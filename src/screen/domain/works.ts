// Works v0 content grammar and host receipt validation. Every parser here
// fails closed: a receipt or content shape it does not recognise throws
// MalformedReceipt instead of being rendered or written back.

import type { Kind } from "../bridge/operations";

export const KINDS: readonly Kind[] = ["doc", "deck", "sheet"];
export const DOC_BLOCK_TYPES = ["h2", "p", "callout"] as const;
export type DocBlockType = (typeof DOC_BLOCK_TYPES)[number];

export const TITLE_BYTES = 240;
export const CONTENT_BYTES = 64 * 1024;

export interface DocBlock {
  type: DocBlockType;
  text: string;
  label?: string;
}
export interface DeckSlide {
  title: string;
  body: string;
  notes?: string;
}
export type Cell = string | number;

export type Content =
  | { kind: "doc"; blocks: DocBlock[] }
  | { kind: "deck"; slides: DeckSlide[] }
  | { kind: "sheet"; columns: string[]; rows: Cell[][] };

export type ReviewState = "draft" | "edited" | "reviewed";
export type ReviewStatus = "none" | "pending" | "approved" | "changes_requested";
export type ExportState = "ready" | "blocked";

export interface WorksRow {
  id: string;
  kind: Kind;
  title: string;
  revision: number;
  reviewedRevision: number;
  reviewState: ReviewState;
  reviewStatus: ReviewStatus;
  exportState: ExportState;
  updated: string;
  snippet: string;
}

export interface WorksItem extends Omit<WorksRow, "snippet"> {
  exportReason: string;
  content: Content;
}

export interface ExportReceipt {
  id: string;
  revision: number;
  format: string;
  digest: string;
}

export class MalformedReceipt extends Error {
  constructor(what: string) {
    super(`Malformed Works receipt: ${what}`);
    this.name = "MalformedReceipt";
  }
}

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (what: string): never => {
  throw new MalformedReceipt(what);
};
const str = (v: unknown, what: string): string => (typeof v === "string" ? v : bad(what));
const posInt = (v: unknown, what: string): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad(what);
const oneOf = <T extends string>(v: unknown, set: readonly T[], what: string): T =>
  typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : bad(what);

const REVIEW_STATES = ["draft", "edited", "reviewed"] as const;
const REVIEW_STATUSES = ["none", "pending", "approved", "changes_requested"] as const;
const EXPORT_STATES = ["ready", "blocked"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const validId = (value: string): boolean => ID.test(value);

const id = (v: unknown): string => {
  const value = str(v, "id");
  return ID.test(value) ? value : bad("id");
};

export const byteLength = (value: string): number => new TextEncoder().encode(value).length;

export function parseContent(kind: Kind, source: Bag): Content {
  if (kind === "doc") {
    if (!Array.isArray(source.blocks)) return bad("doc blocks");
    return {
      kind,
      blocks: source.blocks.map((raw): DocBlock => {
        if (!isBag(raw)) return bad("doc block");
        const type = oneOf(raw.type, DOC_BLOCK_TYPES, "doc block type");
        const text = str(raw.text, "doc block text");
        if (raw.label !== undefined && (type !== "callout" || typeof raw.label !== "string")) {
          return bad("doc block label");
        }
        return raw.label === undefined ? { type, text } : { type, text, label: raw.label as string };
      }),
    };
  }
  if (kind === "deck") {
    if (!Array.isArray(source.slides)) return bad("deck slides");
    return {
      kind,
      slides: source.slides.map((raw): DeckSlide => {
        if (!isBag(raw)) return bad("deck slide");
        const slide: DeckSlide = {
          title: str(raw.title, "slide title"),
          body: str(raw.body, "slide body"),
        };
        if (raw.notes !== undefined) slide.notes = str(raw.notes, "slide notes");
        return slide;
      }),
    };
  }
  if (!Array.isArray(source.columns) || !Array.isArray(source.rows)) return bad("sheet shape");
  const columns = source.columns.map((c) => str(c, "sheet column"));
  const rows = source.rows.map((raw): Cell[] => {
    if (!Array.isArray(raw) || raw.length !== columns.length) return bad("sheet row");
    return raw.map((cell): Cell => {
      if (typeof cell === "string" || (typeof cell === "number" && Number.isFinite(cell))) return cell;
      return bad("sheet cell");
    });
  });
  return { kind, columns, rows };
}

function parseSummary(raw: unknown): Omit<WorksRow, "snippet"> {
  if (!isBag(raw)) return bad("record");
  return {
    id: id(raw.id),
    kind: oneOf(raw.kind, KINDS, "kind"),
    title: str(raw.title, "title"),
    revision: posInt(raw.revision, "revision"),
    reviewedRevision: posInt(raw.reviewedRevision, "reviewedRevision"),
    reviewState: oneOf(raw.reviewState, REVIEW_STATES, "reviewState"),
    reviewStatus: oneOf(raw.reviewStatus, REVIEW_STATUSES, "reviewStatus"),
    exportState: oneOf(raw.exportState, EXPORT_STATES, "exportState"),
    updated: str(raw.updated, "updated"),
  };
}

/** works.query: a bare array of compact rows. */
export function parseRows(raw: unknown): WorksRow[] {
  if (!Array.isArray(raw)) return bad("query result");
  return raw.map((row) => ({
    ...parseSummary(row),
    snippet: typeof (row as Bag).snippet === "string" ? ((row as Bag).snippet as string) : "",
  }));
}

/** works.get, works.patch, works.create, works.restore and works.request_review all return the flat detail. */
export function parseItem(raw: unknown): WorksItem {
  const summary = parseSummary(raw);
  const bag = raw as Bag;
  if (summary.revision < 1) return bad("revision");
  return {
    ...summary,
    exportReason: typeof bag.exportReason === "string" ? bag.exportReason : "",
    content: parseContent(summary.kind, bag),
  };
}

/** works.trash returns the trashed revision so Restore can carry it. */
export function parseTrashed(raw: unknown, itemId: string): number {
  if (!isBag(raw) || raw.trashed !== true || id(raw.id) !== itemId) return bad("trash receipt");
  return posInt(raw.revision, "trash revision");
}

export function parseExport(raw: unknown, itemId: string, revision: number): ExportReceipt {
  if (!isBag(raw)) return bad("export receipt");
  const receipt: ExportReceipt = {
    id: id(raw.id),
    revision: posInt(raw.revision, "export revision"),
    format: str(raw.format, "export format"),
    digest: str(raw.digest, "export digest"),
  };
  if (receipt.id !== itemId || receipt.revision !== revision || !receipt.format || !receipt.digest) {
    return bad("export receipt target");
  }
  return receipt;
}

// ---- content authoring ------------------------------------------------

export const emptyContent = (kind: Kind): Content =>
  kind === "doc"
    ? { kind, blocks: [{ type: "p", text: "" }] }
    : kind === "deck"
      ? { kind, slides: [{ title: "", body: "" }] }
      : { kind, columns: [""], rows: [] };

/** Strip blank optional fields so the host's own validation never sees an empty label or note. */
export function toWire(content: Content): Record<string, unknown> {
  if (content.kind === "doc") {
    return {
      blocks: content.blocks.map((b) => {
        const label = b.type === "callout" ? b.label?.trim() : "";
        return label ? { type: b.type, text: b.text, label } : { type: b.type, text: b.text };
      }),
    };
  }
  if (content.kind === "deck") {
    return {
      slides: content.slides.map((s) => {
        const notes = s.notes?.trim();
        return notes ? { title: s.title, body: s.body, notes } : { title: s.title, body: s.body };
      }),
    };
  }
  return { columns: [...content.columns], rows: content.rows.map((r) => [...r]) };
}

export type DraftProblem =
  | "title_required"
  | "title_long"
  | "block_text"
  | "slide_text"
  | "column_name"
  | "sheet_shape"
  | "content_large";

export function validateDraft(title: string, content: Content): DraftProblem | null {
  const trimmed = title.trim();
  if (!trimmed) return "title_required";
  if (byteLength(trimmed) > TITLE_BYTES) return "title_long";
  if (content.kind === "doc" && content.blocks.some((b) => !b.text.trim())) return "block_text";
  if (content.kind === "deck" && content.slides.some((s) => !s.title.trim() || !s.body.trim())) {
    return "slide_text";
  }
  if (content.kind === "sheet") {
    if (!content.columns.length || content.columns.some((c) => !c.trim())) return "column_name";
    if (content.rows.some((r) => r.length !== content.columns.length)) return "sheet_shape";
  }
  if (byteLength(JSON.stringify(toWire(content))) > CONTENT_BYTES) return "content_large";
  return null;
}

/** Key-order independent equality: an unchanged save must not create a revision. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.hasOwn(b, k) && sameJson((a as Bag)[k], (b as Bag)[k]),
    )
  );
}

/** Columns that held numbers when the item was loaded; edits to them stay numeric while the text is a number. */
export function numericColumns(content: Content): boolean[] {
  if (content.kind !== "sheet") return [];
  return content.columns.map((_, c) => content.rows.some((row) => typeof row[c] === "number"));
}

export function editCell(numeric: boolean, text: string): Cell {
  return numeric && /^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : text;
}

export function patchOperations(
  base: { title: string; content: Content },
  title: string,
  content: Content,
): unknown[] {
  const operations: unknown[] = [];
  if (title.trim() !== base.title) operations.push({ type: "set_title", title: title.trim() });
  const next = toWire(content);
  if (!sameJson(next, toWire(base.content))) operations.push({ type: "set_content", content: next });
  return operations;
}

export const kindSection = (kind: Kind): "docs" | "decks" | "sheets" =>
  kind === "doc" ? "docs" : kind === "deck" ? "decks" : "sheets";

export const sectionKind = (section: string): Kind | undefined =>
  section === "docs" ? "doc" : section === "decks" ? "deck" : section === "sheets" ? "sheet" : undefined;

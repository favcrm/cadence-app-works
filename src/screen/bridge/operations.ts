// Closed Works operation inventory. `scripts/screen_inputs.mjs` reads the
// CALL_FIELDS / SLOT_FIELDS tables below to build the screen declaration, so
// a verb exists in exactly one place.

export const SECTIONS = ["all", "docs", "sheets", "decks"] as const;
export type Section = (typeof SECTIONS)[number];
export type WorksView = "list" | "new";

export type Kind = "doc" | "deck" | "sheet";

export interface QueryArgs {
  text?: string;
  kind?: Kind;
  review?: string;
  sort?: "updated" | "name";
}

export interface CallArgs {
  "works.query": QueryArgs;
  "works.get": { id: string };
  "works.create": { kind: Kind; title: string; content: unknown; idempotency_key: string };
  "works.patch": {
    id: string;
    if_revision: number;
    operations: unknown[];
    idempotency_key: string;
  };
  "works.trash": { id: string; if_revision: number; idempotency_key: string };
  "works.restore": { id: string; if_revision: number; idempotency_key: string };
  "works.request_review": { id: string; revision: number };
  "screen.route.patch": {
    section?: Section;
    view?: WorksView;
    record_id?: string | null;
    segment_id?: string | null;
    params?: Readonly<Record<string, string>>;
    replace?: boolean;
  };
}

// Review and export are host slots: the host draws the confirmation and
// supplies the reviewer decision, reviewer identity and export format.
export interface SlotArgs {
  "works.review": { id: string; revision: number };
  "works.export": { id: string; revision: number };
}

export const CALL_FIELDS: Record<keyof CallArgs, readonly string[]> = {
  "works.query": ["text", "kind", "review", "export", "tag", "owner", "sort"],
  "works.get": ["id"],
  "works.create": ["kind", "title", "content", "tags", "idempotency_key"],
  "works.patch": ["id", "if_revision", "operations", "idempotency_key"],
  "works.trash": ["id", "if_revision", "idempotency_key"],
  "works.restore": ["id", "if_revision", "idempotency_key"],
  "works.request_review": ["id", "revision"],
  "screen.route.patch": ["section", "view", "record_id", "segment_id", "params", "replace"],
};

export const SLOT_FIELDS: Record<keyof SlotArgs, readonly string[]> = {
  "works.review": ["id", "revision"],
  "works.export": ["id", "revision"],
};

export const WRITES: readonly string[] = [
  "works.create",
  "works.patch",
  "works.trash",
  "works.restore",
  "works.request_review",
];

export const OPERATIONS: readonly string[] = [
  ...Object.keys(CALL_FIELDS).filter((verb) => verb.startsWith("works.")),
  ...Object.keys(SLOT_FIELDS),
];

// The host allows 80 KiB for works.create and works.patch; every other Works
// verb keeps the default 16 KiB action budget.
export const LARGE_REQUEST_BUDGET = 81920;
export const REQUEST_BUDGET = 16384;
export const requestBudget = (verb: string): number =>
  verb === "works.create" || verb === "works.patch" ? LARGE_REQUEST_BUDGET : REQUEST_BUDGET;

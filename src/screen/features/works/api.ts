import { ApiError } from "@cadence/screen-ui";
import { channel } from "../../bridge/channel";
import type { Kind, QueryArgs } from "../../bridge/operations";
import type { DisplayScope } from "../../bridge/scope";
import {
  parseExport,
  parseItem,
  parseRows,
  parseTrashed,
  MalformedReceipt,
  toWire,
  type Content,
  type ExportReceipt,
  type WorksItem,
  type WorksRow,
} from "../../domain/works";
import type { MessageKey } from "./localeCatalog";

// One idempotency key per user intent: a retry of the same intent reuses it
// (the host replays the stored result), a different intent gets a new one.
const keys = new Map<string, string>();

function randomKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function intentKey(intent: unknown): string {
  const fingerprint = JSON.stringify(intent);
  let key = keys.get(fingerprint);
  if (!key) {
    key = `w-${randomKey()}`;
    keys.set(fingerprint, key);
  }
  return key;
}

export function settleIntent(intent: unknown): void {
  keys.delete(JSON.stringify(intent));
}

type Bag = Record<string, unknown>;
const call = (scope: DisplayScope, verb: string, args: Bag) => channel.call(scope, verb, args);

export async function queryRows(scope: DisplayScope, args: QueryArgs): Promise<WorksRow[]> {
  return parseRows(await call(scope, "works.query", { ...args }));
}

export async function getItem(scope: DisplayScope, id: string): Promise<WorksItem> {
  const item = parseItem(await call(scope, "works.get", { id }));
  if (item.id !== id) throw new MalformedReceipt("item id");
  return item;
}

export async function createItem(
  scope: DisplayScope,
  kind: Kind,
  title: string,
  content: Content,
): Promise<WorksItem> {
  const body = { kind, title: title.trim(), content: toWire(content) };
  const key = intentKey({ verb: "create", ...body });
  const item = parseItem(await call(scope, "works.create", { ...body, idempotency_key: key }));
  if (item.kind !== kind || item.revision !== 1) throw new MalformedReceipt("created item");
  settleIntent({ verb: "create", ...body });
  return item;
}

export async function patchItem(
  scope: DisplayScope,
  base: WorksItem,
  operations: unknown[],
): Promise<WorksItem> {
  const intent = { verb: "patch", id: base.id, rev: base.revision, operations };
  const item = parseItem(
    await call(scope, "works.patch", {
      id: base.id,
      if_revision: base.revision,
      operations,
      idempotency_key: intentKey(intent),
    }),
  );
  if (item.id !== base.id || item.revision !== base.revision + 1) {
    throw new MalformedReceipt("patched item");
  }
  settleIntent(intent);
  return item;
}

export async function trashItem(scope: DisplayScope, item: WorksItem): Promise<number> {
  const intent = { verb: "trash", id: item.id, rev: item.revision };
  const revision = parseTrashed(
    await call(scope, "works.trash", {
      id: item.id,
      if_revision: item.revision,
      idempotency_key: intentKey(intent),
    }),
    item.id,
  );
  settleIntent(intent);
  return revision;
}

export async function restoreItem(scope: DisplayScope, id: string, revision: number): Promise<WorksItem> {
  const intent = { verb: "restore", id, rev: revision };
  const item = parseItem(
    await call(scope, "works.restore", { id, if_revision: revision, idempotency_key: intentKey(intent) }),
  );
  if (item.id !== id) throw new MalformedReceipt("restored item");
  settleIntent(intent);
  return item;
}

export async function requestReview(scope: DisplayScope, item: WorksItem): Promise<WorksItem> {
  const next = parseItem(
    await call(scope, "works.request_review", { id: item.id, revision: item.revision }),
  );
  if (next.id !== item.id || next.revision !== item.revision || next.reviewStatus !== "pending") {
    throw new MalformedReceipt("review request");
  }
  return next;
}

// Review and export are host slots. The screen names only the item and the
// revision; the host draws the confirmation and supplies the decision and format.
export async function reviewSlot(scope: DisplayScope, item: WorksItem): Promise<void> {
  await channel.slot(scope, "works.review", { id: item.id, revision: item.revision });
}

export async function exportSlot(scope: DisplayScope, item: WorksItem): Promise<ExportReceipt> {
  return parseExport(
    await channel.slot(scope, "works.export", { id: item.id, revision: item.revision }),
    item.id,
    item.revision,
  );
}

export type Failure =
  | { kind: "stale" }
  | { kind: "cancelled" }
  | { kind: "unavailable" }
  | { kind: "message"; key: MessageKey };

/** Closed mapping from a host refusal to screen copy; the host's own text is never shown. */
export function classify(error: unknown): Failure {
  if (error instanceof MalformedReceipt) return { kind: "message", key: "error.malformed" };
  const code = error instanceof ApiError ? (error.code ?? "") : "";
  const status = error instanceof ApiError ? error.status : 0;
  if (code === "conflict" || code === "stale_revision") return { kind: "stale" };
  if (code === "cancelled") return { kind: "cancelled" };
  if (code === "connection_lost" || code === "gone") return { kind: "message", key: "error.lost" };
  if (code === "forbidden" || code === "owner_required" || status === 403) {
    return { kind: "unavailable" };
  }
  const byCode: Record<string, MessageKey> = {
    invalid: "error.invalid",
    not_found: "error.not_found",
    needs_review: "error.needs_review",
    facts_changed: "error.facts_changed",
    unauthorized: "error.unauthorized",
    expired: "error.expired",
    rejected: "error.rejected",
    timeout: "error.timeout",
  };
  if (byCode[code]) return { kind: "message", key: byCode[code] };
  if (status === 429) return { kind: "message", key: "error.busy" };
  return { kind: "message", key: "error.generic" };
}

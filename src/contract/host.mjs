import { createHash } from "node:crypto";

import { contentFixtures } from "../content/fixtures.mjs";
import { createContentReader } from "../content/reader.mjs";

const KINDS = new Set(["deck", "doc", "sheet"]);
const DECISIONS = new Set(["approve", "changes"]);
const clone = (value) => structuredClone(value);
const nowIso = () => new Date().toISOString();
const slug = (title) =>
  String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "untitled";

export class HostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostError";
    this.code = code;
  }
}

const invalid = (message) => {
  throw new HostError("invalid", message);
};

const fieldsFor = (kind, content) => {
  if (!content || typeof content !== "object") invalid("content is required");
  if (kind === "deck") return { slides: clone(content.slides) };
  if (kind === "doc") return { blocks: clone(content.blocks) };
  return { columns: clone(content.columns), rows: clone(content.rows) };
};

const validateItem = (item) => {
  try {
    createContentReader([item]);
  } catch (error) {
    throw new HostError("invalid", error.message);
  }
};

export function createFixtureHost({ fixtures = contentFixtures, clock = nowIso } = {}) {
  const items = new Map();
  const idempotency = new Map();
  const events = [];

  for (const fixture of fixtures) {
    const item = {
      ...clone(fixture),
      author: fixture.author ?? fixture.owner ?? "unknown",
      deleted: false,
      reviewStatus:
        fixture.reviewedRevision === fixture.revision && fixture.reviewedRevision > 0
          ? "approved"
          : "none",
      reviewRequestedRevision: null,
    };
    items.set(item.id, item);
  }

  const activeItems = () => [...items.values()].filter((item) => !item.deleted);
  const find = (id) => items.get(id);
  const alive = (id) => {
    const item = find(id);
    if (!item || item.deleted) throw new HostError("not_found", `content not found: ${id}`);
    return item;
  };

  const history = (actor, action, item, detail = {}) => {
    events.push({
      at: clock(),
      actor,
      action,
      id: item.id,
      revision: item.revision,
      ...detail,
    });
  };

  const authorize = (actor) => {
    if (typeof actor !== "string" || actor.trim() === "") invalid("actor is required");
    return actor;
  };

  const keyFor = (actor, idempotencyKey) => {
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      invalid("idempotencyKey is required");
    }
    return `${actor}:${idempotencyKey}`;
  };

  const replay = (key, payload) => {
    const entry = idempotency.get(key);
    if (!entry) return null;
    if (entry.fingerprint !== JSON.stringify(payload)) {
      throw new HostError("conflict", "idempotency key reused with a different payload");
    }
    return clone(entry.result);
  };

  const remember = (key, payload, result) => {
    idempotency.set(key, { fingerprint: JSON.stringify(payload), result: clone(result) });
  };

  const gate = (item) => {
    return item.reviewStatus === "approved" && item.reviewedRevision === item.revision;
  };

  const summary = (row, item) => ({
    ...row,
    reviewStatus: item.reviewStatus,
    exportState: gate(item) ? "ready" : "blocked",
  });

  const detail = (item) => {
    const result = createContentReader([item]).get(item.id);
    const ready = gate(item);
    result.reviewStatus = item.reviewStatus;
    result.reviewRequestedRevision = item.reviewRequestedRevision;
    result.exportState = ready ? "ready" : "blocked";
    result.exportReason = ready
      ? "This revision is reviewed and ready for host export."
      : item.reviewStatus === "changes_requested"
        ? "Export is blocked until the requested changes are reviewed."
        : "Export is blocked until the current revision is reviewed.";
    return result;
  };

  const uniqueId = (title) => {
    const base = slug(title);
    let id = base;
    let suffix = 2;
    while (items.has(id)) id = `${base}-${suffix++}`;
    return id;
  };

  const query = ({
    text = "",
    kind = "all",
    review,
    export: exportFilter,
    tag,
    owner,
    sort = "updated",
  } = {}) => {
    let rows = createContentReader(activeItems()).list({ query: text, kind, sort });
    rows = rows.map((row) => summary(row, items.get(row.id)));

    if (tag !== undefined) rows = rows.filter((row) => row.tags.includes(tag));
    if (owner !== undefined) rows = rows.filter((row) => row.owner === owner);

    if (review !== undefined) {
      rows = rows.filter((row) => {
        if (review === "pending") return row.reviewStatus === "pending";
        if (review === "changes_requested") return row.reviewStatus === "changes_requested";
        if (review === "approved") {
          return row.reviewStatus === "approved" && row.reviewState === "reviewed";
        }
        return row.reviewState === review;
      });
    }

    if (exportFilter !== undefined) {
      rows = rows.filter((row) => row.exportState === exportFilter);
    }

    return rows.map(clone);
  };

  const get = ({ id } = {}) => detail(alive(id));

  const create = ({ kind, title, content, tags = [], actor, idempotencyKey } = {}) => {
    const who = authorize(actor);
    if (!KINDS.has(kind)) invalid("kind must be deck, doc or sheet");
    if (typeof title !== "string" || title.trim() === "") invalid("title is required");
    if (!Array.isArray(tags)) invalid("tags must be an array");

    const key = keyFor(who, idempotencyKey);
    const payload = { kind, title, content, tags, actor: who };
    const replayed = replay(key, payload);
    if (replayed) return replayed;

    const id = uniqueId(title);
    const item = {
      id,
      title: title.trim(),
      kind,
      revision: 1,
      reviewedRevision: 0,
      owner: who,
      author: who,
      updated: "just now",
      updatedAt: clock(),
      tags: [...tags],
      deleted: false,
      reviewStatus: "none",
      reviewRequestedRevision: null,
      ...fieldsFor(kind, content),
    };

    validateItem(item);
    items.set(id, item);
    history(who, "create", item);
    const result = detail(item);
    remember(key, payload, result);
    return clone(result);
  };

  const patch = ({ id, ifRevision, operations, actor, idempotencyKey } = {}) => {
    const who = authorize(actor);
    if (!Number.isInteger(ifRevision)) invalid("ifRevision is required");
    if (!Array.isArray(operations) || operations.length === 0) invalid("operations are required");

    const key = keyFor(who, idempotencyKey);
    const payload = { id, ifRevision, operations, actor: who };
    const replayed = replay(key, payload);
    if (replayed) return replayed;

    const item = alive(id);
    if (item.revision !== ifRevision) {
      throw new HostError("conflict", `stale revision: current r${item.revision}`);
    }

    const next = clone(item);
    for (const operation of operations) {
      if (!operation || typeof operation !== "object") invalid("operation must be an object");
      if (operation.type === "set_title") {
        if (typeof operation.title !== "string" || operation.title.trim() === "") {
          invalid("set_title requires a title");
        }
        next.title = operation.title.trim();
      } else if (operation.type === "set_content") {
        Object.assign(next, fieldsFor(next.kind, operation.content));
      } else {
        invalid(`unsupported operation: ${operation.type}`);
      }
    }

    next.revision += 1;
    next.author = who;
    next.updated = "just now";
    next.updatedAt = clock();
    next.reviewStatus = "none";
    next.reviewRequestedRevision = null;

    validateItem(next);
    items.set(id, next);
    history(who, "patch", next, { operations: operations.map((operation) => operation.type) });
    const result = detail(next);
    remember(key, payload, result);
    return clone(result);
  };

  const trash = ({ id, ifRevision, actor, idempotencyKey } = {}) => {
    const who = authorize(actor);
    if (!Number.isInteger(ifRevision)) invalid("ifRevision is required");
    const key = keyFor(who, idempotencyKey);
    const payload = { id, ifRevision, actor: who };
    const replayed = replay(key, payload);
    if (replayed) return replayed;

    const item = alive(id);
    if (item.revision !== ifRevision) throw new HostError("conflict", "stale revision");

    const next = clone(item);
    next.deleted = true;
    next.updated = "just now";
    next.updatedAt = clock();
    items.set(id, next);
    history(who, "trash", next);

    const result = { id, revision: next.revision, deleted: true };
    remember(key, payload, result);
    return clone(result);
  };

  const restore = ({ id, ifRevision, actor, idempotencyKey } = {}) => {
    const who = authorize(actor);
    if (!Number.isInteger(ifRevision)) invalid("ifRevision is required");
    const key = keyFor(who, idempotencyKey);
    const payload = { id, ifRevision, actor: who };
    const replayed = replay(key, payload);
    if (replayed) return replayed;

    const item = find(id);
    if (!item) throw new HostError("not_found", `content not found: ${id}`);
    if (!item.deleted) invalid("content is not trashed");
    if (item.revision !== ifRevision) throw new HostError("conflict", "stale revision");

    const next = clone(item);
    next.deleted = false;
    next.updated = "just now";
    next.updatedAt = clock();
    items.set(id, next);
    history(who, "restore", next);

    const result = detail(next);
    remember(key, payload, result);
    return clone(result);
  };

  const requestReview = ({ id, revision, actor } = {}) => {
    const who = authorize(actor);
    const item = alive(id);
    if (item.revision !== revision) throw new HostError("conflict", "stale revision");
    if (item.reviewStatus === "pending") return detail(item);

    const next = clone(item);
    next.reviewStatus = "pending";
    next.reviewRequestedRevision = revision;
    next.updated = "just now";
    next.updatedAt = clock();
    items.set(id, next);
    history(who, "request_review", next);
    return detail(next);
  };

  const review = ({ id, revision, decision, note, actor } = {}) => {
    const who = authorize(actor);
    if (!DECISIONS.has(decision)) invalid("decision must be approve or changes");
    if (note !== undefined && typeof note !== "string") invalid("note must be a string");

    const item = alive(id);
    if (item.revision !== revision) throw new HostError("conflict", "stale revision");
    if (item.reviewStatus !== "pending" || item.reviewRequestedRevision !== revision) {
      throw new HostError("conflict", "no pending review for this revision");
    }
    if (who === item.author) {
      throw new HostError("forbidden", "an author cannot approve their own revision");
    }

    const next = clone(item);
    next.reviewRequestedRevision = null;
    if (decision === "approve") {
      next.reviewedRevision = revision;
      next.reviewStatus = "approved";
    } else {
      next.reviewStatus = "changes_requested";
    }
    next.updated = "just now";
    next.updatedAt = clock();
    items.set(id, next);
    history(who, decision === "approve" ? "review_approve" : "review_changes", next, note ? { note } : {});
    return detail(next);
  };

  const exportContent = ({ id, revision, format = "html", actor = "operator" } = {}) => {
    const who = authorize(actor);
    if (typeof format !== "string" || format === "") invalid("format is required");
    const item = alive(id);
    if (item.revision !== revision) {
      throw new HostError("needs_review", "only the current revision can be exported");
    }
    if (!gate(item)) throw new HostError("needs_review", "the current revision is not approved");

    const digest = `sha256:${createHash("sha256")
      .update(JSON.stringify({ id, revision, title: item.title, content: item }))
      .digest("hex")}`;
    history(who, "export", item, { format, digest });
    return { id, revision, format, digest };
  };

  return Object.freeze({
    query,
    get,
    create,
    patch,
    trash,
    restore,
    request_review: requestReview,
    review,
    export: exportContent,
    audit: () => events.map(clone),
  });
}

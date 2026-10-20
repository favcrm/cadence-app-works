const KINDS = new Set(["deck", "doc", "sheet"]);
const CHANGE_TYPES = new Set(["changed", "added", "removed"]);

export class ContentNotFoundError extends Error {
  constructor(id) {
    super(`content not found: ${id}`);
    this.name = "ContentNotFoundError";
    this.id = id;
  }
}

export class ContentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContentValidationError";
  }
}

const clone = (value) => structuredClone(value);
const fail = (index, message) => {
  throw new ContentValidationError(`contentFixtures[${index}]: ${message}`);
};

const requireString = (value, index, field) => {
  if (typeof value !== "string" || value.trim() === "") fail(index, `${field} must be a non-empty string`);
};

const validateChanges = (changes, index) => {
  if (changes === undefined) return;
  if (!Array.isArray(changes)) fail(index, "changes must be an array");
  changes.forEach((change, changeIndex) => {
    if (!change || typeof change !== "object") fail(index, `changes[${changeIndex}] must be an object`);
    if (!CHANGE_TYPES.has(change.type)) fail(index, `changes[${changeIndex}].type is unsupported`);
    requireString(change.text, index, `changes[${changeIndex}].text`);
  });
};

const validateItem = (item, index) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) fail(index, "item must be an object");
  if (typeof item.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) {
    fail(index, "id must be a lowercase slug");
  }
  requireString(item.title, index, "title");
  if (!KINDS.has(item.kind)) fail(index, "kind must be deck, doc or sheet");
  if (!Number.isInteger(item.revision) || item.revision < 1) fail(index, "revision must be a positive integer");
  if (
    !Number.isInteger(item.reviewedRevision) ||
    item.reviewedRevision < 0 ||
    item.reviewedRevision > item.revision
  ) {
    fail(index, "reviewedRevision must be between 0 and revision");
  }
  requireString(item.owner, index, "owner");
  requireString(item.updated, index, "updated");
  if (typeof item.updatedAt !== "string" || Number.isNaN(Date.parse(item.updatedAt))) {
    fail(index, "updatedAt must be an ISO date");
  }
  if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string")) {
    fail(index, "tags must be an array of strings");
  }

  if (item.kind === "deck") {
    if (!Array.isArray(item.slides) || item.slides.length === 0) fail(index, "deck must have slides");
    item.slides.forEach((slide, slideIndex) => {
      if (!slide || typeof slide !== "object") fail(index, `slides[${slideIndex}] must be an object`);
      requireString(slide.title, index, `slides[${slideIndex}].title`);
      requireString(slide.body, index, `slides[${slideIndex}].body`);
      if (slide.notes !== undefined) requireString(slide.notes, index, `slides[${slideIndex}].notes`);
    });
  } else if (item.kind === "doc") {
    if (!Array.isArray(item.blocks) || item.blocks.length === 0) fail(index, "doc must have blocks");
    item.blocks.forEach((block, blockIndex) => {
      if (!block || typeof block !== "object") fail(index, `blocks[${blockIndex}] must be an object`);
      if (!["h2", "p", "callout"].includes(block.type)) {
        fail(index, `blocks[${blockIndex}].type is unsupported`);
      }
      requireString(block.text, index, `blocks[${blockIndex}].text`);
      if (block.type === "callout" && block.label !== undefined) {
        requireString(block.label, index, `blocks[${blockIndex}].label`);
      }
    });
  } else {
    if (!Array.isArray(item.columns) || item.columns.length === 0) fail(index, "sheet must have columns");
    if (!Array.isArray(item.rows)) fail(index, "sheet must have rows");
    item.columns.forEach((column, columnIndex) => {
      if (columnIndex === 0 && column === "") return;
      requireString(column, index, `columns[${columnIndex}]`);
    });
    item.rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== item.columns.length) {
        fail(index, `rows[${rowIndex}] must match ${item.columns.length} columns`);
      }
      row.forEach((cell, cellIndex) => {
        if (typeof cell !== "string" && typeof cell !== "number") {
          fail(index, `rows[${rowIndex}][${cellIndex}] must be a string or number`);
        }
      });
    });
  }

  validateChanges(item.changes, index);
};

export const reviewStateFor = (item) => {
  if (item.reviewedRevision === 0) return "draft";
  if (item.reviewedRevision === item.revision) return "reviewed";
  return "edited";
};

export const exportStateFor = (item) => {
  return item.reviewedRevision > 0 && item.reviewedRevision === item.revision ? "ready" : "blocked";
};

export const exportReasonFor = (item) => {
  if (exportStateFor(item) === "ready") return "This revision is reviewed and ready for host export.";
  if (reviewStateFor(item) === "draft") return "Export is blocked until the first review approves a revision.";
  return "Export is blocked until the current revision is reviewed.";
};

const searchText = (item) => {
  const parts = [item.title, item.owner, ...item.tags];
  if (item.kind === "deck") {
    item.slides.forEach((slide) => parts.push(slide.title, slide.body, slide.notes ?? ""));
  } else if (item.kind === "doc") {
    item.blocks.forEach((block) => parts.push(block.text, block.label ?? ""));
  } else {
    parts.push(...item.columns);
    item.rows.forEach((row) => parts.push(...row.map(String)));
  }
  return parts.join(" ").toLowerCase();
};

const snippetFor = (item) => {
  if (item.kind === "deck") return `${item.slides.length} slides · ${item.slides[0].body}`;
  if (item.kind === "doc") {
    const lead = item.blocks.find((block) => block.type === "p") ?? item.blocks[0];
    return lead.text;
  }
  return `${item.rows.length} rows · ${item.columns.length} columns`;
};

const summaryFor = (item) => ({
  id: item.id,
  kind: item.kind,
  title: item.title,
  revision: item.revision,
  reviewedRevision: item.reviewedRevision,
  reviewState: reviewStateFor(item),
  exportState: exportStateFor(item),
  updated: item.updated,
  updatedAt: item.updatedAt,
  owner: item.owner,
  tags: [...item.tags],
  snippet: snippetFor(item),
});

const detailFor = (item) => {
  const detail = clone(item);
  detail.reviewState = reviewStateFor(item);
  detail.exportState = exportStateFor(item);
  detail.exportReason = exportReasonFor(item);
  return detail;
};

export function createContentReader(items) {
  if (!Array.isArray(items)) throw new ContentValidationError("content fixtures must be an array");

  const records = items.map((item, index) => {
    validateItem(item, index);
    const copy = clone(item);
    return { item: copy, search: searchText(copy), summary: summaryFor(copy) };
  });

  const ids = new Set();
  records.forEach(({ item }) => {
    if (ids.has(item.id)) throw new ContentValidationError(`duplicate content id: ${item.id}`);
    ids.add(item.id);
  });

  return Object.freeze({
    list({ query = "", kind = "all", sort = "updated" } = {}) {
      if (kind !== "all" && !KINDS.has(kind)) throw new ContentValidationError(`unsupported kind: ${kind}`);
      if (sort !== "updated" && sort !== "name") throw new ContentValidationError(`unsupported sort: ${sort}`);
      const term = String(query).trim().toLowerCase();

      const rows = records.filter(({ item, search }) => {
        if (kind !== "all" && item.kind !== kind) return false;
        return term === "" || search.includes(term);
      });

      rows.sort((a, b) => {
        if (sort === "name") return a.item.title.localeCompare(b.item.title);
        return Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt) || a.item.title.localeCompare(b.item.title);
      });

      return rows.map(({ summary }) => clone(summary));
    },

    get(id) {
      const record = records.find(({ item }) => item.id === id);
      if (!record) throw new ContentNotFoundError(id);
      return detailFor(record.item);
    },
  });
}

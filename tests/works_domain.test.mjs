import assert from "node:assert/strict";
import test from "node:test";
import {
  MalformedReceipt, editCell, numericColumns, parseExport, parseItem, parseRows,
  parseTrashed, patchOperations, toWire, validateDraft,
} from "../src/screen/domain/works.ts";

const doc = {
  id: "plan", kind: "doc", title: "Plan", revision: 2, reviewedRevision: 1,
  reviewState: "edited", reviewStatus: "none", exportState: "blocked",
  exportReason: "x", updated: "just now",
  blocks: [{ type: "h2", text: "Goals" }, { type: "callout", text: "Note", label: "Heads up" }],
};

test("host receipts parse; malformed receipts fail closed", () => {
  assert.equal(parseItem(doc).content.blocks.length, 2);
  assert.throws(() => parseItem({ ...doc, blocks: [{ type: "table", text: "x" }] }), MalformedReceipt);
  assert.throws(() => parseItem({ ...doc, reviewStatus: "approved-ish" }), MalformedReceipt);
  assert.throws(() => parseItem({ ...doc, revision: 0 }), MalformedReceipt);
  assert.throws(() => parseItem({ ...doc, id: "../x" }), MalformedReceipt);
  assert.throws(() => parseItem({ ...doc, kind: "sheet" }), MalformedReceipt);
  assert.throws(() => parseRows({ rows: [] }), MalformedReceipt);
  assert.throws(() => parseTrashed({ id: "other", revision: 2, trashed: true }, "plan"), MalformedReceipt);
  assert.equal(parseTrashed({ id: "plan", revision: 2, trashed: true }, "plan"), 2);
  assert.throws(() => parseExport({ id: "plan", revision: 3, format: "html", digest: "d" }, "plan", 2), MalformedReceipt);
  assert.equal(parseExport({ id: "plan", revision: 2, format: "html", digest: "d" }, "plan", 2).format, "html");
});

test("deck and sheet content follow the v0 grammar", () => {
  const deck = parseItem({ ...doc, kind: "deck", blocks: undefined, slides: [{ title: "A", body: "B", notes: "N" }] });
  assert.equal(deck.content.slides[0].notes, "N");
  const sheet = parseItem({ ...doc, kind: "sheet", blocks: undefined, columns: ["A", "B"], rows: [["x", 1]] });
  assert.deepEqual(numericColumns(sheet.content), [false, true]);
  assert.throws(() => parseItem({ ...doc, kind: "sheet", blocks: undefined, columns: ["A"], rows: [["x", 1]] }), MalformedReceipt);
  assert.equal(editCell(true, "12.5"), 12.5);
  assert.equal(editCell(true, "1."), "1.");
  assert.equal(editCell(false, "12"), "12");
});

test("patch operations carry only real changes, with blank optionals stripped", () => {
  const base = parseItem(doc);
  assert.deepEqual(patchOperations(base, "Plan", base.content), []);
  assert.deepEqual(patchOperations(base, " New ", base.content), [{ type: "set_title", title: "New" }]);
  const blocks = base.content.blocks.map((b) => ({ ...b, label: b.type === "callout" ? "  " : undefined }));
  assert.deepEqual(toWire({ kind: "doc", blocks }).blocks[1], { type: "callout", text: "Note" });
  const [op] = patchOperations(base, "Plan", { kind: "doc", blocks: [{ type: "p", text: "Hi" }] });
  assert.deepEqual(op, { type: "set_content", content: { blocks: [{ type: "p", text: "Hi" }] } });
});

test("draft validation mirrors the host", () => {
  assert.equal(validateDraft(" ", { kind: "doc", blocks: [] }), "title_required");
  assert.equal(validateDraft("T", { kind: "doc", blocks: [{ type: "p", text: " " }] }), "block_text");
  assert.equal(validateDraft("T", { kind: "deck", slides: [{ title: "a", body: "" }] }), "slide_text");
  assert.equal(validateDraft("T", { kind: "sheet", columns: [], rows: [] }), "column_name");
  assert.equal(validateDraft("T", { kind: "sheet", columns: ["a"], rows: [["x", "y"]] }), "sheet_shape");
  assert.equal(validateDraft("x".repeat(241), { kind: "doc", blocks: [] }), "title_long");
  assert.equal(validateDraft("T", { kind: "doc", blocks: [{ type: "p", text: "é".repeat(40000) }] }), "content_large");
  assert.equal(validateDraft("T", { kind: "doc", blocks: [{ type: "p", text: "ok" }] }), null);
});

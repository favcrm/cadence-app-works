import assert from "node:assert/strict";
import test from "node:test";
import { blocksToHtml, docToMarkdown, htmlToMarkdown, inlineMarkdownToHtml } from "../src/screen/cfos/docs/codec.ts";
import {
  coerceCellInput,
  compactSheetRows,
  parseTsv,
  sheetToCsv,
} from "../src/screen/cfos/sheets/codec.ts";
import {
  ERR,
  buildSheetEngine,
  displayCell,
  isErr,
  makeEngine,
  parseRangeText,
} from "../src/screen/cfos/sheets/formula.ts";
import { extractBulletItems, formatAsBullets, isBulletSlide, makeSlideTemplate } from "../src/screen/cfos/slides/codec.ts";
import { validateDraft } from "../src/screen/domain/works.ts";

test("formula engine evaluates arithmetic, aggregations, conditionals, lookup, and cycles", () => {
  const rows = [
    ["Widget", 10, 5, "=B1*C1"],
    ["Gadget", 20, 3, "=B2*C2"],
    ["Total", "=SUM(B1:B2)", "=AVERAGE(C1:C2)", "=SUM(D1:D2)"],
    ["Check", '=IF(D3>100,"High","Low")', '=VLOOKUP("Gadget",A1:D2,4,FALSE)', "=1/0"],
    ["CycleA", "=B5", "=A5", ""],
  ];
  const engine = makeEngine({
    getRaw: (r, c) => rows[r]?.[c] ?? "",
  });

  assert.equal(engine.compute(0, 3), 50);
  assert.equal(engine.compute(1, 3), 60);
  assert.equal(engine.compute(2, 1), 30);
  assert.equal(engine.compute(2, 2), 4);
  assert.equal(engine.compute(2, 3), 110);
  assert.equal(engine.compute(3, 1), "High");
  assert.equal(engine.compute(3, 2), 60);

  const div0 = engine.compute(3, 3);
  assert.ok(isErr(div0) && div0.value === ERR.DIV0().value);

  const cyc = engine.compute(4, 1);
  assert.ok(isErr(cyc) && cyc.value === ERR.CYCLE().value);
});

test("docs codec converts blocks <-> HTML <-> Markdown and satisfies validateDraft", () => {
  const blocks = [
    { type: "h2", text: "Project Plan" },
    { type: "p", text: "Ship **fast** and *safe*." },
    { type: "callout", label: "Risk", text: "Keep payload under 64 KiB." },
  ];
  const html = blocksToHtml(blocks);
  assert.match(html, /<h2>Project Plan<\/h2>/);
  assert.match(html, /<strong>fast<\/strong>/);
  assert.match(html, /<aside data-works-callout="1" data-label="Risk">/);

  const md = docToMarkdown("Roadmap", blocks);
  assert.match(md, /^# Roadmap/);
  assert.match(md, /## Project Plan/);
  assert.match(md, /> \*\*Risk\*\*: Keep payload under 64 KiB\./);

  const inline = inlineMarkdownToHtml("Check [docs](https://example.com) and `code`");
  assert.match(inline, /<a href="https:\/\/example\.com"/);
  assert.match(inline, /<code>code<\/code>/);

  assert.equal(htmlToMarkdown("<p><strong>Hello</strong> world</p>"), "**Hello** world");
  assert.equal(validateDraft("Roadmap", { kind: "doc", blocks }), null);
  assert.equal(validateDraft("Roadmap", { kind: "doc", blocks: [] }), "block_text");
});

test("sheets codec preserves formulas, numbers, CSV/TSV, and validateDraft shape", () => {
  assert.equal(coerceCellInput("42.5"), 42.5);
  assert.equal(coerceCellInput("=SUM(A1:A3)"), "=SUM(A1:A3)");
  assert.equal(coerceCellInput("  "), "");

  const columns = ["Item", "Qty", "Total"];
  const rows = [
    ["Alpha", 4, "=B1*10"],
    ["", "", ""],
  ];
  const compacted = compactSheetRows(columns.length, rows);
  assert.equal(compacted.length, 1);
  assert.equal(validateDraft("Tracker", { kind: "sheet", columns, rows: compacted }), null);

  const engine = buildSheetEngine(columns, compacted);
  assert.deepEqual(displayCell(engine, compacted[0][2], 0, 2), { text: "40", numeric: true });

  const csv = sheetToCsv(columns, compacted);
  assert.equal(csv, "Item,Qty,Total\r\nAlpha,4,=B1*10");
  assert.deepEqual(parseTsv("A\tB\n1\t2\n"), [["A", "B"], ["1", "2"]]);
  assert.deepEqual(parseRangeText("B2:D4"), { r1: 1, c1: 1, r2: 3, c2: 3 });
});

test("slides codec builds valid Works v0 deck slides and formats bullets", () => {
  const slides = [makeSlideTemplate("cover", 0), makeSlideTemplate("bullets", 1)];
  assert.equal(validateDraft("Deck", { kind: "deck", slides }), null);
  assert.equal(isBulletSlide(slides[1].body), true);
  assert.equal(extractBulletItems(slides[1].body).length, 3);
  assert.equal(formatAsBullets("Line 1\nLine 2"), "- Line 1\n- Line 2");
  assert.equal(validateDraft("Deck", { kind: "deck", slides: [] }), "slide_text");
});

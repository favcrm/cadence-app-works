import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DOC_SIDECAR_LABEL,
  blocksToHtml,
  cfosBlocksToHtml,
  cfosDocToWorks,
  docToMarkdown,
  exportDocHtml,
  htmlToMarkdown,
  inlineMarkdownToHtml,
  visibleWorksDocBlocks,
  worksDocToCfos,
} from "../src/screen/cfos/docs/codec.ts";
import {
  SHEET_SIDECAR_PREFIX,
  cfosSheetToWorks,
  coerceCellInput,
  compactSheetRows,
  parseTsv,
  sheetToCsv,
  workbookSheetToCsv,
  worksSheetToCfos,
} from "../src/screen/cfos/sheets/codec.ts";
import {
  ERR,
  FUNCTION_GROUPS,
  buildSheetEngine,
  buildWorkbookEngine,
  displayCell,
  displayValue,
  displayWorkbookCell,
  isErr,
  makeEngine,
  parseRangeText,
} from "../src/screen/cfos/sheets/formula.ts";
import { buildXlsxBytes } from "../src/screen/cfos/sheets/xlsx.ts";
import {
  SLIDE_SIDECAR_MARKER,
  cfosDeckToWorks,
  exportDeckHtml,
  extractBulletItems,
  formatAsBullets,
  isBulletSlide,
  makeCfosSlideTemplate,
  makeSlideTemplate,
  worksDeckToCfos,
} from "../src/screen/cfos/slides/codec.ts";
import { toWire, validateDraft } from "../src/screen/domain/works.ts";

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

test("multi-sheet formula engine evaluates cross-sheet references and formatting", () => {
  assert.ok(Object.keys(FUNCTION_GROUPS).length >= 5);
  assert.ok(FUNCTION_GROUPS.Math.includes("SUM"));

  const wb = {
    title: "Cross-sheet Budget",
    sheetOrder: ["s_1", "s_2", "s_3"],
    sheets: {
      s_1: {
        id: "s_1",
        name: "Summary",
        rows: 10,
        cols: 6,
        colWidths: { 0: 140 },
        rowHeights: {},
        frozenRows: 1,
        frozenCols: 0,
      },
      s_2: {
        id: "s_2",
        name: "Sheet2",
        rows: 10,
        cols: 6,
        colWidths: {},
        rowHeights: {},
        frozenRows: 0,
        frozenCols: 0,
      },
      s_3: {
        id: "s_3",
        name: "Q2 Data",
        rows: 10,
        cols: 6,
        colWidths: {},
        rowHeights: {},
        frozenRows: 0,
        frozenCols: 0,
      },
    },
    cells: {
      s_1: {
        A1: { value: "Doubled", fmt: { b: true } },
        B1: { value: "=Sheet2!B1*2", fmt: { nf: "currency", d: 2 } },
        B2: { value: "='Q2 Data'!A2", fmt: { nf: "percent", d: 1 } },
      },
      s_2: {
        A1: { value: "Rate", fmt: null },
        B1: { value: "125", fmt: null },
      },
      s_3: {
        A1: { value: "Growth", fmt: null },
        A2: { value: "0.245", fmt: null },
      },
    },
  };

  const engine = buildWorkbookEngine(wb, "s_1");
  assert.equal(engine.compute(0, 1, "s_1"), 250);
  assert.equal(engine.compute(1, 1, "s_1"), 0.245);
  assert.deepEqual(displayWorkbookCell(engine, "s_1", wb.cells.s_1.B1, 0, 1), {
    text: "$250.00",
    numeric: true,
  });
  assert.deepEqual(displayWorkbookCell(engine, "s_1", wb.cells.s_1.B2, 1, 1), {
    text: "24.5%",
    numeric: true,
  });

  assert.equal(displayValue(1234.5, { nf: "currency", d: 2 }).text, "$1,234.50");
  assert.equal(displayValue(0.375, { nf: "percent", d: 1 }).text, "37.5%");
  assert.equal(displayValue(1234, { nf: "scientific", d: 2 }).text, "1.23E+3");
  assert.equal(displayValue(45292, { nf: "date" }).text, "1/1/2024");
  assert.equal(displayValue(3.14159, { d: 3 }).text, "3.142");
});

test("buildXlsxBytes generates valid OOXML ZIP archive bytes", async () => {
  const wb = {
    title: "Export Check",
    sheetOrder: ["s_1", "s_2"],
    sheets: {
      s_1: {
        id: "s_1",
        name: "Summary",
        rows: 5,
        cols: 4,
        colWidths: { 0: 150 },
        rowHeights: {},
        frozenRows: 1,
        frozenCols: 0,
      },
      s_2: {
        id: "s_2",
        name: "Details",
        rows: 5,
        cols: 4,
        colWidths: {},
        rowHeights: {},
        frozenRows: 0,
        frozenCols: 0,
      },
    },
    cells: {
      s_1: {
        A1: { value: "Item", fmt: { b: true, bg: "#f1f5f9" } },
        B1: { value: "Cost", fmt: { b: true } },
        A2: { value: "Hosting", fmt: null },
        B2: { value: "=Details!A1*10", fmt: { nf: "currency", d: 2 } },
      },
      s_2: {
        A1: { value: "42", fmt: null },
      },
    },
  };

  const bytes = await buildXlsxBytes(wb);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 500);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
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

test("docs codec performs lossless Wire v0 roundtrips for rich CFOS blocks", () => {
  const richBlocks = [
    { id: "b_1", html: '<h1 class="doc-title" data-block-id="b_1">Launch Brief</h1>' },
    { id: "b_2", html: '<h1 data-block-id="b_2">Overview</h1>' },
    { id: "b_3", html: '<blockquote data-block-id="b_3">Focus on latency first.</blockquote>' },
    { id: "b_4", html: '<pre data-block-id="b_4"><code>const ok = true;</code></pre>' },
    {
      id: "b_5",
      html: '<p data-block-id="b_5"><span style="color: #dc2626">Highlighted</span> summary</p>',
    },
    {
      id: "b_6",
      html: '<figure data-block-id="b_6"><img src="data:image/png;base64,iVBORw0KGgo=" alt="chart"></figure>',
    },
  ];

  const wireBlocks = cfosDocToWorks(richBlocks);
  assert.equal(validateDraft("Rich Doc", { kind: "doc", blocks: wireBlocks }), null);
  assert.ok(wireBlocks.some((b) => b.type === "callout" && b.label === DOC_SIDECAR_LABEL));
  assert.equal(
    visibleWorksDocBlocks(wireBlocks).some((b) => b.label === DOC_SIDECAR_LABEL),
    false,
  );

  const restored = worksDocToCfos(wireBlocks);
  assert.deepEqual(restored, richBlocks);
  assert.match(cfosBlocksToHtml(restored), /class="doc-title"/);
  assert.match(exportDocHtml("Rich Doc", restored), /<!doctype html>/i);
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

test("sheets codec performs lossless Wire v0 roundtrips for multi-sheet formatted workbooks", () => {
  const wb = {
    title: "Multi Sheet",
    sheetOrder: ["s_1", "s_2"],
    sheets: {
      s_1: {
        id: "s_1",
        name: "Revenue",
        rows: 28,
        cols: 10,
        colHeaders: ["Category", "Amount"],
        colWidths: { 0: 180, 1: 120 },
        rowHeights: { 0: 32 },
        frozenRows: 1,
        frozenCols: 0,
      },
      s_2: {
        id: "s_2",
        name: "Assumptions",
        rows: 28,
        cols: 10,
        colHeaders: ["Rate"],
        colWidths: { 0: 120 },
        rowHeights: {},
        frozenRows: 0,
        frozenCols: 0,
      },
    },
    cells: {
      s_1: {
        A1: { value: "Enterprise", fmt: { b: true, bg: "#dbeafe" } },
        B1: { value: "=Assumptions!A1*1000", fmt: { nf: "currency", d: 2, c: "#1d4ed8" } },
      },
      s_2: {
        A1: { value: "12.5", fmt: { nf: "number", d: 1 } },
      },
    },
  };

  const wire = cfosSheetToWorks(wb);
  assert.equal(validateDraft("Multi Sheet", wire), null);
  assert.ok(String(wire.rows.at(-1)?.[0] ?? "").startsWith(SHEET_SIDECAR_PREFIX));

  const restored = worksSheetToCfos(wire, "Multi Sheet");
  assert.deepEqual(restored.sheetOrder, ["s_1", "s_2"]);
  assert.equal(restored.sheets.s_1.frozenRows, 1);
  assert.equal(restored.sheets.s_1.colWidths[0], 180);
  assert.deepEqual(restored.cells.s_1.B1.fmt, { nf: "currency", d: 2, c: "#1d4ed8" });
  assert.equal(restored.cells.s_2.A1.value, "12.5");
  assert.match(workbookSheetToCsv(restored, "s_1"), /Enterprise/);
});

test("slides codec builds valid Works v0 deck slides and formats bullets", () => {
  const slides = [makeSlideTemplate("cover", 0), makeSlideTemplate("bullets", 1)];
  assert.equal(validateDraft("Deck", { kind: "deck", slides }), null);
  assert.equal(isBulletSlide(slides[1].body), true);
  assert.equal(extractBulletItems(slides[1].body).length, 3);
  assert.equal(formatAsBullets("Line 1\nLine 2"), "- Line 1\n- Line 2");
  assert.equal(validateDraft("Deck", { kind: "deck", slides: [] }), "slide_text");
});

test("slides codec performs lossless Wire v0 roundtrips for multi-block CFOS decks", () => {
  const cover = makeCfosSlideTemplate("cover", 0);
  const twoCol = makeCfosSlideTemplate("twoCol", 1);
  twoCol.background = { color: "#0f172a", inset: true, dotGrid: 0.15 };
  twoCol.blocks[0].x = 96;
  twoCol.blocks[0].props.color = "#f97316";

  const deck = { themeVersion: "1", slides: [cover, twoCol] };
  const speakerNotes = { [cover.id]: "Open strong", [twoCol.id]: "Compare options" };

  const wireSlides = cfosDeckToWorks(deck, speakerNotes);
  assert.equal(validateDraft("Rich Deck", { kind: "deck", slides: wireSlides }), null);
  assert.ok(wireSlides.every((s) => (s.notes ?? "").includes(SLIDE_SIDECAR_MARKER.trim())));

  const restored = worksDeckToCfos(wireSlides);
  assert.equal(restored.deck.slides.length, 2);
  assert.deepEqual(restored.deck.slides[0], cover);
  assert.deepEqual(restored.deck.slides[1], twoCol);
  assert.equal(restored.speakerNotes[cover.id], "Open strong");
  assert.equal(restored.speakerNotes[twoCol.id], "Compare options");
  assert.match(exportDeckHtml("Rich Deck", restored.deck), /<!doctype html>/i);
});

test("regression: empty speaker notes survive toWire trimming and h2 strips markdown hash", () => {
  const twoCol = makeCfosSlideTemplate("twoCol", 0);
  const deck = { themeVersion: "1", slides: [twoCol] };
  const wireSlides = cfosDeckToWorks(deck, {});
  const trimmedWire = toWire({ kind: "deck", slides: wireSlides }).slides;
  const restored = worksDeckToCfos(trimmedWire);
  assert.deepEqual(restored.deck.slides[0], twoCol);

  const wireDoc = cfosDocToWorks([
    { id: "b_1", html: '<h2 data-block-id="b_1"><a href="https://example.com">Goals</a></h2>' },
  ]);
  assert.equal(wireDoc[0].type, "h2");
  assert.equal(wireDoc[0].text.startsWith("##"), false);
  assert.ok(wireDoc.some((b) => b.type === "callout" && b.label === DOC_SIDECAR_LABEL));
});

test("regression: exported HTML keeps full document shell while built client.js omits literal document tags", () => {
  const docHtml = exportDocHtml("Spec", [{ id: "b_1", html: "<p>Hello</p>" }]);
  for (const tag of ["<!doctype html>", "<html", "<head>", "<body>", "</body>", "</html>"]) {
    assert.ok(docHtml.includes(tag), `docHtml missing ${tag}`);
  }
  const deckHtml = exportDeckHtml("Deck", {
    themeVersion: "1",
    slides: [makeCfosSlideTemplate("cover", 0)],
  });
  for (const tag of ["<!doctype html>", "<html", "<head>", "<body>", "</body>", "</html>"]) {
    assert.ok(deckHtml.includes(tag), `deckHtml missing ${tag}`);
  }
  const clientJs = readFileSync(new URL("../app/screens/works/client.js", import.meta.url), "utf8");
  assert.equal(/<\/?(?:head|body|html)\b/i.test(clientJs), false);
});

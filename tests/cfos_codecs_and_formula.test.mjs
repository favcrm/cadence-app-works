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
import { buildDocxBytes } from "../src/screen/cfos/docs/docx.ts";
import { ImportError, importFileToWorksDraft, readZipEntries } from "../src/screen/cfos/import/ooxml.ts";
import { buildXlsxBytes } from "../src/screen/cfos/sheets/xlsx.ts";
import { buildPptxBytes } from "../src/screen/cfos/slides/pptx.ts";
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

async function parseZipEntries(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const eocdOffset = archive.byteLength - 22;
  assert.equal(view.getUint32(eocdOffset, true), 0x06054b50);
  const count = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  assert.equal(centralOffset + centralSize, eocdOffset);

  const entries = new Map();
  let cursor = centralOffset;
  let localCursor = 0;
  for (let i = 0; i < count; ++i) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    assert.equal(localOffset, localCursor);
    const name = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen;

    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLen;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const inflatedStream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(compressed);
        ctrl.close();
      },
    }).pipeThrough(new DecompressionStream("deflate-raw"));
    const inflated = new Uint8Array(await new Response(inflatedStream).arrayBuffer());
    assert.equal(inflated.byteLength, uncompressedSize);
    entries.set(name, inflated);
    localCursor = dataStart + compressedSize + 16;
  }
  assert.equal(cursor, eocdOffset);
  return entries;
}

test("pptx exporter builds valid PresentationML archive with logo expansion, cover gradient, cards, and media", async () => {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  const cover = makeCfosSlideTemplate("cover", 0);
  const twoCol = makeCfosSlideTemplate("twoCol", 1);
  const mediaSlide = {
    id: "s_media",
    background: { color: "#FFFFFF", inset: false },
    blocks: [
      {
        id: "b_img",
        type: "image",
        x: 60,
        y: 80,
        w: 400,
        h: 300,
        props: {
          src: `data:image/png;base64,${tinyPngBase64}`,
          fit: "contain",
          alt: "Tiny square",
        },
      },
      {
        id: "b_arrow",
        type: "arrow",
        x: 500,
        y: 120,
        props: { x1: 500, y1: 120, x2: 700, y2: 200, color: "tangerine", label: "Flow" },
      },
    ],
  };

  const bytes = await buildPptxBytes({
    themeVersion: "1",
    slides: [cover, twoCol, mediaSlide],
  });
  const entries = await parseZipEntries(bytes);
  const decoder = new TextDecoder();

  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide3.xml",
    "ppt/media/image1.png",
  ]) {
    assert.ok(entries.has(required), `missing ZIP entry ${required}`);
  }

  const contentTypesXml = decoder.decode(entries.get("[Content_Types].xml"));
  assert.match(contentTypesXml, /Extension="png" ContentType="image\/png"/);
  assert.match(contentTypesXml, /PartName="\/ppt\/slides\/slide3\.xml"/);

  const slide1Xml = decoder.decode(entries.get("ppt/slides/slide1.xml"));
  assert.match(slide1Xml, /Cover gradient/);
  assert.match(slide1Xml, /a:gradFill/);
  assert.match(slide1Xml, />Works</);
  assert.match(slide1Xml, /prst="ellipse"/);

  const slide3Xml = decoder.decode(entries.get("ppt/slides/slide3.xml"));
  assert.match(slide3Xml, /<p:pic>/);
  assert.match(slide3Xml, /r:embed="rId2"/);
  assert.match(slide3Xml, /<p:cxnSp>/);
  assert.match(slide3Xml, />Flow</);

  await assert.rejects(
    () => buildPptxBytes({ slides: Array.from({ length: 501 }, () => ({ blocks: [] })) }),
    /supports at most 500/,
  );
});

test("pptx exporter writes speakerNotes slides and CJK East Asian font fallbacks", async () => {
  const cover = makeCfosSlideTemplate("cover", 0);
  const deck = { themeVersion: "1", slides: [cover] };
  const notes = { [cover.id]: "開場說明：歡迎使用 Works" };
  const bytes = await buildPptxBytes(deck, notes);
  const entries = await parseZipEntries(bytes);
  const decoder = new TextDecoder();

  assert.ok(entries.has("ppt/notesSlides/notesSlide1.xml"));
  assert.ok(entries.has("ppt/notesSlides/_rels/notesSlide1.xml.rels"));
  const slideRels = decoder.decode(entries.get("ppt/slides/_rels/slide1.xml.rels"));
  assert.match(slideRels, /notesSlides\/notesSlide1\.xml/);
  const notesXml = decoder.decode(entries.get("ppt/notesSlides/notesSlide1.xml"));
  assert.match(notesXml, /歡迎使用 Works/);
  assert.match(decoder.decode(entries.get("ppt/slides/slide1.xml")), /Noto Sans TC/);
  assert.match(decoder.decode(entries.get("docProps/app.xml")), /<Notes>1<\/Notes>/);

  const imported = await importFileToWorksDraft("中文簡報.pptx", bytes);
  assert.equal(imported.kind, "deck");
  assert.equal(validateDraft(imported.title, imported.content), null);
  assert.equal(imported.content.slides.length, 1);
  assert.match(imported.content.slides[0].notes ?? "", /歡迎使用 Works/);
});

test("docx exporter and importer round-trip headings, lists, links, inline formatting, and embedded PNG", async () => {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
  const blocks = [
    { id: "b_1", html: "<h1>Project Spec</h1>" },
    {
      id: "b_2",
      html: '<p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com">link</a>.</p>',
    },
    { id: "b_3", html: "<ul><li>First item</li><li>Second item</li></ul>" },
    { id: "b_4", html: `<p><img src="data:image/png;base64,${tinyPngBase64}" alt="dot"></p>` },
  ];

  const docxBytes = await buildDocxBytes("Project Spec", blocks);
  const entries = await parseZipEntries(docxBytes);
  const decoder = new TextDecoder();
  for (const req of [
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "word/document.xml",
    "word/_rels/document.xml.rels",
    "word/styles.xml",
    "word/numbering.xml",
    "word/media/image1.png",
  ]) {
    assert.ok(entries.has(req), `missing DOCX entry ${req}`);
  }
  const docXml = decoder.decode(entries.get("word/document.xml"));
  assert.match(docXml, /Heading1/);
  assert.match(docXml, /<w:b\/>/);
  assert.match(docXml, /<w:hyperlink /);
  assert.match(docXml, /<pic:pic>/);

  const imported = await importFileToWorksDraft("Project-Spec.docx", docxBytes);
  assert.equal(imported.kind, "doc");
  assert.equal(imported.title, "Project Spec");
  assert.equal(validateDraft(imported.title, imported.content), null);
  const restored = worksDocToCfos(imported.content.blocks);
  assert.ok(restored.some((b) => /<h1/.test(b.html) && b.html.includes("Project Spec")));
  assert.ok(restored.some((b) => b.html.includes("<strong>Bold</strong>")));
  assert.ok(restored.some((b) => b.html.includes("https://example.com")));
});

test("xlsx, csv, and markdown importers produce valid Works drafts and reject unsafe archives", async () => {
  const wb = worksSheetToCfos(
    {
      kind: "sheet",
      columns: ["Item", "Amount"],
      rows: [
        ["Server", 120],
        ["Total", "=SUM(B1:B1)"],
      ],
    },
    "Infra Costs",
  );
  const xlsxBytes = await buildXlsxBytes(wb);
  const importedSheet = await importFileToWorksDraft("Infra-Costs.xlsx", xlsxBytes);
  assert.equal(importedSheet.kind, "sheet");
  assert.equal(validateDraft(importedSheet.title, importedSheet.content), null);
  const restoredWb = worksSheetToCfos(importedSheet.content, importedSheet.title);
  const s1 = restoredWb.cells[restoredWb.sheetOrder[0]];
  assert.equal(s1.A1.value, "Item");
  assert.equal(s1.B1.value, "Amount");
  assert.equal(s1.A2.value, "Server");
  assert.equal(s1.B3.value, "=SUM(B1:B1)");

  const csvDraft = await importFileToWorksDraft(
    "sales.csv",
    new TextEncoder().encode("Product,Qty\r\nWidget,5\r\n"),
  );
  assert.equal(csvDraft.kind, "sheet");
  assert.equal(validateDraft(csvDraft.title, csvDraft.content), null);
  assert.equal(csvDraft.content.rows[1][0], "Widget");

  const mdDraft = await importFileToWorksDraft(
    "notes.md",
    new TextEncoder().encode("# Q4 Notes\n\n## Goals\n\n> Ship clean imports\n"),
  );
  assert.equal(mdDraft.kind, "doc");
  assert.equal(mdDraft.title, "Q4 Notes");
  assert.equal(validateDraft(mdDraft.title, mdDraft.content), null);

  // Refusals
  await assert.rejects(
    () => importFileToWorksDraft("macro.xlsm", new Uint8Array([1, 2, 3])),
    (e) => e instanceof ImportError && e.code === "macros",
  );
  await assert.rejects(
    () => importFileToWorksDraft("bad.docx", new Uint8Array([1, 2, 3, 4])),
    (e) => e instanceof ImportError && e.code === "malformed",
  );
  await assert.rejects(
    () => importFileToWorksDraft("huge.docx", new Uint8Array(10 * 1024 * 1024 + 1)),
    (e) => e instanceof ImportError && e.code === "too_large",
  );
  await assert.rejects(
    () => importFileToWorksDraft("script.exe", new Uint8Array([1, 2, 3])),
    (e) => e instanceof ImportError && e.code === "unsupported",
  );

  // Path traversal and encryption flags inside synthetic ZIP central directory
  const fakeDocx = await buildDocxBytes("Safe", [{ id: "b_1", html: "<p>Hello</p>" }]);
  const patchedEncrypted = new Uint8Array(fakeDocx);
  const eocdOff = patchedEncrypted.length - 22;
  const cdOff = new DataView(patchedEncrypted.buffer).getUint32(eocdOff + 16, true);
  // Set bit 0 (encrypted) in first CD entry flags (offset + 8)
  patchedEncrypted[cdOff + 8] |= 0x01;
  await assert.rejects(
    () => readZipEntries(patchedEncrypted),
    (e) => e instanceof ImportError && e.code === "encrypted",
  );
});

test("import polish: core.xml titles, Word tables round-trip, empty shared formulas, slide numbers, and truncation warningCodes", async () => {
  const tableBlocks = [
    { id: "b_1", html: "<h2>Quarterly Summary</h2>" },
    {
      id: "b_2",
      html: "<table><tbody><tr><th>Region</th><th>ARR</th></tr><tr><td>APAC</td><td>$120k</td></tr></tbody></table>",
    },
  ];
  const docxBytes = await buildDocxBytes("Q4 營運報告", tableBlocks);
  const importedDoc = await importFileToWorksDraft("renamed-file.docx", docxBytes);
  assert.equal(importedDoc.title, "Q4 營運報告");
  assert.equal(validateDraft(importedDoc.title, importedDoc.content), null);
  const restored = worksDocToCfos(importedDoc.content.blocks);
  assert.ok(restored.some((b) => b.html.includes("<table") && b.html.includes("APAC") && b.html.includes("$120k")));

  // Synthetic XLSX with <dc:title> and an empty shared formula <f t="shared" si="0"/> falling back to cached <v>
  const { buildZipBytes: _unused } = {};
  const enc = new TextEncoder();
  const buildStoredZip = (files) => {
    const parts = [];
    const cd = [];
    let offset = 0;
    for (const [name, data] of files) {
      const nb = enc.encode(name);
      const db = enc.encode(data);
      const lfh = new Uint8Array(30 + nb.length);
      const lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(26, nb.length, true);
      lfh.set(nb, 30);
      parts.push(lfh, db);
      const cdh = new Uint8Array(46 + nb.length);
      const cv = new DataView(cdh.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint32(20, db.length, true);
      cv.setUint32(24, db.length, true);
      cv.setUint16(28, nb.length, true);
      cv.setUint32(42, offset, true);
      cdh.set(nb, 46);
      cd.push(cdh);
      offset += lfh.length + db.length;
    }
    const cdSize = cd.reduce((s, b) => s + b.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    for (const chunk of [...parts, ...cd, eocd]) {
      out.set(chunk, p);
      p += chunk.length;
    }
    return out;
  };

  const xlsxZip = buildStoredZip([
    [
      "docProps/core.xml",
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Board Budget 2027</dc:title></cp:coreProperties>',
    ],
    [
      "xl/workbook.xml",
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Main" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    [
      "xl/worksheets/sheet1.xml",
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Total</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Cloud</t></is></c><c r="B2"><f t="shared" si="0"/><v>420</v></c></row></sheetData></worksheet>',
    ],
  ]);
  const importedXlsx = await importFileToWorksDraft("random-name.xlsx", xlsxZip);
  assert.equal(importedXlsx.title, "Board Budget 2027");
  assert.equal(importedXlsx.content.rows[1][1], 420);

  // Synthetic PPTX verifying <dc:title> and sldNum filtering inside notesSlide
  const pptxZip = buildStoredZip([
    [
      "docProps/core.xml",
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Keynote Deck</dc:title></cp:coreProperties>',
    ],
    [
      "ppt/presentation.xml",
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    ],
    [
      "ppt/_rels/presentation.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    ],
    [
      "ppt/slides/slide1.xml",
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Welcome</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    ],
    [
      "ppt/slides/_rels/slide1.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    ],
    [
      "ppt/notesSlides/notesSlide1.xml",
      '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Keep note clean</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" idx="10"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
    ],
  ]);
  const importedPptx = await importFileToWorksDraft("deck-abc.pptx", pptxZip);
  assert.equal(importedPptx.title, "Keynote Deck");
  const rawNote = (importedPptx.content.slides[0].notes ?? "").split("\n---cfos-slide-v1---\n")[0];
  assert.equal(rawNote, "Keep note clean");

  // Truncation warningCodes
  const hugeMd = Array.from({ length: 1200 }, (_, i) => `Paragraph ${i} ` + "x".repeat(80)).join("\n\n");
  const bigDraft = await importFileToWorksDraft("big.md", enc.encode(hugeMd));
  assert.ok(bigDraft.warningCodes.includes("truncated_doc"));
});

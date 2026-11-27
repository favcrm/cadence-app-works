// Ported from cloudflare-os workspace-sheets/files/client.ts
// Full spreadsheet workbench: multi-sheet tabs, cross-sheet formulas, cell formatting,
// number formats, drag resize, frozen panes, right-click context menu, TSV clipboard, CSV/XLSX export.

import type { Cell as WireCell } from "../../domain/works";
import { runToolbarPdfExport, sanitizeFileName, triggerDownload } from "../ui/download";
import { el, icon } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { promptInline } from "../ui/prompt";
import {
  bindActionMenu,
  colorBtn,
  customSelect,
  group,
  iconBtn,
  segBtn,
  type SelectOption,
} from "../ui/toolbar";
import {
  MIN_VISUAL_ROWS,
  cfosSheetToWorks,
  parseTsv,
  workbookSheetToCsv,
  worksSheetToCfos,
} from "./codec";
import {
  FUNCTION_GROUPS,
  buildWorkbookEngine,
  colToLetter,
  columnHeaderLabel,
  displayWorkbookCell,
  exportSheetHtml,
  formatSelectionRef,
  isErr,
  parseFormula,
  parseRangeText,
  parseRef,
  rcToRef,
  serializeAst,
  type Ast,
  type CellFmt,
  type CellMap,
  type Dims,
  type RC,
  type Value,
  type WorkbookModel,
} from "./formula";
import { buildXlsxBytes } from "./xlsx";

export interface SheetLabels {
  undo: string;
  redo: string;
  autoSum: string;
  insertFunction: string;
  numberFormat: string;
  currency: string;
  percent: string;
  decDec: string;
  incDec: string;
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  textColor: string;
  fillColor: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  wrapText: string;
  sortAsc: string;
  sortDesc: string;
  addRow: string;
  delRow: string;
  addCol: string;
  delCol: string;
  freezeRow: string;
  clearFormat: string;
  exportMenu: string;
  downloadPdf: string;
  pdfExportFailed: string;
  downloadXlsx: string;
  downloadCsv: string;
  copyCsv: string;
  renameColPrompt: string;
  newColDefault: string;
  nameBoxTitle: string;
  formulaPlaceholder: string;
  addSheet: string;
  renameSheet: string;
  duplicateSheet: string;
  deleteSheet: string;
  ctxCut: string;
  ctxCopy: string;
  ctxPaste: string;
  ctxClear: string;
}

const DEFAULT_COL_W = 104;
const DEFAULT_ROW_H = 25;
const HEAD_W = 44;

interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface MountSheetsOptions {
  host: HTMLElement;
  columns: readonly string[];
  rows: readonly (readonly WireCell[])[];
  documentTitle?: string;
  readOnly: boolean;
  labels: SheetLabels;
  onChange: (next: { columns: string[]; rows: WireCell[][] }) => void;
}

export interface MountedSheetsHandle {
  updateExternal: (columns: readonly string[], rows: readonly (readonly WireCell[])[], title?: string) => void;
  destroy: () => void;
}

export function mountSheets({
  host,
  columns,
  rows,
  documentTitle = "Untitled sheet",
  readOnly,
  labels,
  onChange,
}: MountSheetsOptions): MountedSheetsHandle {
  let model: WorkbookModel = worksSheetToCfos(
    { kind: "sheet", columns: [...columns], rows: rows.map((r) => [...r]) },
    documentTitle,
  );
  let activeSheetId = model.sheetOrder[0];
  let engine = buildWorkbookEngine(model, activeSheetId);
  let lastSerialized = JSON.stringify({ columns, rows });

  let anchor: RC = { r: 0, c: 0 };
  let focus: RC = { r: 0, c: 0 };
  let editing: { ref: string; r: number; c: number } | null = null;
  let mouseSelecting: false | "cell" | "col" | "row" = false;
  let copyFallback: { tsv: string; cells: (CellMap[string] | null)[][] } | null = null;
  let ctxEl: HTMLElement | null = null;

  const undoStack: string[] = [];
  const redoStack: string[] = [];

  const curSheet = () => model.sheets[activeSheetId];
  const curCells = (): CellMap => model.cells[activeSheetId] || (model.cells[activeSheetId] = {});
  const colWidth = (c: number) => curSheet().colWidths[c] || DEFAULT_COL_W;
  const rowHeight = (r: number) => curSheet().rowHeights[r] || DEFAULT_ROW_H;
  const selRange = (): Range => ({
    r1: Math.min(anchor.r, focus.r),
    c1: Math.min(anchor.c, focus.c),
    r2: Math.max(anchor.r, focus.r),
    c2: Math.max(anchor.c, focus.c),
  });

  const rebuildEngine = () => {
    engine = buildWorkbookEngine(model, activeSheetId);
  };

  const emit = () => {
    if (readOnly) return;
    const wire = cfosSheetToWorks(model);
    const out = { columns: wire.columns, rows: wire.rows };
    const serialized = JSON.stringify(out);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    onChange(out);
  };

  const snapshot = (): string => JSON.stringify({ model, activeSheetId });
  const pushUndo = () => {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
    updateUndoBtns();
  };

  // --- Controls ------------------------------------------------------------
  const undoBtn = iconBtn(ICONS.undo, labels.undo, () => undo());
  const redoBtn = iconBtn(ICONS.redo, labels.redo, () => redo());
  const sumBtn = iconBtn(ICONS.sigma, labels.autoSum, () => autoSum());
  const fxBtn = iconBtn(null, labels.insertFunction, () => {}, "ƒx");

  const NUMBER_FORMATS: SelectOption[] = [
    { value: "auto", label: "Automatic", ex: "" },
    { value: "text", label: "Plain text", ex: "" },
    { sep: true },
    { value: "number", label: "Number", ex: "1,000.12" },
    { value: "integer", label: "Number (int)", ex: "1,000" },
    { value: "percent", label: "Percent", ex: "10.12%" },
    { value: "scientific", label: "Scientific", ex: "1.01E+03" },
    { sep: true },
    { value: "currency", label: "Currency", ex: "$1,000.12" },
    { sep: true },
    { value: "date", label: "Date", ex: "9/26/2026" },
    { value: "time", label: "Time", ex: "3:59:00 PM" },
    { value: "datetime", label: "Date time", ex: "9/26/2026 15:59" },
  ];
  const fmtSel = customSelect({
    className: "cfos-fmt-sel",
    title: labels.numberFormat,
    options: NUMBER_FORMATS,
    value: "auto",
    onChange: (v) =>
      setFmtOnSelection((f) => {
        if (v === "auto") delete f.nf;
        else f.nf = v;
      }),
  });

  const currencyBtn = iconBtn(null, labels.currency, () =>
    setFmtOnSelection((f) => {
      f.nf = "currency";
    }),
    "$",
  );
  const percentBtn = iconBtn(null, labels.percent, () =>
    setFmtOnSelection((f) => {
      f.nf = "percent";
    }),
    "%",
  );
  const decDecBtn = iconBtn(null, labels.decDec, () => changeDecimals(-1), "-.0");
  const incDecBtn = iconBtn(null, labels.incDec, () => changeDecimals(1), ".00");

  const boldBtn = iconBtn(ICONS.bold, labels.bold, () => toggleFmt("b"));
  const italicBtn = iconBtn(ICONS.italic, labels.italic, () => toggleFmt("i"));
  const underlineBtn = iconBtn(ICONS.underline, labels.underline, () => toggleFmt("u"));
  const strikeBtn = iconBtn(ICONS.strike, labels.strike, () => toggleFmt("s"));

  const textColorBtn = colorBtn(ICONS.textcolor, labels.textColor, "#1d1d20", (c) =>
    setFmtOnSelection((f) => {
      f.c = c;
    }),
  );
  const fillColorBtn = colorBtn(ICONS.fill, labels.fillColor, "#fff3a3", (bg) =>
    setFmtOnSelection((f) => {
      f.bg = bg;
    }),
  );

  const alignBtns = {
    l: segBtn(ICONS.alignLeft, labels.alignLeft, () =>
      setFmtOnSelection((f) => {
        delete f.a;
      }),
    ),
    c: segBtn(ICONS.alignCenter, labels.alignCenter, () =>
      setFmtOnSelection((f) => {
        f.a = "c";
      }),
    ),
    r: segBtn(ICONS.alignRight, labels.alignRight, () =>
      setFmtOnSelection((f) => {
        f.a = "r";
      }),
    ),
  };
  const alignSegment = el("div", { class: "cfos-segment" }, [
    alignBtns.l,
    alignBtns.c,
    alignBtns.r,
  ]);
  const wrapBtn = iconBtn(ICONS.wrap, labels.wrapText, () => toggleFmt("wrap"));

  const insRowBtn = iconBtn(ICONS.insRow, labels.addRow, () => insertRows(selRange().r1, 1));
  const insColBtn = iconBtn(ICONS.insCol, labels.addCol, () => insertCols(selRange().c1, 1));
  const delRowBtn = iconBtn(ICONS.trash, labels.delRow, () => deleteRows());
  const freezeBtn = iconBtn(ICONS.freeze, labels.freezeRow, () => toggleFreeze());
  const sortAscBtn = iconBtn(ICONS.sortAsc, labels.sortAsc, () => sortSelection(true));
  const sortDescBtn = iconBtn(ICONS.sortDesc, labels.sortDesc, () => sortSelection(false));
  const clearFmtBtn = iconBtn(ICONS.clear, labels.clearFormat, () => clearFormatting());
  const exportBtn = iconBtn(ICONS.download, labels.exportMenu, () => {});

  const unbindFx = bindActionMenu(fxBtn, () => {
    const items = [];
    for (const [sec, names] of Object.entries(FUNCTION_GROUPS)) {
      for (const name of names) {
        items.push({
          id: name,
          section: sec,
          label: name,
          desc: "ƒ",
          onSelect: () => {
            if (readOnly) return;
            const ref = rcToRef(focus.r, focus.c);
            startEdit(ref, true, `=${name}(`);
          },
        });
      }
    }
    return items;
  });

  const unbindExport = bindActionMenu(exportBtn, () => [
    {
      id: "pdf",
      label: labels.downloadPdf,
      desc: ".pdf",
      onSelect: () => {
        const html = exportSheetHtml(model, activeSheetId);
        void runToolbarPdfExport({
          button: exportBtn,
          filename: sanitizeFileName(
            model.sheetOrder.length > 1 && curSheet().name && curSheet().name !== "Sheet1"
              ? `${model.title || "spreadsheet"} - ${curSheet().name}`
              : model.title || curSheet().name,
            "spreadsheet",
            "pdf",
          ),
          html,
          defaultTitle: labels.exportMenu,
          errorPrefix: labels.pdfExportFailed,
          checkHtml: icon(ICONS.check),
          idleHtml: icon(ICONS.download),
        });
      },
    },
    {
      id: "xlsx",
      label: labels.downloadXlsx,
      desc: ".xlsx",
      onSelect: async () => {
        const bytes = await buildXlsxBytes(model);
        triggerDownload(
          sanitizeFileName(model.title, "spreadsheet", "xlsx"),
          bytes,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      },
    },
    {
      id: "csv",
      label: labels.downloadCsv,
      desc: ".csv",
      onSelect: () => {
        const csv = workbookSheetToCsv(model, activeSheetId);
        triggerDownload(
          sanitizeFileName(curSheet().name || model.title, "sheet", "csv"),
          csv,
          "text/csv;charset=utf-8",
        );
      },
    },
    {
      id: "copy-csv",
      label: labels.copyCsv,
      onSelect: () => {
        const csv = workbookSheetToCsv(model, activeSheetId);
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(csv).catch(() => {});
        }
        exportBtn.innerHTML = icon(ICONS.check);
        window.setTimeout(() => {
          exportBtn.innerHTML = icon(ICONS.download);
        }, 1200);
      },
    },
  ]);

  const toolbar = el("div", { class: "cfos-toolbar" }, [
    group(null, [undoBtn, redoBtn], true),
    group(null, [sumBtn, fxBtn]),
    group("p2", [fmtSel.el]),
    group("p2", [currencyBtn, percentBtn, decDecBtn, incDecBtn]),
    group(null, [boldBtn, italicBtn, underlineBtn, strikeBtn]),
    group("p1", [textColorBtn.el, fillColorBtn.el]),
    group("p1", [alignSegment, wrapBtn]),
    group("p2", [insRowBtn, insColBtn, delRowBtn, freezeBtn]),
    group("p3", [sortAscBtn, sortDescBtn]),
    group("p3", [clearFmtBtn, exportBtn]),
  ]);

  // --- Formula bar & Grid --------------------------------------------------
  const nameBox = el("input", {
    class: "cfos-namebox",
    value: "A1",
    spellcheck: "false",
    title: labels.nameBoxTitle,
    "aria-label": labels.nameBoxTitle,
  });
  const formulaInput = el("input", {
    class: "cfos-finput",
    spellcheck: "false",
    placeholder: labels.formulaPlaceholder,
    "aria-label": labels.formulaPlaceholder,
    readonly: readOnly ? "readonly" : null,
  });
  const fbar = el("div", { class: "cfos-fbar" }, [
    nameBox,
    el("div", { class: "cfos-fx" }, "fx"),
    formulaInput,
  ]);

  const gridTable = el("table", { class: "cfos-grid" });
  const cellEditor = el("textarea", {
    class: "cfos-cell-editor",
    spellcheck: "false",
    wrap: "off",
  });
  const gridScroll = el(
    "div",
    { class: "cfos-grid-scroll", tabindex: "0" },
    [gridTable, cellEditor],
  );
  const tabbar = el("div", { class: "cfos-tabbar" });

  const root = el("div", { class: "cfos-sheet-app" }, [
    readOnly ? null : toolbar,
    readOnly ? null : fbar,
    gridScroll,
    tabbar,
  ]);
  host.replaceChildren(root);

  function updateUndoBtns() {
    undoBtn.disabled = readOnly || undoStack.length === 0;
    redoBtn.disabled = readOnly || redoStack.length === 0;
  }

  function undo() {
    if (readOnly || !undoStack.length) return;
    redoStack.push(snapshot());
    const prev = JSON.parse(undoStack.pop()!) as { model: WorkbookModel; activeSheetId: string };
    model = prev.model;
    activeSheetId = model.sheets[prev.activeSheetId] ? prev.activeSheetId : model.sheetOrder[0];
    rebuildEngine();
    renderTabs();
    renderGrid();
    updateSelectionUI();
    updateUndoBtns();
    emit();
  }

  function redo() {
    if (readOnly || !redoStack.length) return;
    undoStack.push(snapshot());
    const next = JSON.parse(redoStack.pop()!) as { model: WorkbookModel; activeSheetId: string };
    model = next.model;
    activeSheetId = model.sheets[next.activeSheetId] ? next.activeSheetId : model.sheetOrder[0];
    rebuildEngine();
    renderTabs();
    renderGrid();
    updateSelectionUI();
    updateUndoBtns();
    emit();
  }

  // --- Grid mutations ------------------------------------------------------
  function ensureVisibleBounds() {
    const sh = curSheet();
    let maxR = MIN_VISUAL_ROWS;
    let maxC = Math.max(8, sh.colHeaders?.length ?? 0);
    for (const ref of Object.keys(curCells())) {
      const rc = parseRef(ref);
      if (rc) {
        maxR = Math.max(maxR, rc.r + 8);
        maxC = Math.max(maxC, rc.c + 3);
      }
    }
    sh.rows = Math.max(sh.rows, maxR);
    sh.cols = Math.max(sh.cols, maxC);
  }

  function setCellValue(ref: string, value: string | null) {
    const cells = curCells();
    const cur = cells[ref];
    if ((value == null || value === "") && !cur?.fmt) {
      delete cells[ref];
      return;
    }
    cells[ref] = { value: value == null ? "" : String(value), fmt: cur?.fmt ?? null };
  }

  function setCellFmt(ref: string, mutator: (f: CellFmt) => void) {
    const cells = curCells();
    const cur = cells[ref];
    const fmt: CellFmt = cur?.fmt ? { ...cur.fmt } : {};
    mutator(fmt);
    const clean = Object.keys(fmt).length ? fmt : null;
    const val = cur?.value ?? "";
    if (val === "" && !clean) {
      delete cells[ref];
      return;
    }
    cells[ref] = { value: val, fmt: clean };
  }

  function forEachSelected(fn: (ref: string, r: number, c: number) => void) {
    if (readOnly) return;
    pushUndo();
    const rng = selRange();
    for (let r = rng.r1; r <= rng.r2; r++) {
      for (let c = rng.c1; c <= rng.c2; c++) {
        fn(rcToRef(r, c), r, c);
      }
    }
    rebuildEngine();
    renderGrid();
    refreshToolbarState();
    emit();
  }

  function toggleFmt(key: "b" | "i" | "u" | "s" | "wrap") {
    const rng = selRange();
    let allOn = true;
    for (let r = rng.r1; r <= rng.r2 && allOn; r++) {
      for (let c = rng.c1; c <= rng.c2 && allOn; c++) {
        if (!curCells()[rcToRef(r, c)]?.fmt?.[key]) allOn = false;
      }
    }
    forEachSelected((ref) =>
      setCellFmt(ref, (f) => {
        if (!allOn) f[key] = true;
        else delete f[key];
      }),
    );
  }

  function setFmtOnSelection(mutator: (f: CellFmt) => void) {
    forEachSelected((ref) => setCellFmt(ref, mutator));
  }

  function changeDecimals(delta: number) {
    forEachSelected((ref) =>
      setCellFmt(ref, (f) => {
        const curV = engine.computeRef(activeSheetId, ref);
        const defDec =
          f.nf === "currency" || f.nf === "percent" || f.nf === "number"
            ? 2
            : typeof curV === "number" && !Number.isInteger(curV)
              ? 2
              : 0;
        const base = f.d != null ? f.d : defDec;
        f.d = Math.max(0, Math.min(10, base + delta));
        if (!f.nf) f.nf = "number";
      }),
    );
  }

  function clearFormatting() {
    forEachSelected((ref) =>
      setCellFmt(ref, (f) => {
        for (const k of Object.keys(f) as (keyof CellFmt)[]) delete f[k];
      }),
    );
  }

  function toggleFreeze() {
    if (readOnly) return;
    pushUndo();
    const sh = curSheet();
    if (sh.frozenRows > 0 || sh.frozenCols > 0) {
      sh.frozenRows = 0;
      sh.frozenCols = 0;
    } else {
      sh.frozenRows = Math.min(12, Math.max(1, focus.r));
    }
    freezeBtn.classList.toggle("active", sh.frozenRows > 0);
    renderGrid();
    emit();
  }

  // --- Structural row/col ops with formula rewriting -----------------------
  function walkRefs(node: Ast | undefined, fn: (ref: string) => string | null) {
    if (!node || typeof node !== "object") return;
    if (node.k === "ref") {
      const nr = fn(node.ref);
      if (nr != null) node.ref = nr;
    } else if (node.k === "range") {
      const a = fn(node.a);
      const b = fn(node.b);
      if (a != null) node.a = a;
      if (b != null) node.b = b;
    } else {
      const branches = node as { a?: Ast; b?: Ast; args?: Ast[] };
      if (branches.a) walkRefs(branches.a, fn);
      if (branches.b) walkRefs(branches.b, fn);
      if (branches.args) branches.args.forEach((n) => walkRefs(n, fn));
    }
  }

  function rewriteFormulas(rowAt: number, rowDelta: number, colAt: number, colDelta: number) {
    for (const cell of Object.values(curCells())) {
      if (!cell.value.startsWith("=")) continue;
      try {
        const ast = parseFormula(cell.value.slice(1));
        walkRefs(ast, (ref) => {
          if (ref.includes("!")) return null;
          const rc = parseRef(ref);
          if (!rc) return null;
          let { r, c } = rc;
          if (rowDelta && r >= rowAt) r += rowDelta;
          if (colDelta && c >= colAt) c += colDelta;
          return r < 0 || c < 0 ? "#REF!" : rcToRef(r, c);
        });
        cell.value = "=" + serializeAst(ast);
      } catch {
        // Keep malformed formula untouched.
      }
    }
  }

  function rebuildSheetCells(mapFn: (r: number, c: number) => RC | null) {
    const old = curCells();
    const next: CellMap = {};
    for (const [ref, cell] of Object.entries(old)) {
      const rc = parseRef(ref);
      if (!rc) continue;
      const nn = mapFn(rc.r, rc.c);
      if (!nn) continue;
      next[rcToRef(nn.r, nn.c)] = { ...cell };
    }
    model.cells[activeSheetId] = next;
  }

  function shiftDims(dims: Dims, at: number, delta: number) {
    const next: Dims = {};
    for (const [k, v] of Object.entries(dims)) {
      const n = Number(k);
      if (delta < 0 && n >= at && n < at - delta) continue;
      next[n >= at ? n + delta : n] = v;
    }
    for (const k of Object.keys(dims)) delete dims[k];
    Object.assign(dims, next);
  }

  function insertRows(at: number, count: number) {
    if (readOnly) return;
    pushUndo();
    const sh = curSheet();
    rewriteFormulas(at, count, 0, 0);
    rebuildSheetCells((r, c) => ({ r: r >= at ? r + count : r, c }));
    sh.rows += count;
    shiftDims(sh.rowHeights, at, count);
    rebuildEngine();
    renderGrid();
    moveActive(at, selRange().c1);
    emit();
  }

  function insertCols(at: number, count: number) {
    if (readOnly) return;
    pushUndo();
    const sh = curSheet();
    rewriteFormulas(0, 0, at, count);
    rebuildSheetCells((r, c) => ({ r, c: c >= at ? c + count : c }));
    if (sh.colHeaders) {
      sh.colHeaders.splice(at, 0, ...Array.from({ length: count }, (_, i) => `${labels.newColDefault} ${sh.colHeaders!.length + i + 1}`));
    }
    sh.cols += count;
    shiftDims(sh.colWidths, at, count);
    rebuildEngine();
    renderGrid();
    moveActive(selRange().r1, at);
    emit();
  }

  function deleteRows() {
    if (readOnly) return;
    const rng = selRange();
    const count = rng.r2 - rng.r1 + 1;
    const sh = curSheet();
    if (sh.rows - count < 1) return;
    pushUndo();
    rewriteFormulas(rng.r1 + count, -count, 0, 0);
    rebuildSheetCells((r, c) =>
      r >= rng.r1 && r <= rng.r2 ? null : { r: r > rng.r2 ? r - count : r, c },
    );
    sh.rows = Math.max(MIN_VISUAL_ROWS, sh.rows - count);
    shiftDims(sh.rowHeights, rng.r1, -count);
    rebuildEngine();
    renderGrid();
    moveActive(Math.min(rng.r1, sh.rows - 1), rng.c1);
    emit();
  }

  function deleteCols() {
    if (readOnly) return;
    const rng = selRange();
    const count = rng.c2 - rng.c1 + 1;
    const sh = curSheet();
    if (sh.cols - count < 1) return;
    pushUndo();
    rewriteFormulas(0, 0, rng.c1 + count, -count);
    rebuildSheetCells((r, c) =>
      c >= rng.c1 && c <= rng.c2 ? null : { r, c: c > rng.c2 ? c - count : c },
    );
    if (sh.colHeaders) sh.colHeaders.splice(rng.c1, count);
    sh.cols = Math.max(2, sh.cols - count);
    shiftDims(sh.colWidths, rng.c1, -count);
    rebuildEngine();
    renderGrid();
    moveActive(rng.r1, Math.min(rng.c1, sh.cols - 1));
    emit();
  }

  function sortSelection(asc: boolean) {
    if (readOnly) return;
    const rng = selRange();
    if (rng.r1 === rng.r2) return;
    pushUndo();
    const cells = curCells();
    const packed: { cellsByCol: Record<number, CellMap[string]>; key: Value }[] = [];
    for (let r = rng.r1; r <= rng.r2; r++) {
      const cellsByCol: Record<number, CellMap[string]> = {};
      for (let c = rng.c1; c <= rng.c2; c++) {
        const cell = cells[rcToRef(r, c)];
        if (cell) cellsByCol[c] = { ...cell };
      }
      packed.push({ cellsByCol, key: engine.computeRef(activeSheetId, rcToRef(r, rng.c1)) });
    }
    packed.sort((a, b) => {
      const x = a.key ?? "";
      const y = b.key ?? "";
      const cmp =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).toLowerCase().localeCompare(String(y).toLowerCase());
      return asc ? cmp : -cmp;
    });
    for (let i = 0; i < packed.length; i++) {
      const r = rng.r1 + i;
      for (let c = rng.c1; c <= rng.c2; c++) {
        const src = packed[i].cellsByCol[c];
        const ref = rcToRef(r, c);
        if (src) cells[ref] = src;
        else delete cells[ref];
      }
    }
    rebuildEngine();
    renderGrid();
    emit();
  }

  function autoSum() {
    if (readOnly) return;
    const rng = selRange();
    const isNum = (ref: string) => typeof engine.computeRef(activeSheetId, ref) === "number";
    if (rng.r1 === rng.r2 && rng.c1 === rng.c2) {
      let top = rng.r1 - 1;
      while (top >= 0 && isNum(rcToRef(top, rng.c1))) top--;
      top++;
      let expr = "";
      if (top <= rng.r1 - 1) {
        expr = `=SUM(${rcToRef(top, rng.c1)}:${rcToRef(rng.r1 - 1, rng.c1)})`;
      } else {
        let left = rng.c1 - 1;
        while (left >= 0 && isNum(rcToRef(rng.r1, left))) left--;
        left++;
        if (left <= rng.c1 - 1) {
          expr = `=SUM(${rcToRef(rng.r1, left)}:${rcToRef(rng.r1, rng.c1 - 1)})`;
        }
      }
      if (!expr) return;
      pushUndo();
      const target = rcToRef(rng.r1, rng.c1);
      setCellValue(target, expr);
      rebuildEngine();
      renderGrid();
      updateSelectionUI();
      emit();
      return;
    }
    pushUndo();
    for (let c = rng.c1; c <= rng.c2; c++) {
      setCellValue(
        rcToRef(rng.r2 + 1, c),
        `=SUM(${rcToRef(rng.r1, c)}:${rcToRef(rng.r2, c)})`,
      );
    }
    rebuildEngine();
    renderGrid();
    updateSelectionUI();
    emit();
  }

  // --- Grid rendering ------------------------------------------------------
  function cellEl(r: number, c: number): HTMLTableCellElement | null {
    return gridTable.querySelector<HTMLTableCellElement>(`td.cfos-cell[data-r="${r}"][data-c="${c}"]`);
  }

  function renderGrid() {
    ensureVisibleBounds();
    const sh = curSheet();
    const rng = selRange();
    const cells = curCells();
    const frag = document.createDocumentFragment();

    const colgroup = el("colgroup");
    colgroup.appendChild(el("col", { style: `width:${HEAD_W}px` }));
    let totalW = HEAD_W;
    for (let c = 0; c < sh.cols; c++) {
      const w = colWidth(c);
      totalW += w;
      colgroup.appendChild(el("col", { style: `width:${w}px` }));
    }
    frag.appendChild(colgroup);
    gridTable.style.width = totalW + "px";

    const thead = el("thead");
    const hr = el("tr");
    hr.appendChild(el("th", { class: "cfos-corner" }));
    for (let c = 0; c < sh.cols; c++) {
      const headerLabel = columnHeaderLabel(c, sh.colHeaders?.[c] ?? "");
      const th = el("th", { class: "cfos-colhead", "data-col": c }, headerLabel);
      if (c >= rng.c1 && c <= rng.c2) {
        th.classList.add(rng.r1 === 0 && rng.r2 === sh.rows - 1 ? "full" : "hl");
      }
      if (!readOnly) {
        th.appendChild(el("div", { class: "cfos-col-resize", "data-col": c }));
      }
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    frag.appendChild(thead);

    const tbody = el("tbody");
    for (let r = 0; r < sh.rows; r++) {
      const rhPx = rowHeight(r);
      const tr = el("tr", { style: `height:${rhPx}px` });
      if (r < sh.frozenRows) tr.classList.add("cfos-frozen-row");
      const rh = el("th", { class: "cfos-rowhead", "data-row": r }, String(r + 1));
      if (r >= rng.r1 && r <= rng.r2) {
        rh.classList.add(rng.c1 === 0 && rng.c2 === sh.cols - 1 ? "full" : "hl");
      }
      if (!readOnly) {
        rh.appendChild(el("div", { class: "cfos-row-resize", "data-row": r }));
      }
      tr.appendChild(rh);

      for (let c = 0; c < sh.cols; c++) {
        const ref = rcToRef(r, c);
        const cell = cells[ref];
        const td = el("td", { class: "cfos-cell", "data-ref": ref, "data-r": r, "data-c": c });
        const disp = displayWorkbookCell(engine, activeSheetId, cell, r, c);
        const cv = el("span", { class: "cfos-cv" }, disp.text);
        td.appendChild(cv);
        if (disp.numeric) td.classList.add("num");
        if (disp.err) td.classList.add("err");
        const fmt = cell?.fmt;
        if (fmt) {
          if (fmt.b) td.style.fontWeight = "700";
          if (fmt.i) td.style.fontStyle = "italic";
          if (fmt.u || fmt.s) {
            td.style.textDecoration = (fmt.u ? "underline " : "") + (fmt.s ? "line-through" : "");
          }
          if (fmt.c) td.style.color = fmt.c;
          if (fmt.bg) td.style.background = fmt.bg;
          if (fmt.fs) td.style.fontSize = fmt.fs + "px";
          if (fmt.a) cv.style.textAlign = fmt.a === "l" ? "left" : fmt.a === "c" ? "center" : "right";
          else if (disp.center) cv.style.textAlign = "center";
          if (fmt.wrap) td.classList.add("wrap");
        } else if (disp.center) {
          cv.style.textAlign = "center";
        }
        if (r >= rng.r1 && r <= rng.r2 && c >= rng.c1 && c <= rng.c2) {
          td.classList.add(r === focus.r && c === focus.c ? "active" : "sel");
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    frag.appendChild(tbody);
    gridTable.replaceChildren(frag);
  }

  function refreshToolbarState() {
    if (readOnly) return;
    const cell = curCells()[rcToRef(focus.r, focus.c)];
    const f = cell?.fmt || {};
    boldBtn.classList.toggle("active", !!f.b);
    italicBtn.classList.toggle("active", !!f.i);
    underlineBtn.classList.toggle("active", !!f.u);
    strikeBtn.classList.toggle("active", !!f.s);
    wrapBtn.classList.toggle("active", !!f.wrap);
    freezeBtn.classList.toggle("active", curSheet().frozenRows > 0);
    alignBtns.l.classList.toggle("active", !f.a || f.a === "l");
    alignBtns.c.classList.toggle("active", f.a === "c");
    alignBtns.r.classList.toggle("active", f.a === "r");
    fmtSel.setValue(f.nf || "auto");
  }

  function updateSelectionUI() {
    const rng = selRange();
    gridTable
      .querySelectorAll("td.cfos-cell.sel, td.cfos-cell.active")
      .forEach((td) => td.classList.remove("sel", "active"));
    gridTable
      .querySelectorAll("th.hl, th.full")
      .forEach((th) => th.classList.remove("hl", "full"));
    const sh = curSheet();
    for (let r = rng.r1; r <= rng.r2; r++) {
      for (let c = rng.c1; c <= rng.c2; c++) {
        const td = cellEl(r, c);
        if (!td) continue;
        td.classList.add(r === focus.r && c === focus.c ? "active" : "sel");
      }
    }
    gridTable.querySelectorAll<HTMLTableCellElement>("th.cfos-colhead").forEach((th) => {
      const c = Number(th.dataset.col);
      if (c >= rng.c1 && c <= rng.c2) {
        th.classList.add(rng.r1 === 0 && rng.r2 === sh.rows - 1 ? "full" : "hl");
      }
    });
    gridTable.querySelectorAll<HTMLTableCellElement>("th.cfos-rowhead").forEach((th) => {
      const r = Number(th.dataset.row);
      if (r >= rng.r1 && r <= rng.r2) {
        th.classList.add(rng.c1 === 0 && rng.c2 === sh.cols - 1 ? "full" : "hl");
      }
    });
    nameBox.value = formatSelectionRef(rng.r1, rng.c1, rng.r2, rng.c2);
    formulaInput.value = curCells()[rcToRef(focus.r, focus.c)]?.value ?? "";
    refreshToolbarState();
  }

  function scrollActiveIntoView() {
    const td = cellEl(focus.r, focus.c);
    if (!td) return;
    const sr = gridScroll.getBoundingClientRect();
    const cr = td.getBoundingClientRect();
    if (cr.top < sr.top + 24) gridScroll.scrollTop -= sr.top + 24 - cr.top;
    else if (cr.bottom > sr.bottom) gridScroll.scrollTop += cr.bottom - sr.bottom;
    if (cr.left < sr.left + HEAD_W) gridScroll.scrollLeft -= sr.left + HEAD_W - cr.left;
    else if (cr.right > sr.right) gridScroll.scrollLeft += cr.right - sr.right;
  }

  function moveActive(r: number, c: number, extend = false) {
    const sh = curSheet();
    const nr = Math.max(0, Math.min(sh.rows - 1, r));
    const nc = Math.max(0, Math.min(sh.cols - 1, c));
    focus = { r: nr, c: nc };
    if (!extend) anchor = { r: nr, c: nc };
    updateSelectionUI();
    scrollActiveIntoView();
  }

  // --- Inline cell editing -------------------------------------------------
  function syncEditorSize() {
    cellEditor.style.height = "auto";
    cellEditor.style.height = Math.max(cellEditor.scrollHeight, DEFAULT_ROW_H) + "px";
    const baseW = editing ? cellEl(editing.r, editing.c)?.offsetWidth || DEFAULT_COL_W : DEFAULT_COL_W;
    cellEditor.style.width = Math.max(cellEditor.scrollWidth + 8, baseW) + "px";
  }

  function startEdit(ref: string, replace = false, seed: string | null = null) {
    if (readOnly) return;
    const rc = parseRef(ref);
    if (!rc) return;
    const td = cellEl(rc.r, rc.c);
    if (!td) return;
    editing = { ref, r: rc.r, c: rc.c };
    const cell = curCells()[ref];
    const text = seed != null ? seed : replace ? "" : cell?.value ?? "";
    cellEditor.style.left = td.offsetLeft + "px";
    cellEditor.style.top = td.offsetTop + "px";
    cellEditor.style.minWidth = td.offsetWidth + "px";
    cellEditor.style.minHeight = td.offsetHeight + "px";
    cellEditor.style.width = td.offsetWidth + "px";
    cellEditor.value = text;
    cellEditor.style.display = "block";
    cellEditor.focus();
    if (replace || seed != null) cellEditor.setSelectionRange(text.length, text.length);
    else cellEditor.select();
    syncEditorSize();
    formulaInput.value = text;
  }

  function commitEdit(advance: "down" | "up" | "right" | "left" | "none" = "down") {
    if (!editing) return;
    const { ref, r, c } = editing;
    const val = cellEditor.value;
    editing = null;
    cellEditor.style.display = "none";
    const existing = curCells()[ref]?.value ?? "";
    if (val !== existing) {
      pushUndo();
      setCellValue(ref, val === "" ? null : val);
      rebuildEngine();
      renderGrid();
      emit();
    }
    if (advance === "down") moveActive(r + 1, c);
    else if (advance === "up") moveActive(r - 1, c);
    else if (advance === "right") moveActive(r, c + 1);
    else if (advance === "left") moveActive(r, c - 1);
    else moveActive(r, c);
    gridScroll.focus();
  }

  function cancelEdit() {
    if (!editing) return;
    const { r, c } = editing;
    editing = null;
    cellEditor.style.display = "none";
    formulaInput.value = curCells()[rcToRef(r, c)]?.value ?? "";
    gridScroll.focus();
  }

  // --- Clipboard (TSV) -----------------------------------------------------
  function copySelection() {
    const rng = selRange();
    const lines: string[] = [];
    const snapped: (CellMap[string] | null)[][] = [];
    for (let r = rng.r1; r <= rng.r2; r++) {
      const colsTsv: string[] = [];
      const rowCells: (CellMap[string] | null)[] = [];
      for (let c = rng.c1; c <= rng.c2; c++) {
        const ref = rcToRef(r, c);
        const cell = curCells()[ref];
        rowCells.push(cell ? { value: cell.value, fmt: cell.fmt ? { ...cell.fmt } : null } : null);
        if (cell) {
          const comp = engine.computeRef(activeSheetId, ref);
          const text = cell.value.startsWith("=")
            ? isErr(comp)
              ? comp.value
              : comp == null
                ? ""
                : String(comp)
            : cell.value;
          colsTsv.push(text);
        } else {
          colsTsv.push("");
        }
      }
      lines.push(colsTsv.join("\t"));
      snapped.push(rowCells);
    }
    const tsv = lines.join("\n");
    copyFallback = { tsv, cells: snapped };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(tsv).catch(() => {});
    }
  }

  function pasteText(text: string) {
    if (readOnly) return;
    const rng = selRange();
    const useSnap = copyFallback && copyFallback.tsv === text;
    const matrix = parseTsv(text);
    pushUndo();
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const r = rng.r1 + i;
        const c = rng.c1 + j;
        if (r >= curSheet().rows || c >= curSheet().cols) continue;
        const ref = rcToRef(r, c);
        if (useSnap && copyFallback!.cells[i]?.[j] !== undefined) {
          const src = copyFallback!.cells[i][j];
          if (src) curCells()[ref] = { value: src.value, fmt: src.fmt ? { ...src.fmt } : null };
          else delete curCells()[ref];
        } else {
          setCellValue(ref, matrix[i][j] === "" ? null : matrix[i][j]);
        }
      }
    }
    rebuildEngine();
    renderGrid();
    updateSelectionUI();
    emit();
  }

  function deleteSelectionContents() {
    if (readOnly) return;
    const rng = selRange();
    pushUndo();
    for (let r = rng.r1; r <= rng.r2; r++) {
      for (let c = rng.c1; c <= rng.c2; c++) {
        setCellValue(rcToRef(r, c), null);
      }
    }
    rebuildEngine();
    renderGrid();
    updateSelectionUI();
    emit();
  }

  // --- Context menu --------------------------------------------------------
  function closeCtx() {
    if (ctxEl) {
      ctxEl.remove();
      ctxEl = null;
    }
  }

  function showCtx(menu: HTMLElement, x: number, y: number) {
    closeCtx();
    ctxEl = menu;
    document.body.appendChild(menu);
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
  }

  // --- Multi-sheet tabs ----------------------------------------------------
  function renderTabs() {
    tabbar.replaceChildren();
    for (const id of model.sheetOrder) {
      const sh = model.sheets[id];
      if (!sh) continue;
      const tab = el(
        "button",
        {
          type: "button",
          class: "cfos-tab" + (id === activeSheetId ? " active" : ""),
          "data-id": id,
        },
        [el("span", { class: "cfos-tname" }, sh.name)],
      );
      tab.addEventListener("click", () => switchSheet(id));
      if (!readOnly) {
        tab.addEventListener("dblclick", () => void renameSheet(id));
        tab.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const menu = el("div", { class: "cfos-ctx" });
          const addItem = (label: string, fn: () => void, danger = false) => {
            const it = el("button", {
              type: "button",
              class: "cfos-ctx-item" + (danger ? " danger" : ""),
            }, [el("span", {}, label)]);
            it.addEventListener("click", () => {
              closeCtx();
              fn();
            });
            menu.appendChild(it);
          };
          addItem(labels.renameSheet, () => void renameSheet(id));
          addItem(labels.duplicateSheet, () => duplicateSheet(id));
          if (model.sheetOrder.length > 1) {
            menu.appendChild(el("div", { class: "cfos-ctx-sep" }));
            addItem(labels.deleteSheet, () => deleteSheet(id), true);
          }
          showCtx(menu, e.clientX, e.clientY);
        });
      }
      tabbar.appendChild(tab);
    }
    if (!readOnly) {
      const addBtn = el("button", {
        type: "button",
        class: "cfos-tab-add",
        title: labels.addSheet,
        "aria-label": labels.addSheet,
        html: icon(ICONS.plus, 14),
      });
      addBtn.addEventListener("click", addSheet);
      tabbar.appendChild(addBtn);
    }
  }

  function switchSheet(id: string) {
    if (editing) commitEdit("none");
    activeSheetId = id;
    anchor = { r: 0, c: 0 };
    focus = { r: 0, c: 0 };
    rebuildEngine();
    renderTabs();
    renderGrid();
    updateSelectionUI();
  }

  function addSheet() {
    if (readOnly) return;
    pushUndo();
    const id = "s_" + Math.random().toString(36).slice(2, 8);
    let n = model.sheetOrder.length + 1;
    while (model.sheetOrder.some((sid) => model.sheets[sid]?.name === `Sheet${n}`)) n++;
    model.sheets[id] = {
      id,
      name: `Sheet${n}`,
      rows: MIN_VISUAL_ROWS,
      cols: 10,
      colWidths: {},
      rowHeights: {},
      frozenRows: 0,
      frozenCols: 0,
    };
    model.sheetOrder.push(id);
    model.cells[id] = {};
    switchSheet(id);
    emit();
  }

  async function renameSheet(id: string) {
    if (readOnly) return;
    const name = await promptInline(labels.renameSheet, model.sheets[id].name);
    if (name == null) return;
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    pushUndo();
    model.sheets[id].name = clean;
    rebuildEngine();
    renderTabs();
    renderGrid();
    emit();
  }

  function duplicateSheet(id: string) {
    if (readOnly) return;
    pushUndo();
    const src = model.sheets[id];
    const nid = "s_" + Math.random().toString(36).slice(2, 8);
    model.sheets[nid] = {
      ...JSON.parse(JSON.stringify(src)),
      id: nid,
      name: `${src.name} copy`.slice(0, 48),
    };
    model.cells[nid] = JSON.parse(JSON.stringify(model.cells[id] || {}));
    const idx = model.sheetOrder.indexOf(id);
    model.sheetOrder.splice(idx + 1, 0, nid);
    switchSheet(nid);
    emit();
  }

  function deleteSheet(id: string) {
    if (readOnly || model.sheetOrder.length <= 1) return;
    pushUndo();
    const idx = model.sheetOrder.indexOf(id);
    model.sheetOrder.splice(idx, 1);
    delete model.sheets[id];
    delete model.cells[id];
    const nextId = model.sheetOrder[Math.max(0, idx - 1)];
    switchSheet(nextId);
    emit();
  }

  // --- Drag resize ---------------------------------------------------------
  function startColResize(col: number, e: MouseEvent) {
    const startX = e.clientX;
    const startW = colWidth(col);
    const sh = curSheet();
    const move = (ev: MouseEvent) => {
      sh.colWidths[col] = Math.max(44, Math.round(startW + ev.clientX - startX));
      const cols = gridTable.querySelectorAll<HTMLTableColElement>("colgroup col");
      if (cols[col + 1]) cols[col + 1].style.width = sh.colWidths[col] + "px";
      let totalW = HEAD_W;
      for (let c = 0; c < sh.cols; c++) totalW += colWidth(c);
      gridTable.style.width = totalW + "px";
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      emit();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function startRowResize(row: number, e: MouseEvent) {
    const startY = e.clientY;
    const startH = rowHeight(row);
    const sh = curSheet();
    const move = (ev: MouseEvent) => {
      sh.rowHeights[row] = Math.max(20, Math.round(startH + ev.clientY - startY));
      const tr = gridTable.querySelectorAll<HTMLTableRowElement>("tbody tr")[row];
      if (tr) tr.style.height = sh.rowHeights[row] + "px";
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      emit();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // --- DOM Event Wiring ----------------------------------------------------
  const onGridDown = (e: MouseEvent) => {
    if (!(e.target instanceof Element)) return;
    const colRz = e.target.closest<HTMLElement>(".cfos-col-resize");
    if (colRz && !readOnly) {
      e.preventDefault();
      startColResize(Number(colRz.dataset.col), e);
      return;
    }
    const rowRz = e.target.closest<HTMLElement>(".cfos-row-resize");
    if (rowRz && !readOnly) {
      e.preventDefault();
      startRowResize(Number(rowRz.dataset.row), e);
      return;
    }
    const ch = e.target.closest<HTMLTableCellElement>("th.cfos-colhead");
    if (ch) {
      const c = Number(ch.dataset.col);
      if (editing) commitEdit("none");
      anchor = { r: 0, c };
      focus = { r: curSheet().rows - 1, c };
      updateSelectionUI();
      mouseSelecting = "col";
      e.preventDefault();
      return;
    }
    const rh = e.target.closest<HTMLTableCellElement>("th.cfos-rowhead");
    if (rh) {
      const r = Number(rh.dataset.row);
      if (editing) commitEdit("none");
      anchor = { r, c: 0 };
      focus = { r, c: curSheet().cols - 1 };
      updateSelectionUI();
      mouseSelecting = "row";
      e.preventDefault();
      return;
    }
    const td = e.target.closest<HTMLTableCellElement>("td.cfos-cell");
    if (td) {
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      if (editing) commitEdit("none");
      if (e.shiftKey) {
        focus = { r, c };
        updateSelectionUI();
      } else {
        moveActive(r, c);
      }
      mouseSelecting = "cell";
      gridScroll.focus();
      e.preventDefault();
    }
  };

  const onGridMove = (e: MouseEvent) => {
    if (!mouseSelecting || !(e.target instanceof Element)) return;
    const td = e.target.closest<HTMLTableCellElement>("td.cfos-cell");
    if (!td) return;
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    if (mouseSelecting === "col") {
      focus = { r: curSheet().rows - 1, c };
      anchor = { r: 0, c: anchor.c };
    } else if (mouseSelecting === "row") {
      focus = { r, c: curSheet().cols - 1 };
      anchor = { r: anchor.r, c: 0 };
    } else {
      focus = { r, c };
    }
    updateSelectionUI();
  };

  const onGridDbl = async (e: MouseEvent) => {
    if (readOnly || !(e.target instanceof Element)) return;
    const ch = e.target.closest<HTMLTableCellElement>("th.cfos-colhead");
    if (ch) {
      const c = Number(ch.dataset.col);
      const sh = curSheet();
      const currentName = sh.colHeaders?.[c] ?? colToLetter(c);
      const next = await promptInline(labels.renameColPrompt, currentName);
      if (next != null && next.trim()) {
        pushUndo();
        if (!sh.colHeaders) {
          sh.colHeaders = Array.from({ length: Math.max(c + 1, 1) }, (_, i) => colToLetter(i));
        }
        while (sh.colHeaders.length <= c) sh.colHeaders.push(colToLetter(sh.colHeaders.length));
        sh.colHeaders[c] = next.trim();
        renderGrid();
        emit();
      }
      return;
    }
    const td = e.target.closest<HTMLTableCellElement>("td.cfos-cell");
    if (td?.dataset.ref) startEdit(td.dataset.ref, false);
  };

  const onGridCtx = (e: MouseEvent) => {
    if (readOnly || !(e.target instanceof Element)) return;
    const td = e.target.closest<HTMLTableCellElement>("td.cfos-cell");
    const ch = e.target.closest("th.cfos-colhead");
    const rh = e.target.closest("th.rowhead, th.cfos-rowhead");
    if (!td && !ch && !rh) return;
    e.preventDefault();
    if (td) {
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      const rng = selRange();
      if (r < rng.r1 || r > rng.r2 || c < rng.c1 || c > rng.c2) moveActive(r, c);
    }
    const menu = el("div", { class: "cfos-ctx" });
    const add = (label: string, k: string, fn: () => void, danger = false) => {
      const it = el("button", {
        type: "button",
        class: "cfos-ctx-item" + (danger ? " danger" : ""),
      }, [el("span", {}, label), k ? el("span", { class: "k" }, k) : null]);
      it.addEventListener("click", () => {
        closeCtx();
        fn();
      });
      menu.appendChild(it);
    };
    const sep = () => menu.appendChild(el("div", { class: "cfos-ctx-sep" }));
    add(labels.ctxCut, "Ctrl+X", () => {
      copySelection();
      deleteSelectionContents();
    });
    add(labels.ctxCopy, "Ctrl+C", copySelection);
    add(labels.ctxPaste, "Ctrl+V", async () => {
      try {
        const text = await navigator.clipboard.readText();
        pasteText(text);
      } catch {
        if (copyFallback) pasteText(copyFallback.tsv);
      }
    });
    sep();
    add(labels.addRow, "", () => insertRows(selRange().r1, 1));
    add(labels.addCol, "", () => insertCols(selRange().c1, 1));
    add(labels.sortAsc, "", () => sortSelection(true));
    add(labels.sortDesc, "", () => sortSelection(false));
    sep();
    add(labels.delRow, "", deleteRows, true);
    add(labels.delCol, "", deleteCols, true);
    add(labels.ctxClear, "Del", deleteSelectionContents);
    showCtx(menu, e.clientX, e.clientY);
  };

  const onGridKey = (e: KeyboardEvent) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          toggleFmt("b");
          return;
        case "i":
          e.preventDefault();
          toggleFmt("i");
          return;
        case "u":
          e.preventDefault();
          toggleFmt("u");
          return;
        case "z":
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        case "y":
          e.preventDefault();
          redo();
          return;
        case "c":
          copySelection();
          return;
        case "x":
          copySelection();
          deleteSelectionContents();
          return;
        case "a":
          e.preventDefault();
          anchor = { r: 0, c: 0 };
          focus = { r: curSheet().rows - 1, c: curSheet().cols - 1 };
          updateSelectionUI();
          return;
      }
    }
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveActive(focus.r - 1, focus.c, e.shiftKey);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveActive(focus.r + 1, focus.c, e.shiftKey);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveActive(focus.r, focus.c - 1, e.shiftKey);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveActive(focus.r, focus.c + 1, e.shiftKey);
        break;
      case "Tab":
        e.preventDefault();
        moveActive(focus.r, focus.c + (e.shiftKey ? -1 : 1));
        break;
      case "Enter":
      case "F2":
        e.preventDefault();
        startEdit(rcToRef(focus.r, focus.c), false);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        deleteSelectionContents();
        break;
      default:
        if (!readOnly && !mod && !e.altKey && e.key.length === 1) {
          e.preventDefault();
          startEdit(rcToRef(focus.r, focus.c), true, e.key);
        }
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (editing || readOnly) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    if (text) pasteText(text);
  };

  const onCellEditorInput = () => {
    syncEditorSize();
    formulaInput.value = cellEditor.value;
  };
  const onCellEditorKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      commitEdit(e.shiftKey ? "up" : "down");
    } else if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      const s = cellEditor.selectionStart;
      cellEditor.value = cellEditor.value.slice(0, s) + "\n" + cellEditor.value.slice(cellEditor.selectionEnd);
      cellEditor.setSelectionRange(s + 1, s + 1);
      syncEditorSize();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
    e.stopPropagation();
  };

  const onNameKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const range = parseRangeText(nameBox.value);
    if (range) {
      anchor = { r: range.r1, c: range.c1 };
      focus = { r: range.r2, c: range.c2 };
      updateSelectionUI();
      scrollActiveIntoView();
    }
    gridScroll.focus();
  };

  const onFormulaFocus = () => {
    if (!editing && !readOnly) startEdit(rcToRef(focus.r, focus.c), false);
  };
  const onFormulaInput = () => {
    if (editing) {
      cellEditor.value = formulaInput.value;
      syncEditorSize();
    }
  };
  const onFormulaKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit("down");
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const onDocUp = () => {
    mouseSelecting = false;
  };
  const onDocDown = (e: MouseEvent) => {
    if (ctxEl && !ctxEl.contains(e.target instanceof Node ? e.target : null)) closeCtx();
  };

  gridTable.addEventListener("mousedown", onGridDown);
  gridTable.addEventListener("mousemove", onGridMove);
  gridTable.addEventListener("dblclick", onGridDbl);
  gridTable.addEventListener("contextmenu", onGridCtx);
  gridScroll.addEventListener("keydown", onGridKey);
  gridScroll.addEventListener("paste", onPaste);
  cellEditor.addEventListener("input", onCellEditorInput);
  cellEditor.addEventListener("keydown", onCellEditorKey);
  nameBox.addEventListener("keydown", onNameKey);
  formulaInput.addEventListener("focus", onFormulaFocus);
  formulaInput.addEventListener("input", onFormulaInput);
  formulaInput.addEventListener("keydown", onFormulaKey);
  document.addEventListener("mouseup", onDocUp);
  document.addEventListener("mousedown", onDocDown);
  window.addEventListener("scroll", closeCtx, true);

  renderTabs();
  renderGrid();
  updateSelectionUI();
  updateUndoBtns();

  return {
    updateExternal(cols: readonly string[], rws: readonly (readonly WireCell[])[], title?: string) {
      if (title !== undefined) model.title = title;
      const incoming = JSON.stringify({ columns: cols, rows: rws });
      if (incoming === lastSerialized) return;
      lastSerialized = incoming;
      model = worksSheetToCfos(
        { kind: "sheet", columns: [...cols], rows: rws.map((r) => [...r]) },
        model.title,
      );
      activeSheetId = model.sheets[activeSheetId] ? activeSheetId : model.sheetOrder[0];
      rebuildEngine();
      renderTabs();
      renderGrid();
      updateSelectionUI();
      updateUndoBtns();
    },
    destroy() {
      gridTable.removeEventListener("mousedown", onGridDown);
      gridTable.removeEventListener("mousemove", onGridMove);
      gridTable.removeEventListener("dblclick", onGridDbl);
      gridTable.removeEventListener("contextmenu", onGridCtx);
      gridScroll.removeEventListener("keydown", onGridKey);
      gridScroll.removeEventListener("paste", onPaste);
      cellEditor.removeEventListener("input", onCellEditorInput);
      cellEditor.removeEventListener("keydown", onCellEditorKey);
      nameBox.removeEventListener("keydown", onNameKey);
      formulaInput.removeEventListener("focus", onFormulaFocus);
      formulaInput.removeEventListener("input", onFormulaInput);
      formulaInput.removeEventListener("keydown", onFormulaKey);
      document.removeEventListener("mouseup", onDocUp);
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("scroll", closeCtx, true);
      unbindFx();
      unbindExport();
      fmtSel.destroy();
      closeCtx();
      host.replaceChildren();
    },
  };
}

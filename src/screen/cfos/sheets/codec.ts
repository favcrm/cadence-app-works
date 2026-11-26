// Lossless codec bridging Works v0 SheetContent ({ columns, rows }) and
// multi-sheet cloudflare-os WorkbookModel (formatting, dims, frozen panes, extra tabs).
// Zero runtime relative imports so Node 22 tests run directly cleanly.

import type { Cell, Content } from "../../domain/works";
import type { CellMap, CfosCell, SheetMeta, WorkbookModel } from "./formula";

export type SheetContent = Extract<Content, { kind: "sheet" }>;

export interface SheetWire {
  kind?: "sheet";
  columns: string[];
  rows: Cell[][];
}

export const MIN_VISUAL_ROWS = 28;
export const MIN_VISUAL_COLS = 10;
export const SHEET_SIDECAR_PREFIX = "__cfos_sheet_v1__:";
const MAX_SHEET_BYTES = 62 * 1024;

export interface SheetGridModel {
  columns: string[];
  rows: Cell[][];
}

function colLetter(c: number): string {
  let s = "";
  let n = c;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function refKey(r: number, c: number): string {
  return colLetter(c) + (r + 1);
}

function parseSimpleRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  let c = 0;
  for (let i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64);
  return { r: parseInt(m[2], 10) - 1, c: c - 1 };
}

export function normalizeSheetInput(
  columns: readonly string[],
  rows: readonly (readonly Cell[])[],
): SheetGridModel {
  const cols = columns.length ? [...columns] : ["Column 1"];
  const normalizedRows = rows.map((row) =>
    cols.map((_, c) => {
      const cell = row[c];
      return cell === undefined || cell === null ? "" : cell;
    }),
  );
  return { columns: cols, rows: normalizedRows };
}

export function coerceCellInput(raw: string): Cell {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (raw.startsWith("=") || raw.startsWith("'")) return raw;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

export function worksSheetToCfos(
  sheet: SheetWire,
  title = "Untitled sheet",
): WorkbookModel {
  const rows = sheet.rows ?? [];
  const lastRow = rows.at(-1);
  if (
    lastRow &&
    typeof lastRow[0] === "string" &&
    lastRow[0].startsWith(SHEET_SIDECAR_PREFIX)
  ) {
    try {
      const parsed = JSON.parse(lastRow[0].slice(SHEET_SIDECAR_PREFIX.length)) as WorkbookModel;
      if (
        parsed &&
        Array.isArray(parsed.sheetOrder) &&
        parsed.sheetOrder.length > 0 &&
        parsed.sheets &&
        parsed.cells
      ) {
        return {
          title: parsed.title || title,
          sheetOrder: parsed.sheetOrder,
          sheets: parsed.sheets,
          cells: parsed.cells,
        };
      }
    } catch {
      // Fall through to plain Wire v0 hydration.
    }
  }

  const colHeaders = sheet.columns.length ? [...sheet.columns] : ["Column 1"];
  const dataRows = rows.filter(
    (row) => !(typeof row[0] === "string" && row[0].startsWith(SHEET_SIDECAR_PREFIX)),
  );
  const cells: CellMap = {};
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    for (let c = 0; c < colHeaders.length; c++) {
      const val = row[c];
      if (val !== undefined && val !== null && val !== "") {
        cells[refKey(r, c)] = { value: String(val), fmt: null };
      }
    }
  }
  const sheetId = "s_1";
  const meta: SheetMeta = {
    id: sheetId,
    name: "Sheet1",
    rows: Math.max(MIN_VISUAL_ROWS, dataRows.length + 12),
    cols: Math.max(MIN_VISUAL_COLS, colHeaders.length + 4),
    colHeaders,
    colWidths: {},
    rowHeights: {},
    frozenRows: 0,
    frozenCols: 0,
  };
  return {
    title,
    sheetOrder: [sheetId],
    sheets: { [sheetId]: meta },
    cells: { [sheetId]: cells },
  };
}

function compactWorkbook(wb: WorkbookModel): WorkbookModel {
  const sheets: Record<string, SheetMeta> = {};
  const cells: Record<string, CellMap> = {};
  for (const id of wb.sheetOrder) {
    const sh = wb.sheets[id];
    if (!sh) continue;
    sheets[id] = {
      id: sh.id,
      name: sh.name,
      rows: sh.rows,
      cols: sh.cols,
      ...(sh.colHeaders ? { colHeaders: sh.colHeaders } : {}),
      colWidths: sh.colWidths,
      rowHeights: sh.rowHeights,
      frozenRows: sh.frozenRows,
      frozenCols: sh.frozenCols,
    };
    const nextMap: CellMap = {};
    for (const [ref, cell] of Object.entries(wb.cells[id] || {})) {
      if (cell.value === "" && !cell.fmt) continue;
      nextMap[ref] = cell.fmt ? { value: cell.value, fmt: cell.fmt } : { value: cell.value, fmt: null };
    }
    cells[id] = nextMap;
  }
  return {
    title: wb.title,
    sheetOrder: wb.sheetOrder.filter((id) => !!sheets[id]),
    sheets,
    cells,
  };
}

function hasWorkbookExtras(wb: WorkbookModel): boolean {
  if (wb.sheetOrder.length > 1) return true;
  const firstId = wb.sheetOrder[0];
  const sh = firstId ? wb.sheets[firstId] : undefined;
  if (!sh) return false;
  if (Object.keys(sh.colWidths || {}).length > 0) return true;
  if (Object.keys(sh.rowHeights || {}).length > 0) return true;
  if ((sh.frozenRows || 0) > 0 || (sh.frozenCols || 0) > 0) return true;
  const map = wb.cells[firstId] || {};
  return Object.values(map).some((c) => !!c.fmt);
}

export function cfosSheetToWorks(wb: WorkbookModel): SheetContent {
  const firstId = wb.sheetOrder[0];
  const sh = firstId ? wb.sheets[firstId] : undefined;
  const map = (firstId && wb.cells[firstId]) || {};

  let maxCol = Math.max(1, sh?.colHeaders?.length ?? 0);
  let maxRow = 0;
  const parsedCells: { r: number; c: number; cell: CfosCell }[] = [];
  for (const [ref, cell] of Object.entries(map)) {
    if (cell.value === "" && !cell.fmt) continue;
    const rc = parseSimpleRef(ref);
    if (!rc) continue;
    maxRow = Math.max(maxRow, rc.r + 1);
    maxCol = Math.max(maxCol, rc.c + 1);
    parsedCells.push({ r: rc.r, c: rc.c, cell });
  }

  const columns: string[] = [];
  for (let c = 0; c < maxCol; c++) {
    const named = sh?.colHeaders?.[c]?.trim();
    columns.push(named || colLetter(c));
  }

  const rows: Cell[][] = Array.from({ length: maxRow }, () =>
    Array.from({ length: columns.length }, () => ""),
  );
  for (const item of parsedCells) {
    if (item.r >= 0 && item.r < rows.length && item.c >= 0 && item.c < columns.length) {
      rows[item.r][item.c] = coerceCellInput(item.cell.value);
    }
  }
  const compacted = compactSheetRows(columns.length, rows);

  if (hasWorkbookExtras(wb)) {
    const encoded = SHEET_SIDECAR_PREFIX + JSON.stringify(compactWorkbook(wb));
    const trailerRow: Cell[] = Array.from({ length: columns.length }, (_, i) =>
      i === 0 ? encoded : "",
    );
    const withSidecar: SheetContent = {
      kind: "sheet",
      columns,
      rows: [...compacted, trailerRow],
    };
    const byteLen = new TextEncoder().encode(
      JSON.stringify({ columns: withSidecar.columns, rows: withSidecar.rows }),
    ).length;
    if (byteLen <= MAX_SHEET_BYTES) {
      return withSidecar;
    }
  }

  return {
    kind: "sheet",
    columns,
    rows: compacted,
  };
}

function csvEscape(val: string | number): string {
  const s = String(val);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sheetToCsv(columns: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((_, c) => csvEscape(row[c] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

export function workbookSheetToCsv(wb: WorkbookModel, sheetId: string): string {
  const sh = wb.sheets[sheetId];
  const map = wb.cells[sheetId] || {};
  let maxRow = 0;
  let maxCol = sh?.colHeaders?.length ?? 1;
  for (const [ref, cell] of Object.entries(map)) {
    if (cell.value === "") continue;
    const rc = parseSimpleRef(ref);
    if (!rc) continue;
    maxRow = Math.max(maxRow, rc.r + 1);
    maxCol = Math.max(maxCol, rc.c + 1);
  }
  const columns = Array.from({ length: maxCol }, (_, c) => sh?.colHeaders?.[c]?.trim() || colLetter(c));
  const lines = [columns.map(csvEscape).join(",")];
  for (let r = 0; r < maxRow; r++) {
    lines.push(columns.map((_, c) => csvEscape(map[refKey(r, c)]?.value ?? "")).join(","));
  }
  return lines.join("\r\n");
}

export function parseTsv(tsv: string): string[][] {
  return tsv
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

export function compactSheetRows(colCount: number, rows: readonly (readonly Cell[])[]): Cell[][] {
  let lastNonEmpty = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (
      row.some((cell) => {
        if (cell === "" || cell === null || cell === undefined) return false;
        if (typeof cell === "string" && cell.startsWith(SHEET_SIDECAR_PREFIX)) return false;
        return true;
      })
    ) {
      lastNonEmpty = r;
    }
  }
  const keepCount = Math.max(0, lastNonEmpty + 1);
  const out: Cell[][] = [];
  for (let r = 0; r < keepCount; r++) {
    const row = rows[r] ?? [];
    out.push(Array.from({ length: colCount }, (_, c) => row[c] ?? ""));
  }
  return out;
}

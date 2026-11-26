// Maps Works v0 SheetContent ({ columns, rows }) to/from a 2D spreadsheet grid
// with formula support, TSV clipboard helpers, and CSV export.

import type { Cell } from "../../domain/works";

export const MIN_VISUAL_ROWS = 24;
export const MIN_VISUAL_COLS = 8;

export interface SheetGridModel {
  columns: string[];
  rows: Cell[][];
}

export function normalizeSheetInput(columns: readonly string[], rows: readonly (readonly Cell[])[]): SheetGridModel {
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

export function parseTsv(tsv: string): string[][] {
  return tsv
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

/** Ensure serialized rows keep valid rectangular shape while trimming empty trailing rows. */
export function compactSheetRows(colCount: number, rows: readonly (readonly Cell[])[]): Cell[][] {
  let lastNonEmpty = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row.some((cell) => cell !== "" && cell !== null && cell !== undefined)) {
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

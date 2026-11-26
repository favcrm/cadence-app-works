// Ported from cloudflare-os libraries/zip/src/zip.ts and workspace-sheets/files/lib/xlsx.ts
// Generates valid .xlsx Office Open XML workbooks (sheets, formulas, formats, frozen panes, widths/heights).

import type { CellFmt, CellMap, Dims, SheetMeta, WorkbookModel } from "./formula";

const encoder = new TextEncoder();
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808;
const DEFLATE_METHOD = 8;
const DOS_TIME = 0;
const DOS_DATE = 33;
const MAX_ROWS = 1048576;
const MAX_COLUMNS = 16384;
const DEFAULT_ROWS = 100;
const DEFAULT_COLUMNS = 26;
const DEFAULT_ROW_PIXELS = 24;
const DEFAULT_COLUMN_PIXELS = 92;
const FUTURE_FUNCTIONS = new Set([
  "CONCAT", "DAYS", "IFNA", "IFS", "SWITCH", "TEXTJOIN", "UNICHAR", "UNICODE", "XOR",
]);

interface ZipEntry {
  name: string;
  data: string;
}

interface CentralEntry {
  name: Uint8Array;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC32_TABLE.length; ++i) {
  let value = i;
  for (let bit = 0; bit < 8; ++bit) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[i] = value >>> 0;
}

function crc32(bytes: Uint8Array, previous = 0): number {
  let value = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; ++i) {
    value = CRC32_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function record(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

async function deflateEntry(raw: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(new ArrayBuffer(raw.byteLength));
  copy.set(raw);
  const stream = new ReadableStream<BufferSource>({
    start(ctrl) {
      ctrl.enqueue(copy);
      ctrl.close();
    },
  }).pipeThrough(new CompressionStream("deflate-raw"));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

async function createZipBytes(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const centralEntries: CentralEntry[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.byteLength;
  };

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = encoder.encode(entry.data);
    const compressed = await deflateEntry(raw);
    const crc = crc32(raw);
    const localOffset = offset;

    push(
      record(30, (view) => {
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, UTF8_DATA_DESCRIPTOR_FLAGS, true);
        view.setUint16(8, DEFLATE_METHOD, true);
        view.setUint16(10, DOS_TIME, true);
        view.setUint16(12, DOS_DATE, true);
        view.setUint16(26, name.byteLength, true);
      }),
    );
    push(name);
    push(compressed);
    push(
      record(16, (view) => {
        view.setUint32(0, 0x08074b50, true);
        view.setUint32(4, crc, true);
        view.setUint32(8, compressed.byteLength, true);
        view.setUint32(12, raw.byteLength, true);
      }),
    );
    centralEntries.push({
      name,
      crc,
      compressedSize: compressed.byteLength,
      uncompressedSize: raw.byteLength,
      localOffset,
    });
  }

  const centralOffset = offset;
  for (const entry of centralEntries) {
    push(
      record(46, (view) => {
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, UTF8_DATA_DESCRIPTOR_FLAGS, true);
        view.setUint16(10, DEFLATE_METHOD, true);
        view.setUint16(12, DOS_TIME, true);
        view.setUint16(14, DOS_DATE, true);
        view.setUint32(16, entry.crc, true);
        view.setUint32(20, entry.compressedSize, true);
        view.setUint32(24, entry.uncompressedSize, true);
        view.setUint16(28, entry.name.byteLength, true);
        view.setUint32(42, entry.localOffset, true);
      }),
    );
    push(entry.name);
  }
  const centralSize = offset - centralOffset;
  push(
    record(22, (view) => {
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, centralEntries.length, true);
      view.setUint16(10, centralEntries.length, true);
      view.setUint32(12, centralSize, true);
      view.setUint32(16, centralOffset, true);
    }),
  );

  const combined = new Uint8Array(offset);
  let pos = 0;
  for (const chunk of chunks) {
    combined.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return combined;
}

interface Dimension {
  index: number;
  value: string;
}

interface PreparedCell {
  reference: string;
  row: number;
  column: number;
  value: string;
  style: number;
}

interface PreparedSheet {
  id: string;
  sourceName: string;
  name: string;
  rows: number;
  columns: number;
  frozenRows: number;
  frozenColumns: number;
  columnWidths: Dimension[];
  rowHeights: Dimension[];
  cells: PreparedCell[];
}

interface Font {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string | null;
  size: number | null;
}

interface Fill {
  color?: string;
  gray125?: boolean;
}

interface Alignment {
  horizontal: string | null;
  wrap: boolean;
}

interface CellFormat {
  fontId: number;
  fillId: number;
  numberFormatId: number;
  alignmentId: number;
}

function spreadsheetXml(value: unknown, attribute = false): string {
  const input = String(value).replace(/_x[0-9a-f]{4}_/gi, (m) => "_x005F_" + m.slice(1));
  let clean = "";
  for (let i = 0; i < input.length; ++i) {
    const code = input.charCodeAt(i);
    if (code === 13) clean += "_x000D_";
    else if (code === 9 || code === 10 || (code >= 0x20 && code <= 0xfffd)) clean += input[i];
    else clean += `_x${code.toString(16).toUpperCase().padStart(4, "0")}_`;
  }
  clean = clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (attribute) clean = clean.replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return clean;
}

function xmlAttribute(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function count(value: unknown, fallback: number, maximum: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(maximum, n)) : fallback;
}

function frozenCount(value: unknown, maximum: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(50, maximum, n)) : 0;
}

function safeSheetName(value: unknown): string {
  let name = String(value ?? "").replace(/[:\\/?*[\]]/g, "_").trim().slice(0, 31);
  if (name.startsWith("'")) name = "_" + name.slice(1);
  if (name.endsWith("'")) name = name.slice(0, -1) + "_";
  if (name.toLowerCase() === "history") name += "_";
  return name || "Sheet";
}

function parseCellReference(ref: string): { row: number; column: number } | null {
  const m = /^([A-Z]+)([1-9]\d*)$/.exec(ref);
  if (!m) return null;
  let column = 0;
  for (const ch of m[1]) column = column * 26 + ch.charCodeAt(0) - 64;
  const row = Number(m[2]);
  return column <= MAX_COLUMNS && Number.isSafeInteger(row) && row <= MAX_ROWS ? { row, column } : null;
}

function columnName(col: number): string {
  let name = "";
  for (let v = col; v > 0; v = Math.floor((v - 1) / 26)) {
    name = String.fromCharCode(65 + ((v - 1) % 26)) + name;
  }
  return name;
}

function dimensions(source: Dims | undefined, max: number, conv: (px: number) => string): Dimension[] {
  const result: Dimension[] = [];
  if (!source) return result;
  for (const [k, v] of Object.entries(source)) {
    if (!/^(0|[1-9]\d*)$/.test(k)) continue;
    const idx = Number(k);
    const px = Math.round(Number(v));
    if (Number.isSafeInteger(idx) && idx >= 0 && idx < max && Number.isFinite(px) && px >= 8 && px <= 2000) {
      result.push({ index: idx, value: conv(px) });
    }
  }
  result.sort((a, b) => a.index - b.index);
  return result;
}

function xlsxColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.slice(1);
  if (!value.startsWith("#") || ![3, 6].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) return null;
  return "FF" + (hex.length === 3 ? Array.from(hex, (c) => c + c).join("") : hex).toUpperCase();
}

function decimalPattern(n: number): string {
  return n ? "." + "0".repeat(n) : "";
}

class Styles {
  fonts: Font[] = [{ size: 11 }];
  fontIds = new Map<string, number>();
  fills: Array<Fill | null> = [null, { gray125: true }];
  fillIds = new Map<string, number>();
  numberFormats: Array<{ id: number; code: string }> = [];
  numberFormatIds = new Map<string, number>();
  alignments: Array<Alignment | null> = [null];
  alignmentIds = new Map<string, number>();
  cellFormats: CellFormat[] = [{ fontId: 0, fillId: 0, numberFormatId: 0, alignmentId: 0 }];
  cellFormatIds = new Map<string, number>();

  font(fmt: CellFmt): number {
    const color = xlsxColor(fmt.c);
    const px = Math.round(Number(fmt.fs));
    const size = Number.isFinite(px) && px >= 6 && px <= 96 ? px * 0.75 : null;
    const f: Font = { bold: !!fmt.b, italic: !!fmt.i, underline: !!fmt.u, strike: !!fmt.s, color, size };
    if (!f.bold && !f.italic && !f.underline && !f.strike && !f.color && !f.size) return 0;
    const key = JSON.stringify(f);
    let id = this.fontIds.get(key);
    if (id == null) {
      id = this.fonts.length;
      this.fontIds.set(key, id);
      this.fonts.push(f);
    }
    return id;
  }

  fill(fmt: CellFmt): number {
    const color = xlsxColor(fmt.bg);
    if (!color) return 0;
    let id = this.fillIds.get(color);
    if (id == null) {
      id = this.fills.length;
      this.fillIds.set(color, id);
      this.fills.push({ color });
    }
    return id;
  }

  customNumFmt(code: string): number {
    let id = this.numberFormatIds.get(code);
    if (id == null) {
      id = 164 + this.numberFormats.length;
      this.numberFormatIds.set(code, id);
      this.numberFormats.push({ id, code });
    }
    return id;
  }

  numFmt(fmt: CellFmt): number {
    const places = fmt.d != null ? Math.max(0, Math.min(10, Math.round(fmt.d))) : null;
    const name = fmt.nf;
    if (name === "text") return 49;
    if (name === "integer") return this.customNumFmt("#,##0");
    if (name === "number") return this.customNumFmt("#,##0" + decimalPattern(places ?? 2));
    if (name === "currency") {
      const p = '"$"#,##0' + decimalPattern(places ?? 2);
      return this.customNumFmt(p + ";-" + p);
    }
    if (name === "percent") return this.customNumFmt("#,##0" + decimalPattern(places ?? 2) + "%");
    if (name === "scientific") return this.customNumFmt("0" + decimalPattern(places ?? 2) + "E+00");
    if (name === "date") return this.customNumFmt("mm/dd/yyyy");
    if (name === "time") return this.customNumFmt("h:mm:ss AM/PM");
    if (name === "datetime") return this.customNumFmt("mm/dd/yyyy h:mm:ss AM/PM");
    return places == null ? 0 : this.customNumFmt("0" + decimalPattern(places));
  }

  alignment(fmt: CellFmt): number {
    const horizontal = fmt.a === "l" ? "left" : fmt.a === "c" ? "center" : fmt.a === "r" ? "right" : null;
    const wrap = !!fmt.wrap;
    if (!horizontal && !wrap) return 0;
    const key = `${horizontal || ""}|${wrap}`;
    let id = this.alignmentIds.get(key);
    if (id == null) {
      id = this.alignments.length;
      this.alignmentIds.set(key, id);
      this.alignments.push({ horizontal, wrap });
    }
    return id;
  }

  style(fmt: CellFmt | null | undefined): number {
    if (!fmt) return 0;
    const cf: CellFormat = {
      fontId: this.font(fmt),
      fillId: this.fill(fmt),
      numberFormatId: this.numFmt(fmt),
      alignmentId: this.alignment(fmt),
    };
    if (!cf.fontId && !cf.fillId && !cf.numberFormatId && !cf.alignmentId) return 0;
    const key = `${cf.fontId}|${cf.fillId}|${cf.numberFormatId}|${cf.alignmentId}`;
    let id = this.cellFormatIds.get(key);
    if (id == null) {
      id = this.cellFormats.length;
      this.cellFormatIds.set(key, id);
      this.cellFormats.push(cf);
    }
    return id;
  }
}

function prepareSheetCells(
  cells: CellMap,
  styles: Styles,
  colHeaders?: readonly string[],
): { items: PreparedCell[]; rowOffset: number } {
  const hasHeaders = !!colHeaders?.some((h) => h.trim().length > 0);
  const rowOffset = hasHeaders ? 1 : 0;
  const items: PreparedCell[] = [];
  if (hasHeaders && colHeaders) {
    const headerStyle = styles.style({ b: true });
    for (let c = 0; c < colHeaders.length; c++) {
      const label = colHeaders[c]?.trim();
      if (!label) continue;
      items.push({
        reference: columnName(c + 1) + "1",
        row: 1,
        column: c + 1,
        value: label,
        style: headerStyle,
      });
    }
  }
  for (const [ref, cell] of Object.entries(cells)) {
    const pos = parseCellReference(ref);
    if (!pos) continue;
    const style = styles.style(cell.fmt);
    if (cell.value === "" && !style) continue;
    const shiftedRow = pos.row + rowOffset;
    items.push({
      reference: columnName(pos.column) + shiftedRow,
      row: shiftedRow,
      column: pos.column,
      value: cell.value,
      style,
    });
  }
  items.sort((a, b) => a.row - b.row || a.column - b.column);
  return { items, rowOffset };
}

function renderCellXml(cell: PreparedCell): string {
  const style = cell.style ? ` s="${cell.style}"` : "";
  if (cell.value === "") return `<c r="${cell.reference}"${style}/>`;
  if (cell.value.startsWith("'")) {
    return `<c r="${cell.reference}"${style} t="inlineStr"><is><t xml:space="preserve">${spreadsheetXml(cell.value.slice(1))}</t></is></c>`;
  }
  if (cell.value.startsWith("=")) {
    const raw = cell.value.slice(1).replace(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g, (m, fn: string) =>
      FUTURE_FUNCTIONS.has(fn.toUpperCase()) ? `_xlfn.${fn.toUpperCase()}(` : m,
    );
    return `<c r="${cell.reference}"${style}><f>${spreadsheetXml(raw)}</f></c>`;
  }
  const trimmed = cell.value.trim();
  if (/^(TRUE|FALSE)$/i.test(trimmed)) {
    return `<c r="${cell.reference}"${style} t="b"><v>${/^true$/i.test(trimmed) ? 1 : 0}</v></c>`;
  }
  if (/^[-+]?\$?[\d,]*\.?\d+%?$/.test(trimmed) && /\d/.test(trimmed)) {
    const neg = trimmed.startsWith("-");
    const n = Number(trimmed.replace(/[$,+%-]/g, "")) * (trimmed.endsWith("%") ? 0.01 : 1);
    if (Number.isFinite(n)) {
      return `<c r="${cell.reference}"${style}><v>${neg ? -n : n}</v></c>`;
    }
  }
  return `<c r="${cell.reference}"${style} t="inlineStr"><is><t xml:space="preserve">${spreadsheetXml(cell.value)}</t></is></c>`;
}

function buildWorksheetXml(sheet: PreparedSheet): string {
  const rowPoints = (px: number) => String(Math.min(409, Math.round(px * 75) / 100));
  const colWidth = (px: number) => String(Math.min(255, Math.round(Math.max(0, (px - 5) / 7) * 256) / 256));
  const dim = sheet.cells.length
    ? `${sheet.cells[0].reference}:${sheet.cells.at(-1)!.reference}`
    : "A1";
  const pane =
    sheet.frozenRows || sheet.frozenColumns
      ? `<pane ${sheet.frozenColumns ? `xSplit="${sheet.frozenColumns}" ` : ""}${
          sheet.frozenRows ? `ySplit="${sheet.frozenRows}" ` : ""
        }topLeftCell="${columnName(sheet.frozenColumns + 1)}${sheet.frozenRows + 1}" state="frozen"/>`
      : "";
  let out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN_NS}">`;
  out += `<dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`;
  out += `<sheetFormatPr defaultColWidth="${colWidth(DEFAULT_COLUMN_PIXELS)}" defaultRowHeight="${rowPoints(DEFAULT_ROW_PIXELS)}"/>`;
  if (sheet.columnWidths.length) {
    out += "<cols>";
    for (const w of sheet.columnWidths) {
      out += `<col min="${w.index + 1}" max="${w.index + 1}" width="${w.value}" customWidth="1"/>`;
    }
    out += "</cols>";
  }
  out += "<sheetData>";
  let ci = 0;
  while (ci < sheet.cells.length) {
    const row = sheet.cells[ci].row;
    out += `<row r="${row}">`;
    while (ci < sheet.cells.length && sheet.cells[ci].row === row) {
      out += renderCellXml(sheet.cells[ci++]);
    }
    out += "</row>";
  }
  out += "</sheetData></worksheet>";
  return out;
}

function buildStylesXml(styles: Styles): string {
  let out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN_NS}">`;
  if (styles.numberFormats.length) {
    out += `<numFmts count="${styles.numberFormats.length}">`;
    for (const nf of styles.numberFormats) {
      out += `<numFmt numFmtId="${nf.id}" formatCode="${xmlAttribute(nf.code)}"/>`;
    }
    out += "</numFmts>";
  }
  out += `<fonts count="${styles.fonts.length}">`;
  for (const font of styles.fonts) {
    out += "<font>";
    if (font.bold) out += "<b/>";
    if (font.italic) out += "<i/>";
    if (font.underline) out += "<u/>";
    if (font.strike) out += "<strike/>";
    out += `<sz val="${font.size || 11}"/>`;
    if (font.color) out += `<color rgb="${font.color}"/>`;
    out += '<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>';
  }
  out += `</fonts><fills count="${styles.fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`;
  for (let i = 2; i < styles.fills.length; i++) {
    out += `<fill><patternFill patternType="solid"><fgColor rgb="${styles.fills[i]!.color}"/><bgColor indexed="64"/></patternFill></fill>`;
  }
  out += '</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>';
  out += `<cellXfs count="${styles.cellFormats.length}">`;
  for (const cf of styles.cellFormats) {
    const al = styles.alignments[cf.alignmentId];
    let attrs = `numFmtId="${cf.numberFormatId}" fontId="${cf.fontId}" fillId="${cf.fillId}" borderId="0" xfId="0"`;
    if (cf.numberFormatId) attrs += ' applyNumberFormat="1"';
    if (cf.fontId) attrs += ' applyFont="1"';
    if (cf.fillId) attrs += ' applyFill="1"';
    if (al) {
      attrs += ' applyAlignment="1"';
      const alAttrs = [
        al.horizontal ? `horizontal="${al.horizontal}"` : "",
        al.wrap ? 'wrapText="1"' : "",
      ]
        .filter(Boolean)
        .join(" ");
      out += `<xf ${attrs}><alignment ${alAttrs}/></xf>`;
    } else {
      out += `<xf ${attrs}/>`;
    }
  }
  out += '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return out;
}

export async function buildXlsxBytes(wb: WorkbookModel): Promise<Uint8Array> {
  const styles = new Styles();
  const usedNames = new Set<string>();
  const sheets: PreparedSheet[] = [];

  for (const id of wb.sheetOrder) {
    const meta: SheetMeta | undefined = wb.sheets[id];
    if (!meta) continue;
    let name = safeSheetName(meta.name);
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      name = `${safeSheetName(meta.name).slice(0, 26)} (${suffix++})`;
    }
    usedNames.add(name.toLowerCase());
    const prepared = prepareSheetCells(wb.cells[id] || {}, styles, meta.colHeaders);
    const cols = count(meta.cols, DEFAULT_COLUMNS, MAX_COLUMNS);
    const rows = count(meta.rows, DEFAULT_ROWS, MAX_ROWS);
    sheets.push({
      id,
      sourceName: meta.name,
      name,
      rows: rows + prepared.rowOffset,
      columns: cols,
      frozenRows: frozenCount(meta.frozenRows + prepared.rowOffset, rows),
      frozenColumns: frozenCount(meta.frozenCols, cols),
      columnWidths: dimensions(meta.colWidths, cols, (px) =>
        String(Math.min(255, Math.round(Math.max(0, (px - 5) / 7) * 256) / 256)),
      ),
      rowHeights: dimensions(meta.rowHeights, rows, (px) =>
        String(Math.min(409, Math.round(px * 75) / 100)),
      ),
      cells: prepared.items,
    });
  }

  let contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
  contentTypes += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
  contentTypes += '<Default Extension="xml" ContentType="application/xml"/>';
  contentTypes += '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  contentTypes += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';

  let wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>`;
  let wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}">`;

  const entries: ZipEntry[] = [
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
  ];

  for (let i = 0; i < sheets.length; i++) {
    contentTypes += `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    wbXml += `<sheet name="${spreadsheetXml(sheets[i].name, true)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
    wbRels += `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: buildWorksheetXml(sheets[i]) });
  }

  contentTypes += "</Types>";
  wbXml += '</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>';
  wbRels += `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;

  entries.unshift({ name: "[Content_Types].xml", data: contentTypes });
  entries.push({ name: "xl/workbook.xml", data: wbXml });
  entries.push({ name: "xl/_rels/workbook.xml.rels", data: wbRels });
  entries.push({ name: "xl/styles.xml", data: buildStylesXml(styles) });

  return createZipBytes(entries);
}

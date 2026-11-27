// Ported from cloudflare-os workspace-sheets/files/lib/formula.ts & client.ts
// Pure formula parser, AST serializer, 100+ formula evaluator (including cross-sheet refs),
// and Excel-compatible cell display formatter.

import type { Cell as WireCell } from "../../domain/works";

export interface CellFmt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  wrap?: boolean;
  c?: string;
  bg?: string;
  a?: "l" | "c" | "r";
  nf?: string;
  d?: number;
  fs?: number;
}

export interface CfosCell {
  value: string;
  fmt: CellFmt | null;
}

export type CellMap = Record<string, CfosCell>;
export type Dims = Record<string, number>;

export interface SheetMeta {
  id: string;
  name: string;
  rows: number;
  cols: number;
  colHeaders?: string[];
  colWidths: Dims;
  rowHeights: Dims;
  frozenRows: number;
  frozenCols: number;
}

export interface WorkbookModel {
  title: string;
  sheetOrder: string[];
  sheets: Record<string, SheetMeta>;
  cells: Record<string, CellMap>;
}

export const FUNCTION_GROUPS: Readonly<Record<string, readonly string[]>> = {
  Math: ["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "PRODUCT", "ROUND", "ABS", "SQRT", "MOD", "POWER"],
  Statistical: ["MEDIAN", "STDEV", "VAR", "COUNTA", "COUNTIF", "SUMIF", "SUMIFS", "COUNTIFS", "RANK", "LARGE"],
  Logical: ["IF", "IFS", "IFERROR", "AND", "OR", "NOT", "SWITCH"],
  Text: ["CONCAT", "TEXTJOIN", "LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "TRIM", "SUBSTITUTE", "TEXT"],
  Lookup: ["VLOOKUP", "HLOOKUP", "INDEX", "MATCH", "CHOOSE", "LOOKUP"],
  Date: ["TODAY", "NOW", "DATE", "YEAR", "MONTH", "DAY", "WEEKDAY", "EDATE", "DATEDIF"],
};

export class CellError {
  declare value: string;
  constructor(v: string) {
    this.value = v;
  }
  toString(): string {
    return this.value;
  }
}

export const ERR = {
  DIV0: () => new CellError("#DIV/0!"),
  VALUE: () => new CellError("#VALUE!"),
  REF: () => new CellError("#REF!"),
  NAME: () => new CellError("#NAME?"),
  NA: () => new CellError("#N/A"),
  NUM: () => new CellError("#NUM!"),
  CYCLE: () => new CellError("#CYCLE!"),
};

export const isErr = (v: unknown): v is CellError => v instanceof CellError;

export interface RC {
  r: number;
  c: number;
}

export function colToLetter(c: number): string {
  let s = "";
  let n = c;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export function letterToCol(str: string): number {
  let col = 0;
  for (let i = 0; i < str.length; i++) {
    col = col * 26 + (str.charCodeAt(i) - 64);
  }
  return col - 1;
}

export function parseRef(ref: string): RC | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9]\d*)$/.exec(ref.trim());
  if (!m) return null;
  const c = letterToCol(m[1].toUpperCase());
  const r = parseInt(m[2], 10) - 1;
  if (c < 0 || c > 16383 || r < 0 || r > 1048575) return null;
  return { r, c };
}

export function rcToRef(r: number, c: number): string {
  return colToLetter(c) + (r + 1);
}

export type Token =
  | { t: "str" | "op" | "word"; v: string }
  | { t: "num"; v: number }
  | { t: "lp" | "rp" | "comma" | "colon"; v?: undefined };

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let str = "";
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            str += '"';
            j += 2;
            continue;
          }
          j++;
          break;
        }
        str += src[j++];
      }
      tokens.push({ t: "str", v: str });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < n && /[0-9]/.test(src[j])) j++;
      }
      tokens.push({ t: "num", v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ t: "comma" });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ t: "colon" });
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch) || ch === "'") {
      let j = i;
      let word = "";
      if (ch === "'") {
        j++;
        while (j < n && src[j] !== "'") {
          if (src[j] === "'" && src[j + 1] === "'") {
            word += "'";
            j += 2;
          } else {
            word += src[j++];
          }
        }
        if (j < n) j++;
        word = "'" + word + "'";
      } else {
        while (j < n && /[A-Za-z0-9_$.]/.test(src[j])) word += src[j++];
      }
      if (src[j] === "!") {
        word += "!";
        j++;
        while (j < n && /[A-Za-z0-9_$]/.test(src[j])) word += src[j++];
      }
      tokens.push({ t: "word", v: word });
      i = j;
      continue;
    }
    i++;
  }
  return tokens;
}

export type Ast =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; ref: string }
  | { k: "range"; a: string; b: string }
  | { k: "paren"; a: Ast }
  | { k: "un"; op: string; a: Ast }
  | { k: "pct"; a: Ast }
  | { k: "bin"; op: string; a: Ast; b: Ast }
  | { k: "call"; name: string; args: Ast[] };

const BP: Record<string, { lbp: number; right?: boolean }> = {
  "=": { lbp: 1 },
  "<>": { lbp: 1 },
  "<": { lbp: 1 },
  ">": { lbp: 1 },
  "<=": { lbp: 1 },
  ">=": { lbp: 1 },
  "&": { lbp: 2 },
  "+": { lbp: 3 },
  "-": { lbp: 3 },
  "*": { lbp: 4 },
  "/": { lbp: 4 },
  "^": { lbp: 5, right: true },
};

export function parseFormula(src: string): Ast {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  function parseExpr(minbp = 0): Ast {
    let left = parseUnary();
    while (true) {
      const tk = peek();
      if (!tk || tk.t !== "op") break;
      const bp = BP[tk.v];
      if (bp == null || bp.lbp <= minbp) break;
      next();
      const right = parseExpr(bp.lbp - (bp.right ? 1 : 0));
      left = { k: "bin", op: tk.v, a: left, b: right };
    }
    return left;
  }

  function parseUnary(): Ast {
    const tk = peek();
    if (tk && tk.t === "op" && (tk.v === "-" || tk.v === "+")) {
      next();
      return { k: "un", op: tk.v, a: parseUnary() };
    }
    let node = parsePrimary();
    while (peek() && peek()!.t === "op" && peek()!.v === "%") {
      next();
      node = { k: "pct", a: node };
    }
    return node;
  }

  function parsePrimary(): Ast {
    const tk = next();
    if (!tk) throw ERR.VALUE();
    if (tk.t === "num") return { k: "num", v: tk.v };
    if (tk.t === "str") return { k: "str", v: tk.v };
    if (tk.t === "lp") {
      const e = parseExpr(0);
      if (peek() && peek()!.t === "rp") next();
      return { k: "paren", a: e };
    }
    if (tk.t === "word") {
      if (peek() && peek()!.t === "lp") {
        next();
        const args: Ast[] = [];
        if (!(peek() && peek()!.t === "rp")) {
          args.push(parseExpr(0));
          while (peek() && peek()!.t === "comma") {
            next();
            args.push(parseExpr(0));
          }
        }
        if (peek() && peek()!.t === "rp") next();
        return { k: "call", name: tk.v.toUpperCase(), args };
      }
      const up = tk.v.toUpperCase();
      if (up === "TRUE") return { k: "bool", v: true };
      if (up === "FALSE") return { k: "bool", v: false };
      let ref: Ast = { k: "ref", ref: tk.v };
      if (peek() && peek()!.t === "colon") {
        next();
        const end = next();
        if (!end || end.t !== "word") throw ERR.VALUE();
        ref = { k: "range", a: tk.v, b: end.v };
      }
      return ref;
    }
    throw ERR.VALUE();
  }

  return parseExpr(0);
}

export function unwrapParens(node: Ast): Ast {
  return node.k === "paren" ? unwrapParens(node.a) : node;
}

export function serializeAst(node: Ast): string {
  switch (node.k) {
    case "num":
      return String(node.v);
    case "str":
      return '"' + node.v.replace(/"/g, '""') + '"';
    case "bool":
      return node.v ? "TRUE" : "FALSE";
    case "ref":
      return node.ref;
    case "range":
      return node.a + ":" + node.b;
    case "paren":
      return "(" + serializeAst(node.a) + ")";
    case "un":
      return node.op + serializeAst(node.a);
    case "pct":
      return serializeAst(node.a) + "%";
    case "bin":
      return serializeAst(node.a) + node.op + serializeAst(node.b);
    case "call":
      return node.name + "(" + node.args.map(serializeAst).join(",") + ")";
  }
}

export type Scalar = number | string | boolean | null | undefined;
export interface Matrix {
  matrix: true;
  rows: number;
  cols: number;
  get(i: number, j: number): Value;
}
export type Value = Scalar | CellError | Matrix;
const isMatrix = (v: Value): v is Matrix => typeof v === "object" && v !== null && "matrix" in v;

const DATE_EPOCH = Date.UTC(1899, 11, 30);
function serialToDate(s: number): Date {
  return new Date(DATE_EPOCH + Math.round(s * 86400000));
}
function dateToSerial(d: Date): number {
  return (d.getTime() - DATE_EPOCH) / 86400000;
}

function toNum(v: Value): number {
  if (isErr(v)) throw v;
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const n = Number(s.replace(/,/g, "").replace(/%$/, ""));
  if (!Number.isFinite(n)) throw ERR.VALUE();
  return s.endsWith("%") ? n / 100 : n;
}

function toStr(v: Value): string {
  if (isErr(v)) throw v;
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function toBool(v: Value): boolean {
  if (isErr(v)) throw v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v == null || v === "") return false;
  const s = String(v).toUpperCase();
  if (s === "TRUE") return true;
  if (s === "FALSE") return false;
  return toNum(v) !== 0;
}

export function fmtGeneral(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-6)) {
    return n.toExponential(5).replace(/\.?0+e/, "e");
  }
  let s = n.toPrecision(11);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

export interface Display {
  text: string;
  numeric?: boolean;
  err?: boolean;
  center?: boolean;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function displayValue(computed: Value, fmt?: CellFmt | null): Display {
  if (isErr(computed)) return { text: computed.value, err: true };
  if (computed == null || computed === "") return { text: "" };
  if (typeof computed === "boolean") {
    return { text: computed ? "TRUE" : "FALSE", center: true };
  }
  if (typeof computed === "string") return { text: computed };
  if (typeof computed === "number") {
    const nf = fmt?.nf;
    const d = fmt?.d;
    if (nf === "text") return { text: String(computed) };
    if (nf === "integer") {
      return {
        text: Math.round(computed).toLocaleString("en-US"),
        numeric: true,
      };
    }
    if (nf === "number") {
      const dec = d != null ? d : 2;
      return {
        text: computed.toLocaleString("en-US", {
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        }),
        numeric: true,
      };
    }
    if (nf === "currency") {
      const dec = d != null ? d : 2;
      const sign = computed < 0 ? "-" : "";
      return {
        text:
          sign +
          "$" +
          Math.abs(computed).toLocaleString("en-US", {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec,
          }),
        numeric: true,
      };
    }
    if (nf === "percent") {
      const dec = d != null ? d : 2;
      return {
        text: (computed * 100).toFixed(dec) + "%",
        numeric: true,
      };
    }
    if (nf === "scientific") {
      return { text: computed.toExponential(d != null ? d : 2).toUpperCase(), numeric: true };
    }
    if (nf === "date" || nf === "time" || nf === "datetime") {
      const dt = serialToDate(computed);
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const day = dt.getUTCDate();
      const h = dt.getUTCHours();
      const min = dt.getUTCMinutes();
      const sec = dt.getUTCSeconds();
      if (nf === "date") return { text: `${m}/${day}/${y}`, numeric: true };
      const ap = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      if (nf === "time") return { text: `${h12}:${pad2(min)}:${pad2(sec)} ${ap}`, numeric: true };
      return { text: `${m}/${day}/${y} ${pad2(h)}:${pad2(min)}:${pad2(sec)}`, numeric: true };
    }
    if (d != null) {
      return {
        text: computed.toLocaleString("en-US", {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        }),
        numeric: true,
      };
    }
    return { text: fmtGeneral(computed), numeric: true };
  }
  return { text: String(computed) };
}

export interface EvalContext {
  sheetId: string;
  r: number;
  c: number;
}

export interface SheetPos {
  sheetId: string;
  r: number;
  c: number;
}

export interface GridReader {
  getRaw?: (r: number, c: number) => string | number | undefined;
  activeSheetId?: string;
  resolveSheetId?: (name: string) => string | null;
  getSheetRaw?: (sheetId: string, r: number, c: number) => string | number | undefined;
}

export interface Engine {
  compute(r: number, c: number): Value;
  display(r: number, c: number, fmt?: CellFmt | null): Display;
  computeRef(sheetId: string, ref: string): Value;
  splitRef(refStr: string, defaultSheetId: string): SheetPos | null;
}

interface Helpers {
  evalNode(node: Ast, ctx: EvalContext): Value;
  toNum: typeof toNum;
  toStr: typeof toStr;
  toBool: typeof toBool;
  compare(a: Value, b: Value, op: string): boolean;
  flatVals(args: Ast[], ctx: EvalContext): Value[];
  flatNums(args: Ast[], ctx: EvalContext): number[];
  scalar(node: Ast, ctx: EvalContext): Value;
  matrixOf(node: Ast, ctx: EvalContext): Matrix;
  splitRef(refStr: string, defaultSheetId: string): SheetPos | null;
}

type FormulaFn = (args: Ast[], ctx: EvalContext, H: Helpers) => Value;

function wildToRe(p: string): RegExp {
  return new RegExp(
    "^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    "i",
  );
}

function matVals(m: Matrix): Value[] {
  const out: Value[] = [];
  for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) out.push(m.get(i, j));
  return out;
}

function matchCriteria(val: Value, crit: Value): boolean {
  if (crit == null) return val == null || val === "";
  const c = typeof crit === "string" ? crit : String(crit);
  const m = /^(<=|>=|<>|=|<|>)(.*)$/.exec(c);
  let op = "=";
  let rhs = c;
  if (m) {
    op = m[1];
    rhs = m[2];
  }
  const rn = Number(rhs);
  const rhsNum = rhs.trim() !== "" && Number.isFinite(rn);
  if (op === "=" || op === "<>") {
    let eq: boolean;
    if (rhsNum && typeof val === "number") eq = val === rn;
    else if (/[*?]/.test(rhs)) eq = wildToRe(rhs).test(String(val ?? ""));
    else eq = String(val ?? "").toLowerCase() === rhs.toLowerCase();
    return op === "=" ? eq : !eq;
  }
  const vn = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(vn) || !rhsNum) {
    const a = String(val ?? "").toLowerCase();
    const b = rhs.toLowerCase();
    const cmp = a < b ? -1 : a > b ? 1 : 0;
    return op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
  }
  return op === "<" ? vn < rn : op === ">" ? vn > rn : op === "<=" ? vn <= rn : vn >= rn;
}

function applyTextFormat(v: number, f: string): string {
  if (/%/.test(f)) {
    const dec = (f.split(".")[1] || "").length;
    return (v * 100).toFixed(dec) + "%";
  }
  if (/[$]/.test(f)) {
    const dec = (f.split(".")[1] || "").replace(/[^0#]/g, "").length;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  if (/yy|mm|dd|hh/i.test(f)) return formatDatePattern(v, f);
  if (/0|#/.test(f)) {
    const dec = (f.split(".")[1] || "").replace(/[^0#]/g, "").length;
    const grp = /[#0],[#0]/.test(f) || /,/.test(f.split(".")[0]);
    return v.toLocaleString("en-US", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
      useGrouping: grp,
    });
  }
  return String(v);
}

function formatDatePattern(serial: number, f: string): string {
  const d = serialToDate(serial);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return f
    .replace(/yyyy/gi, String(d.getUTCFullYear()))
    .replace(/yy/gi, String(d.getUTCFullYear()).slice(-2))
    .replace(/mmmm/gi, months[d.getUTCMonth()])
    .replace(/mmm/gi, months[d.getUTCMonth()].slice(0, 3))
    .replace(/mm/g, pad2(d.getUTCMonth() + 1))
    .replace(/dddd/gi, days[d.getUTCDay()])
    .replace(/ddd/gi, days[d.getUTCDay()].slice(0, 3))
    .replace(/dd/gi, pad2(d.getUTCDate()))
    .replace(/hh/gi, pad2(d.getUTCHours()))
    .replace(/ss/gi, pad2(d.getUTCSeconds()));
}

const FUNCTIONS: Record<string, FormulaFn> = (() => {
  const F: Record<string, FormulaFn> = {};
  const numArgs = (args: Ast[], ctx: EvalContext, H: Helpers) => H.flatNums(args, ctx);
  const s = (args: Ast[], ctx: EvalContext, H: Helpers, i: number) =>
    i < args.length ? H.scalar(args[i], ctx) : undefined;

  // Math
  F.SUM = (a, c, H) => numArgs(a, c, H).reduce((x, y) => x + y, 0);
  F.PRODUCT = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? n.reduce((x, y) => x * y, 1) : 0;
  };
  F.AVERAGE = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : ERR.DIV0();
  };
  F.MEDIAN = (a, c, H) => {
    const n = numArgs(a, c, H).sort((x, y) => x - y);
    if (!n.length) return ERR.NUM();
    const m = n.length >> 1;
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  };
  F.MIN = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? Math.min(...n) : 0;
  };
  F.MAX = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? Math.max(...n) : 0;
  };
  F.COUNT = (a, c, H) => H.flatVals(a, c).filter((v) => typeof v === "number").length;
  F.COUNTA = (a, c, H) => H.flatVals(a, c).filter((v) => v != null && v !== "").length;
  F.COUNTBLANK = (a, c, H) => H.flatVals(a, c).filter((v) => v == null || v === "").length;
  F.ABS = (a, c, H) => Math.abs(H.toNum(s(a, c, H, 0)));
  F.SIGN = (a, c, H) => Math.sign(H.toNum(s(a, c, H, 0)));
  F.SQRT = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    return x < 0 ? ERR.NUM() : Math.sqrt(x);
  };
  F.POWER = (a, c, H) => Math.pow(H.toNum(s(a, c, H, 0)), H.toNum(s(a, c, H, 1)));
  F.MOD = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const y = H.toNum(s(a, c, H, 1));
    return y === 0 ? ERR.DIV0() : ((x % y) + y) % y;
  };
  F.INT = (a, c, H) => Math.floor(H.toNum(s(a, c, H, 0)));
  F.TRUNC = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const d = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 0;
    const m = 10 ** d;
    return Math.trunc(x * m) / m;
  };
  F.ROUND = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const d = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 0;
    const m = 10 ** d;
    return Math.round(x * m) / m;
  };
  F.ROUNDUP = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const d = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 0;
    const m = 10 ** d;
    return (x >= 0 ? Math.ceil(x * m) : Math.floor(x * m)) / m;
  };
  F.ROUNDDOWN = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const d = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 0;
    const m = 10 ** d;
    return Math.trunc(x * m) / m;
  };
  F.CEILING = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const sg = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 1;
    return sg === 0 ? 0 : Math.ceil(x / sg) * sg;
  };
  F.FLOOR = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const sg = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 1;
    return sg === 0 ? 0 : Math.floor(x / sg) * sg;
  };
  F.EXP = (a, c, H) => Math.exp(H.toNum(s(a, c, H, 0)));
  F.LN = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    return x <= 0 ? ERR.NUM() : Math.log(x);
  };
  F.LOG10 = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    return x <= 0 ? ERR.NUM() : Math.log10(x);
  };
  F.LOG = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const base = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 10;
    return x <= 0 || base <= 0 || base === 1 ? ERR.NUM() : Math.log(x) / Math.log(base);
  };
  F.PI = () => Math.PI;
  F.RAND = () => Math.random();
  F.RANDBETWEEN = (a, c, H) => {
    const lo = Math.ceil(H.toNum(s(a, c, H, 0)));
    const hi = Math.floor(H.toNum(s(a, c, H, 1)));
    return lo > hi ? ERR.NUM() : Math.floor(Math.random() * (hi - lo + 1)) + lo;
  };

  // Conditional aggregations
  F.SUMIF = (a, c, H) => {
    const range = matVals(H.matrixOf(a[0], c));
    const crit = a.length > 1 ? H.scalar(a[1], c) : null;
    const sumRange = a.length > 2 ? matVals(H.matrixOf(a[2], c)) : range;
    let t = 0;
    for (let i = 0; i < range.length; i++) {
      if (matchCriteria(range[i], crit)) {
        const v = sumRange[i];
        if (typeof v === "number") t += v;
      }
    }
    return t;
  };
  F.COUNTIF = (a, c, H) => {
    const range = matVals(H.matrixOf(a[0], c));
    const crit = a.length > 1 ? H.scalar(a[1], c) : null;
    return range.filter((v) => matchCriteria(v, crit)).length;
  };
  F.AVERAGEIF = (a, c, H) => {
    const range = matVals(H.matrixOf(a[0], c));
    const crit = a.length > 1 ? H.scalar(a[1], c) : null;
    const avgRange = a.length > 2 ? matVals(H.matrixOf(a[2], c)) : range;
    let t = 0;
    let n = 0;
    for (let i = 0; i < range.length; i++) {
      if (matchCriteria(range[i], crit)) {
        const v = avgRange[i];
        if (typeof v === "number") {
          t += v;
          n++;
        }
      }
    }
    return n ? t / n : ERR.DIV0();
  };
  function ifsMatch(a: Ast[], c: EvalContext, H: Helpers, startIdx: number): boolean[] {
    const pairs: [Value[], Value][] = [];
    for (let i = startIdx; i + 1 < a.length; i += 2) {
      pairs.push([matVals(H.matrixOf(a[i], c)), H.scalar(a[i + 1], c)]);
    }
    const len = pairs.length ? pairs[0][0].length : 0;
    const mask: boolean[] = [];
    for (let i = 0; i < len; i++) mask.push(pairs.every(([rng, cr]) => matchCriteria(rng[i], cr)));
    return mask;
  }
  F.SUMIFS = (a, c, H) => {
    const sum = matVals(H.matrixOf(a[0], c));
    const mask = ifsMatch(a, c, H, 1);
    let t = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] && typeof sum[i] === "number") t += sum[i] as number;
    return t;
  };
  F.COUNTIFS = (a, c, H) => ifsMatch(a, c, H, 0).filter(Boolean).length;
  F.AVERAGEIFS = (a, c, H) => {
    const avg = matVals(H.matrixOf(a[0], c));
    const mask = ifsMatch(a, c, H, 1);
    let t = 0;
    let n = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && typeof avg[i] === "number") {
        t += avg[i] as number;
        n++;
      }
    }
    return n ? t / n : ERR.DIV0();
  };
  F.SUMPRODUCT = (a, c, H) => {
    const mats = a.map((nd) => H.matrixOf(nd, c));
    const rows = mats[0].rows;
    const cols = mats[0].cols;
    let t = 0;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        let p = 1;
        for (const m of mats) {
          const v = m.get(i, j);
          p *= typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
        }
        t += p;
      }
    }
    return t;
  };

  // Statistics
  function stdVar(vals: number[], pop: boolean, variance: boolean): number | CellError {
    if (vals.length < (pop ? 1 : 2)) return ERR.DIV0();
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    const ss = vals.reduce((x, y) => x + (y - mean) ** 2, 0);
    const v = ss / (vals.length - (pop ? 0 : 1));
    return variance ? v : Math.sqrt(v);
  }
  F.STDEV = (a, c, H) => stdVar(numArgs(a, c, H), false, false);
  F.STDEVP = (a, c, H) => stdVar(numArgs(a, c, H), true, false);
  F.VAR = (a, c, H) => stdVar(numArgs(a, c, H), false, true);
  F.VARP = (a, c, H) => stdVar(numArgs(a, c, H), true, true);
  F.LARGE = (a, c, H) => {
    const n = matVals(H.matrixOf(a[0], c)).filter((v) => typeof v === "number").sort((x, y) => y - x);
    const k = H.toNum(s(a, c, H, 1));
    return n[k - 1] ?? ERR.NUM();
  };
  F.SMALL = (a, c, H) => {
    const n = matVals(H.matrixOf(a[0], c)).filter((v) => typeof v === "number").sort((x, y) => x - y);
    const k = H.toNum(s(a, c, H, 1));
    return n[k - 1] ?? ERR.NUM();
  };
  F.RANK = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const arr = matVals(H.matrixOf(a[1], c)).filter((v) => typeof v === "number");
    const asc = a.length > 2 && H.toBool(s(a, c, H, 2));
    const sorted = arr.slice().sort((p, q) => (asc ? p - q : q - p));
    const i = sorted.indexOf(x);
    return i < 0 ? ERR.NA() : i + 1;
  };
  F.PERCENTILE = (a, c, H) => {
    const arr = matVals(H.matrixOf(a[0], c)).filter((v) => typeof v === "number").sort((x, y) => x - y);
    const p = H.toNum(s(a, c, H, 1));
    if (!arr.length) return ERR.NUM();
    const idx = p * (arr.length - 1);
    const lo = Math.floor(idx);
    return arr[lo] + (arr[Math.min(lo + 1, arr.length - 1)] - arr[lo]) * (idx - lo);
  };

  // Logical
  F.IF = (a, c, H) => {
    const t = H.toBool(H.scalar(a[0], c));
    if (t) return a.length > 1 ? H.scalar(a[1], c) : true;
    return a.length > 2 ? H.scalar(a[2], c) : false;
  };
  F.IFS = (a, c, H) => {
    for (let i = 0; i + 1 < a.length; i += 2) {
      if (H.toBool(H.scalar(a[i], c))) return H.scalar(a[i + 1], c);
    }
    return ERR.NA();
  };
  F.IFERROR = (a, c, H) => {
    const v = H.scalar(a[0], c);
    return isErr(v) ? (a.length > 1 ? H.scalar(a[1], c) : "") : v;
  };
  F.IFNA = (a, c, H) => {
    const v = H.scalar(a[0], c);
    return isErr(v) && v.value === "#N/A" ? H.scalar(a[1], c) : v;
  };
  F.AND = (a, c, H) => {
    for (const v of H.flatVals(a, c)) {
      if (isErr(v)) return v;
      if (v != null && v !== "" && !H.toBool(v)) return false;
    }
    return true;
  };
  F.OR = (a, c, H) => {
    let any = false;
    for (const v of H.flatVals(a, c)) {
      if (isErr(v)) return v;
      if (v != null && v !== "" && H.toBool(v)) any = true;
    }
    return any;
  };
  F.XOR = (a, c, H) => {
    let cnt = 0;
    for (const v of H.flatVals(a, c)) if (H.toBool(v)) cnt++;
    return cnt % 2 === 1;
  };
  F.NOT = (a, c, H) => !H.toBool(H.scalar(a[0], c));
  F.TRUE = () => true;
  F.FALSE = () => false;
  F.SWITCH = (a, c, H) => {
    const target = H.scalar(a[0], c);
    let i = 1;
    for (; i + 1 < a.length; i += 2) {
      if (H.compare(target, H.scalar(a[i], c), "=")) return H.scalar(a[i + 1], c);
    }
    return i < a.length ? H.scalar(a[i], c) : ERR.NA();
  };

  // Text
  F.CONCAT = (a, c, H) => H.flatVals(a, c).map((v) => (v == null ? "" : H.toStr(v))).join("");
  F.CONCATENATE = F.CONCAT;
  F.TEXTJOIN = (a, c, H) => {
    const delim = H.toStr(H.scalar(a[0], c));
    const skip = H.toBool(H.scalar(a[1], c));
    const vals = H.flatVals(a.slice(2), c).map((v) => (v == null ? "" : H.toStr(v)));
    return (skip ? vals.filter((v) => v !== "") : vals).join(delim);
  };
  F.LEFT = (a, c, H) => {
    const t = H.toStr(H.scalar(a[0], c));
    const n = a.length > 1 ? H.toNum(H.scalar(a[1], c)) : 1;
    return t.slice(0, Math.max(0, n));
  };
  F.RIGHT = (a, c, H) => {
    const t = H.toStr(H.scalar(a[0], c));
    const n = a.length > 1 ? H.toNum(H.scalar(a[1], c)) : 1;
    return n <= 0 ? "" : t.slice(-n);
  };
  F.MID = (a, c, H) => {
    const t = H.toStr(H.scalar(a[0], c));
    const start = H.toNum(H.scalar(a[1], c));
    const len = H.toNum(H.scalar(a[2], c));
    return t.slice(Math.max(0, start - 1), Math.max(0, start - 1) + Math.max(0, len));
  };
  F.LEN = (a, c, H) => H.toStr(H.scalar(a[0], c)).length;
  F.LOWER = (a, c, H) => H.toStr(H.scalar(a[0], c)).toLowerCase();
  F.UPPER = (a, c, H) => H.toStr(H.scalar(a[0], c)).toUpperCase();
  F.PROPER = (a, c, H) =>
    H.toStr(H.scalar(a[0], c)).replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\B\w/g, (m) => m.toLowerCase());
  F.TRIM = (a, c, H) => H.toStr(H.scalar(a[0], c)).replace(/\s+/g, " ").trim();
  F.CLEAN = (a, c, H) => H.toStr(H.scalar(a[0], c)).replace(/[\x00-\x1F]/g, "");
  F.SUBSTITUTE = (a, c, H) => {
    const t = H.toStr(H.scalar(a[0], c));
    const oldT = H.toStr(H.scalar(a[1], c));
    const newT = H.toStr(H.scalar(a[2], c));
    if (a.length > 3) {
      const inst = H.toNum(H.scalar(a[3], c));
      let k = 0;
      let idx = -1;
      while ((idx = t.indexOf(oldT, idx + 1)) >= 0) {
        if (++k === inst) return t.slice(0, idx) + newT + t.slice(idx + oldT.length);
      }
      return t;
    }
    return oldT === "" ? t : t.split(oldT).join(newT);
  };
  F.REPLACE = (a, c, H) => {
    const t = H.toStr(H.scalar(a[0], c));
    const start = H.toNum(H.scalar(a[1], c));
    const len = H.toNum(H.scalar(a[2], c));
    const newT = H.toStr(H.scalar(a[3], c));
    return t.slice(0, start - 1) + newT + t.slice(start - 1 + len);
  };
  F.FIND = (a, c, H) => {
    const find = H.toStr(H.scalar(a[0], c));
    const within = H.toStr(H.scalar(a[1], c));
    const start = a.length > 2 ? H.toNum(H.scalar(a[2], c)) : 1;
    const i = within.indexOf(find, start - 1);
    return i < 0 ? ERR.VALUE() : i + 1;
  };
  F.SEARCH = (a, c, H) => {
    const find = H.toStr(H.scalar(a[0], c)).toLowerCase();
    const within = H.toStr(H.scalar(a[1], c)).toLowerCase();
    const start = a.length > 2 ? H.toNum(H.scalar(a[2], c)) : 1;
    const i = within.indexOf(find, start - 1);
    return i < 0 ? ERR.VALUE() : i + 1;
  };
  F.REPT = (a, c, H) => H.toStr(H.scalar(a[0], c)).repeat(Math.max(0, H.toNum(H.scalar(a[1], c))));
  F.EXACT = (a, c, H) => H.toStr(H.scalar(a[0], c)) === H.toStr(H.scalar(a[1], c));
  F.CHAR = (a, c, H) => String.fromCharCode(H.toNum(H.scalar(a[0], c)));
  F.UNICHAR = (a, c, H) => String.fromCodePoint(H.toNum(H.scalar(a[0], c)));
  F.CODE = (a, c, H) => {
    const t = H.toStr(H.scalar(a[0], c));
    return t ? t.charCodeAt(0) : ERR.VALUE();
  };
  F.UNICODE = (a, c, H) => {
    const t = H.toStr(H.scalar(a[0], c));
    return t ? t.codePointAt(0) : ERR.VALUE();
  };
  F.T = (a, c, H) => {
    const v = H.scalar(a[0], c);
    return typeof v === "string" ? v : "";
  };
  F.VALUE = (a, c, H) => H.toNum(H.scalar(a[0], c));
  F.TEXT = (a, c, H) => applyTextFormat(H.toNum(H.scalar(a[0], c)), H.toStr(H.scalar(a[1], c)));

  // Lookup
  F.CHOOSE = (a, c, H) => {
    const i = H.toNum(H.scalar(a[0], c));
    return i >= 1 && i < a.length ? H.scalar(a[i], c) : ERR.VALUE();
  };
  F.ROW = (a, c, H) => {
    if (!a.length) return c.r + 1;
    const nd = unwrapParens(a[0]);
    if (nd.k === "ref") {
      const p = H.splitRef(nd.ref, c.sheetId);
      return p ? p.r + 1 : ERR.REF();
    }
    if (nd.k === "range") {
      const p = H.splitRef(nd.a, c.sheetId);
      return p ? p.r + 1 : ERR.REF();
    }
    return ERR.REF();
  };
  F.COLUMN = (a, c, H) => {
    if (!a.length) return c.c + 1;
    const nd = unwrapParens(a[0]);
    if (nd.k === "ref") {
      const p = H.splitRef(nd.ref, c.sheetId);
      return p ? p.c + 1 : ERR.REF();
    }
    if (nd.k === "range") {
      const p = H.splitRef(nd.a, c.sheetId);
      return p ? p.c + 1 : ERR.REF();
    }
    return ERR.REF();
  };
  F.ROWS = (a, c, H) => H.matrixOf(a[0], c).rows;
  F.COLUMNS = (a, c, H) => H.matrixOf(a[0], c).cols;
  F.MATCH = (a, c, H) => {
    const target = H.scalar(a[0], c);
    const m = H.matrixOf(a[1], c);
    const type = a.length > 2 ? H.toNum(H.scalar(a[2], c)) : 1;
    const arr = matVals(m);
    if (type === 0) {
      for (let i = 0; i < arr.length; i++) {
        if (typeof target === "string" && /[*?]/.test(target)) {
          if (wildToRe(target).test(String(arr[i] ?? ""))) return i + 1;
        } else if (H.compare(arr[i], target, "=")) return i + 1;
      }
      return ERR.NA();
    }
    let best = -1;
    for (let i = 0; i < arr.length; i++) {
      const cmp = type === 1 ? H.compare(arr[i], target, "<=") : H.compare(arr[i], target, ">=");
      if (cmp) best = i;
    }
    return best < 0 ? ERR.NA() : best + 1;
  };
  F.INDEX = (a, c, H) => {
    const m = H.matrixOf(a[0], c);
    let row = a.length > 1 ? H.toNum(H.scalar(a[1], c)) : 0;
    let col = a.length > 2 ? H.toNum(H.scalar(a[2], c)) : 0;
    if (m.rows === 1 && a.length === 2) {
      col = row;
      row = 1;
    }
    if (col === 0 && m.cols === 1) col = 1;
    if (row === 0 && m.rows === 1) row = 1;
    if (row < 1 || row > m.rows || col < 1 || col > m.cols) return ERR.REF();
    return m.get(row - 1, col - 1);
  };
  F.VLOOKUP = (a, c, H) => {
    const target = H.scalar(a[0], c);
    const m = H.matrixOf(a[1], c);
    const colIdx = H.toNum(H.scalar(a[2], c));
    const approx = a.length > 3 ? H.toBool(H.scalar(a[3], c)) : true;
    if (colIdx < 1 || colIdx > m.cols) return ERR.REF();
    let found = -1;
    for (let i = 0; i < m.rows; i++) {
      const v = m.get(i, 0);
      if (!approx) {
        if (
          typeof target === "string" && /[*?]/.test(target)
            ? wildToRe(target).test(String(v ?? ""))
            : H.compare(v, target, "=")
        ) {
          found = i;
          break;
        }
      } else {
        if (H.compare(v, target, "<=")) found = i;
        else break;
      }
    }
    return found < 0 ? ERR.NA() : m.get(found, colIdx - 1);
  };
  F.HLOOKUP = (a, c, H) => {
    const target = H.scalar(a[0], c);
    const m = H.matrixOf(a[1], c);
    const rowIdx = H.toNum(H.scalar(a[2], c));
    const approx = a.length > 3 ? H.toBool(H.scalar(a[3], c)) : true;
    if (rowIdx < 1 || rowIdx > m.rows) return ERR.REF();
    let found = -1;
    for (let j = 0; j < m.cols; j++) {
      const v = m.get(0, j);
      if (!approx) {
        if (H.compare(v, target, "=")) {
          found = j;
          break;
        }
      } else {
        if (H.compare(v, target, "<=")) found = j;
        else break;
      }
    }
    return found < 0 ? ERR.NA() : m.get(rowIdx - 1, found);
  };
  F.LOOKUP = (a, c, H) => {
    const target = H.scalar(a[0], c);
    const m = H.matrixOf(a[1], c);
    const vec = matVals(m);
    const result = a.length > 2 ? matVals(H.matrixOf(a[2], c)) : vec;
    let found = -1;
    for (let i = 0; i < vec.length; i++) {
      if (H.compare(vec[i], target, "<=")) found = i;
      else break;
    }
    return found < 0 ? ERR.NA() : (result[found] ?? ERR.NA());
  };

  // Date & time
  F.TODAY = () => {
    const n = new Date();
    return Math.floor(dateToSerial(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))));
  };
  F.NOW = () => {
    const n = new Date();
    return dateToSerial(
      new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds())),
    );
  };
  F.DATE = (a, c, H) =>
    dateToSerial(new Date(Date.UTC(H.toNum(s(a, c, H, 0)), H.toNum(s(a, c, H, 1)) - 1, H.toNum(s(a, c, H, 2)))));
  F.TIME = (a, c, H) =>
    (H.toNum(s(a, c, H, 0)) * 3600 + H.toNum(s(a, c, H, 1)) * 60 + H.toNum(s(a, c, H, 2))) / 86400;
  F.YEAR = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCFullYear();
  F.MONTH = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCMonth() + 1;
  F.DAY = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCDate();
  F.HOUR = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCHours();
  F.MINUTE = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCMinutes();
  F.SECOND = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCSeconds();
  F.WEEKDAY = (a, c, H) => {
    const d = serialToDate(H.toNum(s(a, c, H, 0))).getUTCDay();
    const type = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 1;
    if (type === 2) return d === 0 ? 7 : d;
    if (type === 3) return (d + 6) % 7;
    return d + 1;
  };
  F.WEEKNUM = (a, c, H) => {
    const d = serialToDate(H.toNum(s(a, c, H, 0)));
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor(((d.getTime() - start) / 86400000 + new Date(start).getUTCDay()) / 7) + 1;
  };
  F.DAYS = (a, c, H) => H.toNum(s(a, c, H, 0)) - H.toNum(s(a, c, H, 1));
  F.EDATE = (a, c, H) => {
    const d = serialToDate(H.toNum(s(a, c, H, 0)));
    const mo = H.toNum(s(a, c, H, 1));
    return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mo, d.getUTCDate())));
  };
  F.EOMONTH = (a, c, H) => {
    const d = serialToDate(H.toNum(s(a, c, H, 0)));
    const mo = H.toNum(s(a, c, H, 1));
    return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mo + 1, 0)));
  };
  F.DATEDIF = (a, c, H) => {
    const s1 = serialToDate(H.toNum(s(a, c, H, 0)));
    const s2 = serialToDate(H.toNum(s(a, c, H, 1)));
    const unit = H.toStr(H.scalar(a[2], c)).toUpperCase();
    const days = (s2.getTime() - s1.getTime()) / 86400000;
    if (unit === "D") return Math.round(days);
    if (unit === "M") return (s2.getUTCFullYear() - s1.getUTCFullYear()) * 12 + (s2.getUTCMonth() - s1.getUTCMonth());
    if (unit === "Y") return s2.getUTCFullYear() - s1.getUTCFullYear();
    return ERR.NUM();
  };

  // Information
  F.ISBLANK = (a, c, H) => {
    const v = H.scalar(a[0], c);
    return v == null || v === "";
  };
  F.ISNUMBER = (a, c, H) => typeof H.scalar(a[0], c) === "number";
  F.ISTEXT = (a, c, H) => typeof H.scalar(a[0], c) === "string";
  F.ISNONTEXT = (a, c, H) => typeof H.scalar(a[0], c) !== "string";
  F.ISLOGICAL = (a, c, H) => typeof H.scalar(a[0], c) === "boolean";
  F.ISERROR = (a, c, H) => isErr(H.scalar(a[0], c));
  F.ISERR = (a, c, H) => {
    const v = H.scalar(a[0], c);
    return isErr(v) && v.value !== "#N/A";
  };
  F.ISNA = (a, c, H) => {
    const v = H.scalar(a[0], c);
    return isErr(v) && v.value === "#N/A";
  };
  F.ISEVEN = (a, c, H) => Math.trunc(H.toNum(H.scalar(a[0], c))) % 2 === 0;
  F.ISODD = (a, c, H) => Math.abs(Math.trunc(H.toNum(H.scalar(a[0], c))) % 2) === 1;
  F.N = (a, c, H) => {
    const v = H.scalar(a[0], c);
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    return 0;
  };
  F.NA = () => ERR.NA();
  F.ERRORTYPE = (a, c, H) => {
    const v = H.scalar(a[0], c);
    if (!isErr(v)) return ERR.NA();
    const map: Record<string, number> = {
      "#NULL!": 1,
      "#DIV/0!": 2,
      "#VALUE!": 3,
      "#REF!": 4,
      "#NAME?": 5,
      "#NUM!": 6,
      "#N/A": 7,
    };
    return map[v.value] || ERR.NA();
  };

  return F;
})();

export function makeEngine(reader: GridReader): Engine {
  const defaultSheetId = reader.activeSheetId ?? "_default";
  const cache = new Map<string, Value>();
  const inProgress = new Set<string>();
  const astCache = new Map<string, Ast | CellError>();

  function splitRef(refStr: string, curSheetId: string): SheetPos | null {
    const bang = refStr.indexOf("!");
    let sheetId = curSheetId;
    let body = refStr;
    if (bang >= 0) {
      let sName = refStr.slice(0, bang).trim();
      if (sName.startsWith("'") && sName.endsWith("'")) {
        sName = sName.slice(1, -1).replace(/''/g, "'");
      }
      const resolved = reader.resolveSheetId ? reader.resolveSheetId(sName) : null;
      if (!resolved) return null;
      sheetId = resolved;
      body = refStr.slice(bang + 1);
    }
    const rc = parseRef(body);
    return rc ? { sheetId, r: rc.r, c: rc.c } : null;
  }

  function literalValue(raw: string | number): Scalar {
    if (typeof raw === "number") return raw;
    if (raw.startsWith("'")) return raw.slice(1);
    const s = raw.trim();
    if (s === "") return "";
    if (/^(TRUE|FALSE)$/i.test(s)) return /^true$/i.test(s);
    if (/^[-+]?\$?[\d,]*\.?\d+%?$/.test(s) && /\d/.test(s)) {
      const neg = s.startsWith("-");
      const cleaned = s.replace(/[$,+%-]/g, "");
      let n = Number(cleaned);
      if (Number.isFinite(n)) {
        if (s.endsWith("%")) n /= 100;
        return neg ? -n : n;
      }
    }
    return raw;
  }

  function evalCell(sheetId: string, r: number, c: number): Value {
    const key = `${sheetId}!${rcToRef(r, c)}`;
    if (cache.has(key)) return cache.get(key)!;
    if (inProgress.has(key)) return ERR.CYCLE();
    const raw = reader.getSheetRaw
      ? reader.getSheetRaw(sheetId, r, c)
      : sheetId === defaultSheetId && reader.getRaw
        ? reader.getRaw(r, c)
        : undefined;
    if (raw == null || raw === "") {
      cache.set(key, null);
      return null;
    }
    let result: Value;
    if (typeof raw === "string" && raw.startsWith("=")) {
      inProgress.add(key);
      try {
        let ast = astCache.get(raw);
        if (ast === undefined) {
          try {
            ast = parseFormula(raw.slice(1));
          } catch (e) {
            ast = e instanceof CellError ? e : ERR.VALUE();
          }
          astCache.set(raw, ast);
        }
        result = isErr(ast) ? ast : evalNode(ast, { sheetId, r, c });
      } catch (e) {
        result = isErr(e) ? e : ERR.VALUE();
      } finally {
        inProgress.delete(key);
      }
    } else {
      result = literalValue(raw);
    }
    cache.set(key, result);
    return result;
  }

  function makeMatrix(sheetId: string, r1: number, c1: number, r2: number, c2: number): Matrix {
    return {
      matrix: true,
      rows: r2 - r1 + 1,
      cols: c2 - c1 + 1,
      get(i, j) {
        return evalCell(sheetId, r1 + i, c1 + j);
      },
    };
  }

  function compare(a: Value, b: Value, op: string): boolean {
    const x = a == null ? "" : a;
    const y = b == null ? "" : b;
    let cmp: number;
    if (typeof x === "number" && typeof y === "number") cmp = x - y;
    else if (typeof x === "boolean" || typeof y === "boolean") {
      cmp = (toNum(x) ? 1 : 0) - (toNum(y) ? 1 : 0);
    } else {
      const lx = String(x).toLowerCase();
      const ly = String(y).toLowerCase();
      cmp = lx < ly ? -1 : lx > ly ? 1 : 0;
    }
    switch (op) {
      case "=":
        return cmp === 0;
      case "<>":
        return cmp !== 0;
      case "<":
        return cmp < 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      case ">=":
        return cmp >= 0;
      default:
        return false;
    }
  }

  function flatVals(args: Ast[], ctx: EvalContext): Value[] {
    const out: Value[] = [];
    for (const a of args) {
      const v = evalNode(a, ctx);
      if (isMatrix(v)) {
        for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) out.push(v.get(i, j));
      } else out.push(v);
    }
    return out;
  }

  function flatNums(args: Ast[], ctx: EvalContext): number[] {
    const out: number[] = [];
    for (const a of args) {
      const v = evalNode(a, ctx);
      if (isMatrix(v)) {
        for (let i = 0; i < v.rows; i++) {
          for (let j = 0; j < v.cols; j++) {
            const x = v.get(i, j);
            if (isErr(x)) throw x;
            if (typeof x === "number") out.push(x);
          }
        }
      } else {
        if (isErr(v)) throw v;
        if (typeof v === "number") out.push(v);
        else if (typeof v === "boolean") out.push(v ? 1 : 0);
        else if (typeof v === "string" && v.trim() !== "") out.push(toNum(v));
      }
    }
    return out;
  }

  function scalar(node: Ast, ctx: EvalContext): Value {
    const v = evalNode(node, ctx);
    return isMatrix(v) ? v.get(0, 0) : v;
  }

  function matrixOf(node: Ast, ctx: EvalContext): Matrix {
    const v = evalNode(node, ctx);
    if (isMatrix(v)) return v;
    if (isErr(v)) throw v;
    return { matrix: true, rows: 1, cols: 1, get: () => v };
  }

  const H: Helpers = { evalNode, toNum, toStr, toBool, compare, flatVals, flatNums, scalar, matrixOf, splitRef };

  function evalBin(node: Extract<Ast, { k: "bin" }>, ctx: EvalContext): Value {
    const a = scalar(node.a, ctx);
    if (isErr(a)) return a;
    const b = scalar(node.b, ctx);
    if (isErr(b)) return b;
    try {
      switch (node.op) {
        case "+":
          return toNum(a) + toNum(b);
        case "-":
          return toNum(a) - toNum(b);
        case "*":
          return toNum(a) * toNum(b);
        case "/": {
          const den = toNum(b);
          return den === 0 ? ERR.DIV0() : toNum(a) / den;
        }
        case "^":
          return Math.pow(toNum(a), toNum(b));
        case "&":
          return toStr(a) + toStr(b);
        case "=":
        case "<>":
        case "<":
        case ">":
        case "<=":
        case ">=":
          return compare(a, b, node.op);
        default:
          return ERR.VALUE();
      }
    } catch (e) {
      return isErr(e) ? e : ERR.VALUE();
    }
  }

  function evalNode(node: Ast, ctx: EvalContext): Value {
    switch (node.k) {
      case "num":
      case "str":
      case "bool":
        return node.v;
      case "paren":
        return evalNode(node.a, ctx);
      case "pct": {
        const v = scalar(node.a, ctx);
        return isErr(v) ? v : toNum(v) * 0.01;
      }
      case "ref": {
        const p = splitRef(node.ref, ctx.sheetId);
        return p ? evalCell(p.sheetId, p.r, p.c) : ERR.REF();
      }
      case "range": {
        const a = splitRef(node.a, ctx.sheetId);
        const b = splitRef(node.b, ctx.sheetId);
        if (!a || !b) return ERR.REF();
        return makeMatrix(
          a.sheetId,
          Math.min(a.r, b.r),
          Math.min(a.c, b.c),
          Math.max(a.r, b.r),
          Math.max(a.c, b.c),
        );
      }
      case "un": {
        const v = scalar(node.a, ctx);
        if (isErr(v)) return v;
        try {
          return node.op === "-" ? -toNum(v) : +toNum(v);
        } catch (e) {
          return isErr(e) ? e : ERR.VALUE();
        }
      }
      case "bin":
        return evalBin(node, ctx);
      case "call": {
        const fn = FUNCTIONS[node.name];
        if (!fn) return ERR.NAME();
        try {
          const r = fn(node.args, ctx, H);
          return r === undefined ? null : r;
        } catch (e) {
          return isErr(e) ? e : ERR.VALUE();
        }
      }
    }
  }

  return {
    compute(r, c) {
      return evalCell(defaultSheetId, r, c);
    },
    display(r, c, fmt) {
      return displayValue(evalCell(defaultSheetId, r, c), fmt);
    },
    computeRef(sheetId, ref) {
      const p = parseRef(ref);
      return p ? evalCell(sheetId, p.r, p.c) : ERR.REF();
    },
    splitRef,
  };
}

export function buildWorkbookEngine(wb: WorkbookModel, activeSheetId?: string): Engine {
  const byName = new Map<string, string>();
  for (const id of wb.sheetOrder) {
    const sh = wb.sheets[id];
    if (sh) byName.set(sh.name.toLowerCase(), id);
  }
  return makeEngine({
    activeSheetId: activeSheetId ?? wb.sheetOrder[0] ?? "_default",
    resolveSheetId(name) {
      return byName.get(name.toLowerCase()) ?? null;
    },
    getSheetRaw(sheetId, r, c) {
      return wb.cells[sheetId]?.[rcToRef(r, c)]?.value;
    },
  });
}

export function displayWorkbookCell(
  engine: Engine,
  sheetId: string,
  cell: CfosCell | null | undefined,
  r: number,
  c: number,
): Display {
  if (!cell || (cell.value === "" && !cell.fmt)) return { text: "" };
  const raw = cell.value;
  if (raw === "") return { text: "" };
  if (raw.startsWith("'")) return { text: raw.slice(1) };
  if (raw.startsWith("=") || /^-?\$?[\d,]*\.?\d+%?$/.test(raw.trim())) {
    return displayValue(engine.computeRef(sheetId, rcToRef(r, c)), cell.fmt);
  }
  return { text: raw };
}

export function buildSheetEngine(columns: readonly string[], rows: readonly (readonly WireCell[])[]) {
  return makeEngine({
    getRaw(r, c) {
      if (r < 0 || c < 0 || c >= columns.length) return "";
      const row = rows[r];
      return row ? row[c] ?? "" : "";
    },
  });
}

export function displayCell(
  engine: Engine,
  raw: WireCell | undefined,
  r: number,
  c: number,
): Display {
  if (raw === undefined || raw === "") return { text: "" };
  if (typeof raw === "number") return engine.display(r, c);
  if (raw.startsWith("=")) return engine.display(r, c);
  if (raw.startsWith("'")) return { text: raw.slice(1) };
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return engine.display(r, c);
  return { text: raw };
}

export function parseRangeText(text: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const parts = text.trim().split(":");
  if (parts.length === 1) {
    const p = parseRef(parts[0]);
    return p ? { r1: p.r, c1: p.c, r2: p.r, c2: p.c } : null;
  }
  if (parts.length === 2) {
    const a = parseRef(parts[0]);
    const b = parseRef(parts[1]);
    if (!a || !b) return null;
    return {
      r1: Math.min(a.r, b.r),
      c1: Math.min(a.c, b.c),
      r2: Math.max(a.r, b.r),
      c2: Math.max(a.c, b.c),
    };
  }
  return null;
}

export function formatSelectionRef(r1: number, c1: number, r2: number, c2: number): string {
  const a = rcToRef(Math.min(r1, r2), Math.min(c1, c2));
  const b = rcToRef(Math.max(r1, r2), Math.max(c1, c2));
  return a === b ? a : `${a}:${b}`;
}

export function columnHeaderLabel(colIndex: number, name: string): string {
  const letter = colToLetter(colIndex);
  const clean = name.trim();
  return clean ? `${letter} · ${clean}` : letter;
}

function escapeSheetHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSheetPrintHtmlShell(titleText: string, styleCss: string, bodyInner: string): string {
  const tags = ["html", "head", "body", "title", "style"];
  const wrap = (idx: number, content: string, attrs = "") => {
    const t = tags[idx];
    return "<" + t + attrs + ">" + content + "</" + t + ">";
  };
  const head = wrap(1, `\n<meta charset="utf-8">\n${wrap(3, titleText)}\n${wrap(4, styleCss)}\n`);
  const body = wrap(2, `\n${bodyInner}\n`);
  return `<!doctype html>\n${wrap(0, `\n${head}\n${body}\n`, ' lang="en"')}`;
}

export function exportSheetHtml(wb: WorkbookModel, sheetId: string): string {
  const sh = wb.sheets[sheetId];
  const map = wb.cells[sheetId] || {};
  let maxRow = 0;
  let maxCol = sh?.colHeaders?.length ?? 1;
  for (const [ref, cell] of Object.entries(map)) {
    if (cell.value === "" && !cell.fmt) continue;
    const rc = parseRef(ref);
    if (!rc) continue;
    maxRow = Math.max(maxRow, rc.r + 1);
    maxCol = Math.max(maxCol, rc.c + 1);
  }
  const columns = Array.from(
    { length: maxCol },
    (_, c) => sh?.colHeaders?.[c]?.trim() || colToLetter(c),
  );
  const engine = buildWorkbookEngine(wb, sheetId);
  const headHtml = `<thead><tr>${columns.map((c) => `<th>${escapeSheetHtmlText(c)}</th>`).join("")}</tr></thead>`;
  const rowHtmlParts: string[] = [];
  for (let r = 0; r < maxRow; r++) {
    const cellsHtml: string[] = [];
    for (let c = 0; c < columns.length; c++) {
      const cell = map[rcToRef(r, c)];
      const shown = displayWorkbookCell(engine, sheetId, cell, r, c);
      const isRight =
        cell?.fmt?.a === "r" ||
        (!cell?.fmt?.a && (shown.numeric || /^-?\$?[\d,.]+%?$/.test(shown.text.trim())));
      const styleParts: string[] = [];
      if (cell?.fmt?.b) styleParts.push("font-weight:700");
      if (cell?.fmt?.i) styleParts.push("font-style:italic");
      if (cell?.fmt?.a === "c") styleParts.push("text-align:center");
      else if (cell?.fmt?.a === "l") styleParts.push("text-align:left");
      const attrs = [
        isRight ? ' align="right"' : "",
        styleParts.length ? ` style="${styleParts.join(";")}"` : "",
      ].join("");
      cellsHtml.push(`<td${attrs}>${escapeSheetHtmlText(shown.text)}</td>`);
    }
    rowHtmlParts.push(`<tr>${cellsHtml.join("")}</tr>`);
  }
  const title = wb.title?.trim() || sh?.name?.trim() || "Untitled sheet";
  const sub =
    sh?.name?.trim() && sh.name.trim() !== title
      ? `<div class="sub">${escapeSheetHtmlText(sh.name.trim())}</div>`
      : "";
  const css = [
    "@page { size: a4 landscape; margin: 10mm; }",
    "body { margin: 0; padding: 0; background: #ffffff; color: #141417; font: 10pt/1.4 Inter, ui-sans-serif, system-ui, sans-serif; }",
    "h1 { font-size: 16pt; font-weight: 700; margin: 0 0 6px; }",
    ".sub { font-size: 9.5pt; color: #52525b; margin: 0 0 12px; }",
    "table { width: 100%; border-collapse: collapse; }",
    "thead { display: table-header-group; }",
    "th, td { border: 1px solid #d4d4d8; padding: 5px 8px; vertical-align: top; }",
    "th { background: #f4f4f6; font-weight: 650; text-align: left; }",
  ].join("\n");
  return buildSheetPrintHtmlShell(
    escapeSheetHtmlText(title),
    css,
    `<main><h1>${escapeSheetHtmlText(title)}</h1>${sub}<table>${headHtml}<tbody>${rowHtmlParts.join("")}</tbody></table></main>`,
  );
}

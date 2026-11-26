// Ported from cloudflare-os workspace-sheets/files/lib/formula.ts & client.ts

import type { Cell } from "../../domain/works";

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
  c += 1;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

export function letterToCol(s: string): number {
  let c = 0;
  for (const ch of s.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}

export function rcToRef(r: number, c: number): string {
  return colToLetter(c) + (r + 1);
}

export function parseRef(ref: string): RC | null {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const r = parseInt(m[2], 10) - 1;
  const c = letterToCol(m[1]);
  if (r < 0 || c < 0 || c > 702) return null;
  return { r, c };
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
        while (j < n && src[j] !== "'") word += src[j++];
        j++;
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
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-6)) return n.toExponential(5).replace(/\.?0+e/, "e");
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

export function displayValue(computed: Value): Display {
  if (isErr(computed)) return { text: computed.value, err: true };
  if (computed == null || computed === "") return { text: "" };
  if (typeof computed === "boolean") return { text: computed ? "TRUE" : "FALSE", center: true };
  if (typeof computed === "number") {
    if (!Number.isFinite(computed)) return { text: "#NUM!", err: true };
    return { text: fmtGeneral(computed), numeric: true };
  }
  return { text: String(computed) };
}

export interface GridReader {
  getRaw(r: number, c: number): string | number | null | undefined;
}

export interface Engine {
  compute(r: number, c: number): Value;
  display(r: number, c: number): Display;
}

interface Helpers {
  evalNode(node: Ast, ctx: RC): Value;
  toNum: typeof toNum;
  toStr: typeof toStr;
  toBool: typeof toBool;
  compare(a: Value, b: Value, op: string): boolean;
  flatVals(args: Ast[], ctx: RC): Value[];
  flatNums(args: Ast[], ctx: RC): number[];
  scalar(node: Ast, ctx: RC): Value;
  matrixOf(node: Ast, ctx: RC): Matrix;
}

type FormulaFn = (args: Ast[], ctx: RC, H: Helpers) => Value;

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

const FUNCTIONS: Record<string, FormulaFn> = (() => {
  const F: Record<string, FormulaFn> = {};
  const numArgs = (args: Ast[], ctx: RC, H: Helpers) => H.flatNums(args, ctx);
  const s = (args: Ast[], ctx: RC, H: Helpers, i: number) =>
    i < args.length ? H.scalar(args[i], ctx) : undefined;

  F.SUM = (a, c, H) => numArgs(a, c, H).reduce((x, y) => x + y, 0);
  F.PRODUCT = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? n.reduce((x, y) => x * y, 1) : 0;
  };
  F.AVERAGE = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : ERR.DIV0();
  };
  F.AVG = F.AVERAGE;
  F.COUNT = (a, c, H) => numArgs(a, c, H).length;
  F.COUNTA = (a, c, H) => H.flatVals(a, c).filter((v) => v != null && v !== "").length;
  F.COUNTBLANK = (a, c, H) => H.flatVals(a, c).filter((v) => v == null || v === "").length;
  F.MAX = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? Math.max(...n) : 0;
  };
  F.MIN = (a, c, H) => {
    const n = numArgs(a, c, H);
    return n.length ? Math.min(...n) : 0;
  };
  F.MEDIAN = (a, c, H) => {
    const n = numArgs(a, c, H).sort((x, y) => x - y);
    if (!n.length) return ERR.NUM();
    const m = n.length >> 1;
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  };
  F.ABS = (a, c, H) => Math.abs(H.toNum(s(a, c, H, 0)));
  F.SQRT = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    return x < 0 ? ERR.NUM() : Math.sqrt(x);
  };
  F.POWER = (a, c, H) => Math.pow(H.toNum(s(a, c, H, 0)), H.toNum(s(a, c, H, 1)));
  F.MOD = (a, c, H) => {
    const y = H.toNum(s(a, c, H, 1));
    if (y === 0) return ERR.DIV0();
    const x = H.toNum(s(a, c, H, 0));
    return x - Math.floor(x / y) * y;
  };
  F.INT = (a, c, H) => Math.floor(H.toNum(s(a, c, H, 0)));
  F.ROUND = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const d = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 0;
    const f = Math.pow(10, d);
    return Math.round(x * f + (x >= 0 ? 1e-9 : -1e-9)) / f;
  };
  F.CEIL = (a, c, H) => Math.ceil(H.toNum(s(a, c, H, 0)));
  F.CEILING = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const m = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 1;
    return m === 0 ? 0 : Math.ceil(x / m) * m;
  };
  F.FLOOR = (a, c, H) => {
    const x = H.toNum(s(a, c, H, 0));
    const m = a.length > 1 ? H.toNum(s(a, c, H, 1)) : 1;
    return m === 0 ? 0 : Math.floor(x / m) * m;
  };
  F.PI = () => Math.PI;
  F.SUMIF = (a, c, H) => {
    const range = matVals(H.matrixOf(a[0], c));
    const crit = a.length > 1 ? H.scalar(a[1], c) : null;
    const sumRange = a.length > 2 ? matVals(H.matrixOf(a[2], c)) : range;
    let t = 0;
    for (let i = 0; i < range.length; i++) {
      if (matchCriteria(range[i], crit) && typeof sumRange[i] === "number") {
        t += sumRange[i] as number;
      }
    }
    return t;
  };
  F.COUNTIF = (a, c, H) => {
    const range = matVals(H.matrixOf(a[0], c));
    const crit = a.length > 1 ? H.scalar(a[1], c) : null;
    return range.filter((v) => matchCriteria(v, crit)).length;
  };
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
  F.NOT = (a, c, H) => !H.toBool(H.scalar(a[0], c));
  F.CONCAT = (a, c, H) => H.flatVals(a, c).map((v) => (v == null ? "" : H.toStr(v))).join("");
  F.CONCATENATE = F.CONCAT;
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
  F.TRIM = (a, c, H) => H.toStr(H.scalar(a[0], c)).replace(/\s+/g, " ").trim();
  F.UPPER = (a, c, H) => H.toStr(H.scalar(a[0], c)).toUpperCase();
  F.LOWER = (a, c, H) => H.toStr(H.scalar(a[0], c)).toLowerCase();
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
  F.TODAY = () => {
    const n = new Date();
    return Math.floor(dateToSerial(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))));
  };
  F.NOW = () => {
    const n = new Date();
    return dateToSerial(
      new Date(
        Date.UTC(
          n.getFullYear(),
          n.getMonth(),
          n.getDate(),
          n.getHours(),
          n.getMinutes(),
          n.getSeconds(),
        ),
      ),
    );
  };
  F.YEAR = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCFullYear();
  F.MONTH = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCMonth() + 1;
  F.DAY = (a, c, H) => serialToDate(H.toNum(s(a, c, H, 0))).getUTCDate();
  F.ISBLANK = (a, c, H) => {
    const v = H.scalar(a[0], c);
    return v == null || v === "";
  };
  F.ISNUMBER = (a, c, H) => typeof H.scalar(a[0], c) === "number";
  F.ISTEXT = (a, c, H) => typeof H.scalar(a[0], c) === "string";
  F.ISERROR = (a, c, H) => isErr(H.scalar(a[0], c));
  return F;
})();

export function makeEngine(reader: GridReader): Engine {
  const cache = new Map<string, Value>();
  const inProgress = new Set<string>();
  const astCache = new Map<string, Ast | CellError>();

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

  function evalCell(r: number, c: number): Value {
    const key = rcToRef(r, c);
    if (cache.has(key)) return cache.get(key)!;
    if (inProgress.has(key)) return ERR.CYCLE();
    const raw = reader.getRaw(r, c);
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
        result = isErr(ast) ? ast : evalNode(ast, { r, c });
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

  function makeMatrix(r1: number, c1: number, r2: number, c2: number): Matrix {
    return {
      matrix: true,
      rows: r2 - r1 + 1,
      cols: c2 - c1 + 1,
      get(i, j) {
        return evalCell(r1 + i, c1 + j);
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

  function evalBin(node: Extract<Ast, { k: "bin" }>, ctx: RC): Value {
    const op = node.op;
    let a = evalNode(node.a, ctx);
    let b = evalNode(node.b, ctx);
    if (isMatrix(a)) a = a.get(0, 0);
    if (isMatrix(b)) b = b.get(0, 0);
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    try {
      if (op === "&") return toStr(a) + toStr(b);
      if ("=<>".includes(op[0])) return compare(a, b, op);
      const x = toNum(a);
      const y = toNum(b);
      switch (op) {
        case "+":
          return x + y;
        case "-":
          return x - y;
        case "*":
          return x * y;
        case "/":
          return y === 0 ? ERR.DIV0() : x / y;
        case "^": {
          const r = Math.pow(x, y);
          return Number.isFinite(r) ? r : ERR.NUM();
        }
      }
    } catch (e) {
      return isErr(e) ? e : ERR.VALUE();
    }
    return ERR.VALUE();
  }

  function collectVals(v: Value, out: Value[]): void {
    if (isMatrix(v)) {
      for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) out.push(v.get(i, j));
    } else out.push(v);
  }

  function collectNums(v: Value, out: number[]): void {
    if (isMatrix(v)) {
      for (let i = 0; i < v.rows; i++) {
        for (let j = 0; j < v.cols; j++) {
          const c = v.get(i, j);
          if (isErr(c)) throw c;
          if (typeof c === "number") out.push(c);
        }
      }
    } else {
      if (isErr(v)) throw v;
      if (typeof v === "number") out.push(v);
      else if (typeof v === "boolean") out.push(v ? 1 : 0);
      else if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v.replace(/,/g, ""));
        if (Number.isFinite(n)) out.push(n);
      }
    }
  }

  const H: Helpers = {
    evalNode,
    toNum,
    toStr,
    toBool,
    compare,
    flatVals(args, ctx) {
      const out: Value[] = [];
      for (const node of args) collectVals(evalNode(node, ctx), out);
      return out;
    },
    flatNums(args, ctx) {
      const out: number[] = [];
      for (const node of args) collectNums(evalNode(node, ctx), out);
      return out;
    },
    scalar(node, ctx) {
      let v = evalNode(node, ctx);
      if (isMatrix(v)) v = v.get(0, 0);
      return v;
    },
    matrixOf(node, ctx) {
      const v = evalNode(node, ctx);
      return isMatrix(v) ? v : { matrix: true, rows: 1, cols: 1, get: () => v };
    },
  };

  function evalNode(node: Ast, ctx: RC): Value {
    switch (node.k) {
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "bool":
        return node.v;
      case "paren":
        return evalNode(node.a, ctx);
      case "pct": {
        const n = toNum(evalNode(node.a, ctx));
        return n / 100;
      }
      case "ref": {
        const p = parseRef(node.ref.includes("!") ? node.ref.split("!")[1] ?? "" : node.ref);
        return p ? evalCell(p.r, p.c) : ERR.REF();
      }
      case "range": {
        const a = parseRef(node.a.includes("!") ? node.a.split("!")[1] ?? "" : node.a);
        const b = parseRef(node.b.includes("!") ? node.b.split("!")[1] ?? "" : node.b);
        if (!a || !b) return ERR.REF();
        return makeMatrix(
          Math.min(a.r, b.r),
          Math.min(a.c, b.c),
          Math.max(a.r, b.r),
          Math.max(a.c, b.c),
        );
      }
      case "un": {
        const v = evalNode(node.a, ctx);
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
      return evalCell(r, c);
    },
    display(r, c) {
      return displayValue(evalCell(r, c));
    },
  };
}

export function buildSheetEngine(columns: readonly string[], rows: readonly (readonly Cell[])[]) {
  return makeEngine({
    getRaw(r, c) {
      if (r < 0 || c < 0 || c >= columns.length) return "";
      const row = rows[r];
      return row ? row[c] ?? "" : "";
    },
  });
}

export function displayCell(
  engine: ReturnType<typeof buildSheetEngine>,
  raw: Cell | undefined,
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

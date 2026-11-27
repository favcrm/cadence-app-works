// Zero-dependency bounded Office (.docx, .xlsx, .pptx) and text (.csv, .md, .txt) importer.
// Zero runtime relative imports so Node 22 strip-types unit tests run directly.

import type { Cell, Content, DeckSlide, DocBlock } from "../../domain/works";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ENTRIES = 1_000;
export const MAX_IMPORT_INFLATED_BYTES = 16 * 1024 * 1024;
const MAX_WORKS_CONTENT_BYTES = 60 * 1024;
const MAX_TITLE_BYTES = 200;

export type ImportErrorCode =
  | "too_large"
  | "unsupported"
  | "malformed"
  | "encrypted"
  | "macros";

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

export type ImportWarningCode =
  | "simplified_doc"
  | "truncated_doc"
  | "kept_first_sheet"
  | "truncated_sheet"
  | "simplified_deck"
  | "truncated_deck";

export interface ImportedWorksDraft {
  kind: "doc" | "sheet" | "deck";
  title: string;
  content: Content;
  warnings: string[];
  warningCodes: ImportWarningCode[];
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

function byteLen(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function clampTitle(raw: string, fallback: string): string {
  const clean = raw.replace(/[\r\n\t]+/g, " ").trim() || fallback;
  if (byteLen(clean) <= MAX_TITLE_BYTES) return clean;
  let out = "";
  for (const ch of clean) {
    if (byteLen(out + ch) > MAX_TITLE_BYTES) break;
    out += ch;
  }
  return out.trim() || fallback;
}

function titleFromFileName(fileName: string, fallback: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return clampTitle(base, fallback);
}

// ---- Bounded ZIP reader -------------------------------------------------

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const minOffset = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= minOffset; --i) {
    if (u32(view, i) === 0x06054b50) return i;
  }
  return -1;
}

function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 512) return false;
  if (name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  return !name.split("/").some((seg) => seg === "..");
}

async function inflateRaw(compressed: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  const copy = new Uint8Array(new ArrayBuffer(compressed.byteLength));
  copy.set(compressed);
  const stream = new ReadableStream<BufferSource>({
    start(ctrl) {
      ctrl.enqueue(copy);
      ctrl.close();
    },
  }).pipeThrough(new DecompressionStream("deflate-raw"));
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMPORT_INFLATED_BYTES) {
      throw new ImportError("too_large", "Uncompressed archive exceeds 16 MiB limit.");
    }
    parts.push(value);
  }
  if (expectedSize > 0 && total !== expectedSize) {
    throw new ImportError("malformed", "Compressed entry size mismatch.");
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

export async function readZipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (bytes.byteLength === 0) {
    throw new ImportError("malformed", "Archive is empty.");
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportError("too_large", `File exceeds ${MAX_IMPORT_BYTES} byte limit.`);
  }
  if (
    bytes.byteLength < 22 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    (bytes[2] !== 0x03 && bytes[2] !== 0x05)
  ) {
    throw new ImportError("malformed", "File is not a valid ZIP package.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  if (eocd < 0) {
    throw new ImportError("malformed", "ZIP package has no end-of-central-directory record.");
  }
  const entryCount = u16(view, eocd + 10);
  const cdSize = u32(view, eocd + 12);
  const cdOffset = u32(view, eocd + 16);
  if (
    u16(view, eocd + 8) === 0xffff ||
    entryCount === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new ImportError("unsupported", "ZIP64 packages are not supported.");
  }
  if (entryCount > MAX_IMPORT_ENTRIES || cdOffset + cdSize > eocd) {
    throw new ImportError("malformed", "ZIP package directory is malformed or exceeds entry limit.");
  }

  const out = new Map<string, Uint8Array>();
  let cursor = cdOffset;
  let totalInflated = 0;

  for (let i = 0; i < entryCount; ++i) {
    if (cursor + 46 > eocd || u32(view, cursor) !== 0x02014b50) {
      throw new ImportError("malformed", "ZIP central directory header is malformed.");
    }
    const flags = u16(view, cursor + 8);
    if ((flags & 1) !== 0) {
      throw new ImportError("encrypted", "Encrypted Office packages are not supported.");
    }
    const method = u16(view, cursor + 10);
    if (method !== 0 && method !== 8) {
      throw new ImportError("unsupported", `Unsupported ZIP compression method ${method}.`);
    }
    const compSize = u32(view, cursor + 20);
    const uncompSize = u32(view, cursor + 24);
    const nameLen = u16(view, cursor + 28);
    const extraLen = u16(view, cursor + 30);
    const commentLen = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const nameEnd = cursor + 46 + nameLen;
    if (nameEnd + extraLen + commentLen > cdOffset + cdSize) {
      throw new ImportError("malformed", "ZIP entry extends past central directory.");
    }

    let name: string;
    try {
      name = textDecoder.decode(bytes.subarray(cursor + 46, nameEnd));
    } catch {
      throw new ImportError("malformed", "ZIP entry name is not valid UTF-8.");
    }
    cursor = nameEnd + extraLen + commentLen;

    if (!isSafeEntryName(name)) {
      throw new ImportError("malformed", `Unsafe ZIP entry path: ${name}`);
    }
    if (/vbaproject\.bin$/i.test(name)) {
      throw new ImportError("macros", "Macro-enabled Office files are not supported.");
    }
    if (name.endsWith("/")) continue;

    if (uncompSize > MAX_IMPORT_INFLATED_BYTES || totalInflated + uncompSize > MAX_IMPORT_INFLATED_BYTES) {
      throw new ImportError("too_large", "Uncompressed archive exceeds 16 MiB limit.");
    }
    if (localOffset + 30 > cdOffset || u32(view, localOffset) !== 0x04034b50) {
      throw new ImportError("malformed", "ZIP local file header is malformed.");
    }
    const localNameLen = u16(view, localOffset + 26);
    const localExtraLen = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > cdOffset) {
      throw new ImportError("malformed", "ZIP entry payload overflows archive bounds.");
    }

    const slice = bytes.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) {
      data = new Uint8Array(slice);
    } else {
      try {
        data = await inflateRaw(slice, uncompSize);
      } catch (err) {
        if (err instanceof ImportError) throw err;
        throw new ImportError("malformed", "Failed to inflate compressed ZIP entry.");
      }
    }
    totalInflated += data.byteLength;
    if (totalInflated > MAX_IMPORT_INFLATED_BYTES) {
      throw new ImportError("too_large", "Uncompressed archive exceeds 16 MiB limit.");
    }
    out.set(name, data);
  }
  return out;
}

function readXmlEntry(entries: Map<string, Uint8Array>, path: string): string | null {
  const bytes = entries.get(path);
  if (!bytes) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ---- Lightweight XML helpers --------------------------------------------

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, ent: string) => {
    const lower = ent.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return named[lower] ?? "";
  });
}

function xmlAttr(attrs: string, name: string): string {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  return decodeXmlEntities(m ? (m[1] ?? m[2] ?? "") : "");
}

function parseRelsMap(xml: string | null): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  if (!xml) return map;
  const re = /<Relationship\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = xmlAttr(m[1], "Id");
    const type = xmlAttr(m[1], "Type");
    const target = xmlAttr(m[1], "Target");
    if (id && target) map.set(id, { type, target });
  }
  return map;
}

function resolveZipTarget(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const seg of target.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") base.pop();
    else base.push(seg);
  }
  return base.join("/");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function matchElements(xml: string, tagName: string): { attrs: string; inner: string }[] {
  const results: { attrs: string; inner: string }[] = [];
  const openRe = new RegExp(`<${tagName}(\\s[^>]*)?(/?)>`, "g");
  const tagRe = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "g");
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml)) !== null) {
    if (m[2] === "/") {
      results.push({ attrs: m[1] || "", inner: "" });
      continue;
    }
    const startInner = m.index + m[0].length;
    tagRe.lastIndex = startInner;
    let depth = 1;
    let endInner = xml.length;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(xml)) !== null) {
      if (tm[1] === "/") {
        depth--;
        if (depth === 0) {
          endInner = tm.index;
          break;
        }
      } else if (!tm[0].endsWith("/>")) {
        depth++;
      }
    }
    results.push({ attrs: m[1] || "", inner: xml.slice(startInner, endInner) });
    openRe.lastIndex = tagRe.lastIndex > startInner ? tagRe.lastIndex : xml.length;
  }
  return results;
}

// ---- DOCX importer ------------------------------------------------------

function docxRunHtml(runXml: string, nextBlockId: { id: number }): { html: string; text: string } {
  const rPr = matchElements(runXml, "w:rPr")[0]?.inner ?? "";
  const isBold = /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/?>/i.test(rPr) && !/<w:b\s+w:val="(?:0|false|off)"/i.test(rPr);
  const isItalic = /<w:i(?:\s+w:val="(?:1|true|on)")?\s*\/?>/i.test(rPr) && !/<w:i\s+w:val="(?:0|false|off)"/i.test(rPr);
  const uMatch = /<w:u\b([^>]*)\/?>/i.exec(rPr);
  const isUnderline = !!uMatch && xmlAttr(uMatch[1], "w:val") !== "none";
  const isStrike = /<w:strike(?:\s+w:val="(?:1|true|on)")?\s*\/?>/i.test(rPr) && !/<w:strike\s+w:val="(?:0|false|off)"/i.test(rPr);
  const colMatch = /<w:color\b([^>]*)\/?>/i.exec(rPr);
  const colorVal = colMatch ? xmlAttr(colMatch[1], "w:val") : "";
  const colorHex = /^[0-9a-f]{6}$/i.test(colorVal) && colorVal.toLowerCase() !== "auto" ? `#${colorVal}` : "";

  const textParts: string[] = [];
  const tokenRe = /<w:(t|br|tab)\b([^>]*)(?:\/>|>([\s\S]*?)<\/w:\1>)/g;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(runXml)) !== null) {
    if (tm[1] === "br") textParts.push("\n");
    else if (tm[1] === "tab") textParts.push("  ");
    else textParts.push(decodeXmlEntities(tm[3] ?? ""));
  }
  void nextBlockId;
  const plain = textParts.join("");
  if (!plain) return { html: "", text: "" };

  let html = escapeHtml(plain).replace(/\n/g, "<br>");
  if (colorHex) html = `<span style="color:${colorHex}">${html}</span>`;
  if (isStrike) html = `<del>${html}</del>`;
  if (isUnderline) html = `<u>${html}</u>`;
  if (isItalic) html = `<em>${html}</em>`;
  if (isBold) html = `<strong>${html}</strong>`;
  return { html, text: plain };
}

function corePropTitle(entries: Map<string, Uint8Array>, fallback: string): string {
  const coreXml = readXmlEntry(entries, "docProps/core.xml");
  const coreTitleMatch = coreXml ? /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(coreXml) : null;
  const decoded = coreTitleMatch ? decodeXmlEntities(coreTitleMatch[1]) : "";
  return clampTitle(decoded || fallback, fallback);
}

function extractBodyBlocks(bodyXml: string): Array<{ tag: "w:p" | "w:tbl"; inner: string }> {
  const out: Array<{ tag: "w:p" | "w:tbl"; inner: string }> = [];
  const openRe = /<(w:p|w:tbl)(\s[^>]*)?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(bodyXml)) !== null) {
    const tag = m[1] as "w:p" | "w:tbl";
    if (m[3] === "/") continue;
    const startInner = m.index + m[0].length;
    const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
    tagRe.lastIndex = startInner;
    let depth = 1;
    let endInner = bodyXml.length;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(bodyXml)) !== null) {
      if (tm[1] === "/") {
        depth--;
        if (depth === 0) {
          endInner = tm.index;
          break;
        }
      } else if (!tm[0].endsWith("/>")) {
        depth++;
      }
    }
    out.push({ tag, inner: bodyXml.slice(startInner, endInner) });
    openRe.lastIndex = tagRe.lastIndex > startInner ? tagRe.lastIndex : bodyXml.length;
  }
  return out;
}

function extractParaFragments(
  paraInner: string,
  rels: Map<string, { type: string; target: string }>,
  blockCounter: { id: number },
): { innerHtml: string; plainText: string; hasRich: boolean } {
  const htmlFrags: string[] = [];
  const textFrags: string[] = [];
  let hasRich = false;

  const childRe = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  let cm: RegExpExecArray | null;
  while ((cm = childRe.exec(paraInner)) !== null) {
    if (cm[2] !== undefined) {
      const rid = xmlAttr(cm[1], "r:id");
      const href = rels.get(rid)?.target ?? "";
      const safeHref = /^https?:\/\//i.test(href) ? href : "";
      const linkHtml: string[] = [];
      const linkText: string[] = [];
      for (const r of matchElements(cm[2], "w:r")) {
        const piece = docxRunHtml(r.inner, blockCounter);
        linkHtml.push(piece.html);
        linkText.push(piece.text);
      }
      const joinedText = linkText.join("");
      const joinedHtml = linkHtml.join("");
      if (safeHref && joinedHtml) {
        hasRich = true;
        htmlFrags.push(`<a href="${escapeHtml(safeHref)}">${joinedHtml}</a>`);
        textFrags.push(`[${joinedText}](${safeHref})`);
      } else if (joinedText) {
        htmlFrags.push(joinedHtml || escapeHtml(joinedText));
        textFrags.push(joinedText);
      }
    } else if (cm[3] !== undefined) {
      const piece = docxRunHtml(cm[3], blockCounter);
      if (piece.text) {
        if (piece.html !== escapeHtml(piece.text).replace(/\n/g, "<br>")) hasRich = true;
        htmlFrags.push(piece.html);
        textFrags.push(piece.text);
      }
    }
  }
  return { innerHtml: htmlFrags.join(""), plainText: textFrags.join("").trim(), hasRich };
}

async function importDocx(fileName: string, entries: Map<string, Uint8Array>): Promise<ImportedWorksDraft> {
  const docXml = readXmlEntry(entries, "word/document.xml");
  if (!docXml) {
    throw new ImportError("malformed", "Not a valid DOCX file: word/document.xml is missing.");
  }
  const title = corePropTitle(entries, titleFromFileName(fileName, "Imported doc"));
  const rels = parseRelsMap(readXmlEntry(entries, "word/_rels/document.xml.rels"));

  const blocks: DocBlock[] = [];
  const cfosBlocks: { id: string; html: string }[] = [];
  const warnings: string[] = [];
  const warningCodes: ImportWarningCode[] = [];
  let hasRich = false;

  const bodyInner = matchElements(docXml, "w:body")[0]?.inner ?? docXml;
  const blockCounter = { id: 1 };

  for (const node of extractBodyBlocks(bodyInner)) {
    if (node.tag === "w:tbl") {
      const trs = matchElements(node.inner, "w:tr");
      const parsedRows: { isHeader: boolean; cells: { html: string; text: string }[] }[] = [];
      for (let rIdx = 0; rIdx < trs.length; ++rIdx) {
        const tr = trs[rIdx];
        const explicitHeader = /<w:tblHeader\b/i.test(tr.inner);
        const tcs = matchElements(tr.inner, "w:tc");
        const cells: { html: string; text: string }[] = [];
        for (const tc of tcs) {
          const cellHtml: string[] = [];
          const cellText: string[] = [];
          for (const cp of matchElements(tc.inner, "w:p")) {
            const frag = extractParaFragments(cp.inner, rels, blockCounter);
            if (frag.plainText) {
              cellHtml.push(frag.innerHtml);
              cellText.push(frag.plainText);
            }
          }
          cells.push({
            html: cellHtml.join("<br>"),
            text: cellText.join(" / ").replace(/\|/g, "\\|").trim(),
          });
        }
        if (cells.length) parsedRows.push({ isHeader: explicitHeader || (rIdx === 0 && trs.length >= 2), cells });
      }
      if (!parsedRows.length) continue;
      hasRich = true;
      const id = `b_${blockCounter.id++}`;
      const rowsHtml = parsedRows
        .map((row) => {
          const cellTag = row.isHeader ? "th" : "td";
          return `<tr>${row.cells.map((c) => `<${cellTag}>${c.html}</${cellTag}>`).join("")}</tr>`;
        })
        .join("");
      cfosBlocks.push({ id, html: `<table data-block-id="${id}"><tbody>${rowsHtml}</tbody></table>` });
      const mdLines: string[] = [];
      for (let rIdx = 0; rIdx < parsedRows.length; ++rIdx) {
        const row = parsedRows[rIdx];
        mdLines.push(`| ${row.cells.map((c) => c.text || " ").join(" | ")} |`);
        if (rIdx === 0 && parsedRows.length > 1) {
          mdLines.push(`| ${row.cells.map(() => "---").join(" | ")} |`);
        }
      }
      blocks.push({ type: "p", text: mdLines.join("\n") });
      continue;
    }

    const pPr = matchElements(node.inner, "w:pPr")[0]?.inner ?? "";
    const styleMatch = /<w:pStyle\b([^>]*)\/?>/i.exec(pPr);
    const styleVal = styleMatch ? xmlAttr(styleMatch[1], "w:val").toLowerCase() : "";
    const isList = /<w:numPr\b/i.test(pPr);
    const isHeading1 = /^heading\s*1$|^title$/i.test(styleVal) || styleVal === "heading1";
    const isHeading2 = /^heading\s*2$/i.test(styleVal) || styleVal === "heading2";
    const isHeading3 = /^heading\s*[3-6]$/i.test(styleVal) || /^heading[3-6]$/.test(styleVal);

    const frag = extractParaFragments(node.inner, rels, blockCounter);
    if (!frag.plainText) continue;
    if (frag.hasRich) hasRich = true;

    const id = `b_${blockCounter.id++}`;
    const innerHtml = frag.innerHtml;
    if (isHeading1) {
      hasRich = true;
      blocks.push({ type: "h2", text: frag.plainText });
      cfosBlocks.push({ id, html: `<h1 data-block-id="${id}">${innerHtml}</h1>` });
    } else if (isHeading2) {
      blocks.push({ type: "h2", text: frag.plainText });
      cfosBlocks.push({ id, html: `<h2 data-block-id="${id}">${innerHtml}</h2>` });
    } else if (isHeading3) {
      hasRich = true;
      blocks.push({ type: "h2", text: frag.plainText });
      cfosBlocks.push({ id, html: `<h3 data-block-id="${id}">${innerHtml}</h3>` });
    } else if (isList) {
      hasRich = true;
      blocks.push({ type: "p", text: `- ${frag.plainText}` });
      cfosBlocks.push({ id, html: `<ul data-block-id="${id}"><li>${innerHtml}</li></ul>` });
    } else {
      blocks.push({ type: "p", text: frag.plainText });
      cfosBlocks.push({ id, html: `<p data-block-id="${id}">${innerHtml}</p>` });
    }
  }

  if (!blocks.length) {
    blocks.push({ type: "p", text: " " });
  }

  // Fit within Works 64 KiB budget cleanly.
  const fitBlocks = (list: DocBlock[], withSidecar: boolean): DocBlock[] => {
    const out = [...list];
    if (withSidecar) {
      out.push({
        type: "callout",
        label: "__cfos_doc_v1__",
        text: JSON.stringify(cfosBlocks),
      });
    }
    return out;
  };

  let candidate = fitBlocks(blocks, hasRich);
  if (byteLen(JSON.stringify({ blocks: candidate })) > MAX_WORKS_CONTENT_BYTES) {
    candidate = fitBlocks(blocks, false);
    if (hasRich) {
      warningCodes.push("simplified_doc");
      warnings.push("Simplified formatting to fit workspace document size limit.");
    }
  }
  while (
    candidate.length > 1 &&
    byteLen(JSON.stringify({ blocks: candidate })) > MAX_WORKS_CONTENT_BYTES
  ) {
    candidate = candidate.slice(0, Math.max(1, Math.floor(candidate.length * 0.8)));
    if (!warningCodes.includes("truncated_doc")) {
      warningCodes.push("truncated_doc");
      warnings.push("Document was truncated to fit workspace 64 KiB limit.");
    }
  }
  if (byteLen(JSON.stringify({ blocks: candidate })) > MAX_WORKS_CONTENT_BYTES) {
    candidate = [{ type: "p", text: candidate[0].text.slice(0, 12000) || " " }];
    if (!warningCodes.includes("truncated_doc")) {
      warningCodes.push("truncated_doc");
      warnings.push("Document was truncated to fit workspace 64 KiB limit.");
    }
  }

  return { kind: "doc", title, content: { kind: "doc", blocks: candidate }, warnings, warningCodes };
}

// ---- XLSX importer ------------------------------------------------------

function colIndexFromRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Za-z]+)([1-9]\d*)$/.exec(ref.trim());
  if (!m) return null;
  const letters = m[1].toUpperCase();
  let c = 0;
  for (let i = 0; i < letters.length; ++i) c = c * 26 + letters.charCodeAt(i) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
}

function colLetter(idx: number): string {
  let n = idx + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function coerceCell(raw: string): Cell {
  if (!raw) return "";
  if (raw.startsWith("=")) return raw;
  const n = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(n) && String(n) === raw.trim()) return n;
  return raw;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const list: string[] = [];
  for (const si of matchElements(xml, "si")) {
    const parts: string[] = [];
    for (const t of matchElements(si.inner, "t")) {
      parts.push(decodeXmlEntities(t.inner));
    }
    list.push(parts.join(""));
  }
  return list;
}

async function importXlsx(fileName: string, entries: Map<string, Uint8Array>): Promise<ImportedWorksDraft> {
  const wbXml = readXmlEntry(entries, "xl/workbook.xml");
  if (!wbXml) {
    throw new ImportError("malformed", "Not a valid XLSX file: xl/workbook.xml is missing.");
  }
  const rels = parseRelsMap(readXmlEntry(entries, "xl/_rels/workbook.xml.rels"));
  const sharedStrings = parseSharedStrings(readXmlEntry(entries, "xl/sharedStrings.xml"));

  const sheetsMeta: { id: string; name: string; target: string }[] = [];
  for (const el of matchElements(wbXml, "sheet")) {
    const name = xmlAttr(el.attrs, "name") || `Sheet${sheetsMeta.length + 1}`;
    const rid = xmlAttr(el.attrs, "r:id");
    const rel = rels.get(rid);
    const target = rel ? resolveZipTarget("xl", rel.target) : `xl/worksheets/sheet${sheetsMeta.length + 1}.xml`;
    sheetsMeta.push({ id: `s_${sheetsMeta.length + 1}`, name, target });
  }
  if (!sheetsMeta.length) {
    throw new ImportError("malformed", "XLSX workbook has no worksheets.");
  }

  const cfosSheets: Record<string, unknown> = {};
  const cfosCells: Record<string, Record<string, { value: string }>> = {};
  let firstColumns = ["A"];
  let firstRows: Cell[][] = [];

  for (let idx = 0; idx < sheetsMeta.length; ++idx) {
    const meta = sheetsMeta[idx];
    const wsXml = readXmlEntry(entries, meta.target);
    if (!wsXml) continue;

    let maxRow = 0;
    let maxCol = 1;
    const cellMap: Record<string, { value: string }> = {};
    const gridCells: { r: number; c: number; val: Cell }[] = [];

    for (const cEl of matchElements(wsXml, "c")) {
      const ref = xmlAttr(cEl.attrs, "r");
      const rc = colIndexFromRef(ref);
      if (!rc || rc.r > 2000 || rc.c > 64) continue;
      const t = xmlAttr(cEl.attrs, "t");
      const fMatch = /<f\b[^>]*>([\s\S]*?)<\/f>/i.exec(cEl.inner);
      const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cEl.inner);
      const isMatch = /<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/i.exec(cEl.inner);

      let text = "";
      if (fMatch) {
        const expr = decodeXmlEntities(fMatch[1]).replace(/^_xlfn\./gi, "").trim();
        if (expr) text = expr.startsWith("=") ? expr : `=${expr}`;
      }
      if (!text) {
        if (t === "s" && vMatch) {
          text = sharedStrings[Number(vMatch[1])] ?? "";
        } else if (t === "inlineStr" && isMatch) {
          text = decodeXmlEntities(isMatch[1]);
        } else if (t === "b" && vMatch) {
          text = vMatch[1].trim() === "1" ? "TRUE" : "FALSE";
        } else if (vMatch) {
          text = decodeXmlEntities(vMatch[1]);
        }
      }
      if (!text) continue;
      const normalizedRef = `${colLetter(rc.c)}${rc.r + 1}`;
      cellMap[normalizedRef] = { value: text };
      maxRow = Math.max(maxRow, rc.r + 1);
      maxCol = Math.max(maxCol, rc.c + 1);
      if (idx === 0) gridCells.push({ r: rc.r, c: rc.c, val: coerceCell(text) });
    }

    cfosSheets[meta.id] = {
      id: meta.id,
      name: meta.name,
      rows: Math.max(100, maxRow),
      cols: Math.max(26, maxCol),
      colWidths: {},
      rowHeights: {},
      frozenRows: 0,
      frozenCols: 0,
    };
    cfosCells[meta.id] = cellMap;

    if (idx === 0) {
      firstColumns = Array.from({ length: maxCol }, (_, i) => colLetter(i));
      firstRows = Array.from({ length: maxRow }, () => Array.from({ length: maxCol }, () => ""));
      for (const item of gridCells) {
        firstRows[item.r][item.c] = item.val;
      }
    }
  }

  const warnings: string[] = [];
  const warningCodes: ImportWarningCode[] = [];
  const sidecarWb = {
    sheetOrder: sheetsMeta.map((s) => s.id),
    sheets: cfosSheets,
    cells: cfosCells,
  };
  const trailer: Cell[] = Array.from({ length: firstColumns.length }, (_, i) =>
    i === 0 ? `__cfos_sheet_v1__:${JSON.stringify(sidecarWb)}` : "",
  );
  let rowsWithSidecar = [...firstRows, trailer];
  if (byteLen(JSON.stringify({ columns: firstColumns, rows: rowsWithSidecar })) > MAX_WORKS_CONTENT_BYTES) {
    rowsWithSidecar = firstRows;
    if (sheetsMeta.length > 1) {
      warningCodes.push("kept_first_sheet");
      warnings.push("Kept first worksheet to fit workspace 64 KiB limit.");
    }
  }
  while (
    rowsWithSidecar.length > 0 &&
    byteLen(JSON.stringify({ columns: firstColumns, rows: rowsWithSidecar })) > MAX_WORKS_CONTENT_BYTES
  ) {
    rowsWithSidecar = rowsWithSidecar.slice(0, Math.floor(rowsWithSidecar.length * 0.8));
    if (!warningCodes.includes("truncated_sheet")) {
      warningCodes.push("truncated_sheet");
      warnings.push("Spreadsheet rows were truncated to fit workspace 64 KiB limit.");
    }
  }

  const title = corePropTitle(entries, titleFromFileName(fileName, "Imported sheet"));
  return {
    kind: "sheet",
    title,
    content: { kind: "sheet", columns: firstColumns, rows: rowsWithSidecar },
    warnings,
    warningCodes,
  };
}

// ---- PPTX importer ------------------------------------------------------

const EMU_PER_SLIDE_W = 12192000;
const EMU_PER_SLIDE_H = 6858000;

function extractSlideShapeText(spXml: string): string[] {
  const paras: string[] = [];
  for (const p of matchElements(spXml, "a:p")) {
    const lineParts: string[] = [];
    const re = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p.inner)) !== null) {
      if (m[1] !== undefined) lineParts.push(decodeXmlEntities(m[1]));
      else lineParts.push("\n");
    }
    const text = lineParts.join("").trim();
    if (text) paras.push(text);
  }
  return paras;
}

async function importPptx(fileName: string, entries: Map<string, Uint8Array>): Promise<ImportedWorksDraft> {
  const presXml = readXmlEntry(entries, "ppt/presentation.xml");
  if (!presXml) {
    throw new ImportError("malformed", "Not a valid PPTX file: ppt/presentation.xml is missing.");
  }
  const rels = parseRelsMap(readXmlEntry(entries, "ppt/_rels/presentation.xml.rels"));
  const szMatch = /<p:sldSz\b([^>]*)\/?>/i.exec(presXml);
  const sldCx = Number(szMatch ? xmlAttr(szMatch[1], "cx") : "") || EMU_PER_SLIDE_W;
  const sldCy = Number(szMatch ? xmlAttr(szMatch[1], "cy") : "") || EMU_PER_SLIDE_H;

  const slideTargets: string[] = [];
  for (const sldId of matchElements(presXml, "p:sldId")) {
    const rid = xmlAttr(sldId.attrs, "r:id");
    const rel = rels.get(rid);
    if (rel) slideTargets.push(resolveZipTarget("ppt", rel.target));
  }
  if (!slideTargets.length) {
    throw new ImportError("malformed", "PPTX presentation has no slides.");
  }

  const slides: DeckSlide[] = [];
  for (let i = 0; i < slideTargets.length; ++i) {
    const target = slideTargets[i];
    const sldXml = readXmlEntry(entries, target);
    if (!sldXml) continue;

    // Speaker notes lookup via slide relationships (skip slide-number / image placeholders)
    const slideDir = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "ppt";
    const slideBase = target.split("/").pop() ?? "";
    const slideRels = parseRelsMap(readXmlEntry(entries, `${slideDir}/_rels/${slideBase}.rels`));
    let notesText = "";
    for (const rel of slideRels.values()) {
      if (rel.type.endsWith("/notesSlide")) {
        const notesXml = readXmlEntry(entries, resolveZipTarget(slideDir, rel.target));
        if (notesXml) {
          const bodyNotes: string[] = [];
          const otherNotes: string[] = [];
          for (const nsp of matchElements(notesXml, "p:sp")) {
            const phM = /<p:ph\b([^>]*)\/?>/i.exec(nsp.inner);
            const nPhType = phM ? xmlAttr(phM[1], "type").toLowerCase() : "";
            if (nPhType === "sldnum" || nPhType === "sldimg") continue;
            const lines = extractSlideShapeText(nsp.inner);
            if (!lines.length) continue;
            if (nPhType === "body") bodyNotes.push(...lines);
            else otherNotes.push(...lines);
          }
          notesText = (bodyNotes.length ? bodyNotes : otherNotes).join("\n").trim();
        }
        break;
      }
    }

    const cfosBlocks: Record<string, unknown>[] = [];
    let slideTitle = "";
    const bodyLines: string[] = [];

    for (const sp of matchElements(sldXml, "p:sp")) {
      const paras = extractSlideShapeText(sp.inner);
      if (!paras.length) continue;
      const joined = paras.join("\n");
      const phMatch = /<p:ph\b([^>]*)\/?>/i.exec(sp.inner);
      const phType = phMatch ? xmlAttr(phMatch[1], "type").toLowerCase() : "";

      const xfrm = matchElements(sp.inner, "a:xfrm")[0]?.inner ?? "";
      const offM = /<a:off\b([^>]*)\/?>/i.exec(xfrm);
      const extM = /<a:ext\b([^>]*)\/?>/i.exec(xfrm);
      const x = Math.round(((Number(offM ? xmlAttr(offM[1], "x") : "") || 0) / sldCx) * 1200);
      const y = Math.round(((Number(offM ? xmlAttr(offM[1], "y") : "") || 0) / sldCy) * 675);
      const w = Math.max(120, Math.round(((Number(extM ? xmlAttr(extM[1], "cx") : "") || sldCx * 0.6) / sldCx) * 1200));

      const isTitle = phType === "title" || phType === "ctrtitle" || (!slideTitle && cfosBlocks.length === 0);
      if (isTitle && !slideTitle) {
        slideTitle = paras[0];
        cfosBlocks.push({
          id: `b_${cfosBlocks.length + 1}`,
          type: "title",
          x: Math.max(36, Math.min(900, x || 48)),
          y: Math.max(32, Math.min(500, y || 64)),
          w: Math.min(1100, w),
          props: { text: joined, fontSize: i === 0 ? 48 : 32 },
        });
      } else if (paras.length > 1) {
        for (const p of paras) bodyLines.push(`- ${p}`);
        cfosBlocks.push({
          id: `b_${cfosBlocks.length + 1}`,
          type: "bulletList",
          x: Math.max(36, Math.min(900, x || 48)),
          y: Math.max(120, Math.min(580, y || 180)),
          w: Math.min(1100, w),
          props: { text: joined },
        });
      } else {
        bodyLines.push(joined);
        cfosBlocks.push({
          id: `b_${cfosBlocks.length + 1}`,
          type: "text",
          x: Math.max(36, Math.min(900, x || 48)),
          y: Math.max(120, Math.min(580, y || 180)),
          w: Math.min(1100, w),
          props: { text: joined },
        });
      }
    }

    const cfosSlide = {
      id: `s_${i + 1}`,
      background: i === 0 ? { coverOrange: true, inset: false } : { color: "#FFFFFF", inset: false },
      blocks: cfosBlocks,
    };
    const safeTitle = slideTitle || `Slide ${i + 1}`;
    const safeBody = bodyLines.join("\n").trim() || safeTitle;
    const notesWithSidecar =
      (notesText ? `${notesText}\n` : "") + `---cfos-slide-v1---\n${JSON.stringify(cfosSlide)}`;
    slides.push({ title: safeTitle, body: safeBody, notes: notesWithSidecar });
  }

  if (!slides.length) {
    slides.push({ title: "Slide 1", body: "Empty presentation" });
  }

  const warnings: string[] = [];
  const warningCodes: ImportWarningCode[] = [];
  let candidate = slides;
  if (byteLen(JSON.stringify({ slides: candidate })) > MAX_WORKS_CONTENT_BYTES) {
    candidate = slides.map((s) => ({
      title: s.title,
      body: s.body,
      ...(s.notes ? { notes: s.notes.split("\n---cfos-slide-v1---\n")[0] } : {}),
    }));
    warningCodes.push("simplified_deck");
    warnings.push("Simplified slide metadata to fit workspace 64 KiB limit.");
  }
  while (
    candidate.length > 1 &&
    byteLen(JSON.stringify({ slides: candidate })) > MAX_WORKS_CONTENT_BYTES
  ) {
    candidate = candidate.slice(0, Math.floor(candidate.length * 0.8));
    if (!warningCodes.includes("truncated_deck")) {
      warningCodes.push("truncated_deck");
      warnings.push("Presentation slides were truncated to fit workspace 64 KiB limit.");
    }
  }

  return {
    kind: "deck",
    title: corePropTitle(entries, titleFromFileName(fileName, "Imported deck")),
    content: { kind: "deck", slides: candidate },
    warnings,
    warningCodes,
  };
}

// ---- CSV / Markdown importers -------------------------------------------

function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; ++i) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          ++i;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && clean[i + 1] === "\n") ++i;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

function importCsv(fileName: string, bytes: Uint8Array): ImportedWorksDraft {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const parsed = parseCsvRows(text);
  const width = Math.max(1, Math.min(64, ...parsed.map((r) => r.length)));
  const columns = Array.from({ length: width }, (_, i) => colLetter(i));
  let rows: Cell[][] = parsed.slice(0, 1000).map((r) =>
    Array.from({ length: width }, (_, c) => coerceCell(r[c] ?? "")),
  );
  const warnings: string[] = [];
  const warningCodes: ImportWarningCode[] = [];
  while (rows.length > 0 && byteLen(JSON.stringify({ columns, rows })) > MAX_WORKS_CONTENT_BYTES) {
    rows = rows.slice(0, Math.floor(rows.length * 0.8));
    if (!warningCodes.length) {
      warningCodes.push("truncated_sheet");
      warnings.push("CSV rows were truncated to fit workspace 64 KiB limit.");
    }
  }
  return {
    kind: "sheet",
    title: titleFromFileName(fileName, "Imported CSV"),
    content: { kind: "sheet", columns, rows },
    warnings,
    warningCodes,
  };
}

function importMarkdownOrText(fileName: string, bytes: Uint8Array): ImportedWorksDraft {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\r\n?/g, "\n");
  const blocks: DocBlock[] = [];
  let title = titleFromFileName(fileName, "Imported doc");
  const chunks = text.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  for (let i = 0; i < chunks.length; ++i) {
    const chunk = chunks[i];
    if (/^#\s+/.test(chunk) && i === 0) {
      title = clampTitle(chunk.replace(/^#\s+/, ""), title);
      continue;
    }
    if (/^#{1,6}\s+/.test(chunk)) {
      blocks.push({ type: "h2", text: chunk.replace(/^#{1,6}\s+/, "").trim() });
    } else if (/^>\s+/.test(chunk)) {
      blocks.push({ type: "callout", text: chunk.replace(/^>\s?/gm, "").trim() || " " });
    } else {
      blocks.push({ type: "p", text: chunk });
    }
  }
  if (!blocks.length) blocks.push({ type: "p", text: " " });
  const warnings: string[] = [];
  const warningCodes: ImportWarningCode[] = [];
  let candidate = blocks;
  while (
    candidate.length > 1 &&
    byteLen(JSON.stringify({ blocks: candidate })) > MAX_WORKS_CONTENT_BYTES
  ) {
    candidate = candidate.slice(0, Math.max(1, Math.floor(candidate.length * 0.8)));
    if (!warningCodes.length) {
      warningCodes.push("truncated_doc");
      warnings.push("Document was truncated to fit workspace 64 KiB limit.");
    }
  }
  return { kind: "doc", title, content: { kind: "doc", blocks: candidate }, warnings, warningCodes };
}

// ---- Entrypoint ---------------------------------------------------------

export async function importFileToWorksDraft(
  fileName: string,
  bytes: Uint8Array,
): Promise<ImportedWorksDraft> {
  if (bytes.byteLength === 0) {
    throw new ImportError("malformed", "Selected file is empty.");
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportError("too_large", `File exceeds ${MAX_IMPORT_BYTES} byte limit.`);
  }
  const ext = fileName.trim().toLowerCase().split(".").pop() ?? "";
  if (ext === "docm" || ext === "xlsm" || ext === "pptm") {
    throw new ImportError("macros", "Macro-enabled Office files are not supported.");
  }
  if (ext === "csv") return importCsv(fileName, bytes);
  if (ext === "md" || ext === "markdown" || ext === "txt") {
    return importMarkdownOrText(fileName, bytes);
  }
  if (ext === "docx" || ext === "xlsx" || ext === "pptx") {
    const entries = await readZipEntries(bytes);
    if (ext === "docx") return importDocx(fileName, entries);
    if (ext === "xlsx") return importXlsx(fileName, entries);
    return importPptx(fileName, entries);
  }
  throw new ImportError("unsupported", `Unsupported file type: .${ext || "unknown"}`);
}

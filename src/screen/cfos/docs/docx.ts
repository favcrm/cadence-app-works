// Zero-dependency WordprocessingML (.docx) exporter for Works Docs.
// Zero runtime relative imports so Node 22 strip-types unit tests run cleanly.

const encoder = new TextEncoder();
const WML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808;
const DEFLATE_METHOD = 8;
const DOS_TIME = 0;
const DOS_DATE = 33;
const MAX_IMAGE_EMU_W = 5943600; // 6.5 inches (matches 1" left/right margins on 8.5" page)
const PX_TO_EMU = 9525;

interface ZipEntry {
  name: string;
  data: string | Uint8Array;
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
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
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

function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "\uFFFD")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, ent: string) => {
    const lower = ent.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    const table: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return table[lower] ?? " ";
  });
}

function readAttr(attrs: string, name: string): string {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs);
  return decodeHtmlEntities(m ? (m[1] ?? m[2] ?? m[3] ?? "") : "");
}

function parseHexColor(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const d = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    return d.toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(s);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return undefined;
}

function mapHighlightColor(hex?: string): string | undefined {
  if (!hex) return undefined;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (r > 200 && g > 200 && b < 150) return "yellow";
  if (g > 200 && r < 160 && b < 160) return "green";
  if (b > 200 && r < 160 && g > 180) return "cyan";
  if (r > 200 && b > 180 && g < 160) return "magenta";
  if (r > 200 && g < 140 && b < 140) return "red";
  if (b > 190 && r < 150 && g < 150) return "blue";
  return "lightGray";
}

interface RunStyle {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  highlight?: string;
  sizePt?: number;
  font?: string;
}

interface DocxRel {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

interface DocxMedia {
  index: number;
  extension: "png" | "jpeg";
  mime: string;
  bytes: Uint8Array;
}

interface DocxCtx {
  rels: DocxRel[];
  media: DocxMedia[];
  bySrc: Map<string, { relId: string; w: number; h: number }>;
  nextPicId: number;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) ++offset;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = (bytes[offset] << 8) | bytes[offset + 1];
    if (len < 2 || offset + len > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (len >= 7) {
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        return width > 0 && height > 0 ? { width, height } : null;
      }
    }
    offset += len;
  }
  return null;
}

function decodeBase64(b64: string): Uint8Array | null {
  const clean = b64.replace(/\s+/g, "");
  if (!clean || clean.length % 4 !== 0) return null;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
  return out;
}

function registerImage(src: string, ctx: DocxCtx): { relId: string; w: number; h: number } | null {
  const cached = ctx.bySrc.get(src);
  if (cached) return cached;
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
  if (!m) return null;
  const ext = m[1].toLowerCase() === "png" ? "png" : "jpeg";
  const bytes = decodeBase64(m[2]);
  if (!bytes || !bytes.byteLength) return null;
  const dims = ext === "png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  const pxW = dims?.width ?? 400;
  const pxH = dims?.height ?? 300;
  let w = pxW * PX_TO_EMU;
  let h = pxH * PX_TO_EMU;
  if (w > MAX_IMAGE_EMU_W) {
    h = Math.round((h * MAX_IMAGE_EMU_W) / w);
    w = MAX_IMAGE_EMU_W;
  }
  const index = ctx.media.length + 1;
  const relId = `rId${ctx.rels.length + 1}`;
  ctx.media.push({ index, extension: ext, mime: `image/${ext}`, bytes });
  ctx.rels.push({
    id: relId,
    type: `${R_NS}/image`,
    target: `media/image${index}.${ext}`,
  });
  const receipt = { relId, w, h };
  ctx.bySrc.set(src, receipt);
  return receipt;
}

function registerHyperlink(url: string, ctx: DocxCtx): string | null {
  if (!/^https?:\/\//i.test(url.trim())) return null;
  const relId = `rId${ctx.rels.length + 1}`;
  ctx.rels.push({
    id: relId,
    type: `${R_NS}/hyperlink`,
    target: url.trim(),
    external: true,
  });
  return relId;
}

function styleFromTagAndAttrs(tag: string, attrs: string, parent: RunStyle): RunStyle {
  const next: RunStyle = { ...parent };
  if (tag === "strong" || tag === "b") next.b = true;
  if (tag === "em" || tag === "i") next.i = true;
  if (tag === "u") next.u = true;
  if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
  if (tag === "code") {
    next.code = true;
    next.font = "Courier New";
  }
  const colorAttr = readAttr(attrs, "color");
  if (colorAttr) {
    const parsed = parseHexColor(colorAttr);
    if (parsed) next.color = parsed;
  }
  const styleAttr = readAttr(attrs, "style");
  if (styleAttr) {
    const weightM = /font-weight\s*:\s*([^;]+)/i.exec(styleAttr);
    if (weightM) next.b = /^(bold|bolder|[6-9]00)\b/i.test(weightM[1].trim());
    const slantM = /font-style\s*:\s*([^;]+)/i.exec(styleAttr);
    if (slantM) next.i = /^(italic|oblique)\b/i.test(slantM[1].trim());
    const decM = /text-decoration(?:-line)?\s*:\s*([^;]+)/i.exec(styleAttr);
    if (decM) {
      if (/\bunderline\b/i.test(decM[1])) next.u = true;
      if (/\bline-through\b/i.test(decM[1])) next.strike = true;
    }
    const colM = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(styleAttr);
    if (colM) {
      const parsed = parseHexColor(colM[1]);
      if (parsed) next.color = parsed;
    }
    const bgM = /background(?:-color)?\s*:\s*([^;]+)/i.exec(styleAttr);
    if (bgM) {
      const hl = mapHighlightColor(parseHexColor(bgM[1]));
      if (hl) next.highlight = hl;
    }
    const sizeM = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*pt/i.exec(styleAttr);
    if (sizeM) next.sizePt = Math.max(8, Math.min(72, Number(sizeM[1])));
    const fontM = /font-family\s*:\s*([^;]+)/i.exec(styleAttr);
    if (fontM) next.font = fontM[1].split(",")[0].replace(/['"]/g, "").trim();
  }
  return next;
}

function runPropsXml(style: RunStyle): string {
  const parts: string[] = [];
  if (style.font) {
    const f = xmlEscape(style.font);
    parts.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="Noto Sans TC"/>`);
  }
  if (style.b) parts.push("<w:b/>");
  if (style.i) parts.push("<w:i/>");
  if (style.u) parts.push('<w:u w:val="single"/>');
  if (style.strike) parts.push("<w:strike/>");
  if (style.color) parts.push(`<w:color w:val="${style.color}"/>`);
  if (style.highlight) parts.push(`<w:highlight w:val="${style.highlight}"/>`);
  if (style.code && !style.highlight) {
    parts.push('<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>');
  }
  if (style.sizePt) parts.push(`<w:sz w:val="${Math.round(style.sizePt * 2)}"/><w:szCs w:val="${Math.round(style.sizePt * 2)}"/>`);
  return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
}

function drawingXml(relId: string, w: number, h: number, picId: number, alt: string): string {
  const name = xmlEscape(alt || `Image ${picId}`);
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${picId}" name="${name}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${picId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function renderInlineRuns(html: string, style: RunStyle, ctx: DocxCtx): string {
  const out: string[] = [];
  const stack: { tag: string; style: RunStyle; linkId?: string | null }[] = [{ tag: "", style }];
  const re = /<[!][-][-][\s\S]*?[-][-]>|<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[4] !== undefined) {
      const text = decodeHtmlEntities(m[4]);
      if (!text) continue;
      const top = stack[stack.length - 1];
      out.push(`<w:r>${runPropsXml(top.style)}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`);
      continue;
    }
    const closing = m[1] === "/";
    const tag = (m[2] || "").toLowerCase();
    const attrs = m[3] || "";
    if (!tag) continue;
    if (tag === "br") {
      out.push("<w:r><w:br/></w:r>");
      continue;
    }
    if (tag === "img") {
      const src = readAttr(attrs, "src");
      const alt = readAttr(attrs, "alt");
      const img = registerImage(src, ctx);
      if (img) {
        out.push(drawingXml(img.relId, img.w, img.h, ctx.nextPicId++, alt));
      }
      continue;
    }
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].tag === tag) {
        const popped = stack.pop()!;
        if (popped.linkId) out.push("</w:hyperlink>");
      }
      continue;
    }
    if (/\s*\/\s*$/.test(attrs)) continue;
    const prev = stack[stack.length - 1];
    if (tag === "a") {
      const href = readAttr(attrs, "href");
      const linkId = registerHyperlink(href, ctx);
      const linkStyle: RunStyle = linkId
        ? { ...prev.style, color: prev.style.color ?? "0563C1", u: true }
        : prev.style;
      if (linkId) out.push(`<w:hyperlink r:id="${linkId}">`);
      stack.push({ tag, style: linkStyle, linkId });
      continue;
    }
    stack.push({ tag, style: styleFromTagAndAttrs(tag, attrs, prev.style) });
  }
  while (stack.length > 1) {
    const popped = stack.pop()!;
    if (popped.linkId) out.push("</w:hyperlink>");
  }
  return out.join("");
}

function paragraphAlignXml(attrs: string): string {
  const styleAttr = readAttr(attrs, "style");
  const alignM = /text-align\s*:\s*(left|center|right|justify)\b/i.exec(styleAttr);
  if (!alignM) return "";
  const map: Record<string, string> = {
    left: "left",
    center: "center",
    right: "right",
    justify: "both",
  };
  return `<w:jc w:val="${map[alignM[1].toLowerCase()]}"/>`;
}

function renderParagraphXml(
  innerHtml: string,
  ctx: DocxCtx,
  opts: { pStyle?: string; attrs?: string; numId?: number; ilvl?: number; code?: boolean; quote?: boolean } = {},
): string {
  const pPr: string[] = [];
  if (opts.pStyle) pPr.push(`<w:pStyle w:val="${opts.pStyle}"/>`);
  if (opts.numId !== undefined) {
    pPr.push(`<w:numPr><w:ilvl w:val="${opts.ilvl ?? 0}"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
  }
  if (opts.quote) {
    pPr.push('<w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="F6821F"/></w:pBdr>');
    pPr.push('<w:ind w:left="420"/>');
  } else if (opts.code) {
    pPr.push('<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>');
    pPr.push('<w:ind w:left="240" w:right="240"/>');
  }
  if (opts.attrs) {
    const jc = paragraphAlignXml(opts.attrs);
    if (jc) pPr.push(jc);
  }
  const baseStyle: RunStyle = opts.code ? { font: "Courier New", sizePt: 10 } : {};
  const runs = renderInlineRuns(innerHtml, baseStyle, ctx);
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : ""}${runs}</w:p>`;
}

function renderListItems(listHtml: string, ordered: boolean, ctx: DocxCtx): string {
  const numId = ordered ? 2 : 1;
  const items: string[] = [];
  const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(listHtml)) !== null) {
    items.push(renderParagraphXml(m[2], ctx, { pStyle: "ListParagraph", numId, ilvl: 0, attrs: m[1] }));
  }
  return items.join("");
}

function renderBlockXml(rawHtml: string, ctx: DocxCtx): string {
  const html = rawHtml.trim();
  if (!html) return "";
  if (/^<hr\b/i.test(html)) {
    return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="D6D3D1"/></w:pBdr></w:pPr></w:p>';
  }
  const listM = /^<(ul|ol)\b[^>]*>([\s\S]*)<\/\1>$/i.exec(html);
  if (listM) {
    return renderListItems(listM[2], listM[1].toLowerCase() === "ol", ctx);
  }
  const headingM = /^<(h1|h2|h3|h4)\b([^>]*)>([\s\S]*?)<\/\1>$/i.exec(html);
  if (headingM) {
    const level = headingM[1].toLowerCase();
    const styleMap: Record<string, string> = {
      h1: "Heading1",
      h2: "Heading2",
      h3: "Heading3",
      h4: "Heading3",
    };
    return renderParagraphXml(headingM[3], ctx, { pStyle: styleMap[level], attrs: headingM[2] });
  }
  const quoteM = /^<blockquote\b([^>]*)>([\s\S]*?)<\/blockquote>$/i.exec(html);
  if (quoteM) {
    return renderParagraphXml(quoteM[2], ctx, { attrs: quoteM[1], quote: true });
  }
  const preM = /^<pre\b([^>]*)>([\s\S]*?)<\/pre>$/i.exec(html);
  if (preM) {
    return renderParagraphXml(preM[2], ctx, { attrs: preM[1], code: true });
  }
  const paraM = /^<(?:p|div)\b([^>]*)>([\s\S]*)<\/(?:p|div)>$/i.exec(html);
  if (paraM) {
    const cls = readAttr(paraM[1], "class");
    const pStyle = /\bdoc-title\b/.test(cls) ? "Title" : undefined;
    return renderParagraphXml(paraM[2], ctx, { pStyle, attrs: paraM[1] });
  }
  return renderParagraphXml(html, ctx);
}

function wordStylesXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${WML_NS}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Noto Sans TC"/>` +
    `<w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="1F2328"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:before="120" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="260" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:ind w:left="720"/></w:pPr></w:style>` +
    `</w:styles>`
  );
}

function wordNumberingXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="${WML_NS}">` +
    `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
    `<w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
    `<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>` +
    `</w:numbering>`
  );
}

export async function buildDocxBytes(
  title: string,
  blocks: readonly { id: string; html: string }[],
): Promise<Uint8Array> {
  const ctx: DocxCtx = {
    rels: [
      { id: "rId1", type: `${R_NS}/styles`, target: "styles.xml" },
      { id: "rId2", type: `${R_NS}/numbering`, target: "numbering.xml" },
    ],
    media: [],
    bySrc: new Map(),
    nextPicId: 1,
  };

  const bodyParts: string[] = [];
  for (const block of blocks) {
    const rendered = renderBlockXml(block.html, ctx);
    if (rendered) bodyParts.push(rendered);
  }
  if (!bodyParts.length) {
    bodyParts.push("<w:p/>");
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${WML_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
    `<w:body>${bodyParts.join("")}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    ctx.rels
      .map(
        (r) =>
          `<Relationship Id="${xmlEscape(r.id)}" Type="${xmlEscape(r.type)}" Target="${xmlEscape(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`,
      )
      .join("") +
    `</Relationships>`;

  const mediaTypes = new Map(ctx.media.map((m) => [m.extension, m.mime]));
  let ctXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="${CT_NS}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>`;
  for (const [ext, mime] of mediaTypes) {
    ctXml += `<Default Extension="${ext}" ContentType="${mime}"/>`;
  }
  ctXml +=
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="${PKG_REL_NS}/metadata/core-properties" Target="docProps/core.xml"/>` +
    `</Relationships>`;

  const coreXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="${CP_NS}" xmlns:dc="${DC_NS}">` +
    `<dc:title>${xmlEscape(title.trim() || "Untitled doc")}</dc:title>` +
    `<dc:creator>Cadence Works</dc:creator>` +
    `<cp:lastModifiedBy>Cadence Works</cp:lastModifiedBy><cp:revision>1</cp:revision></cp:coreProperties>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: ctXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "docProps/core.xml", data: coreXml },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: docRelsXml },
    { name: "word/styles.xml", data: wordStylesXml() },
    { name: "word/numbering.xml", data: wordNumberingXml() },
  ];
  for (const m of ctx.media) {
    entries.push({ name: `word/media/image${m.index}.${m.extension}`, data: m.bytes });
  }
  return createZipBytes(entries);
}

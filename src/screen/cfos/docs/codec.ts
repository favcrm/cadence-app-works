// Ported from cloudflare-os workspace-docs/files/lib/markdown.ts & client.ts
// Maps cleanly between rich contenteditable HTML and Works v0 DocBlock[].

import type { DocBlock } from "../../domain/works";

type Marker = "**" | "*" | "~~";
type Emphasis = Partial<Record<Marker, boolean>>;
type EmphasisChange = { at: number; marker: Marker; open: boolean };

const MARKERS: Marker[] = ["**", "*", "~~"];
const HTML_TAGS: Record<Marker, string> = { "**": "strong", "*": "em", "~~": "del" };

const ELEMENT_EMPHASIS = new Map<string, Emphasis>([
  ["strong", { "**": true }],
  ["b", { "**": true }],
  ["em", { "*": true }],
  ["i", { "*": true }],
  ["s", { "~~": true }],
  ["strike", { "~~": true }],
  ["del", { "~~": true }],
  ["span", {}],
  ["font", {}],
]);

const BLOCK_TAGS: Record<string, true> = Object.fromEntries(
  ["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "blockquote", "pre", "ul", "ol", "li", "hr"].map(
    (tag) => [tag, true],
  ),
);

function decodeHtml(value: string): string {
  return String(value).replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (_: string, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      return named[lower] ?? " ";
    },
  );
}

function readHtmlAttribute(source: string, name: string): string {
  const pattern = new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = pattern.exec(source);
  return decodeHtml(match ? (match[1] ?? match[2] ?? match[3] ?? "") : "");
}

function styleEmphasis(attributes: string): Emphasis {
  const style = readHtmlAttribute(attributes, "style").toLowerCase();
  const emphasis: Emphasis = {};
  const weight = /font-weight\s*:\s*(?:(bold|bolder|[6-9]00)|normal|[1-5]00)\b/.exec(style);
  if (weight) emphasis["**"] = weight[1] !== undefined;
  const slant = /font-style\s*:\s*(?:(italic|oblique)|normal)\b/.exec(style);
  if (slant) emphasis["*"] = slant[1] !== undefined;
  if (/text-decoration(-line)?\s*:[^;]*line-through/.test(style)) emphasis["~~"] = true;
  return emphasis;
}

function emphasisOf(tag: string, attributes: string): Emphasis | undefined {
  const implied = ELEMENT_EMPHASIS.get(tag);
  return implied && { ...implied, ...styleEmphasis(attributes) };
}

function emphasisIn(frames: Emphasis[]): Marker[] {
  const on = new Set<Marker>();
  for (const frame of frames) {
    for (const marker of MARKERS) {
      if (frame[marker]) on.add(marker);
      else if (frame[marker] === false) on.delete(marker);
    }
  }
  return [...on];
}

function charClass(char: string | undefined): "space" | "punctuation" | "word" {
  if (char === undefined || /\s/.test(char)) return "space";
  return /[\p{P}\p{S}]/u.test(char) ? "punctuation" : "word";
}

function delimitersReadAsWritten(markdown: string, changes: EmphasisChange[]): boolean {
  const runs: { start: number; end: number; opens: boolean; closes: boolean }[] = [];
  let shift = 0;
  for (const { at, marker, open } of changes) {
    const start = at + shift;
    shift += marker.length;
    const run = runs.at(-1);
    if (run?.end === start && markdown[run.start] === marker[0]) {
      run.end += marker.length;
      run.opens ||= open;
      run.closes ||= !open;
    } else {
      runs.push({ start, end: start + marker.length, opens: open, closes: !open });
    }
  }
  return runs.every(({ start, end, opens, closes }) => {
    const before = charClass(markdown.slice(Math.max(start - 2, 0), start).match(/.$/su)?.[0]);
    const after = charClass(markdown.slice(end, end + 2).match(/^./su)?.[0]);
    const leftFlanking = after !== "space" && (after !== "punctuation" || before !== "word");
    const rightFlanking = before !== "space" && (before !== "punctuation" || after !== "word");
    return opens ? !closes && leftFlanking && !rightFlanking : rightFlanking;
  });
}

function spellEmphasis(text: string, changes: EmphasisChange[]): string {
  const spell = (delimiter: (change: EmphasisChange) => string) => {
    let spelled = "";
    let from = 0;
    for (const change of changes) {
      spelled += text.slice(from, change.at) + delimiter(change);
      from = change.at;
    }
    return spelled + text.slice(from);
  };
  const markdown = spell(({ marker }) => marker);
  if (delimitersReadAsWritten(markdown, changes)) return markdown;
  return spell(({ marker, open }) => `<${open ? "" : "/"}${HTML_TAGS[marker]}>`);
}

function stripHtmlComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (
      source[i] === "<" &&
      source[i + 1] === "!" &&
      source[i + 2] === "-" &&
      source[i + 3] === "-"
    ) {
      let j = i + 4;
      while (j + 2 < source.length) {
        if (source[j] === "-" && source[j + 1] === "-" && source[j + 2] === ">") {
          i = j + 3;
          break;
        }
        j++;
      }
      if (j + 2 >= source.length) return out;
      continue;
    }
    out += source[i];
    i++;
  }
  return out;
}

export function htmlToMarkdown(html: string): string {
  const cleaned = stripHtmlComments(String(html));
  const tokens = cleaned.match(/<![^>]*>|<[^>]+>|[^<]+/g) || [];
  const lists: { type: "ul" | "ol"; count: number }[] = [];
  const links: string[] = [];
  const blockquotes: number[] = [];
  const frames: Emphasis[] = [];
  const written: Marker[] = [];
  let markdown = "";
  let inline = "";
  let changes: EmphasisChange[] = [];
  let inPre = false;
  let inCode = false;
  let inHeading = false;
  let space = false;
  let breaks = 0;

  const closeTo = (depth: number) => {
    for (const marker of written.splice(depth).reverse()) {
      changes.push({ at: inline.length, marker, open: false });
    }
  };
  const beginInline = (wanted = emphasisIn(frames)) => {
    let kept = 0;
    while (kept < written.length && wanted.includes(written[kept])) kept++;
    closeTo(kept);
    inline += breaks ? "\\\n".repeat(breaks) : space ? " " : "";
    space = false;
    breaks = 0;
    for (const marker of wanted) {
      if (written.includes(marker)) continue;
      written.push(marker);
      changes.push({ at: inline.length, marker, open: true });
    }
  };
  const endBlock = () => {
    closeTo(0);
    markdown += spellEmphasis(inline, changes);
    inline = "";
    changes = [];
    space = false;
    breaks = 0;
  };

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const text = decodeHtml(token);
      if (inPre) inline += text;
      else if (inCode) inline += text.replace(/\s+/g, " ");
      else {
        const words = text.replace(/\s+/g, " ");
        space ||= words.startsWith(" ");
        if (words.trim()) {
          beginInline();
          inline += words.trim();
          space = words.endsWith(" ");
        }
      }
      continue;
    }
    if (token.startsWith("<!")) continue;
    const match = /^<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/i.exec(token);
    if (!match) continue;
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attributes = match[3];
    const emphasis = emphasisOf(tag, attributes);
    if (emphasis) {
      if (closing) frames.pop();
      else frames.push(emphasis);
      continue;
    }
    if (BLOCK_TAGS[tag]) endBlock();

    if (closing) {
      switch (tag) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          inHeading = false;
          markdown += "\n\n";
          break;
        case "p":
        case "div":
          markdown += "\n\n";
          break;
        case "blockquote": {
          const start = blockquotes.pop() ?? 0;
          const content = markdown.slice(start).trim().replace(/\n{3,}/g, "\n\n");
          const quoted = content
            ? content
                .split("\n")
                .map((line) => (line ? "> " + line : ">"))
                .join("\n")
            : ">";
          markdown = markdown.slice(0, start) + quoted + "\n\n";
          break;
        }
        case "code":
          if (!inPre) {
            inline += "`";
            inCode = false;
          }
          break;
        case "pre":
          markdown += "\n```\n\n";
          inPre = false;
          break;
        case "a":
          closeTo(0);
          inline += "](" + (links.pop() ?? "") + ")";
          frames.pop();
          break;
        case "li":
          if (!markdown.endsWith("\n")) markdown += "\n";
          break;
        case "ul":
        case "ol":
          lists.pop();
          break;
      }
      continue;
    }

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        inHeading = true;
        markdown += "\n\n" + "#".repeat(Number(tag[1])) + " ";
        break;
      case "p":
      case "div":
        markdown += "\n\n";
        break;
      case "br":
        if (inPre) inline += "\n";
        else if (inCode) inline += " ";
        else if (inHeading) space = true;
        else breaks++;
        break;
      case "code":
        if (!inPre) {
          beginInline();
          inline += "`";
          inCode = true;
        }
        break;
      case "pre":
        markdown += "\n\n```\n";
        inPre = true;
        break;
      case "blockquote":
        markdown += "\n\n";
        blockquotes.push(markdown.length);
        break;
      case "hr":
        markdown += "\n\n---\n\n";
        break;
      case "ul":
        lists.push({ type: "ul", count: 0 });
        break;
      case "ol":
        lists.push({ type: "ol", count: 0 });
        break;
      case "li": {
        const list = lists.at(-1) || { type: "ul", count: 0 };
        list.count += 1;
        markdown +=
          (markdown.endsWith("\n") ? "" : "\n") +
          "  ".repeat(Math.max(0, lists.length - 1)) +
          (list.type === "ol" ? list.count + ". " : "- ");
        break;
      }
      case "a":
        beginInline([]);
        frames.push(styleEmphasis(attributes));
        links.push(readHtmlAttribute(attributes, "href"));
        inline += "[";
        break;
    }
  }
  endBlock();

  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  return "";
}

/** Render inline Markdown (`**bold**`, `*italic*`, `~~del~~`, `` `code` ``, `[label](url)`) to safe HTML. */
export function inlineMarkdownToHtml(text: string): string {
  const tokens: string[] = [];
  const stash = (html: string) => {
    const id = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return id;
  };
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => stash(`<code>${code}</code>`));
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const href = safeHref(decodeHtml(url));
    if (!href) return label;
    return stash(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  });
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/\n/g, "<br>");
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)] ?? "");
}

function blockToHtml(block: DocBlock): string {
  if (block.type === "h2") {
    return `<h2>${inlineMarkdownToHtml(block.text)}</h2>`;
  }
  if (block.type === "callout") {
    const label = block.label?.trim();
    return `<aside data-works-callout="1"${label ? ` data-label="${escapeHtml(label)}"` : ""}>${
      label ? `<strong data-callout-label="1">${escapeHtml(label)}</strong>` : ""
    }<p>${inlineMarkdownToHtml(block.text)}</p></aside>`;
  }
  const lines = block.text.split("\n");
  if (lines.length > 0 && lines.every((l) => /^-\s+/.test(l))) {
    return `<ul>${lines.map((l) => `<li>${inlineMarkdownToHtml(l.replace(/^-\s+/, ""))}</li>`).join("")}</ul>`;
  }
  if (lines.length > 0 && lines.every((l) => /^\d+\.\s+/.test(l))) {
    return `<ol>${lines.map((l) => `<li>${inlineMarkdownToHtml(l.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
  }
  if (lines.length > 0 && lines.every((l) => /^>\s?/.test(l))) {
    return `<blockquote>${lines.map((l) => inlineMarkdownToHtml(l.replace(/^>\s?/, ""))).join("<br>")}</blockquote>`;
  }
  return `<p>${inlineMarkdownToHtml(block.text)}</p>`;
}

export function blocksToHtml(blocks: readonly DocBlock[]): string {
  if (!blocks.length) return "<p><br></p>";
  return blocks.map(blockToHtml).join("");
}

export function elementToDocBlock(node: Element): DocBlock | null {
  const tag = node.tagName.toUpperCase();
  if (tag === "H1" || tag === "H2" || tag === "H3") {
    const text = htmlToMarkdown(node.innerHTML).trim();
    return text ? { type: "h2", text } : null;
  }
  if (tag === "ASIDE" || node.hasAttribute("data-works-callout")) {
    const labelEl = node.querySelector("[data-callout-label]");
    const label = (node.getAttribute("data-label") ?? labelEl?.textContent ?? "").trim();
    const clone = node.cloneNode(true) as Element;
    clone.querySelector("[data-callout-label]")?.remove();
    const text = htmlToMarkdown(clone.innerHTML).trim();
    if (!text) return null;
    return label ? { type: "callout", label, text } : { type: "callout", text };
  }
  const md = htmlToMarkdown(node.outerHTML).trim();
  return md ? { type: "p", text: md } : null;
}

export function htmlRootToBlocks(root: Element): DocBlock[] {
  const blocks: DocBlock[] = [];
  for (const child of Array.from(root.children)) {
    const parsed = elementToDocBlock(child);
    if (parsed) blocks.push(parsed);
  }
  return blocks;
}

export const DOC_SIDECAR_LABEL = "__cfos_doc_v1__";
const MAX_SIDECAR_BYTES = 62 * 1024;

export interface CfosDocBlock {
  id: string;
  html: string;
}

export function visibleWorksDocBlocks(blocks: readonly DocBlock[]): DocBlock[] {
  return blocks.filter(
    (b) => !(b.type === "callout" && b.label === DOC_SIDECAR_LABEL),
  );
}

export function worksDocToCfos(blocks: readonly DocBlock[]): CfosDocBlock[] {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "callout" && b.label === DOC_SIDECAR_LABEL) {
      try {
        const parsed = JSON.parse(b.text);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every(
            (item) =>
              item &&
              typeof item === "object" &&
              typeof (item as CfosDocBlock).id === "string" &&
              typeof (item as CfosDocBlock).html === "string",
          )
        ) {
          return parsed as CfosDocBlock[];
        }
      } catch {
        // Fall through to upgrading visible Wire v0 blocks.
      }
    }
  }
  const visible = visibleWorksDocBlocks(blocks);
  if (!visible.length) return [{ id: "b_1", html: "<p><br></p>" }];
  return visible.map((block, index) => {
    const id = `b_${index + 1}`;
    const rawHtml = blockToHtml(block);
    const tagged = rawHtml.replace(/^<([a-z0-9]+)/i, `<$1 data-block-id="${id}"`);
    return { id, html: tagged };
  });
}

export function cfosBlocksToHtml(blocks: readonly CfosDocBlock[]): string {
  if (!blocks.length) return "<p><br></p>";
  return blocks.map((b) => b.html).join("");
}

function stripTagsToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3|blockquote|pre|aside)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function cfosBlockToFallbackWorksBlock(block: CfosDocBlock): DocBlock | null {
  const html = block.html.trim();
  if (!html) return null;
  if (/^<hr\b/i.test(html)) return { type: "p", text: "---" };
  if (/^<aside\b/i.test(html)) {
    const labelMatch = /data-label="([^"]+)"/i.exec(html);
    const label = labelMatch ? decodeHtml(labelMatch[1]).trim() : "";
    const withoutLabel = html.replace(/<strong[^>]*data-callout-label="1"[^>]*>[\s\S]*?<\/strong>/i, "");
    const text = (htmlToMarkdown(withoutLabel) || stripTagsToText(withoutLabel)).trim() || "Note";
    return label ? { type: "callout", label, text } : { type: "callout", text };
  }
  if (/^<h[1-3]\b/i.test(html)) {
    const inner = html.replace(/^<h[1-3]\b[^>]*>|<\/h[1-3]>$/gi, "");
    const text = (htmlToMarkdown(inner) || stripTagsToText(inner)).replace(/^#{1,6}\s+/, "").trim();
    return text ? { type: "h2", text } : null;
  }
  const md = htmlToMarkdown(html).trim() || stripTagsToText(html);
  if (md) return { type: "p", text: md };
  if (/<img\b/i.test(html)) return { type: "p", text: "[Image]" };
  return null;
}

function hasRichDocFormatting(blocks: readonly CfosDocBlock[]): boolean {
  return blocks.some((b) =>
    /<(?:h1|h3|blockquote|pre|hr|img|u|s|del|font|ul|ol|a|code)\b|style=|class="doc-title"|text-align/i.test(
      b.html,
    ),
  );
}

export function cfosDocToWorks(blocks: readonly CfosDocBlock[]): DocBlock[] {
  const out: DocBlock[] = [];
  for (const b of blocks) {
    const parsed = cfosBlockToFallbackWorksBlock(b);
    if (parsed) out.push(parsed);
  }
  if (!out.length) {
    out.push({ type: "p", text: " " });
  }
  if (hasRichDocFormatting(blocks) || blocks.length !== out.length) {
    const payload = JSON.stringify(blocks);
    const sidecar: DocBlock = {
      type: "callout",
      label: DOC_SIDECAR_LABEL,
      text: payload,
    };
    const candidate = [...out, sidecar];
    if (new TextEncoder().encode(JSON.stringify({ blocks: candidate })).length <= MAX_SIDECAR_BYTES) {
      return candidate;
    }
  }
  return out;
}

export function exportDocHtml(title: string, blocks: readonly CfosDocBlock[]): string {
  const body = cfosBlocksToHtml(blocks);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || "Untitled document")}</title>
<style>
  body { margin: 0; padding: 48px 24px; background: #ffffff; color: #1d1d20; font: 12pt/1.65 Inter, ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 740px; margin: 0 auto; }
  h1.doc-title { font-size: 28pt; font-weight: 750; line-height: 1.15; letter-spacing: -0.025em; margin: 0 0 18px; }
  h1 { font-size: 20pt; font-weight: 700; margin: 22px 0 8px; }
  h2 { font-size: 16pt; font-weight: 650; margin: 18px 0 6px; }
  h3 { font-size: 13pt; font-weight: 650; margin: 14px 0 4px; }
  p { margin: 0 0 10px; }
  blockquote { border-left: 3px solid #e1632e; padding: 2px 0 2px 14px; color: #55555e; margin: 10px 0; }
  aside[data-works-callout="1"] { border-left: 3px solid #e1632e; background: rgba(225, 99, 46, 0.08); padding: 10px 14px; border-radius: 6px; margin: 12px 0; }
  aside[data-works-callout="1"] [data-callout-label="1"] { display: block; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.04em; color: #e1632e; margin-bottom: 4px; }
  pre { background: #f4f4f6; padding: 10px 12px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 10.5pt; white-space: pre-wrap; }
  code { background: #f4f4f6; padding: 1px 4px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.9em; }
  hr { border: 0; border-top: 1px solid #d4d4d8; margin: 16px 0; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  a { color: #e1632e; }
</style>
</head>
<body>
<main>${body}</main>
</body>
</html>`;
}

export function docToMarkdown(title: string, blocks: readonly DocBlock[]): string {
  const lines: string[] = [];
  if (title.trim()) lines.push(`# ${title.trim()}`);
  for (const b of visibleWorksDocBlocks(blocks)) {
    if (!b.text.trim()) continue;
    if (b.type === "h2") lines.push(`## ${b.text.trim()}`);
    else if (b.type === "callout") {
      const prefix = b.label?.trim() ? `> **${b.label.trim()}**: ` : "> ";
      lines.push(prefix + b.text.trim().replace(/\n/g, "\n> "));
    } else {
      lines.push(b.text.trim());
    }
  }
  return lines.join("\n\n") + "\n";
}

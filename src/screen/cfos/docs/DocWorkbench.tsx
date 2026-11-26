// Ported from cloudflare-os workspace-docs/files/client.ts

import { useEffect, useRef } from "react";
import type { DocBlock } from "../../domain/works";
import { el, icon } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { promptInline } from "../ui/prompt";
import { customSelect, group, iconBtn, type CustomSelect } from "../ui/toolbar";
import { blocksToHtml, docToMarkdown, htmlRootToBlocks } from "./codec";

export interface DocLabels {
  blockStyle: string;
  paragraph: string;
  heading: string;
  callout: string;
  calloutPrompt: string;
  calloutPlaceholder: string;
  undo: string;
  redo: string;
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  code: string;
  bullets: string;
  numbered: string;
  link: string;
  linkPrompt: string;
  clearFormat: string;
  copyMarkdown: string;
  copied: string;
  emptyPlaceholder: string;
}

interface InlineFormat {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  code?: boolean;
  href?: string;
}

const BLOCK_TAGS = ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "UL", "OL", "LI", "ASIDE"];

function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1;
}

function isText(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === 3;
}

function escapeText(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtOf(node: Element, ctx: InlineFormat): InlineFormat {
  const next: InlineFormat = { ...ctx };
  const tag = node.tagName;
  if (tag === "B" || tag === "STRONG") next.b = true;
  if (tag === "I" || tag === "EM") next.i = true;
  if (tag === "U") next.u = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.s = true;
  if (tag === "CODE") next.code = true;
  if (tag === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) next.href = href;
  }
  const style = (node.getAttribute("style") ?? "").toLowerCase();
  if (/font-weight\s*:\s*(bold|bolder|[6-9]00)\b/.test(style)) next.b = true;
  if (/font-style\s*:\s*(italic|oblique)\b/.test(style)) next.i = true;
  if (/text-decoration(-line)?\s*:[^;]*underline/.test(style)) next.u = true;
  if (/text-decoration(-line)?\s*:[^;]*line-through/.test(style)) next.s = true;
  return next;
}

function wrapInline(text: string, ctx: InlineFormat): Node {
  let node: Node = document.createTextNode(text);
  const wrap = (tag: string, attrs?: Record<string, string>) => {
    const elNode = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) elNode.setAttribute(k, v);
    elNode.appendChild(node);
    node = elNode;
  };
  if (ctx.code) wrap("code");
  if (ctx.b) wrap("strong");
  if (ctx.i) wrap("em");
  if (ctx.u) wrap("u");
  if (ctx.s) wrap("del");
  if (ctx.href) wrap("a", { href: ctx.href, target: "_blank", rel: "noopener noreferrer" });
  return node;
}

function sanitizePastedHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const result = document.createElement("div");

  function appendInline(src: Node, target: Node, ctx: InlineFormat) {
    src.childNodes.forEach((child) => {
      if (isText(child)) {
        if (child.textContent) target.appendChild(wrapInline(child.textContent, ctx));
      } else if (isElement(child)) {
        const tag = child.tagName;
        if (tag === "BR") target.appendChild(document.createElement("br"));
        else if (tag === "HR" || tag === "STYLE" || tag === "SCRIPT" || tag === "IMG") return;
        else appendInline(child, target, fmtOf(child, ctx));
      }
    });
  }

  function processList(src: Element, ctx: InlineFormat): HTMLElement {
    const list = document.createElement(src.tagName === "OL" ? "ol" : "ul");
    src.childNodes.forEach((child) => {
      if (!isElement(child)) return;
      if (child.tagName === "LI") {
        const li = document.createElement("li");
        const nested: Element[] = [];
        child.childNodes.forEach((g) => {
          if (isElement(g) && (g.tagName === "UL" || g.tagName === "OL")) nested.push(g);
          else if (isText(g)) {
            if (g.textContent) li.appendChild(wrapInline(g.textContent, ctx));
          } else if (isElement(g)) appendInline(g, li, fmtOf(g, ctx));
        });
        nested.forEach((n) => li.appendChild(processList(n, ctx)));
        list.appendChild(li);
      } else if (child.tagName === "UL" || child.tagName === "OL") {
        list.appendChild(processList(child, ctx));
      }
    });
    return list;
  }

  function processNodes(nodes: Node[], ctx: InlineFormat) {
    nodes.forEach((node) => {
      if (isText(node)) {
        if (node.textContent && node.textContent.trim()) {
          const p = document.createElement("p");
          p.appendChild(wrapInline(node.textContent, ctx));
          result.appendChild(p);
        }
        return;
      }
      if (!isElement(node)) return;
      const tag = node.tagName;
      if (tag === "STYLE" || tag === "SCRIPT" || tag === "META" || tag === "BR" || tag === "IMG") return;
      if (tag === "UL" || tag === "OL") {
        result.appendChild(processList(node, ctx));
        return;
      }
      if (["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE"].includes(tag)) {
        const out = tag.startsWith("H") ? "h2" : tag.toLowerCase();
        const block = document.createElement(out);
        appendInline(node, block, ctx);
        if (block.textContent?.trim() || block.querySelector("br")) result.appendChild(block);
        return;
      }
      const newCtx = fmtOf(node, ctx);
      const hasBlockChild = Array.from(node.childNodes).some(
        (c) => isElement(c) && BLOCK_TAGS.includes(c.tagName),
      );
      if (hasBlockChild) {
        processNodes(Array.from(node.childNodes), newCtx);
      } else {
        const p = document.createElement("p");
        appendInline(node, p, newCtx);
        if (p.textContent?.trim() || p.querySelector("br")) result.appendChild(p);
      }
    });
  }

  processNodes(Array.from(parsed.body.childNodes), {});
  return result.innerHTML;
}

export function DocWorkbench({
  title,
  blocks,
  readOnly,
  resetKey,
  labels,
  onChange,
}: {
  title: string;
  blocks: readonly DocBlock[];
  readOnly: boolean;
  resetKey: number;
  labels: DocLabels;
  onChange: (next: DocBlock[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const titleRef = useRef(title);
  titleRef.current = title;
  const latestBlocksRef = useRef<readonly DocBlock[]>(blocks);
  latestBlocksRef.current = blocks;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const styleSelRef = useRef<CustomSelect | null>(null);

  useEffect(() => {
    const mount = hostRef.current;
    if (!mount) return;
    mount.innerHTML = "";

    const app = el("div", { class: "cfos-doc-app" });
    const toolbar = el("div", { class: "cfos-toolbar" });
    const canvas = el("div", { class: "cfos-doc-canvas" });
    const editor = el("div", {
      class: "cfos-doc-page",
      contenteditable: readOnly ? "false" : "true",
      spellcheck: "true",
      "data-placeholder": labels.emptyPlaceholder,
    });
    editorRef.current = editor;
    editor.innerHTML = blocksToHtml(latestBlocksRef.current);

    const normalizeRoot = () => {
      for (const node of Array.from(editor.childNodes)) {
        if (isText(node) || (isElement(node) && node.tagName === "BR")) {
          const p = document.createElement("p");
          if (isText(node)) p.textContent = node.textContent;
          else p.appendChild(document.createElement("br"));
          editor.replaceChild(p, node);
        }
      }
      if (!editor.children.length) {
        const p = document.createElement("p");
        p.appendChild(document.createElement("br"));
        editor.appendChild(p);
      }
    };

    const emit = () => {
      normalizeRoot();
      const parsed = htmlRootToBlocks(editor);
      latestBlocksRef.current = parsed;
      onChangeRef.current(parsed);
    };

    const currentBlock = (): HTMLElement | null => {
      const sel = window.getSelection();
      let node = sel?.anchorNode ?? null;
      if (!node || !editor.contains(node)) return null;
      if (!isElement(node)) node = node.parentElement;
      while (node && node.parentElement !== editor) node = node.parentElement;
      return node && node.parentElement === editor ? (node as HTMLElement) : null;
    };

    const exec = (cmd: string, value?: string) => {
      if (readOnly) return;
      editor.focus();
      try {
        document.execCommand(cmd, false, value);
      } catch {
        // unsupported command
      }
      refreshState();
      emit();
    };

    const styleSel = customSelect({
      className: "cfos-style-sel",
      title: labels.blockStyle,
      value: "p",
      options: [
        { value: "p", label: labels.paragraph },
        { value: "h2", label: labels.heading },
        { value: "callout", label: labels.callout },
      ],
      onChange: async (val) => {
        if (readOnly) return;
        const blk = currentBlock();
        if (val === "callout") {
          const existing = blk?.getAttribute("data-label") ?? "";
          const label = await promptInline(labels.calloutPrompt, existing, {
            placeholder: labels.calloutPlaceholder,
          });
          if (label === null) {
            refreshState();
            return;
          }
          const target = blk ?? editor.firstElementChild;
          if (target) {
            const aside = document.createElement("aside");
            aside.setAttribute("data-works-callout", "1");
            const clean = label.trim();
            if (clean) {
              aside.setAttribute("data-label", clean);
              const strong = document.createElement("strong");
              strong.setAttribute("data-callout-label", "1");
              strong.textContent = clean;
              aside.appendChild(strong);
            }
            const p = document.createElement("p");
            p.textContent = target.textContent || "";
            if (!p.textContent) p.appendChild(document.createElement("br"));
            aside.appendChild(p);
            target.replaceWith(aside);
            emit();
          }
          return;
        }
        if (blk && (blk.tagName === "ASIDE" || blk.hasAttribute("data-works-callout"))) {
          const clone = blk.cloneNode(true) as Element;
          clone.querySelector("[data-callout-label]")?.remove();
          const repl = document.createElement(val === "h2" ? "h2" : "p");
          repl.textContent = clone.textContent ?? "";
          if (!repl.textContent) repl.appendChild(document.createElement("br"));
          blk.replaceWith(repl);
          emit();
          return;
        }
        exec("formatBlock", val === "h2" ? "<h2>" : "<p>");
      },
    });
    styleSelRef.current = styleSel;

    const undoBtn = iconBtn(ICONS.undo, labels.undo, () => exec("undo"));
    const redoBtn = iconBtn(ICONS.redo, labels.redo, () => exec("redo"));
    const boldBtn = iconBtn(ICONS.bold, labels.bold, () => exec("bold"));
    const italicBtn = iconBtn(ICONS.italic, labels.italic, () => exec("italic"));
    const underlineBtn = iconBtn(ICONS.underline, labels.underline, () => exec("underline"));
    const strikeBtn = iconBtn(ICONS.strike, labels.strike, () => exec("strikeThrough"));
    const codeBtn = iconBtn(ICONS.code, labels.code, () => {
      if (readOnly) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const text = sel.toString();
      if (!text) return;
      exec("insertHTML", `<code>${escapeText(text)}</code>`);
    });
    const ulBtn = iconBtn(ICONS.ul, labels.bullets, () => exec("insertUnorderedList"));
    const olBtn = iconBtn(ICONS.ol, labels.numbered, () => exec("insertOrderedList"));
    const linkBtn = iconBtn(ICONS.link, labels.link, async () => {
      if (readOnly) return;
      const sel = window.getSelection();
      const saved = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      const url = await promptInline(labels.linkPrompt, "https://", { placeholder: "https://" });
      if (!url || !/^(https?:|mailto:)/i.test(url.trim())) return;
      editor.focus();
      if (saved && sel) {
        sel.removeAllRanges();
        sel.addRange(saved);
      }
      exec("createLink", url.trim());
    });
    const clearBtn = iconBtn(ICONS.clear, labels.clearFormat, () => exec("removeFormat"));
    const copyMdBtn = iconBtn(ICONS.copy, labels.copyMarkdown, () => {
      const md = docToMarkdown(titleRef.current, latestBlocksRef.current);
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(md);
      }
      copyMdBtn.innerHTML = icon(ICONS.check);
      copyMdBtn.classList.add("active");
      setTimeout(() => {
        copyMdBtn.innerHTML = icon(ICONS.copy);
        copyMdBtn.classList.remove("active");
      }, 1200);
    });

    if (!readOnly) {
      toolbar.append(
        group(null, [undoBtn, redoBtn], true),
        group(null, [styleSel.el]),
        group(null, [boldBtn, italicBtn, underlineBtn, strikeBtn, codeBtn]),
        group("p1", [ulBtn, olBtn]),
        group("p1", [linkBtn, clearBtn]),
        group("p2", [copyMdBtn]),
      );
      app.appendChild(toolbar);
    }

    canvas.appendChild(editor);
    app.appendChild(canvas);
    mount.appendChild(app);

    const refreshState = () => {
      try {
        boldBtn.classList.toggle("active", document.queryCommandState("bold"));
        italicBtn.classList.toggle("active", document.queryCommandState("italic"));
        underlineBtn.classList.toggle("active", document.queryCommandState("underline"));
        strikeBtn.classList.toggle("active", document.queryCommandState("strikeThrough"));
        ulBtn.classList.toggle("active", document.queryCommandState("insertUnorderedList"));
        olBtn.classList.toggle("active", document.queryCommandState("insertOrderedList"));
      } catch {
        // ignore
      }
      const blk = currentBlock();
      if (blk) {
        if (blk.tagName === "ASIDE" || blk.hasAttribute("data-works-callout")) styleSel.setValue("callout");
        else if (blk.tagName === "H1" || blk.tagName === "H2" || blk.tagName === "H3") styleSel.setValue("h2");
        else styleSel.setValue("p");
      }
    };

    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // ignore
    }

    const onInput = () => {
      if (readOnly) return;
      emit();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly) return;
      const cb = e.clipboardData;
      if (!cb) return;
      e.preventDefault();
      const html = cb.getData("text/html");
      if (html && html.trim()) {
        document.execCommand("insertHTML", false, sanitizePastedHtml(html));
      } else {
        const text = cb.getData("text/plain") || "";
        document.execCommand("insertHTML", false, escapeText(text).replace(/\r?\n/g, "<br>"));
      }
      refreshState();
      emit();
    };
    let selQueued = false;
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel?.anchorNode || !editor.contains(sel.anchorNode)) return;
      if (selQueued) return;
      selQueued = true;
      requestAnimationFrame(() => {
        selQueued = false;
        refreshState();
      });
    };

    editor.addEventListener("input", onInput);
    editor.addEventListener("paste", onPaste);
    document.addEventListener("selectionchange", onSel);

    return () => {
      editor.removeEventListener("input", onInput);
      editor.removeEventListener("paste", onPaste);
      document.removeEventListener("selectionchange", onSel);
      styleSel.destroy();
      styleSelRef.current = null;
      editorRef.current = null;
    };
  }, [readOnly, resetKey, labels]);

  return <div ref={hostRef} className="cfos-workbench-host" />;
}

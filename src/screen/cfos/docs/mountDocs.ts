// Ported from cloudflare-os workspace-docs/files/client.ts

import type { DocBlock } from "../../domain/works";
import { sanitizeFileName, triggerDownload } from "../ui/download";
import { el, icon } from "../ui/dom";
import { ICONS, type IconName } from "../ui/icons";
import { imageFilesFrom, isImageFile, prepareImage, type PreparedImage } from "../ui/images";
import { promptInline, type PromptOptions } from "../ui/prompt";
import {
  bindActionMenu,
  colorBtn,
  customSelect,
  group,
  iconBtn,
  segBtn,
  type CustomSelect,
  type CustomSelectOptions,
} from "../ui/toolbar";
import {
  cfosBlocksToHtml,
  cfosDocToWorks,
  docToMarkdown,
  escapeHtml,
  exportDocHtml,
  worksDocToCfos,
  type CfosDocBlock,
} from "./codec";

export interface DocLabels {
  blockStyle: string;
  paragraph: string;
  titleStyle: string;
  heading1: string;
  heading: string;
  heading3: string;
  quote: string;
  codeBlock: string;
  callout: string;
  calloutPrompt: string;
  calloutPlaceholder: string;
  fontLabel: string;
  fontSizeLabel: string;
  undo: string;
  redo: string;
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  code: string;
  textColor: string;
  highlightColor: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignJustify: string;
  outdent: string;
  indent: string;
  bullets: string;
  numbered: string;
  link: string;
  linkPrompt: string;
  linkEdit: string;
  linkRemove: string;
  insertImage: string;
  horizontalRule: string;
  clearFormat: string;
  exportMenu: string;
  copyMarkdown: string;
  downloadMarkdown: string;
  downloadHtml: string;
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

const BLOCK_TAGS = [
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "UL",
  "OL",
  "LI",
  "DIV",
  "ASIDE",
];

function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1;
}

function isText(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === 3;
}

function escapeText(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeHref(url: string): string {
  let href = (url || "").trim();
  if (href && !/^(https?:|mailto:|tel:|#|\/)/i.test(href)) href = "https://" + href;
  return href;
}

function isSafeImageDataUrl(src: string): boolean {
  return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src || "");
}

function sanitizeImageElement(srcImg: Element): HTMLImageElement | null {
  const src = srcImg.getAttribute("src") || "";
  if (!isSafeImageDataUrl(src)) return null;
  const img = document.createElement("img");
  img.className = "cfos-doc-image";
  img.draggable = true;
  img.src = src;
  img.alt = srcImg.getAttribute("alt") || "Image";
  const styleWidth = (srcImg.getAttribute("style") || "").match(/width\s*:\s*([0-9.]+)px/i);
  const attrWidth = parseInt(srcImg.getAttribute("width") || "", 10);
  const width = styleWidth ? parseFloat(styleWidth[1]) : attrWidth;
  if (width && width > 0) img.style.width = Math.min(720, Math.max(40, Math.round(width))) + "px";
  img.style.height = "auto";
  return img;
}

function fmtOf(node: Element, ctx: InlineFormat): InlineFormat {
  const next: InlineFormat = { ...ctx };
  const tag = node.tagName;
  if (tag === "B" || tag === "STRONG") next.b = true;
  if (tag === "I" || tag === "EM") next.i = true;
  if (tag === "U" || tag === "INS") next.u = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.s = true;
  if (tag === "CODE" || tag === "TT") next.code = true;
  if (tag === "A") {
    const href = node.getAttribute("href") ?? ctx.href;
    if (href && /^(https?:|mailto:|tel:|#|\/)/i.test(href.trim())) next.href = href.trim();
  }
  const style = (node.getAttribute("style") ?? "").toLowerCase();
  if (/font-weight\s*:\s*(bold|bolder|[6-9]00)/.test(style)) next.b = true;
  else if (/font-weight\s*:\s*(normal|[1-4]00)/.test(style)) next.b = false;
  if (/font-style\s*:\s*italic/.test(style)) next.i = true;
  else if (/font-style\s*:\s*normal/.test(style)) next.i = false;
  if (/text-decoration[^;]*underline/.test(style)) next.u = true;
  if (/text-decoration[^;]*line-through/.test(style)) next.s = true;
  return next;
}

function wrapEl(tag: string, child: Node): HTMLElement {
  const node = document.createElement(tag);
  node.appendChild(child);
  return node;
}

function wrapInline(text: string, ctx: InlineFormat): Node {
  let node: Node = document.createTextNode(text);
  if (ctx.code) node = wrapEl("code", node);
  if (ctx.s) node = wrapEl("s", node);
  if (ctx.u) node = wrapEl("u", node);
  if (ctx.i) node = wrapEl("i", node);
  if (ctx.b) node = wrapEl("b", node);
  if (ctx.href) {
    const a = document.createElement("a");
    a.setAttribute("href", normalizeHref(ctx.href));
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.appendChild(node);
    node = a;
  }
  return node;
}

export function sanitizePastedHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const result = document.createElement("div");

  function appendInline(src: Node, target: Node, ctx: InlineFormat) {
    src.childNodes.forEach((child) => {
      if (isText(child)) {
        if (child.textContent) target.appendChild(wrapInline(child.textContent, ctx));
      } else if (isElement(child)) {
        const tag = child.tagName;
        if (tag === "BR") target.appendChild(document.createElement("br"));
        else if (tag === "IMG") {
          const img = sanitizeImageElement(child);
          if (img) target.appendChild(img);
        } else if (tag === "HR" || tag === "STYLE" || tag === "SCRIPT") return;
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
      if (tag === "STYLE" || tag === "SCRIPT" || tag === "META" || tag === "BR") return;
      if (tag === "HR") {
        result.appendChild(document.createElement("hr"));
        return;
      }
      if (tag === "IMG") {
        const img = sanitizeImageElement(node);
        if (img) {
          const p = document.createElement("p");
          p.appendChild(img);
          result.appendChild(p);
        }
        return;
      }
      if (tag === "UL" || tag === "OL") {
        result.appendChild(processList(node, ctx));
        return;
      }
      if (["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE"].includes(tag)) {
        let out = tag.toLowerCase();
        if (out === "h4" || out === "h5" || out === "h6") out = "h3";
        const block = document.createElement(out);
        appendInline(node, block, ctx);
        if (block.textContent?.trim() || block.querySelector("br, img")) result.appendChild(block);
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
        if (p.textContent?.trim() || p.querySelector("br, img")) result.appendChild(p);
      }
    });
  }

  processNodes(Array.from(parsed.body.childNodes), {});
  return result.innerHTML;
}

function newBlockId(): string {
  return "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export interface MountDocsOptions {
  host: HTMLElement;
  blocks: readonly DocBlock[];
  documentTitle?: string;
  readOnly: boolean;
  labels: DocLabels;
  onChange: (blocks: DocBlock[]) => void;
}

export interface MountedDocsHandle {
  updateExternal: (blocks: readonly DocBlock[], title?: string) => void;
  destroy: () => void;
}

export function mountDocs({
  host,
  blocks,
  documentTitle = "",
  readOnly,
  labels,
  onChange,
}: MountDocsOptions): MountedDocsHandle {
  let currentTitle = documentTitle;
  let lastSerialized = JSON.stringify(blocks);
  let savedRange: Range | null = null;
  let caretSize: { pt: number; node: Node; offset: number } | null = null;
  let selectedImage: HTMLImageElement | null = null;
  let resizingImage = false;
  let draggedImage: HTMLImageElement | null = null;
  let activeLink: Element | null = null;

  const editor = el("div", {
    class: "cfos-doc-page",
    contenteditable: readOnly ? "false" : "true",
    spellcheck: readOnly ? "false" : "true",
    "data-placeholder": labels.emptyPlaceholder,
  });

  const hydrate = (incoming: readonly DocBlock[]) => {
    const cfosBlocks = worksDocToCfos(incoming);
    editor.innerHTML = cfosBlocksToHtml(cfosBlocks);
    normalizeBlocks();
  };

  const getRange = (): Range | null => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      return sel.getRangeAt(0).cloneRange();
    }
    return savedRange;
  };

  const restoreRange = () => {
    if (!savedRange) return;
    try {
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } catch {
      // Ignore detached range errors.
    }
  };

  const currentBlock = (): Element | null => {
    const sel = window.getSelection();
    let node: Node | null | undefined = sel?.anchorNode ?? null;
    while (node && node !== editor) {
      if (
        isElement(node) &&
        ["P", "H1", "H2", "H3", "BLOCKQUOTE", "PRE", "LI", "DIV", "ASIDE"].includes(node.tagName)
      ) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  };

  const currentLink = (): Element | null => {
    const sel = window.getSelection();
    let node: Node | null | undefined = sel?.anchorNode ?? null;
    while (node && node !== editor) {
      if (isElement(node) && node.tagName === "A") return node;
      node = node.parentNode;
    }
    return null;
  };

  const selectNode = (node: Node) => {
    const range = document.createRange();
    range.selectNode(node);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  };

  function normalizeBlocks() {
    for (const node of Array.from(editor.childNodes)) {
      if (isText(node) || (isElement(node) && node.tagName === "BR")) {
        const p = document.createElement("p");
        if (isText(node)) p.textContent = node.textContent;
        else p.appendChild(document.createElement("br"));
        editor.replaceChild(p, node);
      }
    }
    const seen = new Set<string>();
    for (const node of Array.from(editor.children)) {
      let id = node.getAttribute("data-block-id");
      if (!id || seen.has(id)) {
        id = newBlockId();
        node.setAttribute("data-block-id", id);
      }
      seen.add(id);
    }
  }

  const collectCfosBlocks = (): CfosDocBlock[] => {
    normalizeBlocks();
    const out: CfosDocBlock[] = [];
    for (const child of Array.from(editor.children)) {
      const id = child.getAttribute("data-block-id") || newBlockId();
      out.push({ id, html: child.outerHTML });
    }
    return out;
  };

  const emit = () => {
    if (readOnly) return;
    const next = cfosDocToWorks(collectCfosBlocks());
    const serialized = JSON.stringify(next);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    onChange(next);
  };

  // --- Link popover --------------------------------------------------------
  const linkPopUrl = el("a", {
    class: "cfos-lp-url",
    target: "_blank",
    rel: "noopener noreferrer",
  });
  const linkPopEdit = el("button", { type: "button", class: "cfos-lp-btn" }, labels.linkEdit);
  const linkPopRemove = el(
    "button",
    { type: "button", class: "cfos-lp-btn danger" },
    labels.linkRemove,
  );
  const linkPop = el("div", { class: "cfos-link-pop" }, [
    linkPopUrl,
    el("span", { class: "cfos-lp-div" }),
    linkPopEdit,
    linkPopRemove,
  ]);
  linkPop.style.display = "none";

  const hideLinkPopover = () => {
    activeLink = null;
    linkPop.style.display = "none";
  };

  const positionLinkPopover = (anchor: Element) => {
    const r = anchor.getBoundingClientRect();
    linkPop.style.visibility = "hidden";
    linkPop.style.display = "flex";
    const pw = linkPop.offsetWidth;
    const ph = linkPop.offsetHeight;
    const left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - pw - 8));
    let top = Math.round(r.bottom + 6);
    if (top + ph > window.innerHeight - 8) top = Math.round(r.top - ph - 6);
    linkPop.style.left = left + "px";
    linkPop.style.top = top + "px";
    linkPop.style.visibility = "visible";
  };

  const updateLinkPopover = () => {
    if (readOnly) return hideLinkPopover();
    const a = currentLink();
    if (a && editor.contains(a)) {
      activeLink = a;
      const href = a.getAttribute("href") || "";
      linkPopUrl.textContent = href.replace(/^mailto:/i, "");
      linkPopUrl.setAttribute("href", href);
      positionLinkPopover(a);
    } else {
      hideLinkPopover();
    }
  };

  const linkPromptOpts: PromptOptions = { placeholder: "https://" };
  const editLink = async (anchor: Element) => {
    const url = await promptInline(labels.linkPrompt, anchor.getAttribute("href") || "", linkPromptOpts);
    if (url === null) return;
    selectNode(anchor);
    if (url.trim() === "") document.execCommand("unlink", false, undefined);
    else document.execCommand("createLink", false, normalizeHref(url));
    hideLinkPopover();
    editor.focus();
    emit();
  };

  const removeLink = (anchor: Element) => {
    selectNode(anchor);
    document.execCommand("unlink", false, undefined);
    hideLinkPopover();
    editor.focus();
    emit();
  };

  linkPop.addEventListener("mousedown", (e) => {
    if (e.target !== linkPopUrl) e.preventDefault();
  });
  linkPopEdit.addEventListener("click", () => {
    if (activeLink) void editLink(activeLink);
  });
  linkPopRemove.addEventListener("click", () => {
    if (activeLink) removeLink(activeLink);
  });

  // --- Image controls & resize --------------------------------------------
  const resizeHandle = el("div", { class: "cfos-doc-img-handle" });
  const imageControls = el("div", { class: "cfos-doc-img-controls" }, [resizeHandle]);
  imageControls.style.display = "none";

  const positionImageControls = () => {
    if (!selectedImage || !editor.contains(selectedImage) || resizingImage) return;
    const r = selectedImage.getBoundingClientRect();
    imageControls.style.left = Math.round(r.left) + "px";
    imageControls.style.top = Math.round(r.top) + "px";
    imageControls.style.width = Math.round(r.width) + "px";
    imageControls.style.height = Math.round(r.height) + "px";
    imageControls.style.display = "block";
  };

  const hideImageControls = () => {
    if (selectedImage) selectedImage.classList.remove("image-selected");
    selectedImage = null;
    imageControls.style.display = "none";
  };

  const selectImage = (img: HTMLImageElement) => {
    if (readOnly) return;
    if (selectedImage === img) {
      positionImageControls();
      return;
    }
    hideLinkPopover();
    if (selectedImage) selectedImage.classList.remove("image-selected");
    selectedImage = img;
    selectedImage.classList.add("image-selected");
    positionImageControls();
  };

  const insertImageDataUrl = ({ src, width, alt }: PreparedImage) => {
    if (!isSafeImageDataUrl(src)) return;
    restoreRange();
    const displayWidth = Math.min(width || 480, Math.max(220, editor.clientWidth - 64));
    const html = `<img class="cfos-doc-image" draggable="true" src="${src}" alt="${escapeHtml(
      alt || "Image",
    )}" style="width:${Math.round(displayWidth)}px;height:auto;">`;
    document.execCommand("insertHTML", false, html);
    savedRange = getRange();
  };

  const insertImageFiles = async (files: File[]) => {
    if (readOnly) return;
    const imageFiles = files.filter(isImageFile);
    if (!imageFiles.length) return;
    hideLinkPopover();
    hideImageControls();
    for (const file of imageFiles) {
      try {
        insertImageDataUrl(await prepareImage(file, { alt: file.name || "Image" }));
      } catch {
        // Keep editing intact if an individual image still exceeds the 64 KiB cap.
      }
    }
    editor.focus();
    refreshToolbarState();
    emit();
  };

  resizeHandle.addEventListener("mousedown", (e) => {
    if (!selectedImage || readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    resizingImage = true;
    const img = selectedImage;
    const startX = e.clientX;
    const startWidth = img.getBoundingClientRect().width;
    const maxW = Math.max(120, editor.getBoundingClientRect().width - 40);
    imageControls.style.display = "none";

    const move = (ev: MouseEvent) => {
      const next = Math.max(80, Math.min(maxW, startWidth + ev.clientX - startX));
      img.style.width = Math.round(next) + "px";
      img.style.height = "auto";
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      resizingImage = false;
      positionImageControls();
      emit();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  // --- Toolbar (full cloudflare-os Controls) -------------------------------
  const toolbarSelect = (opts: CustomSelectOptions): CustomSelect => {
    const sel = customSelect(opts);
    sel.el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      savedRange = getRange();
    });
    return sel;
  };

  const styleSel = toolbarSelect({
    className: "cfos-style-sel",
    title: labels.blockStyle,
    value: "P",
    options: [
      { value: "P", label: labels.paragraph },
      { value: "TITLE", label: labels.titleStyle, style: "font-size:16px;font-weight:750;" },
      { value: "H1", label: labels.heading1, style: "font-size:15px;font-weight:700;" },
      { value: "H2", label: labels.heading, style: "font-size:14px;font-weight:650;" },
      { value: "H3", label: labels.heading3, style: "font-size:13px;font-weight:600;" },
      { sep: true },
      { value: "BLOCKQUOTE", label: labels.quote },
      { value: "PRE", label: labels.codeBlock },
      { value: "CALLOUT", label: labels.callout },
    ],
    onChange: async (value) => {
      restoreRange();
      if (value === "CALLOUT") {
        const block = currentBlock();
        const existingText = block?.textContent?.trim() || labels.calloutPlaceholder;
        const labelText = await promptInline(labels.calloutPrompt, "");
        if (labelText === null) return;
        const trimmedLabel = labelText.trim();
        const aside = document.createElement("aside");
        aside.setAttribute("data-works-callout", "1");
        aside.setAttribute("data-block-id", newBlockId());
        if (trimmedLabel) {
          aside.setAttribute("data-label", trimmedLabel);
          const strong = document.createElement("strong");
          strong.setAttribute("data-callout-label", "1");
          strong.textContent = trimmedLabel;
          aside.appendChild(strong);
        }
        const p = document.createElement("p");
        p.textContent = existingText;
        aside.appendChild(p);
        if (block && block.parentElement === editor) {
          editor.replaceChild(aside, block);
        } else {
          editor.appendChild(aside);
        }
        editor.focus();
        refreshToolbarState();
        emit();
        return;
      }

      const active = currentBlock();
      if (active && active.tagName === "ASIDE") {
        const clone = active.cloneNode(true) as Element;
        clone.querySelector("[data-callout-label]")?.remove();
        const p = document.createElement(value === "TITLE" ? "h1" : value.toLowerCase());
        if (value === "TITLE") p.classList.add("doc-title");
        p.setAttribute("data-block-id", active.getAttribute("data-block-id") || newBlockId());
        p.textContent = clone.textContent?.trim() || "";
        editor.replaceChild(p, active);
        editor.focus();
        refreshToolbarState();
        emit();
        return;
      }

      if (value === "TITLE") {
        document.execCommand("formatBlock", false, "H1");
        const b = currentBlock();
        if (b && b.tagName === "H1") b.classList.add("doc-title");
      } else {
        if (active) active.classList.remove("doc-title");
        document.execCommand("formatBlock", false, value);
      }
      editor.focus();
      refreshToolbarState();
      emit();
    },
  });

  const fontSel = toolbarSelect({
    className: "cfos-font-sel",
    title: labels.fontLabel,
    value: "ui-sans-serif, system-ui, Inter, sans-serif",
    options: [
      ["Sans serif", "ui-sans-serif, system-ui, Inter, sans-serif"],
      ["Serif", "Georgia, 'Times New Roman', serif"],
      ["Mono", "ui-monospace, 'SF Mono', Menlo, monospace"],
      ["Inter", "Inter, system-ui, sans-serif"],
      ["Georgia", "Georgia, serif"],
      ["Courier", "'Courier New', monospace"],
    ].map(([label, val]) => ({ value: val, label, style: "font-family:" + val + ";" })),
    onChange: (value) => {
      restoreRange();
      document.execCommand("fontName", false, value);
      editor.focus();
      emit();
    },
  });

  const applyFontSize = (pt: number) => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    editor.querySelectorAll<HTMLElement>('font[size], [style*="xxx-large"]').forEach((f) => {
      if (!range?.intersectsNode(f)) return;
      f.style.fontSize = getComputedStyle(f).fontSize;
      f.removeAttribute("size");
    });
    const untouched = new Set(editor.querySelectorAll('font[size="7"]'));
    document.execCommand("styleWithCSS", false, "false");
    try {
      document.execCommand("fontSize", false, "7");
    } finally {
      document.execCommand("styleWithCSS", false, "true");
    }
    editor.querySelectorAll<HTMLFontElement>('font[size="7"]').forEach((f) => {
      if (untouched.has(f)) return;
      f.removeAttribute("size");
      f.style.fontSize = pt + "pt";
    });
    if (range?.collapsed && selection?.focusNode) {
      caretSize = { pt, node: selection.focusNode, offset: selection.focusOffset };
    }
  };

  const atSizedCaret = (): boolean => {
    const sel = window.getSelection();
    return (
      !!caretSize &&
      !!sel?.isCollapsed &&
      sel.focusNode === caretSize.node &&
      sel.focusOffset === caretSize.offset
    );
  };

  const sizeSel = toolbarSelect({
    className: "cfos-size-sel",
    title: labels.fontSizeLabel,
    value: 12,
    showUnlistedValue: true,
    options: [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48].map((s) => ({
      value: s,
      label: String(s),
    })),
    onChange: (value) => {
      restoreRange();
      applyFontSize(parseInt(value, 10) || 12);
      editor.focus();
      emit();
    },
  });

  const cmdBtn = (iconName: IconName, title: string, command: string, val?: string) =>
    iconBtn(ICONS[iconName], title, () => {
      document.execCommand(command, false, val);
      editor.focus();
      refreshToolbarState();
      emit();
    });

  const undoBtn = iconBtn(ICONS.undo, labels.undo, () => {
    document.execCommand("undo");
    editor.focus();
    emit();
  });
  const redoBtn = iconBtn(ICONS.redo, labels.redo, () => {
    document.execCommand("redo");
    editor.focus();
    emit();
  });

  const boldBtn = cmdBtn("bold", labels.bold, "bold");
  const italicBtn = cmdBtn("italic", labels.italic, "italic");
  const underlineBtn = cmdBtn("underline", labels.underline, "underline");
  const strikeBtn = cmdBtn("strike", labels.strike, "strikeThrough");
  const codeBtn = iconBtn(ICONS.code, labels.code, () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const text = sel.toString();
    if (!text) return;
    document.execCommand("insertHTML", false, `<code>${escapeText(text)}</code>`);
    editor.focus();
    emit();
  });

  const commandColor = (iconName: IconName, title: string, cmd: string, def: string) => {
    const btn = colorBtn(ICONS[iconName], title, def, (color) => {
      restoreRange();
      document.execCommand(cmd, false, color);
      editor.focus();
      emit();
    });
    btn.el.addEventListener("mousedown", () => {
      savedRange = getRange();
    });
    return btn;
  };
  const textColorBtn = commandColor("textcolor", labels.textColor, "foreColor", "#1d1d20");
  const highlightBtn = commandColor("highlight", labels.highlightColor, "hiliteColor", "#fff3a3");

  const alignBtn = (iconName: IconName, title: string, cmd: string) =>
    segBtn(ICONS[iconName], title, () => {
      document.execCommand(cmd, false, undefined);
      editor.focus();
      refreshToolbarState();
      emit();
    });
  const alignBtns = {
    left: alignBtn("alignLeft", labels.alignLeft, "justifyLeft"),
    center: alignBtn("alignCenter", labels.alignCenter, "justifyCenter"),
    right: alignBtn("alignRight", labels.alignRight, "justifyRight"),
    justify: alignBtn("alignJustify", labels.alignJustify, "justifyFull"),
  };
  const alignSegment = el("div", { class: "cfos-segment" }, [
    alignBtns.left,
    alignBtns.center,
    alignBtns.right,
    alignBtns.justify,
  ]);

  const ulBtn = cmdBtn("ul", labels.bullets, "insertUnorderedList");
  const olBtn = cmdBtn("ol", labels.numbered, "insertOrderedList");
  const outdentBtn = cmdBtn("outdent", labels.outdent, "outdent");
  const indentBtn = cmdBtn("indent", labels.indent, "indent");

  const linkBtn = iconBtn(ICONS.link, labels.link, async () => {
    const existing = currentLink();
    if (existing) {
      await editLink(existing);
      return;
    }
    savedRange = getRange();
    const url = await promptInline(labels.linkPrompt, "", linkPromptOpts);
    if (!url || !url.trim()) return;
    restoreRange();
    document.execCommand("createLink", false, normalizeHref(url));
    editor.focus();
    emit();
  });

  const imageInput = el("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/webp,image/gif",
    multiple: "true",
  });
  imageInput.style.display = "none";
  const imageBtn = iconBtn(ICONS.image, labels.insertImage, () => {
    savedRange = getRange();
    imageInput.value = "";
    imageInput.click();
  });
  imageInput.addEventListener("change", () => {
    void insertImageFiles(Array.from(imageInput.files || []));
  });

  const hrBtn = cmdBtn("hr", labels.horizontalRule, "insertHorizontalRule");
  const clearBtn = iconBtn(ICONS.clear, labels.clearFormat, () => {
    document.execCommand("removeFormat", false, undefined);
    const active = currentBlock();
    if (active) active.classList.remove("doc-title");
    document.execCommand("formatBlock", false, "P");
    editor.focus();
    refreshToolbarState();
    emit();
  });

  const exportBtn = iconBtn(ICONS.download, labels.exportMenu, () => {});
  const unbindExport = bindActionMenu(exportBtn, () => [
    {
      id: "copy-md",
      label: labels.copyMarkdown,
      onSelect: () => {
        const md = docToMarkdown(currentTitle, cfosDocToWorks(collectCfosBlocks()));
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(md).catch(() => {});
        }
        exportBtn.innerHTML = icon(ICONS.check);
        window.setTimeout(() => {
          exportBtn.innerHTML = icon(ICONS.download);
        }, 1200);
      },
    },
    {
      id: "dl-md",
      label: labels.downloadMarkdown,
      desc: ".md",
      onSelect: () => {
        const md = docToMarkdown(currentTitle, cfosDocToWorks(collectCfosBlocks()));
        triggerDownload(
          sanitizeFileName(currentTitle, "document", "md"),
          md,
          "text/markdown;charset=utf-8",
        );
      },
    },
    {
      id: "dl-html",
      label: labels.downloadHtml,
      desc: ".html",
      onSelect: () => {
        const html = exportDocHtml(currentTitle, collectCfosBlocks());
        triggerDownload(
          sanitizeFileName(currentTitle, "document", "html"),
          html,
          "text/html;charset=utf-8",
        );
      },
    },
  ]);

  const toolbar = el("div", { class: "cfos-toolbar" }, [
    group(null, [undoBtn, redoBtn], true),
    group(null, [styleSel.el]),
    group("p2", [fontSel.el, sizeSel.el]),
    group(null, [boldBtn, italicBtn, underlineBtn, strikeBtn, codeBtn]),
    group("p2", [textColorBtn.el, highlightBtn.el]),
    group("p1", [alignSegment]),
    group("p1", [ulBtn, olBtn]),
    group("p3", [outdentBtn, indentBtn]),
    group("p2", [linkBtn, imageBtn]),
    group("p3", [hrBtn, clearBtn]),
    group(null, [exportBtn]),
  ]);

  function refreshToolbarState() {
    if (readOnly) return;
    const set = (btn: HTMLElement, on: boolean) => btn.classList.toggle("active", on);
    try {
      set(boldBtn, document.queryCommandState("bold"));
      set(italicBtn, document.queryCommandState("italic"));
      set(underlineBtn, document.queryCommandState("underline"));
      set(strikeBtn, document.queryCommandState("strikeThrough"));
      set(ulBtn, document.queryCommandState("insertUnorderedList"));
      set(olBtn, document.queryCommandState("insertOrderedList"));
      set(alignBtns.left, document.queryCommandState("justifyLeft"));
      set(alignBtns.center, document.queryCommandState("justifyCenter"));
      set(alignBtns.right, document.queryCommandState("justifyRight"));
      set(alignBtns.justify, document.queryCommandState("justifyFull"));
    } catch {
      // Ignore browser focus gaps.
    }
    const block = currentBlock();
    if (block) {
      let tag = block.tagName;
      if (tag === "ASIDE" || block.hasAttribute("data-works-callout")) tag = "CALLOUT";
      else if (tag === "H1" && block.classList.contains("doc-title")) tag = "TITLE";
      else if (tag === "LI" || tag === "DIV") tag = "P";
      styleSel.setValue(
        ["P", "TITLE", "H1", "H2", "H3", "BLOCKQUOTE", "PRE", "CALLOUT"].includes(tag) ? tag : "P",
      );
    }
    const focus = window.getSelection()?.focusNode;
    if (atSizedCaret()) {
      sizeSel.setValue(caretSize!.pt);
    } else if (focus && editor.contains(focus)) {
      const target = focus.nodeType === Node.TEXT_NODE ? focus.parentElement : (focus as Element);
      if (target) {
        const pt = parseFloat(getComputedStyle(target).fontSize) * 0.75;
        if (Number.isFinite(pt)) sizeSel.setValue(Math.round(pt * 2) / 2);
      }
    }
  }

  // --- Editor listeners ----------------------------------------------------
  const onInput = (e: Event) => {
    if (readOnly) return;
    const ie = e as InputEvent;
    if (caretSize) {
      const { pt } = caretSize;
      const sel = window.getSelection();
      caretSize = null;
      if (
        sel?.focusNode &&
        (ie.inputType === "insertParagraph" || ie.inputType === "insertLineBreak")
      ) {
        caretSize = { pt, node: sel.focusNode, offset: sel.focusOffset };
      } else {
        const run = sel?.focusNode?.parentElement;
        if (
          run &&
          run !== editor &&
          editor.contains(run) &&
          (run.style.fontSize === "xxx-large" || run.getAttribute("size") === "7")
        ) {
          run.removeAttribute("size");
          run.style.fontSize = pt + "pt";
        }
      }
    }
    normalizeBlocks();
    refreshToolbarState();
    emit();
  };

  const onPaste = (e: ClipboardEvent) => {
    if (readOnly) return;
    const cb = e.clipboardData;
    if (!cb) return;
    const imageFiles = imageFilesFrom(cb);
    if (imageFiles.length) {
      e.preventDefault();
      savedRange = getRange();
      void insertImageFiles(imageFiles);
      return;
    }
    e.preventDefault();
    const html = cb.getData("text/html");
    if (html && html.trim()) {
      document.execCommand("insertHTML", false, sanitizePastedHtml(html));
    } else {
      const text = cb.getData("text/plain") || "";
      document.execCommand("insertHTML", false, escapeText(text).replace(/\r?\n/g, "<br>"));
    }
    refreshToolbarState();
    emit();
  };

  const onEditorClick = (e: MouseEvent) => {
    const img = e.target instanceof Element && e.target.closest<HTMLImageElement>("img.cfos-doc-image");
    if (img && editor.contains(img)) selectImage(img);
    else hideImageControls();
  };

  const onDragStart = (e: DragEvent) => {
    const img = e.target instanceof Element && e.target.closest<HTMLImageElement>("img.cfos-doc-image");
    if (!img || !editor.contains(img)) return;
    draggedImage = img;
    selectImage(img);
    hideImageControls();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-cfos-doc-image-move", "1");
    }
  };

  const onDragOver = (e: DragEvent) => {
    if (readOnly) return;
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (
      draggedImage ||
      imageFilesFrom(e.dataTransfer).length ||
      types.includes("Files") ||
      types.includes("text/html") ||
      types.includes("text/plain")
    ) {
      e.preventDefault();
      editor.classList.add("drop-target");
    }
  };

  const onDrop = (e: DragEvent) => {
    if (readOnly) return;
    editor.classList.remove("drop-target");
    if (draggedImage && editor.contains(draggedImage)) {
      e.preventDefault();
      const img = draggedImage;
      draggedImage = null;
      const sel = window.getSelection();
      const range = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? getRange();
      if (range && editor.contains(range.startContainer)) {
        range.insertNode(img);
        const after = document.createRange();
        after.setStartAfter(img);
        after.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(after);
        savedRange = after.cloneRange();
      }
      selectImage(img);
      emit();
      return;
    }
    const files = imageFilesFrom(e.dataTransfer);
    if (files.length) {
      e.preventDefault();
      savedRange = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? getRange();
      void insertImageFiles(files);
      return;
    }
    const html = e.dataTransfer?.getData("text/html");
    const text = e.dataTransfer?.getData("text/plain");
    if ((html && html.trim()) || text) {
      e.preventDefault();
      if (html && html.trim()) document.execCommand("insertHTML", false, sanitizePastedHtml(html));
      else if (text) document.execCommand("insertHTML", false, escapeText(text).replace(/\r?\n/g, "<br>"));
      emit();
    }
  };

  let selQueued = false;
  const onSelChange = () => {
    if (caretSize && !atSizedCaret()) caretSize = null;
    const sel = window.getSelection();
    if (!sel?.anchorNode || !editor.contains(sel.anchorNode)) return;
    if (selQueued) return;
    selQueued = true;
    requestAnimationFrame(() => {
      selQueued = false;
      refreshToolbarState();
      updateLinkPopover();
    });
  };

  const onWindowScroll = () => {
    if (activeLink) positionLinkPopover(activeLink);
    if (selectedImage) positionImageControls();
  };

  editor.addEventListener("input", onInput);
  editor.addEventListener("paste", onPaste);
  editor.addEventListener("click", onEditorClick);
  editor.addEventListener("dragstart", onDragStart);
  editor.addEventListener("dragover", onDragOver);
  editor.addEventListener("dragleave", () => editor.classList.remove("drop-target"));
  editor.addEventListener("drop", onDrop);
  document.addEventListener("selectionchange", onSelChange);
  window.addEventListener("scroll", onWindowScroll, true);
  window.addEventListener("resize", onWindowScroll);

  const canvas = el("div", { class: "cfos-doc-canvas" }, [editor]);
  const root = el("div", { class: "cfos-doc-app" }, [
    readOnly ? null : toolbar,
    canvas,
  ]);
  host.replaceChildren(root);
  if (!readOnly) {
    document.body.appendChild(imageInput);
    document.body.appendChild(linkPop);
    document.body.appendChild(imageControls);
  }

  hydrate(blocks);
  if (!readOnly) refreshToolbarState();

  return {
    updateExternal(incoming: readonly DocBlock[], title?: string) {
      if (title !== undefined) currentTitle = title;
      const serialized = JSON.stringify(incoming);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      hydrate(incoming);
      refreshToolbarState();
    },
    destroy() {
      editor.removeEventListener("input", onInput);
      editor.removeEventListener("paste", onPaste);
      editor.removeEventListener("click", onEditorClick);
      editor.removeEventListener("dragstart", onDragStart);
      editor.removeEventListener("dragover", onDragOver);
      editor.removeEventListener("drop", onDrop);
      document.removeEventListener("selectionchange", onSelChange);
      window.removeEventListener("scroll", onWindowScroll, true);
      window.removeEventListener("resize", onWindowScroll);
      unbindExport();
      styleSel.destroy();
      fontSel.destroy();
      sizeSel.destroy();
      imageInput.remove();
      linkPop.remove();
      imageControls.remove();
      host.replaceChildren();
    },
  };
}

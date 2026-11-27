// Ported from cloudflare-os workspace-slides/files/lib/protocol.ts & client.ts
// Lossless codec between Works v0 DeckSlide ({ title, body, notes? }) and
// full cloudflare-os 1200x675 positioned component slides. Zero runtime relative imports.

import type { DeckSlide } from "../../domain/works";

export type SlideTemplateKind = "cover" | "content" | "bullets" | "twoCol" | "fourCol";

export type PropValue = string | number | boolean;

export interface BlockProps {
  [key: string]: PropValue | undefined;
  text?: string;
  fontSize?: number;
  weight?: number | string;
  color?: string;
  letterSpacing?: string;
  lineHeight?: number;
  highlight?: string;
  variant?: string;
  scale?: number;
  accentDot?: boolean;
  size?: string;
  family?: string;
  align?: string;
  treatment?: string;
  tone?: string;
  topStripe?: boolean;
  eyebrow?: string;
  title?: string;
  body?: string;
  dashed?: boolean;
  opacity?: number;
  kind?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  src?: string;
  fit?: string;
  alt?: string;
  markup?: string;
  background?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  label?: string;
  width?: number;
}

export interface CfosBlock {
  id: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  props: BlockProps;
}

export interface SlideBackground {
  color?: string;
  inset?: boolean;
  dotGrid?: number;
  coverOrange?: boolean;
}

export interface CfosSlide {
  id: string;
  background: SlideBackground;
  blocks: CfosBlock[];
}

export interface CfosDeck {
  themeVersion?: string;
  slides: CfosSlide[];
}

export const SLIDE_SIDECAR_MARKER = "\n---cfos-slide-v1---\n";
const MAX_DECK_BYTES = 62 * 1024;

let nextUid = 1;
export function newSlideUid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${(nextUid++).toString(36)}`;
}

export function isBulletSlide(body: string): boolean {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((l) => /^[-*•]\s+/.test(l));
}

export function extractBulletItems(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean);
}

export function formatAsBullets(body: string): string {
  const items = extractBulletItems(body);
  if (!items.length) return "- First point\n- Second point";
  return items.map((line) => `- ${line}`).join("\n");
}

export function makeSlideTemplate(kind: SlideTemplateKind, index: number): DeckSlide {
  if (kind === "cover") {
    return {
      title: "Presentation title",
      body: "Subtitle or key framing for this deck",
      notes: "Opening cover slide",
    };
  }
  if (kind === "bullets") {
    return {
      title: `Key points (${index + 1})`,
      body: "- First key point or metric\n- Second supporting insight\n- Recommended next action",
    };
  }
  return {
    title: `Slide ${index + 1}`,
    body: "Main takeaway or narrative for this slide.",
  };
}

export function makeCfosSlideTemplate(kind: SlideTemplateKind, index: number): CfosSlide {
  const sid = newSlideUid("s");
  if (kind === "cover") {
    return {
      id: sid,
      background: { color: "#F6821F", inset: false, coverOrange: true },
      blocks: [
        { id: newSlideUid("b"), type: "logo", x: 36, y: 56, w: 267, props: { text: "Works", variant: "light", scale: 1, accentDot: true } },
        {
          id: newSlideUid("b"),
          type: "title",
          x: 33,
          y: 197,
          w: 687,
          props: {
            text: "Presentation title",
            fontSize: 58,
            weight: 700,
            color: "#FFFFFF",
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            highlight: "",
          },
        },
        {
          id: newSlideUid("b"),
          type: "subtitle",
          x: 36,
          y: 533,
          w: 553,
          props: {
            text: "Prepared in Cadence Works",
            fontSize: 17,
            weight: 600,
            color: "#FFFFFF",
            lineHeight: 1.5,
          },
        },
      ],
    };
  }

  const baseBlocks: CfosBlock[] = [
    { id: newSlideUid("b"), type: "sectionLabel", x: 36, y: 35, props: { text: `SECTION ${index + 1}` } },
    {
      id: newSlideUid("b"),
      type: "title",
      x: 35,
      y: 76,
      w: 984,
      props: {
        text: "Write the headline as a specific assertion",
        fontSize: 28,
        weight: 600,
        color: "#000000",
        letterSpacing: "-0.03em",
        lineHeight: 1.2,
        highlight: "",
      },
    },
    { id: newSlideUid("b"), type: "logo", x: 1013, y: 40, props: { text: "Works", variant: "dark", scale: 0.62, accentDot: true } },
  ];

  const brandBar: CfosBlock = {
    id: newSlideUid("b"),
    type: "shape",
    x: 0,
    y: 663,
    w: 1200,
    h: 12,
    props: { kind: "rect", fill: "#F6821F", stroke: "", strokeWidth: 0, radius: 0, opacity: 1 },
  };

  if (kind === "twoCol") {
    for (const x of [36, 609]) {
      baseBlocks.push(
        {
          id: newSlideUid("b"),
          type: "text",
          x,
          y: 204,
          w: 553,
          props: { text: "Column heading", fontSize: 18, weight: 600, color: "#000000", family: "sans", align: "left", lineHeight: 1.3 },
        },
        {
          id: newSlideUid("b"),
          type: "text",
          x,
          y: 252,
          w: 553,
          props: {
            text: "Add concise supporting copy. Keep both columns parallel in structure.",
            fontSize: 19,
            weight: 400,
            color: "#000000",
            family: "sans",
            align: "left",
            lineHeight: 1.6,
          },
        },
      );
    }
    baseBlocks.push(brandBar);
    return { id: sid, background: { color: "#FFFFFF", inset: false, dotGrid: 0 }, blocks: baseBlocks };
  }

  if (kind === "fourCol") {
    [34, 328, 622, 916].forEach((x, i) => {
      baseBlocks.push(
        {
          id: newSlideUid("b"),
          type: "text",
          x,
          y: 194,
          w: 40,
          props: { text: String(i + 1).padStart(2, "0"), fontSize: 14, weight: 600, color: "#FF6633", family: "sans", align: "left", lineHeight: 1.2 },
        },
        {
          id: newSlideUid("b"),
          type: "text",
          x,
          y: 228,
          w: 260,
          props: { text: "Pillar", fontSize: 16, weight: 600, color: "#000000", family: "sans", align: "left", lineHeight: 1.3 },
        },
        {
          id: newSlideUid("b"),
          type: "text",
          x,
          y: 272,
          w: 260,
          props: { text: "Compact supporting detail for this column.", fontSize: 15, weight: 400, color: "#747474", family: "sans", align: "left", lineHeight: 1.5 },
        },
      );
    });
    baseBlocks.push(brandBar);
    return { id: sid, background: { color: "#FFFFFF", inset: false, dotGrid: 0 }, blocks: baseBlocks };
  }

  if (kind === "bullets") {
    baseBlocks.push({
      id: newSlideUid("b"),
      type: "bulletList",
      x: 36,
      y: 204,
      w: 850,
      props: {
        text: "First key takeaway or metric.\nSecond supporting insight.\nRecommended next step.",
        treatment: "primary",
      },
    });
    baseBlocks.push(brandBar);
    return { id: sid, background: { color: "#FFFFFF", inset: false, dotGrid: 0 }, blocks: baseBlocks };
  }

  baseBlocks.push({
    id: newSlideUid("b"),
    type: "text",
    x: 36,
    y: 204,
    w: 760,
    props: {
      text: "Replace this with one or two short paragraphs of supporting evidence. Keep body copy concise.",
      fontSize: 19,
      weight: 400,
      color: "#000000",
      family: "sans",
      align: "left",
      lineHeight: 1.6,
    },
  });
  baseBlocks.push(brandBar);
  return { id: sid, background: { color: "#FFFFFF", inset: false, dotGrid: 0 }, blocks: baseBlocks };
}

export function slideText(slide: CfosSlide): string {
  const parts: string[] = [];
  for (const b of slide.blocks) {
    const p = b.props;
    for (const k of ["text", "eyebrow", "title", "body", "label"] as const) {
      if (typeof p[k] === "string" && p[k]) parts.push(p[k]!);
    }
  }
  return parts.join(" ");
}

export function slideLabel(slide: CfosSlide): string {
  for (const b of slide.blocks) {
    if (b.type === "title" && typeof b.props.text === "string" && b.props.text.trim()) {
      return b.props.text.trim().replace(/\n+/g, " ");
    }
  }
  for (const b of slide.blocks) {
    if (b.type === "logo") continue;
    for (const k of ["title", "text", "body", "eyebrow"] as const) {
      const val = b.props[k];
      if (typeof val === "string" && val.trim()) {
        return val.trim().replace(/\n+/g, " ").slice(0, 60);
      }
    }
  }
  return "Untitled slide";
}

function legacySlideToCfos(slide: DeckSlide, index: number): { cfos: CfosSlide; speakerNote: string } {
  const notes = slide.notes ?? "";
  const markerWithNl = SLIDE_SIDECAR_MARKER;
  const markerBare = SLIDE_SIDECAR_MARKER.trimStart();
  let speakerNote = "";
  let jsonText: string | null = null;
  const nlIdx = notes.indexOf(markerWithNl);
  if (nlIdx >= 0) {
    speakerNote = notes.slice(0, nlIdx);
    jsonText = notes.slice(nlIdx + markerWithNl.length);
  } else if (notes.startsWith(markerBare)) {
    speakerNote = "";
    jsonText = notes.slice(markerBare.length);
  }
  if (jsonText !== null) {
    try {
      const parsed = JSON.parse(jsonText) as CfosSlide;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.blocks) && parsed.background) {
        return {
          cfos: {
            id: typeof parsed.id === "string" ? parsed.id : newSlideUid("s"),
            background: parsed.background,
            blocks: parsed.blocks,
          },
          speakerNote,
        };
      }
    } catch {
      // Fall through to upgrading plain Wire v0 slide.
    }
  }

  const trimmedNotes = notes.startsWith(SLIDE_SIDECAR_MARKER.trimStart()) ? "" : notes;
  const isCover = index === 0;
  if (isCover) {
    const tpl = makeCfosSlideTemplate("cover", index);
    const titleBlock = tpl.blocks.find((b) => b.type === "title");
    const subBlock = tpl.blocks.find((b) => b.type === "subtitle");
    if (titleBlock) titleBlock.props.text = slide.title || "Presentation title";
    if (subBlock) subBlock.props.text = slide.body || "Prepared in Cadence Works";
    return { cfos: tpl, speakerNote: trimmedNotes };
  }

  const isBullets = isBulletSlide(slide.body);
  const tpl = makeCfosSlideTemplate(isBullets ? "bullets" : "content", index);
  const titleBlock = tpl.blocks.find((b) => b.type === "title");
  if (titleBlock) titleBlock.props.text = slide.title || `Slide ${index + 1}`;
  if (isBullets) {
    const bl = tpl.blocks.find((b) => b.type === "bulletList");
    if (bl) bl.props.text = extractBulletItems(slide.body).join("\n");
  } else {
    const tb = tpl.blocks.find((b) => b.type === "text");
    if (tb) tb.props.text = slide.body;
  }
  return { cfos: tpl, speakerNote: trimmedNotes };
}

export function worksDeckToCfos(slides: readonly DeckSlide[]): {
  deck: CfosDeck;
  speakerNotes: Record<string, string>;
} {
  const speakerNotes: Record<string, string> = {};
  const cfosSlides = (slides.length ? slides : [makeSlideTemplate("cover", 0)]).map((s, idx) => {
    const { cfos, speakerNote } = legacySlideToCfos(s, idx);
    if (speakerNote.trim()) speakerNotes[cfos.id] = speakerNote;
    return cfos;
  });
  return { deck: { themeVersion: "1", slides: cfosSlides }, speakerNotes };
}

function summarizeSlideBody(slide: CfosSlide, fallback: string): string {
  const parts: string[] = [];
  for (const b of slide.blocks) {
    if (b.type === "title" || b.type === "logo" || b.type === "sectionLabel") continue;
    if (b.type === "bulletList" && typeof b.props.text === "string" && b.props.text.trim()) {
      parts.push(
        b.props.text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => `- ${line}`)
          .join("\n"),
      );
      continue;
    }
    const text = [b.props.title, b.props.text, b.props.body]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" — ");
    if (text) parts.push(text.trim());
  }
  return parts.join("\n").trim() || fallback;
}

export function cfosDeckToWorks(
  deck: CfosDeck,
  speakerNotes: Readonly<Record<string, string>>,
): DeckSlide[] {
  const list = deck.slides.length ? deck.slides : [makeCfosSlideTemplate("cover", 0)];
  const withSidecar: DeckSlide[] = list.map((slide, idx) => {
    const title = slideLabel(slide) || `Slide ${idx + 1}`;
    const body = summarizeSlideBody(slide, title);
    const noteText = (speakerNotes[slide.id] ?? "").trim();
    const notes = noteText
      ? noteText + SLIDE_SIDECAR_MARKER + JSON.stringify(slide)
      : SLIDE_SIDECAR_MARKER.trimStart() + JSON.stringify(slide);
    return { title, body, notes };
  });

  if (new TextEncoder().encode(JSON.stringify({ slides: withSidecar })).length <= MAX_DECK_BYTES) {
    return withSidecar;
  }
  return list.map((slide, idx) => {
    const title = slideLabel(slide) || `Slide ${idx + 1}`;
    const body = summarizeSlideBody(slide, title);
    const noteText = (speakerNotes[slide.id] ?? "").trim();
    return noteText ? { title, body, notes: noteText } : { title, body };
  });
}

function escapeHtmlBasic(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildDeckHtmlShell(titleText: string, styleCss: string, bodyInner: string): string {
  const tags = ["html", "head", "body", "title", "style"];
  const wrap = (idx: number, content: string, attrs = "") => {
    const t = tags[idx];
    return "<" + t + attrs + ">" + content + "</" + t + ">";
  };
  const head = wrap(1, `\n<meta charset="utf-8">\n${wrap(3, titleText)}\n${wrap(4, styleCss)}\n`);
  const body = wrap(2, `\n${bodyInner}\n`);
  return `<!doctype html>\n${wrap(0, `\n${head}\n${body}\n`, ' lang="en"')}`;
}

export function exportDeckHtml(title: string, deck: CfosDeck): string {
  const slidesHtml = deck.slides
    .map((s, idx) => {
      const heading = escapeHtmlBasic(slideLabel(s));
      const body = escapeHtmlBasic(summarizeSlideBody(s, "")).replace(/\n/g, "<br>");
      const isCover = !!s.background.coverOrange;
      return `<section class="slide ${isCover ? "cover" : ""}">
  <div class="meta">Slide ${idx + 1}</div>
  <h1>${heading}</h1>
  <div class="body">${body}</div>
</section>`;
    })
    .join("\n");
  const css = `
  body { margin: 0; padding: 32px; background: #f4f3ef; font: 16px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; color: #141417; }
  .slide { width: min(960px, 100%); aspect-ratio: 16 / 9; margin: 0 auto 24px; padding: 48px; box-sizing: border-box; background: #ffffff; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,0.08); display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .slide.cover { background: linear-gradient(135deg, #ff5115 0%, #ff861f 58%, #ffc02c 100%); color: #ffffff; }
  .meta { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; margin-bottom: 12px; }
  h1 { margin: 0 0 18px; font-size: 32px; line-height: 1.15; letter-spacing: -0.025em; }
  .body { font-size: 18px; line-height: 1.6; opacity: 0.92; }
`;
  return buildDeckHtmlShell(escapeHtmlBasic(title || "Presentation"), css, slidesHtml);
}

const SLIDE_DATA_IMG_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

export function exportDeckPdfHtml(title: string, deck: CfosDeck): string {
  const slidesHtml = deck.slides
    .map((s, idx) => {
      const heading = escapeHtmlBasic(slideLabel(s));
      const parts: string[] = [];
      for (const b of s.blocks) {
        if (b.type === "logo" || b.type === "title") continue;
        const p = b.props ?? {};
        if (b.type === "bulletList" && typeof p.text === "string" && p.text.trim()) {
          const items = p.text
            .split("\n")
            .map((l) => l.trim().replace(/^[-*•]\s+/, ""))
            .filter(Boolean)
            .map((l) => `<li>${escapeHtmlBasic(l)}</li>`)
            .join("");
          if (items) parts.push(`<ul>${items}</ul>`);
          continue;
        }
        if (b.type === "image" && typeof p.src === "string" && SLIDE_DATA_IMG_RE.test(p.src.trim())) {
          parts.push(`<img class="slide-img" src="${escapeHtmlBasic(p.src.trim())}" alt="${escapeHtmlBasic(typeof p.alt === "string" ? p.alt : "")}">`);
          continue;
        }
        const texts = [p.eyebrow, p.title, p.text, p.body]
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim());
        if (texts.length) {
          parts.push(`<p>${escapeHtmlBasic(texts.join(" — ")).replace(/\n/g, "<br>")}</p>`);
        }
      }
      const bodyHtml = parts.length ? `<div class="body">${parts.join("")}</div>` : "";
      const isCover = !!s.background.coverOrange;
      return `<section class="slide ${isCover ? "cover" : ""}">\n  <div class="meta">Slide ${idx + 1}</div>\n  <h1>${heading}</h1>\n  ${bodyHtml}\n</section>`;
    })
    .join("\n");
  const css = [
    "@page { size: 297mm 167mm; margin: 0; }",
    "body { margin: 0; padding: 0; background: #ffffff; font: 16px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; color: #141417; -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
    ".slide { width: 100%; height: 167mm; padding: 48px 56px; box-sizing: border-box; background: #ffffff; display: flex; flex-direction: column; justify-content: center; break-after: page; page-break-after: always; overflow: hidden; }",
    ".slide.cover { background: linear-gradient(135deg, #ff5115 0%, #ff861f 58%, #ffc02c 100%); color: #ffffff; }",
    ".meta { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.72; margin-bottom: 12px; }",
    "h1 { margin: 0 0 18px; font-size: 32px; line-height: 1.15; letter-spacing: -0.025em; }",
    ".body p { margin: 0 0 10px; font-size: 18px; line-height: 1.55; opacity: 0.92; }",
    "ul { margin: 0 0 10px; padding-left: 24px; font-size: 18px; line-height: 1.6; }",
    "li { margin-bottom: 6px; }",
    ".slide-img { max-width: 100%; max-height: 92mm; object-fit: contain; border-radius: 8px; margin-top: 8px; }",
  ].join("\n");
  return buildDeckHtmlShell(escapeHtmlBasic(title || "Presentation"), css, slidesHtml);
}

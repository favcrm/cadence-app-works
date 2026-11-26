// Ported from cloudflare-os workspace-slides/files/client.ts
// Complete Cloudflare OS branded component library & 1200x675 slide renderer.

import { el } from "../ui/dom";
import {
  newSlideUid,
  type BlockProps,
  type CfosBlock,
  type CfosSlide,
} from "./codec";

export const C = {
  bg: "#FFFFFF",
  surface: "#F5F5F5",
  text: "#000000",
  muted: "#747474",
  subtle: "#A0A0A0",
  orange: "#F6821F",
  ruby: "#FF6633",
  mango: "#FBAD41",
  border: "#E5E5E5",
};

export const TONES = ["neutral", "tangerine", "ruby"] as const;
const toneFill: Record<string, string> = {
  neutral: "#FFFFFF",
  tangerine: "#FFFFFF",
  ruby: "#FFFFFF",
};
const toneColor: Record<string, string> = {
  neutral: "#747474",
  tangerine: "#F6821F",
  ruby: "#FF6633",
};

const FONT = "Inter, ui-sans-serif, system-ui, Arial, sans-serif";

export function hexA(hex: string, a: number): string {
  const h = (hex || "#000000").replace("#", "");
  if (h.length !== 6) return `rgba(0,0,0,${a})`;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
  children?: Node[],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, String(v));
    }
  }
  if (children) children.forEach((c) => node.appendChild(c));
  return node;
}

export function renderCoverOrangeBg(): SVGSVGElement {
  const defs = svgEl("defs", undefined, [
    svgEl("linearGradient", { id: "cfos-cov-b", x2: "1", y2: "1" }, [
      svgEl("stop", { "stop-color": "#ff5115" }),
      svgEl("stop", { offset: ".56", "stop-color": "#ff861f" }),
      svgEl("stop", { offset: "1", "stop-color": "#ffc02c" }),
    ]),
    svgEl("linearGradient", { id: "cfos-cov-a", x2: "1", y2: ".8" }, [
      svgEl("stop", { "stop-color": "#ff5a16" }),
      svgEl("stop", { offset: "1", "stop-color": "#ffad25" }),
    ]),
  ]);
  return svgEl(
    "svg",
    {
      viewBox: "0 0 1200 675",
      preserveAspectRatio: "none",
      style: "position:absolute;inset:0;width:1200px;height:675px;pointer-events:none;z-index:0;",
    },
    [
      defs,
      svgEl("rect", { width: "1200", height: "675", fill: "url(#cfos-cov-b)" }),
      svgEl("path", {
        d: "M-42-50C374-81 699-4 886 185c171 172 157 399-13 490H0V0z",
        fill: "#ff5a17",
        opacity: ".64",
      }),
      svgEl("path", {
        d: "M7 675C126 389 380 208 694 198c256-8 427 90 506 169v308z",
        fill: "url(#cfos-cov-a)",
        opacity: ".66",
      }),
      svgEl("path", {
        d: "M1199 98c-29 282-237 494-518 558-192 44-413 37-675 19",
        fill: "none",
        stroke: "#ffbe20",
        "stroke-width": "2.2",
        opacity: ".92",
      }),
    ],
  );
}

export function renderDotGrid(opacity = 0.42): SVGSVGElement {
  const pat = svgEl(
    "pattern",
    { id: "cfos-dotgrid", width: "24", height: "24", patternUnits: "userSpaceOnUse" },
    [svgEl("circle", { cx: "12", cy: "12", r: "1", fill: C.border, opacity: String(opacity) })],
  );
  return svgEl(
    "svg",
    {
      width: "1200",
      height: "675",
      style: "position:absolute;inset:0;width:1200px;height:675px;pointer-events:none;z-index:0;",
    },
    [
      svgEl("defs", undefined, [pat]),
      svgEl("rect", { width: "1200", height: "675", fill: "url(#cfos-dotgrid)" }),
    ],
  );
}

export interface FieldSchema {
  key: string;
  label: string;
  type: "text" | "multiline" | "number" | "color" | "select" | "checkbox" | "image" | "svg";
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  advanced?: boolean;
}

export interface RenderCtx {
  inlineText(
    elem: HTMLElement,
    propKey: string,
    transform?: (raw: string) => string,
  ): HTMLElement;
}

export interface ComponentDef {
  name: string;
  defaultBlock?: () => Omit<CfosBlock, "id" | "type">;
  fields?: FieldSchema[];
  resizableW?: boolean;
  resizableH?: boolean;
  fullBleed?: boolean;
  render(props: BlockProps, ctx: RenderCtx): HTMLElement | SVGElement;
}

export const COMPONENTS: Record<string, ComponentDef> = {
  sectionLabel: {
    name: "Section label",
    defaultBlock: () => ({ x: 48, y: 38, props: { text: "NEW SECTION" } }),
    fields: [{ key: "text", label: "Text", type: "text" }],
    render(_props, ctx) {
      return ctx.inlineText(
        el("div", {
          style:
            "color:#FF6633;font-size:10px;font-weight:600;line-height:1;letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;",
        }),
        "text",
      );
    },
  },

  logo: {
    name: "Logo",
    defaultBlock: () => ({
      x: 36,
      y: 56,
      props: { variant: "light", scale: 1, text: "Works", accentDot: true },
    }),
    fields: [
      { key: "text", label: "Wordmark", type: "text" },
      { key: "variant", label: "Variant", type: "select", options: ["light", "dark"] },
      { key: "scale", label: "Scale", type: "number", min: 0.4, max: 2, step: 0.05 },
      { key: "accentDot", label: "Accent dot", type: "checkbox" },
    ],
    render(props) {
      const scale = Number(props.scale) || 1;
      const dark = props.variant === "dark";
      const wrap = el("div", {
        style: `display:flex;flex-direction:row;align-items:baseline;gap:${3 * scale}px;white-space:nowrap;`,
      });
      wrap.appendChild(
        el(
          "div",
          {
            style: `color:${dark ? "#000000" : "#FFFFFF"};font-family:${FONT};font-size:${24 * scale}px;font-weight:700;line-height:1;letter-spacing:-0.02em;white-space:nowrap;`,
          },
          String(props.text ?? "Works"),
        ),
      );
      if (props.accentDot !== false) {
        wrap.appendChild(
          el("div", {
            style: `width:${6 * scale}px;height:${6 * scale}px;border-radius:50%;background:#F6821F;flex:0 0 ${6 * scale}px;transform:translateY(${-1 * scale}px);`,
          }),
        );
      }
      return wrap;
    },
  },

  title: {
    name: "Title",
    defaultBlock: () => ({
      x: 33,
      y: 197,
      w: 687,
      props: {
        text: "Headline",
        fontSize: 48,
        weight: 700,
        color: "#000000",
        letterSpacing: "-0.03em",
        highlight: "",
        lineHeight: 1.1,
      },
    }),
    resizableW: true,
    fields: [
      { key: "text", label: "Text", type: "multiline" },
      { key: "fontSize", label: "Font size", type: "number", min: 14, max: 120, step: 1 },
      { key: "color", label: "Color", type: "color" },
      { key: "highlight", label: "Highlight", type: "text", advanced: true },
      { key: "weight", label: "Weight", type: "select", options: ["400", "500", "600", "700"], advanced: true },
      { key: "lineHeight", label: "Line height", type: "number", min: 0.8, max: 2, step: 0.05, advanced: true },
    ],
    render(props, ctx) {
      const node = el("div", {
        style: `font-size:${props.fontSize || 42}px;font-weight:${props.weight || 700};letter-spacing:${props.letterSpacing || "-0.03em"};line-height:${props.lineHeight || 1.1};color:${props.color || C.text};white-space:pre-wrap;`,
      });
      ctx.inlineText(node, "text", (txt) => {
        let html = escapeHtml(txt);
        const words = String(props.highlight || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const w of words) {
          html = html.replace(
            new RegExp(escapeRegex(w), "g"),
            `<span style="color:${C.orange}">${escapeHtml(w)}</span>`,
          );
        }
        return html.replace(/\n/g, "<br/>");
      });
      return node;
    },
  },

  subtitle: {
    name: "Subtitle",
    defaultBlock: () => ({
      x: 36,
      y: 533,
      w: 553,
      props: { text: "Subtitle", fontSize: 17, color: "#747474", lineHeight: 1.5, weight: 600 },
    }),
    resizableW: true,
    fields: [
      { key: "text", label: "Text", type: "multiline" },
      { key: "fontSize", label: "Font size", type: "number", min: 10, max: 48, step: 1 },
      { key: "color", label: "Color", type: "color" },
      { key: "weight", label: "Weight", type: "select", options: ["400", "500", "600", "700"], advanced: true },
    ],
    render(props, ctx) {
      const node = el("div", {
        style: `color:${props.color || C.muted};font-size:${props.fontSize || 19}px;line-height:${props.lineHeight || 1.5};font-weight:${props.weight || 500};white-space:pre-wrap;`,
      });
      return ctx.inlineText(node, "text");
    },
  },

  text: {
    name: "Text block",
    defaultBlock: () => ({
      x: 100,
      y: 200,
      w: 420,
      props: { text: "Text", fontSize: 19, color: "#000000", weight: 400, align: "left", lineHeight: 1.6 },
    }),
    resizableW: true,
    fields: [
      { key: "text", label: "Text", type: "multiline" },
      { key: "fontSize", label: "Font size", type: "number", min: 8, max: 96, step: 1 },
      { key: "color", label: "Color", type: "color" },
      { key: "align", label: "Align", type: "select", options: ["left", "center", "right"] },
      { key: "weight", label: "Weight", type: "select", options: ["400", "500", "600", "700"], advanced: true },
    ],
    render(props, ctx) {
      const node = el("div", {
        style: `font-family:${FONT};font-size:${props.fontSize || 19}px;font-weight:${props.weight || 400};color:${props.color || "#000000"};text-align:${props.align || "left"};line-height:${props.lineHeight || 1.6};white-space:pre-wrap;`,
      });
      return ctx.inlineText(node, "text");
    },
  },

  bulletList: {
    name: "Bullet list",
    defaultBlock: () => ({
      x: 36,
      y: 204,
      w: 850,
      props: {
        text: "First key takeaway.\nSecond supporting insight.\nRecommended next action.",
        treatment: "primary",
      },
    }),
    resizableW: true,
    fields: [
      { key: "text", label: "Items", type: "multiline" },
      { key: "treatment", label: "Style", type: "select", options: ["primary", "compact"] },
    ],
    render(props) {
      const compact = props.treatment === "compact";
      const size = compact ? 17 : 19;
      const list = el("div", {
        style: `width:100%;display:flex;flex-direction:column;gap:${compact ? 8 : 10}px;font-family:${FONT};`,
      });
      const items = String(props.text || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
      for (const item of items) {
        const row = el("div", { style: "display:flex;align-items:flex-start;gap:12px;width:100%;" }, [
          el("span", {
            style: `width:6px;height:6px;flex:0 0 6px;margin-top:${compact ? 7 : 8}px;border-radius:50%;background:#F6821F;`,
          }),
          el(
            "div",
            {
              style: `flex:1;min-width:0;font-size:${size}px;font-weight:400;line-height:${compact ? 1.45 : 1.5};color:#000000;text-align:left;`,
            },
            item,
          ),
        ]);
        list.appendChild(row);
      }
      return list;
    },
  },

  card: {
    name: "Card",
    defaultBlock: () => ({
      x: 100,
      y: 220,
      w: 300,
      h: 240,
      props: { tone: "neutral", topStripe: true, eyebrow: "EYEBROW", title: "Card title", body: "Supporting detail goes here." },
    }),
    resizableW: true,
    resizableH: true,
    fields: [
      { key: "tone", label: "Tone", type: "select", options: [...TONES] },
      { key: "topStripe", label: "Top stripe", type: "checkbox" },
      { key: "eyebrow", label: "Eyebrow", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "body", label: "Body", type: "multiline" },
    ],
    render(props, ctx) {
      const tone = props.tone || "neutral";
      const wrap = el("div", {
        style: `position:relative;width:100%;height:100%;box-sizing:border-box;padding:20px;border-radius:2px;background:${toneFill[tone]};border:1px solid #E5E5E5;${props.topStripe ? `border-top:3px solid ${tone === "ruby" ? C.ruby : C.orange};` : ""}display:flex;flex-direction:column;gap:10px;overflow:hidden;`,
      });
      if (props.eyebrow) {
        wrap.appendChild(
          ctx.inlineText(
            el("div", {
              style: `color:${tone === "neutral" ? C.ruby : toneColor[tone]};font-size:10px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;line-height:1.2;`,
            }),
            "eyebrow",
          ),
        );
      }
      wrap.appendChild(
        ctx.inlineText(
          el("div", {
            style: "font-size:18px;font-weight:600;letter-spacing:-0.02em;line-height:1.3;color:#000000;",
          }),
          "title",
        ),
      );
      wrap.appendChild(
        ctx.inlineText(
          el("div", {
            style: "font-size:15px;line-height:1.5;color:#747474;font-weight:400;white-space:pre-wrap;",
          }),
          "body",
        ),
      );
      return wrap;
    },
  },

  box: {
    name: "Diagram box",
    defaultBlock: () => ({
      x: 200,
      y: 300,
      w: 220,
      h: 110,
      props: { tone: "neutral", title: "Box", body: "", dashed: false },
    }),
    resizableW: true,
    resizableH: true,
    fields: [
      { key: "tone", label: "Tone", type: "select", options: [...TONES] },
      { key: "dashed", label: "Dashed border", type: "checkbox" },
      { key: "title", label: "Title", type: "text" },
      { key: "body", label: "Body", type: "multiline" },
    ],
    render(props, ctx) {
      const tone = props.tone || "neutral";
      const wrap = el("div", {
        style: `width:100%;height:100%;box-sizing:border-box;padding:14px;border-radius:2px;background:${toneFill[tone]};border:${props.dashed ? "1px dashed" : "1px solid"} #E5E5E5;display:flex;flex-direction:column;justify-content:center;`,
      });
      wrap.appendChild(
        ctx.inlineText(
          el("div", { style: "font-size:16px;font-weight:600;letter-spacing:-0.02em;color:#000000;line-height:1.3;" }),
          "title",
        ),
      );
      if (props.body) {
        wrap.appendChild(
          ctx.inlineText(
            el("div", { style: "margin-top:6px;font-size:14px;color:#747474;font-weight:400;line-height:1.45;" }),
            "body",
          ),
        );
      }
      return wrap;
    },
  },

  tonePill: {
    name: "Tone pill",
    defaultBlock: () => ({ x: 100, y: 200, props: { tone: "tangerine", text: "LABEL" } }),
    fields: [
      { key: "tone", label: "Tone", type: "select", options: [...TONES] },
      { key: "text", label: "Text", type: "text" },
    ],
    render(props, ctx) {
      const tone = props.tone || "tangerine";
      return ctx.inlineText(
        el("div", {
          style: `display:inline-block;padding:5px 12px;border-radius:999px;background:${hexA(toneColor[tone], 0.12)};color:${toneColor[tone]};font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;`,
        }),
        "text",
      );
    },
  },

  divider: {
    name: "Divider",
    defaultBlock: () => ({ x: 100, y: 360, w: 400, h: 2, props: { color: C.border, opacity: 1 } }),
    resizableW: true,
    resizableH: true,
    fields: [
      { key: "color", label: "Color", type: "color" },
      { key: "opacity", label: "Opacity", type: "number", min: 0, max: 1, step: 0.05 },
    ],
    render(props) {
      return el("div", {
        style: `width:100%;height:100%;background:${props.color || C.border};opacity:${props.opacity ?? 1};border-radius:1px;`,
      });
    },
  },

  shape: {
    name: "Shape",
    defaultBlock: () => ({
      x: 200,
      y: 200,
      w: 200,
      h: 200,
      props: { kind: "rect", fill: "#FFFFFF", stroke: "#E5E5E5", strokeWidth: 1, radius: 2, opacity: 1 },
    }),
    resizableW: true,
    resizableH: true,
    fields: [
      { key: "kind", label: "Kind", type: "select", options: ["rect", "ellipse"] },
      { key: "fill", label: "Fill", type: "color" },
      { key: "stroke", label: "Stroke", type: "color" },
      { key: "opacity", label: "Opacity", type: "number", min: 0, max: 1, step: 0.05 },
      { key: "strokeWidth", label: "Stroke width", type: "number", min: 0, max: 12, step: 1, advanced: true },
      { key: "radius", label: "Corner radius", type: "number", min: 0, max: 200, step: 1, advanced: true },
    ],
    render(props) {
      return el("div", {
        style: `width:100%;height:100%;background:${props.fill || "transparent"};border:${props.strokeWidth || 0}px solid ${props.stroke || "transparent"};border-radius:${props.kind === "ellipse" ? "999px" : (props.radius || 0) + "px"};opacity:${props.opacity ?? 1};box-sizing:border-box;`,
      });
    },
  },

  image: {
    name: "Image",
    defaultBlock: () => ({
      x: 420,
      y: 160,
      w: 420,
      h: 280,
      props: { src: "", fit: "contain", radius: 4, alt: "" },
    }),
    resizableW: true,
    resizableH: true,
    fields: [
      { key: "src", label: "Source", type: "image" },
      { key: "fit", label: "Fit", type: "select", options: ["contain", "cover", "fill"] },
      { key: "radius", label: "Radius", type: "number", min: 0, max: 200, step: 1, advanced: true },
      { key: "alt", label: "Alt text", type: "text", advanced: true },
    ],
    render(props) {
      const wrap = el("div", {
        style: `width:100%;height:100%;overflow:hidden;border-radius:${props.radius || 0}px;display:flex;align-items:center;justify-content:center;background:${props.src ? "transparent" : hexA(C.muted, 0.06)};border:${props.src ? "none" : `1px dashed ${hexA(C.muted, 0.35)}`};box-sizing:border-box;`,
      });
      if (props.src && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(String(props.src))) {
        wrap.appendChild(
          el("img", {
            src: String(props.src),
            alt: String(props.alt || ""),
            draggable: "false",
            style: `width:100%;height:100%;object-fit:${props.fit || "contain"};display:block;pointer-events:none;user-select:none;`,
          }),
        );
      } else {
        wrap.appendChild(
          el(
            "div",
            {
              style: `color:${C.subtle};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;`,
            },
            "Image",
          ),
        );
      }
      return wrap;
    },
  },

  svg: {
    name: "SVG",
    defaultBlock: () => ({
      x: 100,
      y: 180,
      w: 360,
      h: 220,
      props: { markup: "", fit: "contain", background: "" },
    }),
    resizableW: true,
    resizableH: true,
    fields: [
      { key: "markup", label: "SVG markup", type: "svg" },
      { key: "fit", label: "Fit", type: "select", options: ["contain", "stretch"] },
      { key: "background", label: "Background", type: "color", advanced: true },
    ],
    render(props) {
      const wrap = el("div", {
        style: `width:100%;height:100%;background:${props.background || "transparent"};display:flex;align-items:center;justify-content:center;overflow:hidden;box-sizing:border-box;border-radius:2px;`,
      });
      const raw = String(props.markup || "").trim();
      if (!raw) {
        wrap.style.border = `1px dashed ${hexA(C.muted, 0.35)}`;
        wrap.style.background = hexA(C.muted, 0.06);
        wrap.appendChild(
          el("div", { style: `color:${C.subtle};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;` }, "SVG"),
        );
        return wrap;
      }
      const parsed = new DOMParser().parseFromString(raw, "image/svg+xml");
      const svgNode = parsed.querySelector("svg");
      if (!svgNode) {
        wrap.appendChild(el("div", { style: `color:${C.ruby};font-size:12px;font-weight:700;` }, "Invalid SVG"));
        return wrap;
      }
      svgNode.querySelectorAll("script").forEach((s) => s.remove());
      const stripHandlers = (n: Element) => {
        for (const a of Array.from(n.attributes)) {
          if (a.name.toLowerCase().startsWith("on")) n.removeAttribute(a.name);
        }
        Array.from(n.children).forEach(stripHandlers);
      };
      stripHandlers(svgNode);
      svgNode.setAttribute("width", "100%");
      svgNode.setAttribute("height", "100%");
      svgNode.setAttribute("preserveAspectRatio", props.fit === "stretch" ? "none" : "xMidYMid meet");
      svgNode.style.display = "block";
      svgNode.style.pointerEvents = "none";
      wrap.appendChild(document.importNode(svgNode, true));
      return wrap;
    },
  },

  arrow: {
    name: "Arrow",
    fullBleed: true,
    defaultBlock: () => ({
      x: 0,
      y: 0,
      props: { x1: 200, y1: 400, x2: 600, y2: 400, color: "tangerine", label: "", dashed: false, width: 2.5 },
    }),
    fields: [
      { key: "label", label: "Label", type: "text" },
      { key: "color", label: "Color", type: "select", options: ["muted", "tangerine", "ruby"] },
      { key: "dashed", label: "Dashed", type: "checkbox" },
      { key: "width", label: "Width", type: "number", min: 1, max: 8, step: 0.5, advanced: true },
      { key: "x1", label: "From X", type: "number", min: 0, max: 1200, advanced: true },
      { key: "y1", label: "From Y", type: "number", min: 0, max: 675, advanced: true },
      { key: "x2", label: "To X", type: "number", min: 0, max: 1200, advanced: true },
      { key: "y2", label: "To Y", type: "number", min: 0, max: 675, advanced: true },
    ],
    render(props) {
      const color =
        ({ muted: "#747474", tangerine: "#F6821F", ruby: "#FF6633" } as Record<string, string>)[
          String(props.color || "muted")
        ] || "#F6821F";
      const mid = newSlideUid("ah");
      const marker = svgEl(
        "marker",
        { id: mid, markerWidth: "10", markerHeight: "10", refX: "8", refY: "3", orient: "auto", markerUnits: "strokeWidth" },
        [svgEl("path", { d: "M0,0 L0,6 L9,3 z", fill: color })],
      );
      const line = svgEl("line", {
        x1: Number(props.x1 ?? 200),
        y1: Number(props.y1 ?? 400),
        x2: Number(props.x2 ?? 600),
        y2: Number(props.y2 ?? 400),
        stroke: color,
        "stroke-width": String(props.width || 2),
        opacity: "0.88",
        "marker-end": `url(#${mid})`,
        "stroke-linecap": "round",
      });
      if (props.dashed) line.setAttribute("stroke-dasharray", "6 6");
      const children: Node[] = [svgEl("defs", undefined, [marker]), line];
      if (props.label) {
        const mx = (Number(props.x1 ?? 200) + Number(props.x2 ?? 600)) / 2;
        const my = (Number(props.y1 ?? 400) + Number(props.y2 ?? 400)) / 2 - 8;
        const t = svgEl("text", {
          x: mx,
          y: my,
          "text-anchor": "middle",
          fill: color,
          "font-size": "12",
          "font-weight": "700",
          "font-family": FONT,
        });
        t.textContent = String(props.label);
        children.push(t);
      }
      return svgEl(
        "svg",
        {
          width: 1200,
          height: 675,
          viewBox: "0 0 1200 675",
          style: "position:absolute;left:0;top:0;pointer-events:none;width:1200px;height:675px;",
        },
        children,
      );
    },
  },
};

export const COMPONENT_CATEGORIES: readonly { name: string; types: readonly string[] }[] = [
  { name: "Text", types: ["title", "subtitle", "text", "bulletList", "sectionLabel"] },
  { name: "Containers", types: ["card", "box"] },
  { name: "Media", types: ["image", "svg"] },
  { name: "Decoration", types: ["tonePill", "divider", "shape"] },
  { name: "Diagram", types: ["arrow"] },
];

export const COMP_DESC: Readonly<Record<string, string>> = {
  title: "Display headline",
  subtitle: "Supporting copy",
  text: "Free-form text",
  bulletList: "Corporate bullet list",
  sectionLabel: "Section eyebrow",
  card: "Tonal card",
  box: "Diagram block",
  image: "Uploaded picture",
  svg: "Vector graphic",
  tonePill: "Inline badge",
  divider: "Horizontal rule",
  shape: "Rect or ellipse",
  arrow: "Connector",
};

export const COMP_ICON: Readonly<Record<string, string>> = {
  title: '<path d="M2.5 4h11M8 4v9"/>',
  subtitle: '<path d="M4 6.5h8M8 6.5v5.5"/>',
  text: '<path d="M3 5h10M3 8h10M3 11h6"/>',
  bulletList: '<circle cx="3" cy="4.5" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="11.5" r=".8" fill="currentColor" stroke="none"/><path d="M6 4.5h7M6 8h7M6 11.5h7"/>',
  sectionLabel: '<circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none"/><path d="M6.5 8h7"/>',
  card: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.8"/><path d="M2.5 6h11"/>',
  box: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/>',
  tonePill: '<rect x="1.5" y="5.5" width="13" height="5" rx="2.5"/>',
  divider: '<path d="M2 8h12"/>',
  shape: '<circle cx="8" cy="8" r="5"/>',
  arrow: '<path d="M2.5 8h10"/><path d="M9 4.5 12.5 8 9 11.5"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="7" r="1.2"/><path d="m2.5 12 3.5-3 3 2.5 2-1.5 2.5 2"/>',
  svg: '<path d="M6 4.5 2.5 8 6 11.5"/><path d="M10 4.5 13.5 8 10 11.5"/>',
};

export function renderSlideSurface(
  slide: CfosSlide,
  options: {
    editable: boolean;
    selectedBlockId: string | null;
    onSelectBlock?: (blockId: string | null) => void;
    onCommitBlockText?: (blockId: string, propKey: string, val: string) => void;
    onDragMove?: (block: CfosBlock, wrap: HTMLDivElement, ev: PointerEvent) => void;
    onAddResize?: (wrap: HTMLDivElement, block: CfosBlock, def: ComponentDef) => void;
  },
): HTMLDivElement {
  const frame = el("div", {
    class: "cfos-slide-frame",
    style: `position:relative;width:1200px;height:675px;overflow:hidden;background:${slide.background.color || C.bg};font-family:${FONT};color:${C.text};box-sizing:border-box;user-select:none;`,
  });
  if (slide.background.coverOrange) {
    frame.appendChild(renderCoverOrangeBg());
  }
  if (slide.background.inset) {
    frame.appendChild(
      el("div", {
        style: `position:absolute;inset:20px;background:${C.surface};border-radius:16px;pointer-events:none;z-index:0;`,
      }),
    );
  }
  if (slide.background.dotGrid) {
    frame.appendChild(renderDotGrid(slide.background.dotGrid));
  }

  for (const block of slide.blocks) {
    const def = COMPONENTS[block.type];
    if (!def) continue;
    const isSelected = options.editable && block.id === options.selectedBlockId;
    const inlineCtx: RenderCtx = {
      inlineText(target, propKey, transform) {
        const raw = String(block.props[propKey] ?? "");
        if (transform) target.innerHTML = transform(raw);
        else target.textContent = raw;
        if (options.editable) {
          target.title = "Double-click to edit";
          target.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            target.contentEditable = "true";
            target.textContent = String(block.props[propKey] ?? "");
            target.style.outline = `2px solid ${C.orange}`;
            target.style.borderRadius = "3px";
            target.focus();
            const finish = () => {
              target.contentEditable = "false";
              target.style.outline = "";
              const val = target.innerText;
              if (val !== String(block.props[propKey] ?? "")) {
                options.onCommitBlockText?.(block.id, propKey, val);
              }
            };
            target.addEventListener("blur", finish, { once: true });
            target.addEventListener("keydown", (ke) => {
              if (ke.key === "Escape") {
                target.textContent = String(block.props[propKey] ?? "");
                target.blur();
              } else if ((ke.metaKey || ke.ctrlKey) && ke.key === "Enter") {
                target.blur();
              }
              ke.stopPropagation();
            });
          });
        }
        return target;
      },
    };

    const rendered = def.render(block.props || {}, inlineCtx);
    if (def.fullBleed) {
      rendered.setAttribute("data-block-id", block.id);
      if (options.editable) {
        rendered.style.pointerEvents = "auto";
        rendered.style.cursor = "pointer";
        rendered.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          options.onSelectBlock?.(block.id);
        });
      }
      frame.appendChild(rendered);
      continue;
    }

    const wrap = el("div", {
      class: "cfos-slide-block" + (isSelected ? " selected" : ""),
      "data-block-id": block.id,
      style: `position:absolute;left:${block.x ?? 0}px;top:${block.y ?? 0}px;${
        block.w != null ? `width:${block.w}px;` : ""
      }${block.h != null ? `height:${block.h}px;` : ""}z-index:1;box-sizing:border-box;${
        options.editable ? "cursor:move;" : ""
      }${
        isSelected
          ? `outline:2px solid ${C.orange};outline-offset:3px;border-radius:3px;`
          : ""
      }`,
    }, [rendered]);

    if (options.editable) {
      wrap.addEventListener("pointerdown", (ev) => {
        options.onDragMove?.(block, wrap, ev);
      });
      if (isSelected && (def.resizableW || def.resizableH)) {
        options.onAddResize?.(wrap, block, def);
      }
    }
    frame.appendChild(wrap);
  }

  return frame;
}

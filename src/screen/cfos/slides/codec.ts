// Ported from cloudflare-os workspace-slides/files/client.ts
// Maps Works v0 DeckSlide ({ title, body, notes? }) to Cloudflare OS branded 1200x675 slide rendering.

import type { DeckSlide } from "../../domain/works";

export type SlideTemplateKind = "cover" | "content" | "bullets";

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

export function isBulletSlide(body: string): boolean {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 1 && lines.every((l) => /^[-*•]\s+/.test(l));
}

export function extractBulletItems(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean);
}

export function formatAsBullets(body: string): string {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return "- First point\n- Second point";
  return lines.map((l) => (/^[-*•]\s+/.test(l) ? l : `- ${l}`)).join("\n");
}

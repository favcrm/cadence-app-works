// Ported from cloudflare-os libraries/ui/src/status.ts

import { el } from "./dom";

export interface StatusOptions {
  kind?: string;
  text?: string;
  title?: string;
}

export interface StatusIndicator {
  readonly element: HTMLDivElement;
  set(kind: string, text: string): void;
}

export function statusIndicator({
  kind = "saved",
  text = "Saved",
  title,
}: StatusOptions = {}): StatusIndicator {
  const dot = el("span", { class: `cfos-dot ${kind}` });
  const label = el("span", {}, [text]);
  const element = el("div", { class: "cfos-status", title }, [dot, label]);
  let currentKind = kind;
  let currentText = text;
  return {
    element,
    set(nextKind, nextText) {
      if (nextKind === currentKind && nextText === currentText) return;
      currentKind = nextKind;
      currentText = nextText;
      dot.className = `cfos-dot ${nextKind}`;
      label.textContent = nextText;
    },
  };
}

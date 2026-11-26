// Ported from cloudflare-os libraries/ui/src/prompt.ts

import { el } from "./dom";

export interface PromptOptions {
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
}

export function promptInline(
  message: string,
  initial = "",
  options: string | PromptOptions = {},
): Promise<string | null> {
  const {
    placeholder = "",
    okLabel = "OK",
    cancelLabel = "Cancel",
  } = typeof options === "string" ? { placeholder: options } : options;

  return new Promise((resolve) => {
    const input = el("input", { value: initial, placeholder });
    const done = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    const ok = el(
      "button",
      { class: "cfos-prompt-btn primary", type: "button", onclick: () => done(input.value) },
      [okLabel],
    );
    const cancel = el(
      "button",
      { class: "cfos-prompt-btn", type: "button", onclick: () => done(null) },
      [cancelLabel],
    );
    const overlay = el(
      "div",
      {
        class: "cfos-prompt-overlay",
        onmousedown: (event: Event) => {
          if (event.target === overlay) done(null);
        },
      },
      [
        el("div", { class: "cfos-prompt-card" }, [
          el("div", { class: "cfos-prompt-msg" }, [message]),
          input,
          el("div", { class: "cfos-prompt-actions" }, [cancel, ok]),
        ]),
      ],
    );
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") done(input.value);
      if (event.key === "Escape") done(null);
    });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

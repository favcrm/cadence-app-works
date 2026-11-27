// File download helper: uses host-mediated download over parent postMessage inside
// Cadence's sandboxed iframe (where `allow-downloads` is omitted), falling back to a local
// `<a download>` when running standalone without a parent download listener.

let downloadSeq = 0;

function fallbackAnchorDownload(copy: Uint8Array, mimeType: string, filename: string): void {
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function triggerDownload(
  filename: string,
  payload: string | Uint8Array,
  mimeType: string,
): void {
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);

  const parentWin = typeof window !== "undefined" ? window.parent : null;
  if (parentWin && parentWin !== window && typeof parentWin.postMessage === "function") {
    const requestId = `dl_${Date.now().toString(36)}_${(++downloadSeq).toString(36)}`;
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        event.source === parentWin &&
        data &&
        typeof data === "object" &&
        data.type === "cadence-file-download-ack" &&
        data.requestId === requestId
      ) {
        settled = true;
        cleanup();
      }
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      fallbackAnchorDownload(copy, mimeType, filename);
    }, 150);
    window.addEventListener("message", onMessage);
    parentWin.postMessage(
      {
        type: "cadence-file-download",
        requestId,
        filename,
        mimeType,
        bytes: copy.buffer,
      },
      "*",
    );
    return;
  }

  fallbackAnchorDownload(copy, mimeType, filename);
}

const PDF_EXPORT_TIMEOUT_MS = 30_000;

export async function triggerPdfExport(
  filename: string,
  html: string,
  options?: { paper?: "a4" | "letter" },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parentWin = typeof window !== "undefined" ? window.parent : null;
  if (!parentWin || parentWin === window || typeof parentWin.postMessage !== "function") {
    return { ok: false, error: "PDF export requires the hosted Cadence renderer." };
  }
  const requestId = `pdf_${Date.now().toString(36)}_${(++downloadSeq).toString(36)}`;
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        event.source === parentWin &&
        data &&
        typeof data === "object" &&
        data.type === "cadence-pdf-export-ack" &&
        data.requestId === requestId
      ) {
        settled = true;
        cleanup();
        if (data.ok === true) {
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error: typeof data.error === "string" && data.error ? data.error : "PDF export failed.",
          });
        }
      }
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, error: "PDF export timed out." });
    }, PDF_EXPORT_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    parentWin.postMessage(
      {
        type: "cadence-pdf-export",
        requestId,
        filename,
        html,
        ...(options?.paper ? { paper: options.paper } : {}),
      },
      "*",
    );
  });
}

export type SubmitDocumentPayload =
  | {
      title: string;
      label: string;
      kind: "pdf";
      html: string;
      paper?: "a4" | "letter";
      submit: boolean;
    }
  | {
      title: string;
      label: string;
      kind: "docx" | "xlsx" | "pptx";
      bytes: Uint8Array;
      submit: boolean;
    };

export async function triggerSubmitDocument(
  payload: SubmitDocumentPayload,
): Promise<{ ok: true; id: string; stage: string } | { ok: false; error: string }> {
  const parentWin = typeof window !== "undefined" ? window.parent : null;
  if (!parentWin || parentWin === window || typeof parentWin.postMessage !== "function") {
    return { ok: false, error: "Documents submission requires the hosted Cadence host." };
  }
  const requestId = `sub_${Date.now().toString(36)}_${(++downloadSeq).toString(36)}`;
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (
        event.source === parentWin &&
        data &&
        typeof data === "object" &&
        data.type === "cadence-submit-document-ack" &&
        data.requestId === requestId
      ) {
        settled = true;
        cleanup();
        if (data.ok === true && typeof data.id === "string") {
          resolve({
            ok: true,
            id: data.id,
            stage: typeof data.stage === "string" ? data.stage : payload.submit ? "in_review" : "draft",
          });
        } else {
          resolve({
            ok: false,
            error: typeof data.error === "string" && data.error ? data.error : "Document submission failed.",
          });
        }
      }
    };
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, error: "Document submission timed out." });
    }, PDF_EXPORT_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    if (payload.kind === "pdf") {
      parentWin.postMessage(
        {
          type: "cadence-submit-document",
          requestId,
          title: payload.title,
          label: payload.label,
          kind: "pdf",
          html: payload.html,
          ...(payload.paper ? { paper: payload.paper } : {}),
          submit: payload.submit,
        },
        "*",
      );
      return;
    }
    const copy = new Uint8Array(new ArrayBuffer(payload.bytes.byteLength));
    copy.set(payload.bytes);
    parentWin.postMessage(
      {
        type: "cadence-submit-document",
        requestId,
        title: payload.title,
        label: payload.label,
        kind: payload.kind,
        bytes: copy.buffer,
        submit: payload.submit,
      },
      "*",
      [copy.buffer],
    );
  });
}

export async function runToolbarPdfExport(opts: {
  button: HTMLButtonElement;
  filename: string;
  html: string;
  defaultTitle: string;
  errorPrefix: string;
  checkHtml: string;
  idleHtml: string;
  paper?: "a4" | "letter";
}): Promise<void> {
  if (opts.button.getAttribute("aria-busy") === "true") return;
  opts.button.setAttribute("aria-busy", "true");
  opts.button.disabled = true;
  try {
    const res = await triggerPdfExport(
      opts.filename,
      opts.html,
      opts.paper ? { paper: opts.paper } : undefined,
    );
    if (res.ok) {
      opts.button.title = opts.defaultTitle;
      opts.button.innerHTML = opts.checkHtml;
      window.setTimeout(() => {
        opts.button.innerHTML = opts.idleHtml;
      }, 1200);
    } else {
      opts.button.title = `${opts.errorPrefix}: ${res.error}`;
    }
  } finally {
    opts.button.disabled = false;
    opts.button.removeAttribute("aria-busy");
  }
}

export function sanitizeFileName(raw: string, fallback: string, ext: string): string {
  const stem = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${stem || fallback}.${ext}`;
}

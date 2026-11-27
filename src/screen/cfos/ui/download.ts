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

export function sanitizeFileName(raw: string, fallback: string, ext: string): string {
  const stem = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${stem || fallback}.${ext}`;
}

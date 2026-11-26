// Local file download helper for Markdown, HTML, CSV, and XLSX exports inside the sandboxed frame.

export function triggerDownload(
  filename: string,
  payload: string | Uint8Array,
  mimeType: string,
): void {
  const bytes =
    typeof payload === "string"
      ? new TextEncoder().encode(payload)
      : payload;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
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

export function sanitizeFileName(raw: string, fallback: string, ext: string): string {
  const stem = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${stem || fallback}.${ext}`;
}

// Ported from cloudflare-os libraries/ui/src/images.ts
// Downscales picked, dropped, or pasted images into compact data URLs so
// Works documents stay well within the host's 64 KiB draft budget.

export interface PreparedImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface ImageLimits {
  maxDimension: number;
  maxDataUrlLength: number;
  maxGifDataUrlLength: number;
}

export interface PrepareImageOptions extends Partial<ImageLimits> {
  alt?: string;
}

export const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxDimension: 960,
  maxDataUrlLength: 24_000,
  maxGifDataUrlLength: 24_000,
};

const QUALITY_STEPS = [0.82, 0.68, 0.54, 0.4];

export function isImageFile(file: File | null | undefined): file is File {
  return !!file && IMAGE_TYPES.has(file.type);
}

export function imageFilesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files ?? []).filter(isImageFile);
  if (files.length) return files;
  return Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file" && IMAGE_TYPES.has(item.type))
    .map((item) => item.getAsFile())
    .filter(isImageFile);
}

export async function prepareImage(
  file: File,
  options: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const limits: ImageLimits = {
    maxDimension: options.maxDimension ?? DEFAULT_IMAGE_LIMITS.maxDimension,
    maxDataUrlLength: options.maxDataUrlLength ?? DEFAULT_IMAGE_LIMITS.maxDataUrlLength,
    maxGifDataUrlLength: options.maxGifDataUrlLength ?? DEFAULT_IMAGE_LIMITS.maxGifDataUrlLength,
  };
  const original = await readFileAsDataURL(file);
  const image = await loadImage(original);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const alt = options.alt ?? altFromFileName(file.name);

  if (
    file.type === "image/gif" &&
    original.length <= limits.maxGifDataUrlLength &&
    Math.max(naturalWidth, naturalHeight) <= limits.maxDimension
  ) {
    return { src: original, alt, width: naturalWidth, height: naturalHeight };
  }

  let scale = Math.min(1, limits.maxDimension / Math.max(naturalWidth, naturalHeight, 1));
  for (let attempt = 0; attempt < 5; attempt++) {
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas image processing is unavailable.");
    context.drawImage(image, 0, 0, width, height);
    for (const quality of QUALITY_STEPS) {
      const src = encode(canvas, quality);
      if (src.length <= limits.maxDataUrlLength) return { src, alt, width, height };
    }
    scale *= 0.65;
  }
  throw new Error("Image is too large for the 64 KiB Works limit.");
}

export function altFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "Image";
}

function encode(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
}

export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Could not read image.")),
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Could not decode image.")), {
      once: true,
    });
    image.src = src;
  });
}

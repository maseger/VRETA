// Bilder som lämnar appen har platsdata (EXIF/GPS) och annan metadata borttagen (INV-07). En bild som
// ritas om på en canvas och sparas som JPEG får inga metadata med sig; originalet sparas privat.

export type Derivatives = { share: Blob; thumb: Blob; width: number; height: number };

async function draw(src: Blob, max: number, quality: number, type = "image/jpeg"): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(src, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = canvas instanceof HTMLCanvasElement
    ? await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Kunde inte spara bilden"))), type, quality))
    : await (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  return { blob, width: w, height: h };
}

// Kartunderlag får större delningsversion och WebP (behåller genomskinlighet utanför kartramen).
export async function makeDerivatives(file: Blob, opts: { max?: number; type?: "image/jpeg" | "image/webp" } = {}): Promise<Derivatives> {
  if (file.type === "image/svg+xml") {
    // Demobilder är ritade av appen och saknar metadata
    return { share: file, thumb: file, width: 800, height: 600 };
  }
  const share = await draw(file, opts.max ?? 2048, 0.86, opts.type);
  const thumb = await draw(file, 480, 0.8);
  return { share: share.blob, thumb: thumb.blob, width: share.width, height: share.height };
}

export function extOf(type: string, fallback = "bin"): string {
  if (type.includes("jpeg")) return "jpg";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("svg")) return "svg";
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("pdf")) return "pdf";
  if (type.includes("heic")) return "heic";
  return fallback;
}

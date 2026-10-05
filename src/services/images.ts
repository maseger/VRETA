// Bildhantering i webbläsaren. Den rensade kopian ritas om via canvas, vilket tar bort
// all EXIF-data inklusive GPS-position (INV-07). Originalet sparas separat som privat.

export interface PreparedImage {
  original: File;
  clean: Blob;
  width: number;
  height: number;
  previewUrl: string;
}

async function drawToJpeg(source: Blob, maxDim: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas stöds inte");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Kunde inte koda bilden"))), "image/jpeg", quality),
  );
  return { blob, width, height };
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const { blob, width, height } = await drawToJpeg(file, 2048, 0.86);
  return { original: file, clean: blob, width, height, previewUrl: URL.createObjectURL(blob) };
}

/** Mindre kopia som base64 för AI-tolkning. */
export async function toAgentImage(blob: Blob): Promise<{ media_type: "image/jpeg"; data: string }> {
  const { blob: small } = await drawToJpeg(blob, 1024, 0.8);
  const buf = new Uint8Array(await small.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { media_type: "image/jpeg", data: btoa(bin) };
}

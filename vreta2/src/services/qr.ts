// QR-etiketter för lagerplatser (FR-017) och scanning (FR-018). QR-koden innehåller en länk till
// lagerplatsen, så telefonens vanliga kamera öppnar rätt hylla direkt i appen.
import QRCode from "qrcode";

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#2A2824", light: "#FBF8F1" } });
}

export function storageUrl(id: string): string {
  const base = `${location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, "");
  return `${base}/#/lager/${id}`;
}

export function scannerAvailable(): boolean {
  return "BarcodeDetector" in window;
}

export async function scanOnce(video: HTMLVideoElement, signal: AbortSignal): Promise<string | null> {
  const Detector = (window as any).BarcodeDetector;
  if (!Detector) return null;
  const detector = new Detector({ formats: ["qr_code"] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  video.srcObject = stream;
  await video.play();
  try {
    while (!signal.aborted) {
      const codes = await detector.detect(video);
      if (codes.length) return codes[0].rawValue as string;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// Delning via telefonens delningsmeny (Web Share API) med reserv: kopiera text + ladda ner bilder.
// Facebook och Instagram tar bara emot bilderna – texten de får från andra appar slängs.
// Därför kopieras texten alltid, och det måste ske direkt vid knapptrycket: efter att bilderna
// laddats (await) tillåter Safari inte längre att något skrivs till urklipp.
export type ShareOutcome = "shared" | "copied" | "cancelled";

export interface ShareResult {
  outcome: ShareOutcome;
  /** Texten ligger i urklipp och kan klistras in. */
  textCopied: boolean;
}

/** Kopierar text till urklipp. Anropa först i klickhanteraren, före allt som väntar. */
export function copyText(text: string): Promise<boolean> {
  if (!text) return Promise.resolve(false);
  const legacy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  };
  if (!navigator.clipboard?.writeText) return Promise.resolve(legacy());
  return navigator.clipboard.writeText(text).then(() => true, () => legacy());
}

/** Kanaler som slänger texten när bilder delas till dem. */
export const DROPS_SHARED_TEXT = new Set(["facebook", "instagram"]);

/**
 * Delar text och bilder. Skicka med `copied` från copyText() som anropades vid knapptrycket,
 * annars görs ett (ofta misslyckat) försök här.
 */
export async function shareStory(text: string, images: { name: string; blob: Blob }[], copied?: Promise<boolean>): Promise<ShareResult> {
  const textCopied = copied ?? copyText(text);
  const files = images.map((i) => new File([i.blob], i.name, { type: "image/jpeg" }));
  const data: ShareData = files.length ? { text, files } : { text };
  if (navigator.share && (!files.length || navigator.canShare?.(data))) {
    try {
      await navigator.share(data);
      return { outcome: "shared", textCopied: await textCopied };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return { outcome: "cancelled", textCopied: await textCopied };
    }
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
  }
  return { outcome: "copied", textCopied: await textCopied };
}

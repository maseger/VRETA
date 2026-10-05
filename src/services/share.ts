// Delning via telefonens delningsmeny (Web Share API) med reserv: kopiera text + ladda ner bilder.
export type ShareOutcome = "shared" | "copied" | "cancelled";

export async function shareStory(text: string, images: { name: string; blob: Blob }[]): Promise<ShareOutcome> {
  const files = images.map((i) => new File([i.blob], i.name, { type: "image/jpeg" }));
  const data: ShareData = files.length ? { text, files } : { text };
  if (navigator.share && (!files.length || navigator.canShare?.(data))) {
    try {
      // Vissa appar (t.ex. Instagram) ignorerar texten; kopiera den också.
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      await navigator.share(data);
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard?.writeText(text).catch(() => undefined);
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
  }
  return "copied";
}

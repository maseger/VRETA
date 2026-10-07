// Delning (R1.1 8.4, FR-089): texten kopieras redan vid knapptrycket, innan bilderna laddas – annars
// tillåter telefonen det inte. Facebook och Instagram tar bara emot bilderna, så appen påminner om att
// klistra in texten. Bilderna som delas är alltid de rensade versionerna utan platsdata (INV-07).
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export async function shareContent(opts: { text: string; title?: string; urls: string[] }): Promise<{ copied: boolean; shared: boolean; downloaded: boolean }> {
  const copiedPromise = copyText(opts.text);
  const files: File[] = [];
  for (const [i, url] of opts.urls.entries()) {
    try {
      const blob = await (await fetch(url)).blob();
      const ext = blob.type.includes("png") ? "png" : blob.type.includes("svg") ? "svg" : "jpg";
      files.push(new File([blob], `vreta-${i + 1}.${ext}`, { type: blob.type }));
    } catch { /* hoppa över bilden */ }
  }
  const copied = await copiedPromise;
  const data: ShareData = { title: opts.title, text: opts.text, ...(files.length ? { files } : {}) };
  if (navigator.share && (!files.length || navigator.canShare?.(data))) {
    try {
      await navigator.share(data);
      return { copied, shared: true, downloaded: false };
    } catch (e) {
      if ((e as Error).name === "AbortError") return { copied, shared: false, downloaded: false };
    }
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
  }
  return { copied, shared: false, downloaded: files.length > 0 };
}

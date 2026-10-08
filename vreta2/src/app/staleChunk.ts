// Efter en ny publicering kan en flik som körde den förra versionen försöka hämta en sidfil som inte finns
// längre ("Failed to fetch dynamically imported module"). Då laddas sidan om en gång – aldrig i en slinga –
// så att den nya versionen tas i bruk.
const KEY = "vreta2-reloaded-for-update";

export function isStaleChunkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(m);
}

export function reloadForUpdate(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

// Bildfiler i webbläsaren: alla filer i demoläget, och filer som väntar på uppladdning när appen är offline.
import { openDB, type IDBPDatabase } from "idb";

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB("vreta2-media", 1, { upgrade(d) { d.createObjectStore("blobs"); } });
  return dbp;
}

export async function putBlob(path: string, blob: Blob): Promise<void> {
  await (await db()).put("blobs", blob, path);
}
export async function getBlob(path: string): Promise<Blob | undefined> {
  return (await db()).get("blobs", path);
}
export async function deleteBlob(path: string): Promise<void> {
  await (await db()).delete("blobs", path);
}
export async function clearBlobs(): Promise<void> {
  await (await db()).clear("blobs");
}

const urls = new Map<string, string>();
export async function blobUrl(path: string): Promise<string | null> {
  if (urls.has(path)) return urls.get(path)!;
  const b = await getBlob(path);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(path, u);
  return u;
}

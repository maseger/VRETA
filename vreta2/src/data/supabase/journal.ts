// Offline command journal (ADR-013): handlingar sparas som avsikt ("flytta 40 tegel från A till B"),
// inte som slutvärde, och skickas i ordning när nätet kommer tillbaka. Servern validerar varje kommando
// mot aktuellt läge; avvisade visas i "Synk att lösa". Dessutom en läscache så att sidor kan visas offline.
import { openDB, type IDBPDatabase } from "idb";
import type { JournalEntry } from "../repo";

type Schema = { journal: JournalEntry & { seq: number; media?: string[] }; cache: { key: string; value: unknown; at: number } };
let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB("vreta2-offline", 1, {
    upgrade(d) {
      const j = d.createObjectStore("journal", { keyPath: "key" });
      j.createIndex("seq", "seq");
      d.createObjectStore("cache", { keyPath: "key" });
    },
  });
  return dbp;
}

export async function enqueue(entry: Omit<Schema["journal"], "seq">): Promise<void> {
  await (await db()).put("journal", { ...entry, seq: Date.now() + Math.random() });
}
export async function entries(): Promise<Schema["journal"][]> {
  return (await (await db()).getAllFromIndex("journal", "seq")) as Schema["journal"][];
}
export async function update(entry: Schema["journal"]): Promise<void> {
  await (await db()).put("journal", entry);
}
export async function remove(key: string): Promise<void> {
  await (await db()).delete("journal", key);
}
export async function cachePut(key: string, value: unknown): Promise<void> {
  await (await db()).put("cache", { key, value, at: Date.now() });
}
export async function cacheGet(key: string): Promise<{ value: unknown; at: number } | undefined> {
  return (await db()).get("cache", key);
}

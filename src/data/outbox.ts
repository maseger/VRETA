// Utkorg för ändringar som görs utan nät (FR-003, FR-013, FR-015, AC-02, AC-15).
// Ändringarna sparas i IndexedDB och skickas i samma ordning när nätet kommer tillbaka.
// Ett misslyckat steg stoppar kön, så att ordningen (bild före fångst osv.) alltid håller.
import { openDB, type IDBPDatabase } from "idb";

export type OutboxKind = "media" | "capture" | "checklist" | "complete_pickup";

export interface OutboxOp {
  id: string;
  seq: number;
  kind: OutboxKind;
  payload: unknown;
  blobs?: Record<string, Blob>;
  created_at: string;
  attempts: number;
  last_error?: string;
}

export class Outbox {
  private dbp: Promise<IDBPDatabase>;

  constructor(dbName = "vreta-outbox") {
    this.dbp = openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore("ops", { keyPath: "id" });
        db.createObjectStore("cache");
      },
    });
  }

  async enqueue(kind: OutboxKind, payload: unknown, blobs?: Record<string, Blob>): Promise<OutboxOp> {
    const db = await this.dbp;
    const ops = (await db.getAll("ops")) as OutboxOp[];
    const op: OutboxOp = {
      id: crypto.randomUUID(),
      seq: ops.reduce((m, o) => Math.max(m, o.seq), 0) + 1,
      kind,
      payload,
      blobs,
      created_at: new Date().toISOString(),
      attempts: 0,
    };
    await db.put("ops", op);
    return op;
  }

  async list(): Promise<OutboxOp[]> {
    return ((await (await this.dbp).getAll("ops")) as OutboxOp[]).sort((a, b) => a.seq - b.seq);
  }

  async count(): Promise<number> {
    return (await this.dbp).count("ops");
  }

  /** Skickar köade ändringar i ordning. Returnerar antal som gick igenom. */
  async flush(handler: (op: OutboxOp) => Promise<void>): Promise<{ done: number; remaining: number }> {
    const db = await this.dbp;
    let done = 0;
    const ops = await this.list();
    for (const op of ops) {
      try {
        await handler(op);
        await db.delete("ops", op.id);
        done++;
      } catch (e) {
        await db.put("ops", { ...op, attempts: op.attempts + 1, last_error: (e as Error).message });
        break;
      }
    }
    return { done, remaining: await this.count() };
  }

  async cacheGet<T>(key: string): Promise<T | undefined> {
    return (await (await this.dbp).get("cache", key)) as T | undefined;
  }

  async cachePut(key: string, value: unknown): Promise<void> {
    await (await this.dbp).put("cache", value, key);
  }
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(msg);
}

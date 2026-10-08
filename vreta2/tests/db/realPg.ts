// Samma databastester mot en riktig Postgres (med PostGIS och pgvector) i stället för PGlite.
// Slås på med VRETA_PG_URL=postgres://användare:lösen@värd:port – varje testfil får en egen databas
// som kopieras från en mall där shim och migreringar redan körts.
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationFiles } from "./pglite";

export type Tx = { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>; exec(sql: string): Promise<unknown> };
export type Db = Tx & { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>; close(): Promise<void> };

const root = join(import.meta.dirname, "..", "..", "supabase");

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export async function realDb(url: string): Promise<Db> {
  const shim = readFileSync(join(root, "shim", "supabase_shim.sql"), "utf8");
  const files = migrationFiles();
  const hash = createHash("sha256").update(shim).update(files.map((f) => f.name + f.sql).join("\n")).digest("hex").slice(0, 12);
  const template = `vreta_t_${hash}`;
  // Mallen byggs en gång (lås så att parallella testfiler inte krockar)
  await withClient(url, async (c) => {
    await c.query("select pg_advisory_lock(424242)");
    try {
      const exists = (await c.query("select 1 from pg_database where datname = $1", [template])).rowCount;
      if (!exists) {
        await c.query(`create database ${template}`);
        await withClient(url.replace(/\/[^/]*$/, `/${template}`), async (t) => {
          await t.query(shim);
          for (const f of files) {
            try { await t.query(f.sql); } catch (e) { throw new Error(`Migrering ${f.name} misslyckades: ${(e as Error).message}`); }
          }
        });
      }
    } finally {
      await c.query("select pg_advisory_unlock(424242)");
    }
  });
  const name = `vreta_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(url, (c) => c.query(`create database ${name} template ${template}`));
  const pool = new pg.Pool({ connectionString: url.replace(/\/[^/]*$/, `/${name}`), max: 4 });
  const asTx = (c: pg.PoolClient | pg.Pool): Tx => ({
    query: async (text, params) => ({ rows: (await c.query(text, params as any[])).rows }),
    exec: (sql) => c.query(sql),
  });
  return {
    ...asTx(pool),
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const r = await fn(asTx(c));
        await c.query("commit");
        return r;
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
      await withClient(url, (c) => c.query(`drop database if exists ${name}`)).catch(() => undefined);
    },
  };
}

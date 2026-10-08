// Startar PGlite (Postgres i WASM) med samma tillägg som Supabase och kör shim + alla migreringar.
// Används av databastesterna. Resultatet cachas som en datakatalog så att varje testfil startar snabbt.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { postgis } from "@electric-sql/pglite-postgis";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dirname, "..", "..", "supabase");
export const extensions = { vector, postgis, pg_trgm, pgcrypto };

export function migrationFiles(): { name: string; sql: string }[] {
  const dir = join(root, "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

export async function freshDb(): Promise<PGlite> {
  const shim = readFileSync(join(root, "shim", "supabase_shim.sql"), "utf8");
  const files = migrationFiles();
  const hash = createHash("sha256").update(shim).update(files.map((f) => f.name + f.sql).join("\n")).digest("hex").slice(0, 16);
  const cacheDir = join(tmpdir(), "vreta2-pglite-cache");
  const cache = join(cacheDir, `${hash}.tar.gz`);
  if (existsSync(cache)) {
    const blob = new Blob([readFileSync(cache)]);
    return PGlite.create({ extensions, loadDataDir: blob });
  }
  const db = await PGlite.create({ extensions });
  await db.exec(shim);
  for (const f of files) {
    try {
      await db.exec(f.sql);
    } catch (e) {
      throw new Error(`Migrering ${f.name} misslyckades: ${(e as Error).message}`);
    }
  }
  mkdirSync(cacheDir, { recursive: true });
  const dump = await db.dumpDataDir("gzip");
  writeFileSync(cache, Buffer.from(await dump.arrayBuffer()));
  return db;
}

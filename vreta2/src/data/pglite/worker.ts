/// <reference lib="webworker" />
// Demoläget: hela VRETA-databasen (samma shim, migreringar och Domain API som i Supabase) körs i PGlite
// i en Web Worker och sparas i webbläsarens IndexedDB. Fungerar offline efter första laddningen.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { postgis } from "@electric-sql/pglite-postgis";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import shim from "../../../supabase/shim/supabase_shim.sql?raw";
import { callApi, processJobs, runCommand, runQuery } from "./engine";

const migrationFiles = import.meta.glob("../../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const migrations = Object.entries(migrationFiles).sort(([a], [b]) => a.localeCompare(b));

let db: PGlite | null = null;
let dbName = "";

async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

function progress(message: string) {
  (self as unknown as Worker).postMessage({ progress: message });
}

async function removeOldDatabases(keep: string) {
  try {
    const dbs = await indexedDB.databases();
    for (const d of dbs) {
      if (d.name && d.name.startsWith("/pglite/vreta2-demo-") && d.name !== `/pglite/${keep}`) indexedDB.deleteDatabase(d.name);
    }
  } catch { /* äldre webbläsare saknar indexedDB.databases() */ }
}

async function init(): Promise<{ fresh: boolean }> {
  const version = await digest(shim + migrations.map(([n, s]) => n + s).join("\n"));
  dbName = `vreta2-demo-${version}`;
  progress("Startar databasen …");
  db = await PGlite.create(`idb://${dbName}`, { extensions: { vector, postgis, pg_trgm, pgcrypto }, relaxedDurability: true });
  // Tabellen måste finnas innan den kan frågas (relationen slås upp redan när frågan tolkas)
  const exists = await db.query<{ ok: boolean }>("select to_regclass('core.command_catalog') is not null as ok");
  if (exists.rows[0].ok && (await db.query("select 1 from core.command_catalog limit 1")).rows.length) return { fresh: false };
  progress("Bygger databasen för första gången …");
  await db.exec(shim);
  for (const [name, sql] of migrations) {
    progress(`Migrering ${name.split("/").pop()}`);
    await db.exec(sql);
  }
  await removeOldDatabases(dbName);
  return { fresh: true };
}

async function handle(op: string, a: any): Promise<unknown> {
  if (op === "init") return init();
  if (!db) throw new Error("Databasen är inte startad");
  switch (op) {
    case "command": return runCommand(db, a.claims, a.type, a.payload, a.opts);
    case "query": return runQuery(db, a.claims, a.name, a.params);
    case "api": return callApi(db, a.claims, a.fn, a.params);
    case "jobs": return processJobs(db, a.claims);
    case "sql": return (await db.query(a.text, a.params ?? [])).rows;
    case "reset": {
      await db.close();
      db = null;
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(`/pglite/${dbName}`);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
      return init();
    }
    default: throw new Error(`Okänd operation ${op}`);
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { id, op, ...args } = e.data;
  try {
    const result = await handle(op, args);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message ?? String(err) });
  }
};

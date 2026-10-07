import { randomUUID } from "node:crypto";
import { freshDb } from "./pglite";
import { realDb } from "./realPg";
import type { SqlTx } from "../../src/data/pglite/engine";

// PGlite som standard; VRETA_PG_URL kör samma tester mot en riktig Postgres.
export type HarnessDb = SqlTx & { transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> };
import { asRole, callApi, processJobs, runCommand, runQuery, type Claims, type CommandOptions, type CommandResult } from "../../src/data/pglite/engine";

export type User = { id: string; name: string; claims: Claims };

export class Harness {
  constructor(public db: HarnessDb) {}

  static async create(): Promise<Harness> {
    const url = process.env.VRETA_PG_URL;
    return new Harness(url ? await realDb(url) : await freshDb());
  }

  async user(name: string, anon = false): Promise<User> {
    const id = randomUUID();
    await this.db.query("insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)", [id, anon ? null : `${name}@exempel.se`, anon]);
    return { id, name, claims: { sub: id, role: "authenticated", is_anonymous: anon } };
  }

  cmd<T = Record<string, unknown>>(u: User, type: string, payload: unknown, opts: CommandOptions = {}): Promise<CommandResult<T>> {
    return runCommand<T>(this.db, u.claims, type, payload, opts);
  }

  async ok<T = Record<string, any>>(u: User, type: string, payload: unknown, opts: CommandOptions = {}): Promise<T> {
    const r = await this.cmd<T>(u, type, payload, opts);
    if (r.status !== "accepted") throw new Error(`${type} avvisades: ${r.reason} ${r.suggestion ? JSON.stringify(r.suggestion) : ""}`);
    return r.result as T;
  }

  q<T = any>(u: User | null, name: string, params: unknown = {}): Promise<T> {
    return runQuery<T>(this.db, u ? u.claims : null, name, params);
  }

  api<T = any>(u: User | null, fn: string, params: unknown = {}): Promise<T> {
    return callApi<T>(this.db, u ? u.claims : null, fn, params);
  }

  jobs(u: User): Promise<number> {
    return processJobs(this.db, u.claims);
  }

  async sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query<T>(text, params)).rows;
  }

  async as<T = any>(u: User | null, text: string, params: unknown[] = []): Promise<T[]> {
    return asRole(this.db, u ? u.claims : null, async (tx) => (await tx.query<T>(text, params)).rows);
  }
}

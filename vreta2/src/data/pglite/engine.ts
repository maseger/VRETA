// Kör Domain API i PGlite med samma roller och JWT-anspråk som Supabase (demoläget och databastesterna).
// Varje anrop är en egen transaktion: set_config('request.jwt.claims') + set local role, precis som PostgREST.
import type { PGlite, Transaction } from "@electric-sql/pglite";

export type Claims = {
  sub?: string;
  role: "authenticated" | "anon" | "service_role";
  is_anonymous?: boolean;
  email?: string;
};

export type CommandOptions = {
  idempotencyKey?: string;
  version?: number;
  clientTime?: string;
  siteId?: string;
  origin?: "online" | "offline" | "agent" | "action_preview" | "mcp" | "system";
  agent?: string;
};

export type CommandResult<T = Record<string, unknown>> = {
  status: "accepted" | "rejected" | "superseded";
  command_id?: string;
  result?: T;
  reason?: string;
  suggestion?: unknown;
  duplicate?: boolean;
};

type Db = Pick<PGlite, "transaction">;

export async function asRole<T>(db: Db, claims: Claims | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const c = claims ?? { role: "anon" };
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c)]);
    await tx.exec(`set local role ${c.role === "authenticated" ? "authenticated" : c.role === "service_role" ? "service_role" : "anon"}`);
    return fn(tx);
  });
}

export async function runCommand<T = Record<string, unknown>>(
  db: Db, claims: Claims, type: string, payload: unknown, opts: CommandOptions = {},
): Promise<CommandResult<T>> {
  return asRole(db, claims, async (tx) => {
    const r = await tx.query<{ r: CommandResult<T> }>(
      "select api.run_command($1, $2::jsonb, $3::uuid, $4, $5::timestamptz, $6::uuid, $7, $8) as r",
      [type, JSON.stringify(payload ?? {}), opts.idempotencyKey ?? null, opts.version ?? 1, opts.clientTime ?? null,
        opts.siteId ?? null, opts.origin ?? "online", opts.agent ?? null],
    );
    return r.rows[0].r;
  });
}

const NAME = /^[a-z_]+$/;

export async function runQuery<T = unknown>(db: Db, claims: Claims | null, name: string, params: unknown = {}): Promise<T> {
  if (!NAME.test(name)) throw new Error(`Ogiltig fråga: ${name}`);
  return asRole(db, claims, async (tx) => {
    const r = await tx.query<{ r: T }>(`select api.${name}($1::jsonb) as r`, [JSON.stringify(params ?? {})]);
    return r.rows[0].r;
  });
}

// Plattformsingångar som inte är kommandon: bootstrap_site, redeem_guest_link, submit_contribution.
export async function callApi<T = unknown>(db: Db, claims: Claims | null, fn: string, params: unknown = {}): Promise<T> {
  if (!NAME.test(fn)) throw new Error(`Ogiltig funktion: ${fn}`);
  return asRole(db, claims, async (tx) => {
    const r = await tx.query<{ r: T }>(`select api.${fn}($1::jsonb) as r`, [JSON.stringify(params ?? {})]);
    return r.rows[0].r;
  });
}

export async function processJobs(db: Db, claims: Claims): Promise<number> {
  return asRole(db, claims, async (tx) => {
    const r = await tx.query<{ n: number }>("select api.process_jobs(200) as n");
    return r.rows[0].n;
  });
}

// Feltexten från databasen är "kod: Svensk förklaring".
export function reasonText(reason?: string): string {
  if (!reason) return "Något gick fel";
  // Tekniska databasfel översätts till något begripligt
  if (/invalid input syntax for type uuid/.test(reason)) return "Det finns inget här – länken kan vara fel.";
  if (/permission denied|row-level security/.test(reason)) return "Det här har du inte behörighet till.";
  if (/Failed to fetch|NetworkError|Load failed/.test(reason)) return "Ingen kontakt med servern just nu.";
  const i = reason.indexOf(": ");
  return i > 0 && /^[a-z_]+$/.test(reason.slice(0, i)) ? reason.slice(i + 2) : reason;
}
export function reasonCode(reason?: string): string {
  if (!reason) return "error";
  const i = reason.indexOf(": ");
  return i > 0 && /^[a-z_]+$/.test(reason.slice(0, i)) ? reason.slice(0, i) : "error";
}

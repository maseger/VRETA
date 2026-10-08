// Gemensamt för serverfunktionerna: CORS, svar, och Domain API-anrop med användarens egen inloggning.
// Allt läses och skrivs som användaren – radnivåsäkerheten och kommandonas rollkontroll gäller precis
// som i appen. Funktionerna har ingen egen behörighet utöver det (utom vädret, som kör som tjänst).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...headers } });
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

export type Ctx = { sb: SupabaseClient<any, any, any>; userId: string; role: string; siteId: string; siteName: string; flags: Record<string, boolean>; settings: Record<string, any>; raw: any };

// Klient med användarens JWT mot schemat api (Domain API).
export function userClient(req: Request): SupabaseClient<any, any, any> {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    db: { schema: "api" },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(): SupabaseClient<any, any, any> {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function query<T = any>(sb: SupabaseClient<any, any, any>, name: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(name, { p: params });
  if (error) throw new HttpError(400, "query_failed", `${name}: ${error.message}`);
  return data as T;
}

export type CommandResult<T = any> = { status: "accepted" | "rejected" | "superseded"; result?: T; reason?: string; suggestion?: unknown; command_id?: string };

// Kommandon från agenterna märks med agentens namn (AuditEntry.agent) och körs med användarens roll.
export async function command<T = any>(sb: SupabaseClient<any, any, any>, type: string, payload: Record<string, unknown>, agent: string): Promise<CommandResult<T>> {
  const { data, error } = await sb.rpc("run_command", { p_type: type, p_payload: payload, p_idempotency_key: crypto.randomUUID(), p_origin: "agent", p_agent: agent });
  if (error) throw new HttpError(400, "command_failed", `${type}: ${error.message}`);
  return data as CommandResult<T>;
}

// Vem frågar, och får hen använda AI? Gäster använder aldrig AI.
export async function context(req: Request, roles: string[] = ["owner", "helper", "reader"]): Promise<Ctx> {
  const sb = userClient(req);
  // Utan sparad session måste token skickas uttryckligen för att verifieras
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "unauthorized");
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth.user) throw new HttpError(401, "unauthorized");
  const c = await query<any>(sb, "q_context");
  if (!c?.site || !c.role) throw new HttpError(403, "no_site");
  if (!roles.includes(c.role)) throw new HttpError(403, "forbidden");
  return { sb, userId: auth.user.id, role: c.role, siteId: c.site.id, siteName: c.site.name, flags: c.flags ?? {}, settings: c.settings ?? {}, raw: c };
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
      return json({ error: "internal" }, 500);
    }
  };
}

// MCP-server (R2.0, flaggan mcp): låter en AI-klient (t.ex. Claude) läsa platsens data och fånga nya saker
// med användarens egen behörighet. Protokoll: MCP över HTTP (JSON-RPC, svar som JSON). Klienten skickar
// sin VRETA-inloggning som Bearer-token. Inget kan godkännas, delas eller raderas härifrån – fångster
// blir förslag som en människa granskar i appen (INV-02).
import { command, context, corsHeaders, handle, HttpError, json, query, type Ctx } from "../_server/http.ts";

const PROTOCOL = "2025-06-18";
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const TOOLS = [
  { name: "today", description: "Det som behöver göras nu på platsen: att granska, försenat, vem som väntar på svar, vem som ska tackas.", inputSchema: obj({}) },
  { name: "search", description: "Sök i saker, människor, platser, projekt och historik.", inputSchema: obj({ q: { type: "string" } }, ["q"]) },
  { name: "find_object", description: "Var finns en sak? Status, plats och fördelning för partier. origin = givare eller ort.", inputSchema: obj({ q: { type: "string" }, origin: { type: "string" } }, ["q"]) },
  { name: "open_needs", description: "Öppna behov i projekten med framsteg.", inputSchema: obj({}) },
  { name: "project_overview", description: "Ett projekt i detalj.", inputSchema: obj({ name: { type: "string" }, project_id: { type: "string" } }) },
  { name: "place_overview", description: "En plats på Vreta i detalj.", inputSchema: obj({ name: { type: "string" }, place_id: { type: "string" } }) },
  { name: "contributors", description: "Vilka som bidragit och vilka som inte fått tack.", inputSchema: obj({ year: { type: "integer" } }) },
  { name: "longest_stored", description: "Saker som legat längst i lager.", inputSchema: obj({}) },
  { name: "period_summary", description: "Vad som hänt under en period.", inputSchema: obj({ from: { type: "string" }, to: { type: "string" } }) },
  { name: "capture", description: "Fånga något nytt (text). Blir ett förslag som granskas i appen – inget blir fakta direkt.", inputSchema: obj({ text: { type: "string" }, kind_hint: { type: "string", enum: ["find", "contribution", "observation", "moment", "task", "person"] } }, ["text"]) },
];

async function call(ctx: Ctx, name: string, args: Record<string, any>) {
  if (name === "today") return query(ctx.sb, "q_today");
  if (name === "capture") {
    if (!["owner", "helper"].includes(ctx.role)) throw new Error("Din roll kan inte fånga");
    const id = crypto.randomUUID();
    const r = await command(ctx.sb, "RecordCapture", { id, text: String(args.text).slice(0, 4000), kind_hint: args.kind_hint ?? null, client_created_at: new Date().toISOString(),
      context: { screen: { route: "mcp" } } }, "mcp");
    if (r.status !== "accepted") throw new Error(r.reason ?? "Kunde inte spara");
    return { capture_id: id, message: "Sparat. Fångsten tolkas och väntar under Granska i appen." };
  }
  if (!TOOLS.some((t) => t.name === name)) throw new Error(`Okänt verktyg ${name}`);
  return query(ctx.sb, "q_tool", { tool: name, args });
}

async function rpc(ctx: Ctx, m: Rpc): Promise<unknown> {
  switch (m.method) {
    case "initialize":
      return { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "vreta", version: "2.0.0" },
        instructions: `VRETA för platsen ${ctx.siteName}. Läs med verktygen; fånga nytt med capture. Allt sker med användarens behörighet.` };
    case "ping": return {};
    case "tools/list": return { tools: TOOLS };
    case "tools/call": {
      try {
        const r = await call(ctx, m.params?.name, m.params?.arguments ?? {});
        return { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: Array.isArray(r) ? { items: r } : r };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
    default: throw Object.assign(new Error(`Metoden ${m.method} finns inte`), { code: -32601 });
  }
}

Deno.serve(handle(async (req) => {
  if (req.method === "GET") return new Response("Bara POST (JSON-RPC)", { status: 405, headers: { ...corsHeaders, Allow: "POST" } });
  const ctx = await context(req, ["owner", "helper", "reader"]);
  if (!ctx.flags.mcp) throw new HttpError(403, "feature_off", "MCP är avslaget för platsen");
  const body = await req.json() as Rpc | Rpc[];
  const batch = Array.isArray(body) ? body : [body];
  const out: unknown[] = [];
  for (const m of batch) {
    if (m.id === undefined || m.id === null) continue; // notiser (t.ex. notifications/initialized) får inget svar
    try { out.push({ jsonrpc: "2.0", id: m.id, result: await rpc(ctx, m) }); }
    catch (e) { out.push({ jsonrpc: "2.0", id: m.id, error: { code: (e as any).code ?? -32603, message: (e as Error).message } }); }
  }
  if (!out.length) return new Response(null, { status: 202, headers: corsHeaders });
  return json(Array.isArray(body) ? out : out[0], 200, { "MCP-Protocol-Version": PROTOCOL });
}));

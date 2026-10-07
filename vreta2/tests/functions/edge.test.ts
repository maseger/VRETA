// Serverfunktionerna (Supabase Edge Functions) körs här i Node mot den riktiga databasen i PGlite.
// En liten låtsas-Supabase vidarebefordrar PostgREST-anrop (rpc) och auth till Domain API, och en
// låtsas-Claude svarar med förinspelade svar och sparar varje förfrågan – så att testet kan kontrollera
// både kopplingen och att inget privat skickas till modellen.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { seeded, type Seeded } from "../db/seeded";
import { callApi, runCommand, runQuery, type Claims } from "../../src/data/pglite/engine";

let s: Seeded;
let server: Server;
let base = "";
const claudeRequests: any[] = [];
const handlers: Record<string, (req: Request) => Promise<Response>> = {};
const claimsFor = new Map<string, Claims>();

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : {};
}

// Förinspelade svar från "Claude" beroende på vilken agent som frågar
function claudeReply(req: any): any {
  const system = JSON.stringify(req.system ?? "");
  const text = (t: string) => ({ id: "msg_test", type: "message", role: "assistant", model: req.model, content: [{ type: "text", text: t }],
    stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 } });
  if (system.includes("Capture Agent")) {
    const lena = s.ids.lena;
    return text(JSON.stringify({ summary: "4 kakelugnskakel från Lena Berg", cards: [
      { key: "object", kind: "object", fields: [
        { field: "title", value: "Kakelugnskakel", confidence: 0.9, evidence: [{ kind: "text_excerpt", excerpt: "kakelugnskakel", entity_id: null }] },
        { field: "quantity", value: 4, confidence: 0.9, evidence: [{ kind: "text_excerpt", excerpt: "fyra", entity_id: null }] },
        { field: "unit", value: "st", confidence: 0.9, evidence: [] }],
        match_entity_id: null, match_candidates: [] },
      { key: "person", kind: "person", fields: [{ field: "display_name", value: "Lena Berg", confidence: 0.85, evidence: [{ kind: "existing_relation", excerpt: "Lena", entity_id: lena }] }],
        match_entity_id: lena, match_candidates: [{ entity_id: lena, title: "Lena Berg", shared: ["samma namn"] }, { entity_id: "00000000-0000-0000-0000-000000000000", title: "Påhittad", shared: [] }] },
      { key: "acquisition", kind: "acquisition", fields: [{ field: "type", value: "gift", confidence: 0.8, evidence: [] }, { field: "price", value: 0, confidence: 0.95, evidence: [] }],
        match_entity_id: null, match_candidates: [] },
    ] }));
  }
  if (system.includes("Story Agent")) {
    // Ett utkast som råkar nämna givarens hemort ska stoppas av efterkontrollen
    return text(JSON.stringify({ drafts: [
      { channel: "facebook", text: "Sex gjutjärnsfönster från ett torp i Ockelbo har fått nytt liv i Orangeriet." },
      { channel: "instagram", text: "Gamla fönster, nytt liv i Orangeriet. #återbruk" }] }));
  }
  if (system.includes("Marketplace Agent")) {
    return text(JSON.stringify({ posts: [
      { channel: "blocket", title: "Tre spegeldörrar i furu, 70×200", body: "Fina innerdörrar i furu. 300 kr/st. Hämtas i Uppsala." },
      { channel: "facebook_marketplace", title: "Spegeldörrar", body: "Köpta för 450 kr av Torsten – säljes!" }] }));
  }
  if (system.includes("Fråga Vreta")) {
    const last = req.messages[req.messages.length - 1];
    if (typeof last.content === "string") {
      return { id: "msg_t1", type: "message", role: "assistant", model: req.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 40 },
        content: [{ type: "tool_use", id: "toolu_1", name: "find_object", input: { q: "fönster", origin: "Ockelbo" } }] };
    }
    return text("Fönstren från Ockelbo sitter i Orangeriet › Södra väggen (4 st), och 2 st ligger i lagret.\nAllmänt råd: Linoljekitt torkar långsamt – vänta några veckor innan du målar.");
  }
  return text("{}");
}

beforeAll(async () => {
  s = await seeded();
  for (const [name, u] of [["owner", s.owner], ["helper", s.helper], ["reader", s.reader]] as const) claimsFor.set(`test-${name}`, u.claims);
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const claims = claimsFor.get(token) ?? null;
    try {
      if (url.pathname === "/auth/v1/user") return claims ? send(200, { id: claims.sub, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" }) : send(401, { message: "invalid" });
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.split("/").pop()!;
        const b = await body(req);
        if (fn === "run_command") return send(200, await runCommand(s.h.db, claims!, b.p_type, b.p_payload, { idempotencyKey: b.p_idempotency_key, origin: b.p_origin, agent: b.p_agent }));
        if (fn.startsWith("q_")) return send(200, await runQuery(s.h.db, claims, fn, b.p ?? {}));
        return send(200, await callApi(s.h.db, claims, fn, b.p ?? b));
      }
      if (url.pathname.startsWith("/v1/messages")) {
        const b = await body(req);
        claudeRequests.push(b);
        return send(200, claudeReply(b));
      }
      send(404, { message: "not found" });
    } catch (e) {
      send(400, { message: (e as Error).message, code: "P0001" });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env: Record<string, string> = { SUPABASE_URL: base, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", ANTHROPIC_API_KEY: "test-key" };
  process.env.ANTHROPIC_BASE_URL = base;
  let current = "";
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: any) => { handlers[current] = h; } };
  for (const fn of ["capture-agent", "story-agent", "marketplace-agent", "ask-vreta", "mcp"]) {
    current = fn;
    await import(`../../supabase/functions/${fn}/index.ts`);
  }
}, 240_000);

afterAll(() => server?.close());

const post = (fn: string, as: string, payload: unknown) => handlers[fn](new Request(`${base}/functions/v1/${fn}`, {
  method: "POST", headers: { Authorization: `Bearer test-${as}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
}));

describe("serverfunktionerna mot Domain API", () => {
  test("capture-agent: förslaget sparas med evidens, kända id:n och _match – påhittade id:n tas bort", async () => {
    const id = crypto.randomUUID();
    await s.h.ok(s.helper, "RecordCapture", { id, text: "Fick fyra kakelugnskakel av Lena", client_created_at: new Date().toISOString() });
    const r = await post("capture-agent", "helper", { capture_id: id });
    expect(r.status).toBe(200);
    const { proposal_id } = await r.json();
    const p = await s.h.q(s.owner, "q_proposal", { id: proposal_id });
    expect(p.agent).toBe("capture_agent");
    expect(p.model).toBe("claude-opus-5-5");
    const person = p.cards.find((c: any) => c.kind === "person");
    expect(person.match_entity.id).toBe(s.ids.lena);
    expect(person.match_candidates.map((m: any) => m.entity_id)).toEqual([s.ids.lena]);
    const price = p.cards.find((c: any) => c.kind === "acquisition").fields.find((f: any) => f.field === "price");
    expect(Number(price.confidence)).toBeLessThanOrEqual(0.7);
    const usage = await s.h.sql("select function_name, calls from core.ai_usage where function_name = 'capture-agent'");
    expect(usage[0].calls).toBeGreaterThan(0);
    // Läsaren får inte använda Capture Agent
    expect((await post("capture-agent", "reader", { capture_id: id })).status).toBe(403);
  });

  test("story-agent: Claude får bara den rensade kontexten; utkast med hemort ersätts av mallen", async () => {
    claudeRequests.length = 0;
    await s.h.ok(s.owner, "SetVisibility", { id: s.ids.fonster, visibility: "shareable" });
    const r = await post("story-agent", "owner", { source_ids: [s.ids.fonster], goal: "story", channels: ["facebook", "instagram"] });
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out.allowed).toBe(true);
    const sent = JSON.stringify(claudeRequests[0].messages);
    expect(sent).not.toMatch(/Ockelbo|Byvägen|070-|1 ?200 kr/);
    expect(out.drafts.facebook).not.toMatch(/Ockelbo/);
    expect(out.warnings.join(" ")).toMatch(/mallen används/);
    expect(out.drafts.instagram).toMatch(/nytt liv/);
  });

  test("marketplace-agent: inköpspris och givarens namn stoppas, priset föreslås med motivering", async () => {
    claudeRequests.length = 0;
    const listings = await s.h.q(s.owner, "q_listings");
    const l = listings.find((x: any) => /spegeldörrar/i.test(x.title));
    const r = await post("marketplace-agent", "owner", { listing_id: l.id, channels: ["blocket", "facebook_marketplace"] });
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(JSON.stringify(claudeRequests[0].messages)).not.toMatch(/450|Torsten|Pall A/);
    expect(out.packages.blocket.body).toMatch(/Fina innerdörrar/);
    expect(out.packages.facebook_marketplace.body).not.toMatch(/450|Torsten/);
    expect(out.packages.facebook_marketplace.warnings.join(" ")).toMatch(/standardtexten/);
    expect(out.price.rationale).toBeTruthy();
  });

  test("ask-vreta: verktygsloop med användarens behörighet, källor, allmänt råd och sparad tråd", async () => {
    claudeRequests.length = 0;
    const r = await post("ask-vreta", "owner", { question: "Var är fönstren från Ockelbo?" });
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out.text).toMatch(/Orangeriet/);
    expect(out.general_advice).toMatch(/Linoljekitt/);
    expect(out.sources.some((x: any) => x.id === s.ids.fonster)).toBe(true);
    expect(out.thread_id).toBeTruthy();
    // Verktygsresultatet som gick till Claude kom från q_tool med användarens behörighet
    const toolResult = claudeRequests[1].messages.at(-1).content[0];
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.content).toMatch(/Gjutjärnsfönster/);
    const thread = await s.h.q(s.owner, "q_assistant_thread", { id: out.thread_id });
    expect(thread.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
  });

  test("mcp: initialize, tools/list, tools/call och fånga – bara när flaggan är på", async () => {
    const rpc = (m: any, as = "owner") => post("mcp", as, m);
    const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })).json();
    expect(init.result.serverInfo.name).toBe("vreta");
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((t: any) => t.name)).toContain("find_object");
    const found = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_object", arguments: { q: "handtag" } } })).json();
    expect(found.result.content[0].text).toMatch(/mässingshandtag/i);
    const cap = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "capture", arguments: { text: "Hittade en gammal smidesgrind vid ladan" } } }, "reader")).json();
    expect(cap.result.isError).toBe(true);
    const ok = await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "capture", arguments: { text: "Hittade en gammal smidesgrind vid ladan" } } })).json();
    expect(ok.result.isError).toBeUndefined();
    await s.h.ok(s.owner, "SetFeatureFlag", { flag: "mcp", enabled: false });
    expect((await rpc({ jsonrpc: "2.0", id: 6, method: "tools/list" })).status).toBe(403);
  });
});

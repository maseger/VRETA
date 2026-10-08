// Fråga Vreta: POST { question, thread_id?, screen?, history? } → { text, sources, general_advice, actions, navigate, thread_id }.
// Claude arbetar bara via definierade verktyg (api.q_tool), som körs med användarens egen inloggning –
// radnivåsäkerheten filtrerar innan något når modellen (R1.1 11.3, NFR-007). Varje svar bär källor (INV-10).
// Åtgärder utförs aldrig här: de returneras som förslag som appen visar i Action Preview.
import Anthropic from "@anthropic-ai/sdk";
import { command, context, handle, HttpError, json, query } from "../_server/http.ts";
import { anthropic, apiErrorResponse, assertBudget, FALLBACK_BETA, MODEL, recordUsage } from "../_server/claude.ts";
import type { EntityRef, ProposedAction } from "../_shared/knowledgeLocal.ts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required });
const str = (description: string) => ({ type: "string", description });

const READ_TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: "search", description: "Fritextsökning i allt: saker, människor, platser, projekt, händelser.", input_schema: obj({ q: str("Sökord"), types: { type: "array", items: { type: "string" }, description: "Begränsa till typer, t.ex. object, person, zone" } }, ["q"]) },
  { name: "find_object", description: "Hitta saker och var de finns nu (plats, status, fördelning i partier). origin filtrerar på givarens namn, ort eller platsen saken kom ifrån.", input_schema: obj({ q: str("Vad, t.ex. 'fönster'"), origin: str("Varifrån, t.ex. 'Ockelbo' eller 'Anders'") }, ["q"]) },
  { name: "stock_from_person", description: "Vad vi har kvar (hemma, i bruk, på väg ut) från en viss person, med pris om användaren får se det.", input_schema: obj({ name: str("Personens namn") }, ["name"]) },
  { name: "person_network", description: "En persons relationer: vem som tipsade om vem, familj, grannar.", input_schema: obj({ name: str("Personens namn") }, ["name"]) },
  { name: "contributors", description: "Vilka som bidragit ett visst år och vilka som inte fått tack.", input_schema: obj({ year: { type: "integer" } }) },
  { name: "unanswered_leads", description: "Intressenter på annonser som väntar på svar.", input_schema: obj({}) },
  { name: "longest_stored", description: "Saker som legat längst i lager.", input_schema: obj({}) },
  { name: "bought_sold", description: "Antal och summa köpt och sålt ett år (summor bara om användaren får se priser).", input_schema: obj({ year: { type: "integer" } }) },
  { name: "follow_up", description: "Det som behöver göras eller följas upp nu (Idag-listan).", input_schema: obj({}) },
  { name: "story_ideas", description: "Färska händelser markerade som värda att berätta.", input_schema: obj({}) },
  { name: "open_needs", description: "Öppna behov i projekten med framsteg, t.ex. '1 020 av 1 500 st'.", input_schema: obj({}) },
  { name: "projects", description: "Alla projekt med status och behov.", input_schema: obj({}) },
  { name: "project_overview", description: "Ett projekt i detalj: behov, beslut, bidragsgivare, saker som använts.", input_schema: obj({ project_id: str("Projektets id om känt"), name: str("Projektets namn") }) },
  { name: "place_overview", description: "En plats på Vreta: vad som finns, används, projekt och observationer.", input_schema: obj({ place_id: str("Platsens id om känt"), name: str("Platsens namn") }) },
  { name: "period_summary", description: "Journalen för en period (vad som hänt).", input_schema: obj({ from: str("ÅÅÅÅ-MM-DD"), to: str("ÅÅÅÅ-MM-DD"), type: str("Händelseslag, t.ex. object, project") }) },
  { name: "pickups", description: "Hämtningar som är planerade eller klara.", input_schema: obj({ scope: { type: "string", enum: ["upcoming", "done", "all"] } }) },
];
const ACTION_TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: "propose_move_object", description: "Föreslå att flytta en sak (utförs först när användaren bekräftar).", input_schema: obj({ object_id: str("Sakens id"), to_place_id: str("Platsens id"), quantity: { type: "number" } }, ["object_id", "to_place_id"]) },
  { name: "propose_task", description: "Föreslå en uppgift eller påminnelse (utförs först när användaren bekräftar).", input_schema: obj({ title: str("Vad"), due_at: str("ÅÅÅÅ-MM-DD"), subject_entity_id: str("Id för det uppgiften gäller") }, ["title"]) },
  { name: "open_page", description: "Öppna en sida i appen, t.ex. annonsstudion (/annons/ny?objekt=ID) eller Berätta (/beratta?kalla=ID).", input_schema: obj({ route: str("Sökväg i appen"), label: str("Vad som öppnas") }, ["route"]) },
];

const SYSTEM = `Du är Fråga Vreta, assistenten i appen VRETA för platsen Vreta – en regenerativ återbruksfastighet. Svara på svenska, kort och konkret, som en vän som vet var allt finns.

Regler:
- Allt du säger om Vreta (saker, lager, personer, affärer, projekt, behov, platser, historik) måste komma från ett verktygsresultat i det här samtalet. Hittar verktygen inget: säg "Jag hittar inget om det."
- Allmänna frågor (t.ex. hur man renoverar ett gjutjärnsfönster) får du besvara med egen kunskap, men skriv då det på en egen rad som börjar med "Allmänt råd:".
- Ändringar görs bara som förslag via propose_*-verktygen; säg att användaren bekräftar nedan och påstå aldrig att något är gjort. Publicering, samtycke, priser och radering gör användaren själv på respektive sida.
- Nämn bara det verktygen visat. Källkort visas automatiskt under svaret – räkna inte upp länkar.`;

// Plockar ut postreferenser (id, typ, titel, väg) ur verktygsresultaten som källkort.
function collectRefs(x: unknown, out: Map<string, EntityRef>) {
  if (Array.isArray(x)) { for (const y of x) collectRefs(y, out); return; }
  if (!x || typeof x !== "object") return;
  const o = x as Record<string, any>;
  if (typeof o.id === "string" && typeof o.type === "string" && typeof o.title === "string" && "route" in o) {
    if (!out.has(o.id)) out.set(o.id, { id: o.id, type: o.type, title: o.title, route: o.route, type_label: o.type_label });
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") collectRefs(v, out);
}

Deno.serve(handle(async (req) => {
  const ctx = await context(req, ["owner", "helper", "reader"]);
  await assertBudget(ctx);
  const body = await req.json() as { question: string; thread_id?: string | null; screen?: any; history?: { role: "user" | "assistant"; content: string }[] };
  const question = (body.question ?? "").trim().slice(0, 2000);
  if (!question) throw new HttpError(400, "missing_field", "Ingen fråga");
  const canAct = ctx.role !== "reader";
  const tools = [...READ_TOOLS, ...(canAct ? ACTION_TOOLS : ACTION_TOOLS.filter((t) => t.name === "open_page"))];
  const today = new Date().toISOString().slice(0, 10);
  const screen = body.screen?.entity_id ? ` Användaren tittar på ${body.screen.entity_type ?? "sidan"} "${body.screen.title ?? ""}" (id ${body.screen.entity_id}).` : "";

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(body.history ?? []).slice(-8).filter((m) => m.content).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: `Dagens datum: ${today}. Användarens roll: ${ctx.role}.${screen}\n\n${question}` },
  ];
  const refs = new Map<string, EntityRef>();
  const actions: ProposedAction[] = [];
  let navigate: string | null = null;
  let text = "";

  try {
    for (let turn = 0; turn < 8; turn++) {
      const res = await anthropic.beta.messages.create({
        model: MODEL, max_tokens: 8000, betas: [FALLBACK_BETA], fallbacks: "default",
        output_config: { effort: "low" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools, messages,
      });
      await recordUsage(ctx.sb, "ask-vreta", res.usage);
      if (res.stop_reason === "refusal") { text = "Det kan jag tyvärr inte hjälpa till med."; break; }
      if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
      const uses = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) {
        text = res.content.filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text").map((c) => c.text).join("\n").trim();
        break;
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const input = (u.input ?? {}) as Record<string, any>;
        try {
          if (u.name === "propose_move_object") {
            const o = await query<any>(ctx.sb, "q_entity", { id: input.object_id });
            const p = await query<any>(ctx.sb, "q_entity", { id: input.to_place_id });
            if (!o || !p) throw new Error("Saken eller platsen finns inte");
            actions.push({ key: `move-${actions.length}`, command_type: "MoveObject", payload: { object_id: o.id, to_place_id: p.id, quantity: input.quantity ?? null },
              label: `Flytta ${o.title.toLocaleLowerCase("sv")} till ${p.title}`, effect: "Ändrar var saken finns och skriver en händelse i journalen" });
            refs.set(o.id, o); refs.set(p.id, p);
            results.push({ type: "tool_result", tool_use_id: u.id, content: "Förslaget visas för användaren, som bekräftar." });
          } else if (u.name === "propose_task") {
            actions.push({ key: `task-${actions.length}`, command_type: "CreateTask", payload: { title: String(input.title), due_at: input.due_at ?? null, subject_entity_id: input.subject_entity_id ?? body.screen?.entity_id ?? null },
              label: `Uppgift: ${input.title}${input.due_at ? ` (${input.due_at})` : ""}`, effect: "Skapar en uppgift som syns under Idag" });
            results.push({ type: "tool_result", tool_use_id: u.id, content: "Förslaget visas för användaren, som bekräftar." });
          } else if (u.name === "open_page") {
            if (typeof input.route === "string" && input.route.startsWith("/")) navigate = input.route;
            results.push({ type: "tool_result", tool_use_id: u.id, content: "Knappen visas för användaren." });
          } else {
            const r = await query(ctx.sb, "q_tool", { tool: u.name, args: input });
            collectRefs(r, refs);
            results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r).slice(0, 60_000) });
          }
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: (e as Error).message });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    throw apiErrorResponse(e) ?? e;
  }
  if (!text) text = "Frågan blev för stor – försök dela upp den.";

  // "Allmänt råd:" skiljs ut så att appen kan märka det (det kommer inte från VRETA:s data)
  const m = text.match(/^Allmänt råd:\s*([\s\S]*)$/m);
  const general_advice = m ? m[1].trim() : null;
  const answer = m ? text.slice(0, m.index).trim() || "Här är ett allmänt råd." : text;
  const sources = [...refs.values()].slice(0, 12);

  let thread_id = body.thread_id ?? null;
  const saved = await command<{ thread_id: string }>(ctx.sb, "AppendAssistantMessage", { thread_id, screen: body.screen ?? {}, messages: [
    { role: "user", content: question }, { role: "assistant", content: answer, sources, general_advice }] }, "ask_vreta").catch(() => null);
  if (saved?.status === "accepted") thread_id = saved.result!.thread_id;

  return json({ text: answer, sources, general_advice, actions, navigate, thread_id, tool: "claude" });
}));

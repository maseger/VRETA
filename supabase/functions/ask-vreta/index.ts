// POST { question, screen, history } → svar med källkort och ev. åtgärd att bekräfta (11.6).
// Claude arbetar bara via verktygen i _shared/knowledge.ts. Verktygen läser med användarens
// egen inloggning, så radnivåsäkerheten filtrerar innan något når modellen (NFR-007).
// Åtgärder utförs aldrig här – de skickas tillbaka till appen för bekräftelse.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders, json } from "../_shared/http.ts";
import { TOOL_DEFS, runTool, type PendingAction, type Screen, type SourceCard } from "../_shared/knowledge.ts";
import { supabaseStore } from "../_shared/knowledgeStore.ts";
import { logUsage, overCap, siteOf } from "../_shared/usage.ts";

const anthropic = new Anthropic();
const MODEL = "claude-opus-5-5";

const SYSTEM = `Du är Fråga Vreta, chatboten i appen VRETA för återbruk och byggnadsvård på platsen Vreta. Svara på svenska, kort och konkret.

Regler:
- Allt du påstår om Vreta (objekt, lager, personer och deras relationer, affärer, projekt och behov, platser, journal) måste komma från ett verktygsresultat i det här samtalet. Använd alltid verktygen för sådana frågor. Hittar verktygen inget: säg "Jag hittar inget om det."
- Allmänna frågor (t.ex. hur man renoverar ett gjutjärnsfönster) får du besvara med egen kunskap, men börja då svaret med "Allmänt råd:" så att det inte förväxlas med fakta om Vreta.
- Du kan aldrig publicera något, ändra samtycke, radera data eller sätta pris. Be användaren göra det i respektive studio.
- Åtgärdsverktygen (propose_*, start_*) utför ingenting. Säg att användaren bekräftar nedan; påstå aldrig att något redan är gjort.
- Nämn bara uppgifter som verktygen gett dig. Priser och anteckningar finns bara med när användaren får se dem.
- Källkort visas automatiskt under svaret – räkna inte upp länkar.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const member = await siteOf(sb);
  if (!member) return json({ error: "unauthorized" }, 401);
  // Gäster (M9) använder inte AI
  if (member.is_guest) return json({ error: "forbidden" }, 403);
  if (await overCap(sb, member.site_id)) return json({ error: "cap_reached" }, 429);

  const { question, screen, history } = (await req.json()) as { question: string; screen: Screen; history: { role: "user" | "assistant"; text: string }[] };
  const today = new Date().toISOString().slice(0, 10);
  const store = supabaseStore(sb, member.role, today);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.text })),
    {
      role: "user",
      content: `Dagens datum: ${today}. Användarens roll: ${member.role}.${screen?.type ? ` Användaren står på ${screen.type}-sidan för "${screen.title ?? ""}" (id ${screen.id}).` : ""}\n\n${question}`,
    },
  ];
  const cards: SourceCard[] = [];
  let action: PendingAction | undefined;

  try {
    for (let turn = 0; turn < 6; turn++) {
      const res = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: TOOL_DEFS as unknown as Anthropic.Beta.BetaTool[],
        messages,
      });
      await logUsage(sb, member.site_id, "ask-vreta", MODEL, res.usage);
      if (res.stop_reason === "refusal") return json({ answer: "Det kan jag inte hjälpa till med.", cards: [], general: false });
      const uses = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) {
        const answer = res.content.filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text").map((c) => c.text).join("\n").trim();
        const seen = new Set<string>();
        return json({
          answer: answer || "Jag hittar inget om det.",
          cards: cards.filter((c) => (seen.has(`${c.type}:${c.id}`) ? false : (seen.add(`${c.type}:${c.id}`), true))),
          action,
          general: /^Allmänt råd:/m.test(answer),
        });
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const r = await runTool(store, u.name, (u.input ?? {}) as Record<string, unknown>);
        cards.push(...r.cards);
        if (r.action) action = r.action;
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify({ facts: r.facts, summary: r.answer, needs_confirmation: !!r.action }) });
      }
      messages.push({ role: "user", content: results });
    }
    return json({ answer: "Frågan blev för komplicerad – försök dela upp den.", cards, action, general: false });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: "upstream", status: err.status }, 502);
    return json({ error: "internal" }, 500);
  }
});

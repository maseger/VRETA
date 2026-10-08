// Story Agent: POST { source_ids, person_ids?, goal, channels, tone? } → { allowed, context, removed, warnings, ask_messages, drafts }.
// Integritetsfiltret (deterministisk kod, inte en språkmodell) bygger den rensade kontexten FÖRE anropet;
// Claude ser aldrig något annat. Varje utkast kontrolleras igen efteråt – hittas något som inte får
// delas används mallen för den kanalen i stället (R1.1 8.6, 11.1). Databasen kontrollerar en sista gång vid godkännande.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { context, handle, HttpError, json, query } from "../_server/http.ts";
import { anthropic, apiErrorResponse, assertBudget, FALLBACK_BETA, MODEL, recordUsage } from "../_server/claude.ts";
import { STORY_SYSTEM, StoryOutput } from "../_server/schemas.ts";
import { checkText, forbiddenNamesFor, forbiddenPlacesFor, guardStory } from "../_shared/privacyGuard.ts";
import { writeStory, GOAL_LABELS } from "../_shared/storyTemplates.ts";
import { adapterFromCode } from "../_shared/listingPackage.ts";
import type { StoryContextRaw } from "../_shared/types.ts";

Deno.serve(handle(async (req) => {
  const ctx = await context(req, ["owner", "helper"]);
  const body = await req.json() as { source_ids: string[]; person_ids?: string[]; goal: string; channels: string[]; tone?: "warm" | "plain" | "short" };
  if (!body.source_ids?.length) throw new HttpError(400, "missing_field", "Välj vad som ska berättas");
  const codes: any[] = ctx.raw.codes?.channel ?? [];
  const adapters = body.channels.map((c) => codes.find((x) => x.code === c)).filter(Boolean).map((c) => adapterFromCode(c));
  if (!adapters.length) throw new HttpError(400, "missing_field", "Välj minst en kanal");

  const raw = await query<StoryContextRaw>(ctx.sb, "q_story_context", { source_ids: body.source_ids, person_ids: body.person_ids ?? [] });
  const privateOnly = adapters.every((a) => a.code === "private_message");
  const g = guardStory(raw, { goal: body.goal, channelKind: privateOnly ? "private" : "public", personIds: body.person_ids });
  if (!g.allowed) return json({ ...g, drafts: {} });

  const tone = body.tone ?? "warm";
  const drafts: Record<string, string> = {};
  const warnings = [...g.warnings];
  await assertBudget(ctx);
  try {
    const response = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(StoryOutput) },
      system: [{ type: "text", text: STORY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Mål: ${GOAL_LABELS[body.goal] ?? body.goal}. Ton: ${{ warm: "varm", plain: "saklig", short: "kort" }[tone]}.
Kanaler: ${adapters.map((a) => `${a.code} (${a.label}${a.hashtags ? ", hashtags" : ""})`).join(", ")}.

Rensad kontext (JSON):
${JSON.stringify(g.context)}` }],
    });
    await recordUsage(ctx.sb, "story-agent", response.usage);
    if (response.stop_reason !== "refusal" && response.parsed_output) {
      for (const d of response.parsed_output.drafts) drafts[d.channel] = d.text.trim();
    }
  } catch (e) {
    const http = apiErrorResponse(e);
    if (!http || http.status !== 429) throw http ?? e;
    warnings.push("AI var inte tillgänglig – utkasten kommer från mallarna");
  }

  // Efterkontroll per kanal; mallen tar över om något slunkit igenom
  const forbiddenNames = forbiddenNamesFor(raw);
  const forbiddenPlaces = forbiddenPlacesFor(raw);
  const storagePlaces = ((await query<any[]>(ctx.sb, "q_storage_tree").catch(() => [])) ?? []).map((s) => s.name);
  for (const a of adapters) {
    const text = drafts[a.code];
    const found = text ? checkText(text, { forbiddenNames, storagePlaces, forbiddenPlaces }) : [];
    if (!text || found.length) {
      if (found.length) warnings.push(`${a.label}: AI-utkastet innehöll ${found.map((f) => f.text).join(", ")} – mallen används i stället`);
      drafts[a.code] = writeStory(g.context, a, tone);
    }
  }
  return json({ ...g, warnings: [...new Set(warnings)], drafts });
}));

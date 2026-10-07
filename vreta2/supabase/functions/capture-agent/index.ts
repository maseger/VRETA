// Capture Agent: POST { capture_id, here?, screen? } → { proposal_id }.
// Läser fångsten och platsens kända personer, platser och projekt med användarens egen inloggning,
// låter Claude tolka text, tal och bilder till ett förslag med evidens per fält, och sparar förslaget
// via Domain API (CreateProposal). Svarar funktionen inte använder appen den lokala tolkningen.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { command, context, handle, HttpError, json, query } from "../_server/http.ts";
import { anthropic, apiErrorResponse, assertBudget, FALLBACK_BETA, MODEL, recordUsage } from "../_server/claude.ts";
import { CAPTURE_SYSTEM, CaptureOutput, type CaptureOutputT } from "../_server/schemas.ts";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function imageBlocks(sb: any, media: any[]): Promise<Anthropic.Beta.BetaImageBlockParam[]> {
  const out: Anthropic.Beta.BetaImageBlockParam[] = [];
  for (const m of media.filter((x) => x.kind === "photo" && x.share_path).slice(0, 4)) {
    const { data } = await sb.storage.from("media").download(m.share_path);
    if (!data || !IMAGE_TYPES.has(data.type)) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push({ type: "image", source: { type: "base64", media_type: data.type as "image/jpeg", data: btoa(bin) } });
  }
  return out;
}

// Bara id:n som finns i underlaget får följa med; personkort får sitt _match-fält.
function sanitize(out: CaptureOutputT, known: Set<string>) {
  return out.cards.map((c) => {
    const candidates = (c.match_candidates ?? []).filter((m) => known.has(m.entity_id));
    const match = c.match_entity_id && known.has(c.match_entity_id) ? c.match_entity_id : null;
    const fields = c.fields
      .filter((f) => !(f.field.endsWith("_id") && typeof f.value === "string" && !known.has(f.value)))
      .map((f) => ({
        field: f.field, value: f.value, confidence: Math.max(0, Math.min(f.field === "price" ? 0.7 : 1, f.confidence)),
        evidence: f.evidence.map((e) => ({ kind: e.kind, excerpt: e.excerpt, entity_id: e.entity_id && known.has(e.entity_id) ? e.entity_id : null })),
      }));
    if (c.kind === "person") fields.push({ field: "_match", value: null, confidence: 0, evidence: [] });
    return { key: c.key, kind: c.kind, fields, match_entity_id: match, match_candidates: candidates };
  });
}

Deno.serve(handle(async (req) => {
  const ctx = await context(req, ["owner", "helper"]);
  await assertBudget(ctx);
  const { capture_id, here, screen } = await req.json() as { capture_id: string; here?: any; screen?: any };
  if (!capture_id) throw new HttpError(400, "missing_field", "capture_id saknas");

  const [capture, people, places, projects] = await Promise.all([
    query<any>(ctx.sb, "q_capture", { id: capture_id }),
    query<any[]>(ctx.sb, "q_people"),
    query<any>(ctx.sb, "q_places"),
    query<any[]>(ctx.sb, "q_projects"),
  ]);
  if (!capture) throw new HttpError(404, "not_found", "Fångsten finns inte");
  if (capture.proposal_id) return json({ proposal_id: capture.proposal_id, existing: true });

  const external = [...(places?.localities ?? []).flatMap((l: any) => l.places.map((p: any) => ({ id: p.id, name: p.name, locality: l.name }))),
    ...(places?.external_without_locality ?? []).map((p: any) => ({ id: p.id, name: p.name }))];
  const knowledge = {
    today: new Date().toISOString().slice(0, 10),
    people: people.map((p) => ({ id: p.id, name: p.display_name, locality: p.locality, roles: p.roles })),
    external_places: external,
    projects: projects.filter((p) => p.status !== "done").map((p) => ({ id: p.id, name: p.name, needs: (p.canvas?.needs ?? []).map((n: any) => ({ id: n.id, title: n.title, unit: n.unit, progress: n.progress })) })),
    categories: (ctx.raw.categories ?? []).map((c: any) => ({ code: c.code, name: c.name })),
    observation_types: (ctx.raw.codes?.observation_type ?? []).map((c: any) => c.code),
    contribution_types: (ctx.raw.codes?.contribution_type ?? []).map((c: any) => c.code),
    here: here ?? capture.context?.here ?? null,
    screen: screen ?? capture.context?.screen ?? null,
  };
  const known = new Set<string>([...knowledge.people.map((p) => p.id), ...external.map((p) => p.id), ...knowledge.projects.flatMap((p) => [p.id, ...p.needs.map((n: any) => n.id)]),
    ...(knowledge.screen?.entity_id ? [knowledge.screen.entity_id] : []), ...(knowledge.here?.place_id ? [knowledge.here.place_id] : [])]);

  const images = await imageBlocks(ctx.sb, capture.media ?? []);
  const text = [capture.text && `Skrivet: ${capture.text}`, capture.transcript && `Sagt (transkription): ${capture.transcript}`, capture.url && `Länk: ${capture.url}`,
    capture.kind_hint && `Användaren valde: ${capture.kind_hint}`].filter(Boolean).join("\n");

  let out: CaptureOutputT | null = null;
  try {
    const response = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(CaptureOutput) },
      system: [{ type: "text", text: CAPTURE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [...images, { type: "text", text: `Underlag om platsen (JSON):\n${JSON.stringify(knowledge)}\n\nFångsten:\n${text || "(bara bilder)"}` }] }],
    });
    await recordUsage(ctx.sb, "capture-agent", response.usage);
    if (response.stop_reason === "refusal") throw new HttpError(422, "refused", "AI avböjde – använd den lokala tolkningen");
    out = response.parsed_output;
  } catch (e) {
    throw apiErrorResponse(e) ?? e;
  }
  if (!out || !out.cards.length) throw new HttpError(422, "empty", "Inget att föreslå");

  const r = await command<{ proposal_id: string }>(ctx.sb, "CreateProposal", {
    capture_id, agent: "capture_agent", model: MODEL, summary: out.summary, cards: sanitize(out, known),
  }, "capture_agent");
  if (r.status !== "accepted") throw new HttpError(409, "rejected", r.reason);
  return json({ proposal_id: r.result!.proposal_id });
}));

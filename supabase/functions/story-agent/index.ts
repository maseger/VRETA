// POST { object_id, goal, channels } → utkast per kanal.
// Kontexten hämtas från databasen med användarens egna rättigheter och rensas av
// Privacy Guard innan något skickas till Claude (INV-03, NFR-007).
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { AgentRefusedError, runStoryAgent } from "../_shared/agents.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { logUsage, overCap, siteOf } from "../_shared/usage.ts";
import { guardStoryContext } from "../_shared/privacyGuard.ts";
import { buildRawStoryContext } from "../_shared/storyContext.ts";
import { scrubText } from "../_shared/listingPackage.ts";

const anthropic = new Anthropic();

const STATUS_LABEL: Record<string, string> = {
  discovered: "Upptäckt", contacted: "Kontaktad", reserved: "Reserverad", pickup_planned: "Hämtning planerad",
  collected: "Hämtad", stored: "I lager", processing: "Renoveras", in_use: "I bruk", listed: "Utannonserad",
  reserved_out: "Reserverad för köpare", lent: "Utlånad", declined: "Avstått", lost: "Missat", sold: "Såld",
  donated: "Skänkt", exchanged: "Bytt", discarded: "Kasserad",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: "unauthorized" }, 401);
  const { data: canWrite } = await supabase.rpc("can_write");
  if (!canWrite) return json({ error: "forbidden" }, 403);
  const member = await siteOf(supabase);
  if (member && (await overCap(supabase, member.site_id))) return json({ error: "cap_reached" }, 429);

  const { object_id, goal, channels, content_id } = (await req.json()) as { object_id: string; goal: string; channels: string[]; content_id?: string };

  const { data: object } = await supabase.from("objects").select("*").eq("id", object_id).single();
  if (!object) return json({ error: "not_found" }, 404);

  const [acq, notes, links, media, contributions, consents] = await Promise.all([
    supabase.from("acquisitions").select("object_id, person_id, type").eq("object_id", object_id),
    supabase.from("story_notes").select("kind, text, quote_consent").eq("entity_type", "object").eq("entity_id", object_id),
    supabase.from("event_links").select("event_id").eq("entity_type", "object").eq("entity_id", object_id),
    supabase.from("media").select("id, visibility, has_people, clean_path").eq("entity_type", "object").eq("entity_id", object_id),
    supabase.from("contributions").select("person_id, kind, description, visibility").eq("object_id", object_id),
    content_id
      ? supabase.from("content_consents").select("person_id, name_ok, contribution_ok").eq("content_id", content_id)
      : Promise.resolve({ data: [] }),
  ]);
  const personIds = [...(acq.data ?? []), ...(contributions.data ?? [])].map((a) => a.person_id).filter(Boolean) as string[];
  const eventIds = (links.data ?? []).map((l) => l.event_id);
  const [persons, events] = await Promise.all([
    personIds.length
      ? supabase.from("persons").select("id, name, locality, consent_name, consent_contribution").in("id", personIds)
      : Promise.resolve({ data: [] }),
    eventIds.length
      ? supabase.from("events").select("summary, occurred_at, visibility").in("id", eventIds)
      : Promise.resolve({ data: [] }),
  ]);

  const raw = buildRawStoryContext({
    object,
    acquisitions: (acq.data ?? []).map((a) => ({ ...a, price: null })), // priser hämtas aldrig hit
    persons: (persons.data ?? []).map((p) => ({ ...p, contact: "", notes: "" })), // privata fält hämtas aldrig hit
    contributions: contributions.data ?? [],
    consents: consents.data ?? [],
    notes: notes.data ?? [],
    events: events.data ?? [],
    media: media.data ?? [],
  });
  const guard = guardStoryContext(raw, STATUS_LABEL[object.status] ?? object.status);
  if (!guard.allowed || !guard.context) return json({ error: "not_publishable", warnings: guard.warnings }, 400);

  try {
    const drafted = await runStoryAgent(anthropic, { context: guard.context, goal, channels }, (model, usage) => member ? logUsage(supabase, member.site_id, "story-agent", model, usage) : undefined);
    // Sista kontroll: namn utan samtycke och personers hemorter får aldrig stå i texten (AC-11)
    const hidden = raw.people.filter((_, i) => !guard.context!.people[i]?.name).map((p) => p.name);
    const places = raw.people.map((p) => p.locality).filter(Boolean);
    const variants = drafted.map((v) => ({ ...v, text: scrubText(v.text, hidden, places).text }));
    return json({ variants, media_ids: guard.context.media_ids, removed: guard.removed, warnings: guard.warnings });
  } catch (err) {
    if (err instanceof AgentRefusedError) return json({ error: "refused" }, 422);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: "upstream", status: err.status }, 502);
    console.error("story-agent:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    return json({ error: "internal" }, 500);
  }
});

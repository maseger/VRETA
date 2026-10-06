// POST { listing_id, channels } → annonspaket per kanal + prisförslag med motivering.
// Kontexten hämtas med användarens egna rättigheter och rensas av guardListing innan
// något skickas till Claude. Inköpspriset används bara för prisförslaget och skickas aldrig
// till Claude. Claudes text kontrolleras igen med assertClean innan den lämnas ut (AC-11).
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { AgentRefusedError, runMarketplaceAgent } from "../_shared/agents.ts";
import { adapter, type ChannelAdapter } from "../_shared/channels.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { logUsage, overCap, siteOf } from "../_shared/usage.ts";
import { assertClean, buildPackage, guardListing, priceLabel, suggestPrice, type ListingPackage } from "../_shared/listingPackage.ts";

const anthropic = new Anthropic();

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

  const { listing_id, channels } = (await req.json()) as { listing_id: string; channels: string[] };
  const { data: listing } = await supabase.from("listings").select("*").eq("id", listing_id).single();
  if (!listing) return json({ error: "not_found" }, 404);
  const { data: object } = listing.object_id
    ? await supabase.from("objects").select("*").eq("id", listing.object_id).single()
    : { data: null };

  const [acq, leads, locations, structures, sites, media, sameCategory] = await Promise.all([
    object ? supabase.from("acquisitions").select("id, person_id").eq("object_id", object.id) : Promise.resolve({ data: [] }),
    supabase.from("leads").select("person_id").eq("listing_id", listing_id),
    supabase.from("storage_locations").select("name"),
    supabase.from("structures").select("name"),
    supabase.from("sites").select("name"),
    object
      ? supabase.from("media").select("id, visibility, has_people, clean_path").eq("entity_type", "object").eq("entity_id", object.id)
      : Promise.resolve({ data: [] }),
    object?.category
      ? supabase.from("objects").select("id").eq("category", object.category).neq("id", object.id)
      : Promise.resolve({ data: [] }),
  ]);
  const personIds = [...(acq.data ?? []), ...(leads.data ?? [])].map((r) => r.person_id).filter(Boolean) as string[];
  const acqIds = (acq.data ?? []).map((a) => a.id);
  const similarIds = (sameCategory.data ?? []).map((o) => o.id);
  const [persons, acqPrivate, sold] = await Promise.all([
    personIds.length ? supabase.from("persons").select("name").in("id", personIds) : Promise.resolve({ data: [] }),
    acqIds.length ? supabase.from("acquisition_private").select("price").in("acquisition_id", acqIds) : Promise.resolve({ data: [] }),
    similarIds.length
      ? supabase.from("disposals").select("id, quantity").eq("type", "sold").in("object_id", similarIds)
      : Promise.resolve({ data: [] }),
  ]);
  const soldIds = (sold.data ?? []).map((d) => d.id);
  const { data: soldPrices } = soldIds.length
    ? await supabase.from("disposal_private").select("disposal_id, price").in("disposal_id", soldIds)
    : { data: [] };

  const raw = {
    listing: { type: listing.type, title: listing.title, description: listing.description, price: listing.price, quantity: listing.quantity, locality: listing.locality },
    object,
    person_names: (persons.data ?? []).map((p) => p.name),
    place_names: [...(locations.data ?? []), ...(structures.data ?? []), ...(sites.data ?? [])].map((r) => r.name),
    purchase_price: (acqPrivate.data ?? [])[0]?.price ?? null,
    media: (media.data ?? []).map((m) => ({ id: m.id, visibility: m.visibility, has_people: m.has_people, has_clean: !!m.clean_path })),
  };
  const guard = guardListing(raw);
  if (!guard.allowed || !guard.context) return json({ error: "not_publishable", warnings: guard.warnings }, 400);
  const ctx = guard.context;

  const price = suggestPrice({
    type: listing.type,
    quantity: listing.quantity,
    total_quantity: object?.quantity ?? 1,
    condition: object?.condition ?? null,
    purchase_price: raw.purchase_price,
    comparables: (sold.data ?? []).map((d) => ({ price: (soldPrices ?? []).find((p) => p.disposal_id === d.id)?.price ?? 0, quantity: d.quantity })),
  });

  const adapters = channels.map(adapter).filter(Boolean) as ChannelAdapter[];
  const templates = adapters.map((a) => buildPackage(ctx, a.id));
  let packages: ListingPackage[] = templates;
  let source: "claude" | "mall" = "mall";
  try {
    const drafted = await runMarketplaceAgent(anthropic, { context: ctx, price_label: priceLabel(ctx), channels: adapters }, (model, usage) => member ? logUsage(supabase, member.site_id, "marketplace-agent", model, usage) : undefined);
    packages = templates.map((t) => {
      const d = drafted.find((x) => x.channel === t.channel);
      if (!d) return t;
      const a = adapter(t.channel)!;
      return { ...t, title: assertClean(d.title, raw).text.slice(0, a.title_max_length), text: assertClean(d.text, raw).text.slice(0, a.text_max_length) };
    });
    source = "claude";
  } catch (err) {
    if (!(err instanceof AgentRefusedError) && !(err instanceof Anthropic.APIError)) {
      console.error("marketplace-agent:", err instanceof Error ? `${err.name}: ${err.message}` : err);
      return json({ error: "internal" }, 500);
    }
    // Mallarna fungerar alltid; Claude är en förbättring, inte ett krav.
  }
  return json({ packages, price, media_ids: ctx.media_ids, removed: guard.removed, warnings: guard.warnings, source });
});

// Marketplace Agent: POST { listing_id, channels } → { packages: {kanal: {title, body, media_ids, category, warnings}}, price }.
// Claude får bara det annonsen får innehålla – aldrig givarens namn, inköpspris eller lagerplats (INV-12).
// Prisförslaget räknas deterministiskt (jämförbara försäljningar och inköpspris) och motiveras.
// Texterna kontrolleras efteråt; hittas något som inte får stå där används standardpaketet.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { context, handle, HttpError, json, query } from "../_server/http.ts";
import { anthropic, apiErrorResponse, assertBudget, FALLBACK_BETA, MODEL, recordUsage } from "../_server/claude.ts";
import { LISTING_SYSTEM, ListingOutput } from "../_server/schemas.ts";
import { adapterFromCode, buildChannelPackage, suggestPrice, type ChannelPackage } from "../_shared/listingPackage.ts";
import { checkText } from "../_shared/privacyGuard.ts";

Deno.serve(handle(async (req) => {
  const ctx = await context(req, ["owner", "helper"]);
  const { listing_id, channels } = await req.json() as { listing_id: string; channels: string[] };
  if (!listing_id) throw new HttpError(400, "missing_field", "listing_id saknas");
  const codes: any[] = ctx.raw.codes?.channel ?? [];
  const adapters = (channels ?? []).map((c) => codes.find((x) => x.code === c)).filter(Boolean).map((c) => adapterFromCode(c));

  const [pkg, listing, storage] = await Promise.all([
    query<any>(ctx.sb, "q_listing_package", { listing_id }),
    query<any>(ctx.sb, "q_listing", { id: listing_id }),
    query<any[]>(ctx.sb, "q_storage_tree").catch(() => []),
  ]);
  if (!pkg) throw new HttpError(404, "not_found", "Annonsen finns inte");
  const forbiddenNames = (listing?.object?.acquisitions ?? []).flatMap((a: any) => a.counterpart ? [a.counterpart.display_name, a.counterpart.display_name.split(" ")[0]] : []);
  const storagePlaces = (storage ?? []).map((s) => s.name);
  const price = suggestPrice(pkg);

  // Standardpaketen är både reserv och facit för vad som får stå i annonsen
  const packages: Record<string, ChannelPackage> = {};
  for (const a of adapters) packages[a.code] = buildChannelPackage(pkg, a, { forbiddenNames, storagePlaces });

  await assertBudget(ctx);
  // Det Claude får se: annonsens innehåll utan inköpspris och utan något om givaren
  const safe = { type: pkg.type, title: pkg.title, description: pkg.description, price: pkg.price, quantity: pkg.quantity, unit: pkg.unit, condition: pkg.condition,
    object: pkg.object ? { title: pkg.object.title, material: pkg.object.material, dimensions: pkg.object.dimensions, age_period: pkg.object.age_period,
      weight_kg: pkg.object.weight_kg, living_material: pkg.object.living_material, species_variety: pkg.object.species_variety } : null,
    need: pkg.need, locality: pkg.locality, category: pkg.category?.name };
  try {
    const response = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(ListingOutput) },
      system: [{ type: "text", text: LISTING_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Kanaler: ${adapters.map((a) => `${a.code} (${a.label}${a.title_max_length ? `, rubrik högst ${a.title_max_length} tecken` : ""}${a.supports_price === false ? ", inget pris" : ""})`).join("; ")}

Annonsen (JSON):
${JSON.stringify(safe)}` }],
    });
    await recordUsage(ctx.sb, "marketplace-agent", response.usage);
    if (response.stop_reason !== "refusal") {
      for (const p of response.parsed_output?.posts ?? []) {
        const a = adapters.find((x) => x.code === p.channel);
        if (!a) continue;
        const title = a.title_max_length && p.title.length > a.title_max_length ? packages[a.code].title : p.title.trim();
        const found = checkText(`${title}\n${p.body}`, { forbiddenNames, storagePlaces, allowPrices: true });
        if (pkg.purchase_price && new RegExp(`\\b${pkg.purchase_price}\\s*kr`).test(p.body)) found.push({ kind: "price", text: `${pkg.purchase_price} kr` });
        if (found.length) { packages[a.code].warnings.push(`AI-texten innehöll ${found.map((f) => f.text).join(", ")} – standardtexten används`); continue; }
        packages[a.code] = { ...packages[a.code], title, body: p.body.trim() };
      }
    }
  } catch (e) {
    const http = apiErrorResponse(e);
    if (!http || http.status !== 429) throw http ?? e;
  }
  return json({ packages, price });
}));

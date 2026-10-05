// Marketplace Agent på klientsidan. Med Supabase byggs paketen på servern (Claude + samma
// guard); i demoläge och vid fel byggs de lokalt från mallar med samma integritetsregler.
import type { Repo } from "../data/repo";
import { SupabaseRepo } from "../data/supabaseRepo";
import type { Listing } from "../domain/types";
import { buildPackage, guardListing, suggestPrice, type ListingPackage, type PriceSuggestion, type RawListingContext, type SafeListingContext } from "../../supabase/functions/_shared/listingPackage";

export interface PackageResult {
  ok: boolean;
  packages: ListingPackage[];
  price: PriceSuggestion | null;
  media_ids: string[];
  removed: string[];
  warnings: string[];
  context: SafeListingContext | null;
  source: "claude" | "mall";
}

/** Rå annonskontext från datalagret (samma uppgifter som edge-funktionen hämtar). */
export async function rawListingContext(repo: Repo, listing: Listing): Promise<RawListingContext> {
  const object = listing.object_id ? await repo.object(listing.object_id) : null;
  const [acqs, leads, persons, locations, structures, site, media] = await Promise.all([
    object ? repo.acquisitionsFor(object.id) : Promise.resolve([]),
    repo.leads(listing.id),
    repo.persons(),
    repo.storageLocations(),
    repo.structures(),
    repo.site(),
    object ? repo.mediaFor("object", object.id) : Promise.resolve([]),
  ]);
  const personIds = new Set([...acqs.map((a) => a.person_id), ...leads.map((l) => l.person_id)].filter(Boolean));
  return {
    listing: { type: listing.type, title: listing.title, description: listing.description, price: listing.price, quantity: listing.quantity, locality: listing.locality },
    object: object && {
      title: object.title, category: object.category, description: object.description, material: object.material, dimensions: object.dimensions,
      era: object.era, condition: object.condition, quantity: object.quantity, unit: object.unit, is_batch: object.is_batch, visibility: object.visibility,
    },
    person_names: persons.filter((p) => personIds.has(p.id)).map((p) => p.name),
    place_names: [...locations.map((l) => l.name), ...structures.map((s) => s.name), ...(site ? [site.name] : [])],
    purchase_price: acqs.find((a) => a.price != null)?.price ?? null,
    media: media.map((m) => ({ id: m.id, visibility: m.visibility, has_people: m.has_people, has_clean: !!m.clean_path })),
  };
}

async function comparables(repo: Repo, category: string, exclude: string | null) {
  if (!category) return [];
  const objects = (await repo.objects()).filter((o) => o.category === category && o.id !== exclude);
  const ids = new Set(objects.map((o) => o.id));
  return (await repo.disposals()).filter((d) => d.type === "sold" && ids.has(d.object_id) && d.price != null).map((d) => ({ price: d.price!, quantity: d.quantity }));
}

export async function packagesForListing(repo: Repo, listing: Listing, channels: string[]): Promise<PackageResult> {
  const raw = await rawListingContext(repo, listing);
  const guard = guardListing(raw);
  if (!guard.allowed || !guard.context) {
    return { ok: false, packages: [], price: null, media_ids: [], removed: guard.removed, warnings: guard.warnings, context: null, source: "mall" };
  }
  if (repo instanceof SupabaseRepo) {
    const { data, error } = await repo.client.functions.invoke<{
      packages: ListingPackage[]; price: PriceSuggestion; media_ids: string[]; removed: string[]; warnings: string[]; source: "claude" | "mall"; error?: string;
    }>("marketplace-agent", { body: { listing_id: listing.id, channels } });
    if (!error && data && !data.error) return { ok: true, ...data, context: guard.context };
  }
  const object = listing.object_id ? await repo.object(listing.object_id) : null;
  return {
    ok: true,
    packages: channels.map((c) => buildPackage(guard.context!, c)),
    price: suggestPrice({
      type: listing.type,
      quantity: listing.quantity,
      total_quantity: object?.quantity ?? 1,
      condition: object?.condition ?? null,
      purchase_price: raw.purchase_price,
      comparables: await comparables(repo, object?.category ?? "", object?.id ?? null),
    }),
    media_ids: guard.context.media_ids,
    removed: guard.removed,
    warnings: guard.warnings,
    context: guard.context,
    source: "mall",
  };
}

// Annonspaket (specifikationen 9.3) och integritetsregler för annonser (INV-12, AC-11).
// Deterministisk kod: används i webbläsaren (demoläge och reserv) och i edge-funktionen
// marketplace-agent, som också kör assertClean på Claudes text innan den lämnas ut.
import type { Vis } from "./privacyGuard.ts";
import { adapter, type ListingKind } from "./channels.ts";

export interface RawListingContext {
  listing: { type: ListingKind; title: string; description: string; price: number | null; quantity: number | null; locality: string };
  object: {
    title: string;
    category: string;
    description: string;
    material: string;
    dimensions: string;
    era: string;
    condition: number | null;
    quantity: number;
    unit: string;
    is_batch: boolean;
    visibility: Vis;
  } | null;
  /** Givare, säljare och intressenter – nämns aldrig i en annons. */
  person_names: string[];
  /** Lagerplatser, byggnader och fastighetsnamn – nämns aldrig i en annons. */
  place_names: string[];
  /** Privat. Används bara för prisförslaget och lämnar aldrig guarden. */
  purchase_price: number | null;
  media: { id: string; visibility: Vis; has_people: boolean; has_clean: boolean }[];
}

export interface SafeListingContext {
  type: ListingKind;
  title: string;
  description: string;
  price: number | null;
  quantity: number | null;
  unit: string;
  locality: string;
  category: string;
  material: string;
  dimensions: string;
  era: string;
  condition_label: string | null;
  media_ids: string[];
}

export interface ListingGuardResult {
  allowed: boolean;
  context: SafeListingContext | null;
  removed: string[];
  warnings: string[];
}

export const CONDITION_LABEL: Record<number, string> = {
  1: "behöver mycket arbete",
  2: "behöver renoveras",
  3: "brukbart skick",
  4: "gott skick",
  5: "mycket gott skick",
};

const SENSITIVE: { label: string; re: RegExp }[] = [
  { label: "fastighetsbeteckning", re: /\b[A-ZÅÄÖ][a-zåäöé]+(?:[ -][A-ZÅÄÖ]?[a-zåäöé]+)?\s\d{1,4}:\d{1,4}\b/g },
  { label: "gatuadress", re: /\b[A-ZÅÄÖ][a-zåäöé]*(?:gatan|vägen|väg|gränd|stigen|torget|backen|allén|leden|plan)\s+\d+\s?[A-Za-z]?\b/g },
  { label: "postnummer", re: /\b\d{3}\s\d{2}\b/g },
  { label: "telefonnummer", re: /(?:\+46|\b0)[\s-]?\d{1,3}(?:[\s-]?\d{2,3}){2,4}\b/g },
  { label: "e-postadress", re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { label: "koordinater", re: /\b\d{1,3}[.,]\d{4,}\s*[,;]?\s*\d{1,3}[.,]\d{4,}\b/g },
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tar bort namn, platser och adressliknande uppgifter ur en text. */
export function scrubText(text: string, names: string[], places: string[]): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  for (const { label, re } of SENSITIVE) {
    out = out.replace(re, () => {
      hits.push(label);
      return "";
    });
  }
  for (const n of [...names, ...places].filter((x) => x && x.trim().length >= 2).sort((a, b) => b.length - a.length)) {
    // Även genitiv ("Gunillas torp") räknas som namnet
    const re = new RegExp(`(?<![\\p{L}\\d])${escapeRe(n.trim())}s?(?![\\p{L}\\d])`, "giu");
    out = out.replace(re, () => {
      hits.push(names.includes(n) ? `namn: ${n}` : `plats: ${n}`);
      return "";
    });
  }
  out = out.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").replace(/\(\s*\)/g, "").replace(/^[ \t]+|[ \t]+$/gm, "").trim();
  return { text: out, hits: [...new Set(hits)] };
}

/** Ort på kommunnivå: aldrig gata, nummer eller postnummer (INV-12). */
export function safeLocality(locality: string): { value: string; changed: boolean } {
  const last = locality.split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? "";
  const value = last.replace(/\d+/g, "").replace(/\s{2,}/g, " ").trim();
  return { value, changed: value !== locality.trim() };
}

const PUBLISHABLE: Vis[] = ["shareable", "public"];

export function guardListing(raw: RawListingContext): ListingGuardResult {
  const removed: string[] = [];
  const warnings: string[] = [];
  if (raw.object?.visibility === "private") {
    return { allowed: false, context: null, removed: ["hela objektet"], warnings: ["Objektet är privat och kan inte annonseras. Ändra synligheten först."] };
  }
  if (raw.purchase_price != null) removed.push("inköpspris");

  const scrub = (t: string) => {
    const r = scrubText(t, raw.person_names, raw.place_names);
    for (const h of r.hits) {
      if (!removed.includes(h)) removed.push(h);
    }
    return r.text;
  };
  const before = removed.length;
  const title = scrub(raw.listing.title || raw.object?.title || "");
  const description = scrub(raw.listing.description || raw.object?.description || "");
  const material = scrub(raw.object?.material ?? "");
  const dimensions = scrub(raw.object?.dimensions ?? "");
  const era = scrub(raw.object?.era ?? "");
  if (removed.length > before) warnings.push("Texten innehöll namn, platser eller adressuppgifter som har tagits bort.");

  const loc = safeLocality(raw.listing.locality);
  if (loc.changed) {
    removed.push("adress i orten");
    warnings.push(`Orten visas som ”${loc.value || "–"}” – annonser visar bara ort, aldrig adress.`);
  }
  if (!loc.value) warnings.push("Ange ort (kommun eller tätort) så att köpare vet var saken hämtas.");

  const media_ids: string[] = [];
  for (const m of raw.media) {
    if (!m.has_clean) removed.push("bild utan rensad kopia");
    else if (!PUBLISHABLE.includes(m.visibility)) removed.push("intern bild");
    else if (m.has_people) removed.push("bild med personer");
    else media_ids.push(m.id);
  }
  if (media_ids.length === 0) warnings.push("Ingen bild kan användas ännu – annonser med bild får fler svar.");

  return {
    allowed: true,
    removed,
    warnings,
    context: {
      type: raw.listing.type,
      title,
      description,
      price: raw.listing.type === "give" ? 0 : raw.listing.price,
      quantity: raw.listing.quantity ?? (raw.object?.is_batch ? raw.object.quantity : null),
      unit: raw.object?.unit ?? "st",
      locality: loc.value,
      category: raw.object?.category ?? "",
      material,
      dimensions,
      era,
      condition_label: raw.object?.condition ? CONDITION_LABEL[raw.object.condition] ?? null : null,
      media_ids,
    },
  };
}

export interface ListingPackage {
  channel: string;
  title: string;
  text: string;
  category: string;
  price_label: string;
  image_ids: string[];
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

export function priceLabel(ctx: SafeListingContext): string {
  if (ctx.type === "give") return "Gratis";
  if (ctx.type === "wanted" || ctx.type === "help_wanted") return "";
  if (ctx.price == null) return "Pris enligt överenskommelse";
  const each = ctx.quantity && ctx.quantity > 1 ? ` (${Math.round((ctx.price / ctx.quantity) * 100) / 100} kr/${ctx.unit})` : "";
  return `${ctx.price.toLocaleString("sv-SE")} kr${each}`;
}

const LEAD_IN: Record<ListingKind, string> = {
  sell: "Säljes",
  give: "Skänkes",
  exchange: "Bytes",
  lend: "Lånas ut",
  wanted: "Sökes",
  help_wanted: "Hjälp sökes",
};

/** Mallbaserat annonspaket för en kanal (används när Marketplace Agent inte kan nås). */
export function buildPackage(ctx: SafeListingContext, channelId: string): ListingPackage {
  const a = adapter(channelId);
  if (!a) throw new Error(`Okänd kanal: ${channelId}`);
  const qty = ctx.quantity && ctx.quantity > 1 ? `${ctx.quantity} ${ctx.unit === "st" ? "" : `${ctx.unit} `}` : "";
  const keyDim = ctx.dimensions ? `, ${ctx.dimensions}` : "";
  const baseTitle = `${qty}${qty ? ctx.title.charAt(0).toLowerCase() + ctx.title.slice(1) : ctx.title}${keyDim}`.replace(/\s+/g, " ").trim();
  const title = truncate(a.id.startsWith("facebook_group") ? `${LEAD_IN[ctx.type]}: ${baseTitle}` : baseTitle, a.title_max_length);

  const facts = [
    ctx.material && `Material: ${ctx.material}`,
    ctx.dimensions && `Mått: ${ctx.dimensions}`,
    ctx.era && `Ålder: ${ctx.era}`,
    ctx.condition_label && `Skick: ${ctx.condition_label}`,
    ctx.quantity && ctx.quantity > 1 ? `Antal: ${ctx.quantity} ${ctx.unit}` : "",
  ].filter(Boolean) as string[];
  const pl = priceLabel(ctx);
  const where = ctx.locality ? (ctx.type === "wanted" || ctx.type === "help_wanted" ? `Vi finns i ${ctx.locality}.` : `Hämtas i ${ctx.locality}.`) : "";
  const body = [
    `${LEAD_IN[ctx.type]}: ${baseTitle.charAt(0).toLowerCase() + baseTitle.slice(1)}.`,
    ctx.description ? cap(ctx.description.replace(/\.?$/, ".")) : "",
    facts.join("\n"),
    ctx.type === "sell" ? (ctx.price != null ? `Pris: ${pl}` : "Pris enligt överenskommelse.") : ctx.type === "give" ? "Gratis mot att du hämtar." : "",
    where,
    ctx.type === "sell" || ctx.type === "give" ? "Återbrukat från Vreta – hellre nytt liv än container." : "Hör gärna av dig om du har något liknande!",
    a.footer,
  ].filter(Boolean).join("\n\n");
  return {
    channel: a.id,
    title,
    text: truncate(body, a.text_max_length),
    category: a.categories[ctx.category] ?? "",
    price_label: a.supports_price ? pl : "",
    image_ids: ctx.media_ids.slice(0, Math.min(a.max_images, 8)),
  };
}

/** Sista kontroll av en färdig text (även Claudes): inget namn, ingen plats, ingen adress. */
export function assertClean(text: string, raw: Pick<RawListingContext, "person_names" | "place_names" | "purchase_price">): { text: string; hits: string[] } {
  const r = scrubText(text, raw.person_names, raw.place_names);
  return { text: r.text, hits: r.hits };
}

// ---------------------------------------------------------------- prisförslag
export interface PriceSuggestion {
  price: number | null;
  motivation: string;
}

const CONDITION_FACTOR: Record<number, number> = { 1: 0.4, 2: 0.6, 3: 0.85, 4: 1.1, 5: 1.3 };

function round(p: number) {
  const step = p >= 1000 ? 50 : p >= 100 ? 10 : 5;
  return Math.max(step, Math.round(p / step) * step);
}

/**
 * Prisförslag med motivering (9.3). Användaren sätter alltid priset själv.
 * comparables: tidigare försäljningar i samma kategori (pris och antal).
 */
export function suggestPrice(input: {
  type: ListingKind;
  quantity: number | null;
  total_quantity: number;
  condition: number | null;
  purchase_price: number | null;
  comparables: { price: number; quantity: number | null }[];
}): PriceSuggestion {
  if (input.type === "give") return { price: 0, motivation: "Skänkes – inget pris." };
  if (input.type === "wanted" || input.type === "help_wanted") return { price: null, motivation: "Efterlysningar har inget pris." };
  const qty = input.quantity ?? input.total_quantity;
  const unitPrices = input.comparables.filter((c) => c.price > 0).map((c) => c.price / (c.quantity || 1)).sort((a, b) => a - b);
  if (unitPrices.length) {
    const median = unitPrices[Math.floor(unitPrices.length / 2)];
    return {
      price: round(median * qty),
      motivation: `Bygger på ${unitPrices.length} tidigare ${unitPrices.length === 1 ? "försäljning" : "försäljningar"} i samma kategori (cirka ${Math.round(median)} kr per styck).`,
    };
  }
  if (input.purchase_price != null && input.purchase_price > 0) {
    const share = input.total_quantity > 0 ? qty / input.total_quantity : 1;
    const factor = CONDITION_FACTOR[input.condition ?? 3] ?? 0.85;
    return {
      price: round(input.purchase_price * share * factor),
      motivation: `Bygger på vad du betalade${share < 1 ? ` (andel ${Math.round(share * 100)} %)` : ""} och skicket${input.condition ? ` ${input.condition}/5` : ""}. Inköpspriset syns aldrig i annonsen.`,
    };
  }
  return { price: null, motivation: "Inget underlag ännu – jämför med liknande annonser i kanalen." };
}

// ---------------------------------------------------------------- svarsutkast till intressenter
export type ReplyStage = "available" | "booking" | "agreed" | "taken" | "next_in_line";

export function draftLeadReply(ctx: SafeListingContext, stage: ReplyStage, firstName: string | null): string {
  const hi = firstName ? `Hej ${firstName}!` : "Hej!";
  const what = ctx.title.charAt(0).toLowerCase() + ctx.title.slice(1);
  const where = ctx.locality ? ` i ${ctx.locality}` : "";
  switch (stage) {
    case "available":
      return `${hi} Ja, ${what} finns kvar. Vill du komma och titta? Det hämtas${where}. När passar det dig?`;
    case "booking":
      return `${hi} Toppen – då ses vi. Jag skickar exakt vägbeskrivning när vi bestämt tid.`;
    case "agreed":
      return `${hi} Då är det ditt${ctx.type === "sell" && ctx.price ? ` för ${priceLabel(ctx)}` : ""}. Jag håller det åt dig tills du hämtar.`;
    case "taken":
      return `${hi} Tack för intresset! Tyvärr har ${what} redan fått ett nytt hem. Jag hör av mig om något liknande dyker upp.`;
    case "next_in_line":
      return `${hi} Den som var före dig i kön hoppade av – är du fortfarande intresserad av ${what}?`;
  }
}

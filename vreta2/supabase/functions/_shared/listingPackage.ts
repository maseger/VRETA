// Annonspaket per kanal (R1.1 9.3) och kanaladaptrar (9.2). Gränssnittet anpassar sig efter adaptern,
// aldrig efter hårdkodade antaganden. Texten nämner aldrig givare, adress, lagerplats eller inköpspris (INV-12).
import type { ChannelAdapter } from "./types.ts";
import { checkText, scrubText } from "./privacyGuard.ts";

export function adapterFromCode(v: { code: string; label: string; attributes: Record<string, any> }): ChannelAdapter {
  const a = v.attributes ?? {};
  return {
    code: v.code, label: v.label, kind: a.kind ?? "marketplace", max_images: a.max_images ?? 10, title_max_length: a.title_max_length,
    supports_price: a.supports_price, supports_free: a.supports_free, publish_modes: a.publish_modes ?? ["manual"],
    share_text: a.share_text ?? true, hashtags: a.hashtags,
  };
}

// Facebook och Instagram tar bara emot bilderna från andra appar – texten måste klistras in (R1.1 8.4).
export function needsPaste(adapter: Pick<ChannelAdapter, "share_text">): boolean {
  return !adapter.share_text;
}

const CONDITION = ["", "Slitet, behöver lagas", "Begagnat med tydliga spår", "Gott begagnat skick", "Fint skick", "Som nytt"];

export type ListingPackageInput = {
  type: string;
  title: string;
  description?: string | null;
  price?: number | null;
  quantity?: number | null;
  unit?: string | null;
  condition?: number | null;
  object?: { title: string; material?: string | null; dimensions?: string | null; age_period?: string | null; weight_kg?: number | null;
             story_why?: string | null; living_material?: boolean; species_variety?: string | null } | null;
  category?: { name: string; channel_mapping?: Record<string, string> } | null;
  locality?: string | null;
  media?: { id: string; share_path?: string | null }[];
  purchase_price?: number | null;
  comparable_sales?: { title: string; price: number; quantity?: number | null; condition?: number | null }[];
  need?: { title: string; progress: string; project?: string | null } | null;
};

export type ChannelPackage = { channel: string; title: string; body: string; media_ids: string[]; category?: string | null; warnings: string[] };

function fit(title: string, max?: number): string {
  if (!max || title.length <= max) return title;
  return title.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

export function suggestPrice(pkg: ListingPackageInput): { price: number | null; rationale: string } {
  if (!["sell", "exchange", "lend"].includes(pkg.type)) return { price: null, rationale: pkg.type === "give" ? "Skänks bort" : "" };
  const parts: string[] = [];
  const qty = Math.max(1, pkg.quantity ?? 1);
  const comps = (pkg.comparable_sales ?? []).map((c) => c.price / Math.max(1, c.quantity ?? 1)).sort((a, b) => a - b);
  let each: number | null = null;
  if (pkg.purchase_price) parts.push(`köpt ${Math.round(pkg.purchase_price / qty)} kr/st`);
  if (pkg.condition) parts.push(`skick ${pkg.condition}/5`);
  if (comps.length) {
    parts.push(`sålda liknande ${Math.round(comps[0])}–${Math.round(comps[comps.length - 1])} kr`);
    each = comps[Math.floor(comps.length / 2)];
  } else if (pkg.purchase_price) {
    each = (pkg.purchase_price / qty) * (pkg.condition && pkg.condition >= 4 ? 2 : 1.5);
  }
  if (each === null) return { price: null, rationale: "Ingen prisgrund – sätt priset själv" };
  const rounded = each >= 100 ? Math.round(each / 50) * 50 : Math.max(10, Math.round(each / 10) * 10);
  return { price: rounded, rationale: parts.join(" · ") };
}

export function buildChannelPackage(pkg: ListingPackageInput, adapter: ChannelAdapter, opts: { forbiddenNames?: string[]; storagePlaces?: string[] } = {}): ChannelPackage {
  const o = pkg.object;
  const qty = pkg.quantity && pkg.quantity > 1 ? `${pkg.quantity} ${pkg.unit ?? "st"} ` : "";
  const dims = o?.dimensions ? `, ${o.dimensions}` : "";
  let title: string;
  const lines: string[] = [];
  if (pkg.type === "wanted" || pkg.type === "help_wanted") {
    title = pkg.title;
    lines.push(pkg.type === "help_wanted" ? `Vi söker hjälp: ${pkg.title.toLocaleLowerCase("sv")}.` : `Vi söker ${pkg.title.toLocaleLowerCase("sv")}.`);
    if (pkg.description) lines.push(pkg.description);
    if (pkg.need) lines.push(`Till ${pkg.need.project ?? "ett projekt på Vreta"} – ${pkg.need.progress} hittills.`);
    lines.push("Hör av dig om du har något liggande eller vet var det finns!");
  } else {
    title = fit(`${qty}${pkg.title}${dims}`.replace(/^\d+ st (.)/, (m) => m), adapter.title_max_length);
    if (pkg.description) lines.push(pkg.description);
    else if (o) lines.push([o.title, o.age_period ? `från ${o.age_period.toLocaleLowerCase("sv")}` : null, o.material ? `i ${o.material.toLocaleLowerCase("sv")}` : null].filter(Boolean).join(" ") + ".");
    const facts: string[] = [];
    if (pkg.condition) facts.push(`Skick: ${CONDITION[pkg.condition]} (${pkg.condition}/5)`);
    if (o?.dimensions) facts.push(`Mått: ${o.dimensions}`);
    if (o?.material) facts.push(`Material: ${o.material}`);
    if (o?.weight_kg) facts.push(`Vikt: ca ${o.weight_kg} kg${pkg.quantity && pkg.quantity > 1 ? "/st" : ""}`);
    if (o?.living_material && o.species_variety) facts.push(`Sort: ${o.species_variety}`);
    if (facts.length) lines.push(facts.join("\n"));
    if (pkg.type === "give") lines.push("Skänkes till den som kan hämta.");
    else if (pkg.price && adapter.supports_price !== false) lines.push(`Pris: ${pkg.price} kr${pkg.quantity && pkg.quantity > 1 ? "/st" : ""}.`);
    // Platsen anges bara på ortsnivå (INV-12)
    lines.push(`Hämtas i ${pkg.locality || "Uppsala kommun"}.`);
  }
  const scrubbed = scrubText(lines.join("\n\n"), { forbiddenNames: opts.forbiddenNames, keepPrices: true });
  const warnings = checkText(scrubbed.text, { forbiddenNames: opts.forbiddenNames, storagePlaces: opts.storagePlaces, allowPrices: true })
    .map((v) => `Kontrollera: ${v.text}`);
  return {
    channel: adapter.code,
    title,
    body: scrubbed.text,
    media_ids: (pkg.media ?? []).filter((m) => m.share_path).slice(0, adapter.max_images).map((m) => m.id),
    category: pkg.category?.channel_mapping?.[adapter.code] ?? pkg.category?.name ?? null,
    warnings,
  };
}

export function leadReplyDraft(kind: "reply" | "viewing" | "agreed" | "next_in_line" | "sold_elsewhere", listingTitle: string, firstName?: string | null): string {
  const hej = firstName ? `Hej ${firstName}!` : "Hej!";
  switch (kind) {
    case "viewing": return `${hej} Ja, ${listingTitle.toLocaleLowerCase("sv")} finns kvar. Passar det att titta på lördag kl 11?`;
    case "agreed": return `${hej} Vad roligt – då säger vi så. Jag skickar adressen och en vägbeskrivning.`;
    case "next_in_line": return `${hej} Den som var före dig kom inte, så om du fortfarande är intresserad är ${listingTitle.toLocaleLowerCase("sv")} din.`;
    case "sold_elsewhere": return `${hej} Tack för intresset! ${listingTitle} har tyvärr fått ett nytt hem.`;
    default: return `${hej} Tack för ditt meddelande. Ja, ${listingTitle.toLocaleLowerCase("sv")} finns kvar.`;
  }
}

// Instruktion till Claude i Chrome (webbläsaragenten, P1): inloggning, betalning och sista klicket gör människan.
export function browserAgentInstruction(pkg: ChannelPackage, channelLabel: string): string {
  return [
    `Lägg upp en annons på ${channelLabel} i min inloggade webbläsare.`,
    `Rubrik: ${pkg.title}`,
    `Text:\n${pkg.body}`,
    pkg.category ? `Kategori: ${pkg.category}` : null,
    "Använd bilderna jag sparade från VRETA (de saknar platsdata).",
    "Logga inte in åt mig, betala inget och tryck inte på publicera – stanna innan sista klicket och låt mig granska.",
    "När annonsen är publicerad: kopiera annonsens adress så att jag kan klistra in den i VRETA.",
  ].filter(Boolean).join("\n\n");
}

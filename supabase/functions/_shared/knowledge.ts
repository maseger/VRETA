// Kunskapsverktygen bakom Fråga Vreta (specifikationen 11.3 och 11.6).
// Samma verktyg används av Claude på servern och av den lokala tolkningen i demoläget.
// Verktygen läser bara via en KStore som redan är behörighetsfiltrerad: i webbläsaren
// datalagrets rollregler, på servern databasens radnivåsäkerhet med användarens inloggning.
// Privata fält (pris, kontakt, anteckningar) finns därför bara med när användaren får se dem.
// Åtgärdsverktyg utför aldrig något – de returnerar ett förslag som användaren bekräftar.

export type Role = "owner" | "contributor" | "viewer";

export interface KObject {
  id: string; title: string; category: string; description: string; material: string; quantity: number; unit: string;
  status: string; is_batch: boolean; storage_location_id: string | null; zone_id: string | null; structure_id: string | null;
  created_at: string; updated_at: string;
}
export interface KAllocation { object_id: string; id: string; quantity: number; status: string; storage_location_id: string | null; zone_id: string | null; structure_id: string | null; updated_at: string }
export interface KNamed { id: string; name: string }
export interface KLocation extends KNamed { parent_id: string | null }
export interface KPerson extends KNamed { locality: string; roles: string[]; notes?: string; contact?: string }
export interface KAcquisition { id: string; object_id: string; person_id: string | null; type: string; status: string; price?: number | null; created_at: string }
export interface KDisposal { id: string; object_id: string; person_id: string | null; type: string; quantity: number | null; occurred_at: string; price?: number | null }
export interface KContribution { id: string; person_id: string; kind: string; description: string; occurred_at: string; thanked_at: string | null; object_id: string | null }
export interface KListing { id: string; object_id: string | null; title: string; type: string; status: string }
export interface KLead { id: string; listing_id: string; person_id: string | null; status: string; message: string; queue_position: number; created_at: string }
export interface KTask { id: string; title: string; due: string | null; status: string; entity_type: string; entity_id: string | null }
export interface KPickup { id: string; title: string; scheduled_date: string | null; status: string }
export interface KInteraction { id: string; person_id: string | null; summary: string; follow_up: string | null; occurred_at: string }
export interface KEvent { id: string; event_type: string; summary: string; occurred_at: string; story_worthy: boolean }
export interface KNote { entity_type: string; entity_id: string; kind: string; text: string }
export interface KContent { source_type: string; source_id: string; status: string; goal: string }
export interface KObservation { id: string; kind: string; text: string; zone_id: string | null; occurred_at: string }
export interface KDecision { id: string; question: string; choice: string; rationale: string; zone_id: string | null; decided_on: string }

/** Behörighetsfiltrerad läsning. Implementeras av datalagret i webbläsaren och av Supabase på servern. */
export interface KStore {
  role: Role;
  today: string; // ÅÅÅÅ-MM-DD
  objects(): Promise<KObject[]>;
  allocations(): Promise<KAllocation[]>;
  storageLocations(): Promise<KLocation[]>;
  zones(): Promise<KNamed[]>;
  structures(): Promise<KNamed[]>;
  persons(): Promise<KPerson[]>;
  acquisitions(): Promise<KAcquisition[]>;
  disposals(): Promise<KDisposal[]>;
  contributions(): Promise<KContribution[]>;
  listings(): Promise<KListing[]>;
  leads(): Promise<KLead[]>;
  tasks(): Promise<KTask[]>;
  pickups(): Promise<KPickup[]>;
  interactions(): Promise<KInteraction[]>;
  events(): Promise<KEvent[]>;
  eventsFor(entityType: string, entityId: string): Promise<KEvent[]>;
  notes(): Promise<KNote[]>;
  content(): Promise<KContent[]>;
  observations(): Promise<KObservation[]>;
  decisions(): Promise<KDecision[]>;
  proposalsWaiting(): Promise<number>;
}

export interface SourceCard {
  type: "object" | "person" | "listing" | "pickup" | "zone" | "storage" | "task" | "journal";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export type PendingAction =
  | { kind: "move"; object_id: string; location_id: string; label: string }
  | { kind: "task"; title: string; due: string | null; entity_id: string | null; label: string }
  | { kind: "navigate"; href: string; label: string }
  | { kind: "capture"; text: string; label: string };

export interface ToolResult {
  /** Fakta till modellen (eller till mallsvaret). Bara behörig data. */
  facts: unknown;
  cards: SourceCard[];
  action?: PendingAction;
  /** Kort svar på svenska när verktyget används utan modell (demoläge, reserv). */
  answer: string;
}

export const STATUS_SV: Record<string, string> = {
  discovered: "upptäckt", contacted: "kontaktad", reserved: "reserverad", pickup_planned: "hämtning planerad", collected: "hämtad",
  stored: "i lager", processing: "renoveras", in_use: "i bruk", listed: "utannonserad", reserved_out: "reserverad för köpare",
  lent: "utlånad", declined: "avstått", lost: "missat", sold: "såld", donated: "skänkt", exchanged: "bytt", discarded: "kasserad",
};
const IN_STOCK = ["collected", "stored", "processing", "listed", "reserved_out"];

// ---------------------------------------------------------------- svensk matchning
const STOP = new Set(["var", "är", "finns", "ligger", "mina", "min", "mitt", "de", "den", "det", "alla", "jag", "har", "vad", "vilka", "som", "i", "på", "från", "till", "och", "en", "ett", "the"]);
const SUFFIXES = ["arnas", "ernas", "ornas", "arna", "erna", "orna", "ens", "ets", "en", "et", "na", "ar", "er", "or", "n", "s"];

export function stem(word: string): string {
  const w = word.toLowerCase().replace(/[^\p{L}\d]/gu, "");
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length);
  return w;
}

// Svenskt e-bortfall: "tegel" → "teglet", "fönster" → "fönstret", "socken" → "socknen"
const syncope = (w: string) => w.replace(/e([lnr])$/, "$1");

export function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\d]+/u).filter((t) => t.length >= 2 && !STOP.has(t)).map(stem);
}

/** Poäng för hur väl en text matchar en fråga (sammansatta ord: "tegelpartiet" matchar "tegel"). */
export function matchScore(query: string, haystack: string): number {
  const q = tokens(query);
  const h = tokens(haystack);
  if (!q.length || !h.length) return 0;
  let score = 0;
  const forms = (w: string) => [w, syncope(w)];
  const pairs = (t: string, w: string) => forms(t).flatMap((a) => forms(w).map((b) => [a, b] as const));
  for (const t of q) {
    if (h.some((w) => pairs(t, w).some(([a, b]) => a === b))) score += 3;
    else if (h.some((w) => pairs(t, w).some(([a, b]) => (b.length >= 3 && a.startsWith(b)) || (a.length >= 3 && b.startsWith(a))))) score += 2;
    else if (t.length >= 5 && h.some((w) => w.includes(t) || (w.length >= 5 && t.includes(w)))) score += 1;
  }
  return score / q.length;
}

function best<T>(items: T[], text: (t: T) => string, query: string, min = 1.5): T[] {
  return items.map((i) => ({ i, s: matchScore(query, text(i)) })).filter((x) => x.s >= min).sort((a, b) => b.s - a.s).map((x) => x.i);
}

function locationPath(locs: KLocation[], id: string | null): string {
  const parts: string[] = [];
  let cur = locs.find((l) => l.id === id);
  while (cur && parts.length < 8) {
    parts.unshift(cur.name);
    cur = locs.find((l) => l.id === cur!.parent_id);
  }
  return parts.join(" › ");
}

const kr = (n: number) => `${n.toLocaleString("sv-SE")} kr`;
const objCard = (o: KObject, subtitle: string): SourceCard => ({ type: "object", id: o.id, title: o.title, subtitle, href: `/objekt/${o.id}` });
const personCard = (p: KPerson, subtitle: string): SourceCard => ({ type: "person", id: p.id, title: p.name, subtitle, href: `/person/${p.id}` });
const year = (s: KStore) => s.today.slice(0, 4);

// ---------------------------------------------------------------- verktyg
async function whereIs(s: KStore, o: KObject): Promise<string> {
  const [locs, zones, structures, allocs] = await Promise.all([s.storageLocations(), s.zones(), s.structures(), s.allocations()]);
  const place = (a: { status: string; storage_location_id: string | null; zone_id: string | null; structure_id: string | null }) => {
    if (a.storage_location_id) return `i lager på ${locationPath(locs, a.storage_location_id)}`;
    const z = zones.find((x) => x.id === a.zone_id)?.name ?? structures.find((x) => x.id === a.structure_id)?.name;
    if (a.status === "in_use" && z) return `i bruk i ${z}`;
    return STATUS_SV[a.status] ?? a.status;
  };
  const mine = allocs.filter((a) => a.object_id === o.id);
  if (o.is_batch && mine.length > 1) return mine.map((a) => `${a.quantity} ${o.unit} ${place(a)}`).join(", ");
  return place(o);
}

export async function findObjects(s: KStore, query: string): Promise<ToolResult> {
  const objects = (await s.objects()).filter((o) => !["declined", "lost"].includes(o.status));
  const hits = best(objects, (o) => `${o.title} ${o.category} ${o.material}`, query).slice(0, 5);
  if (!hits.length) return { facts: { hits: [] }, cards: [], answer: `Jag hittar inget som heter ”${query}”.` };
  const rows = await Promise.all(hits.map(async (o) => ({ o, where: await whereIs(s, o) })));
  return {
    facts: rows.map(({ o, where }) => ({ id: o.id, title: o.title, quantity: o.quantity, unit: o.unit, status: STATUS_SV[o.status], where })),
    cards: rows.map(({ o, where }) => objCard(o, where)),
    answer: rows.length === 1
      ? `${rows[0].o.title} (${rows[0].o.quantity} ${rows[0].o.unit}): ${rows[0].where}.`
      : `Jag hittar ${rows.length}: ${rows.map(({ o, where }) => `${o.title} – ${where}`).join("; ")}.`,
  };
}

async function findPerson(s: KStore, name: string): Promise<KPerson | null> {
  const persons = await s.persons();
  return persons.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? best(persons, (p) => p.name, name, 2)[0] ?? null;
}

export async function objectsFromPerson(s: KStore, name: string, inStockOnly: boolean): Promise<ToolResult> {
  const p = await findPerson(s, name);
  if (!p) return { facts: null, cards: [], answer: `Jag hittar ingen person som heter ${name}.` };
  const [acqs, objects] = await Promise.all([s.acquisitions(), s.objects()]);
  const mine = acqs.filter((a) => a.person_id === p.id).map((a) => ({ a, o: objects.find((o) => o.id === a.object_id) })).filter((x) => x.o) as { a: KAcquisition; o: KObject }[];
  const allocs = await s.allocations();
  const inStock = (o: KObject) => IN_STOCK.includes(o.status) || allocs.some((a) => a.object_id === o.id && IN_STOCK.includes(a.status));
  const rows = await Promise.all(mine.filter(({ o }) => !inStockOnly || inStock(o)).map(async ({ a, o }) => ({ a, o, where: await whereIs(s, o) })));
  const priced = rows.some(({ a }) => a.price !== undefined);
  const facts = rows.map(({ a, o, where }) => ({ title: o.title, quantity: o.quantity, unit: o.unit, where, ...(a.price !== undefined ? { price: a.price } : {}) }));
  if (!rows.length) {
    return { facts, cards: [personCard(p, p.roles.join(", "))], answer: `Du har inget ${inStockOnly ? "i lager " : ""}från ${p.name}.` };
  }
  return {
    facts,
    cards: [personCard(p, p.roles.join(", ")), ...rows.map(({ o, where }) => objCard(o, where))],
    answer: `Från ${p.name}${inStockOnly ? " i lager" : ""}: ${rows.map(({ a, o, where }) => `${o.quantity} ${o.unit} ${o.title.toLowerCase()} (${where}${a.price != null ? `, ${kr(a.price)}` : ""})`).join("; ")}.${!priced ? " Priser är privata och visas inte för dig." : ""}`,
  };
}

export async function whoSold(s: KStore, query: string): Promise<ToolResult> {
  const objects = await s.objects();
  const hits = best(objects, (o) => `${o.title} ${o.category}`, query).slice(0, 3);
  if (!hits.length) return { facts: null, cards: [], answer: `Jag hittar inget som heter ”${query}”.` };
  const [acqs, persons] = await Promise.all([s.acquisitions(), s.persons()]);
  const rows = hits.map((o) => ({ o, a: acqs.find((a) => a.object_id === o.id) })).filter((x) => x.a);
  if (!rows.length) return { facts: null, cards: hits.map((o) => objCard(o, STATUS_SV[o.status])), answer: "Det finns ingen anskaffning registrerad för det." };
  const text = rows.map(({ o, a }) => {
    const p = persons.find((x) => x.id === a!.person_id);
    const how = a!.type === "gift" ? "fick du av" : a!.type === "purchase" ? "köpte du av" : "kom från";
    const price = a!.price === undefined ? " (priset är privat)" : a!.price != null ? ` för ${kr(a!.price)}` : "";
    return `${o.title} ${how} ${p?.name ?? "okänd"}${a!.type === "purchase" ? price : ""}`;
  });
  return {
    facts: rows.map(({ o, a }) => ({ object: o.title, person: persons.find((x) => x.id === a!.person_id)?.name ?? null, type: a!.type, ...(a!.price !== undefined ? { price: a!.price } : {}) })),
    cards: rows.flatMap(({ o, a }) => {
      const p = persons.find((x) => x.id === a!.person_id);
      return [objCard(o, STATUS_SV[o.status]), ...(p ? [personCard(p, p.roles.join(", "))] : [])];
    }),
    answer: `${text.join(". ")}.`,
  };
}

/** Bidrag och gåvor under ett år, och vilka som inte tackats (AC-14). */
export async function contributors(s: KStore, yr = year(s)): Promise<ToolResult> {
  const [contribs, acqs, persons, content] = await Promise.all([s.contributions(), s.acquisitions(), s.persons(), s.content()]);
  const thankedBy = new Set(content.filter((c) => c.goal === "tack" && c.status === "shared" && c.source_type === "person").map((c) => c.source_id));
  const map = new Map<string, { p: KPerson; what: string[]; unthanked: number }>();
  const add = (pid: string | null, what: string, thanked: boolean) => {
    const p = persons.find((x) => x.id === pid);
    if (!p) return;
    const e = map.get(p.id) ?? { p, what: [], unthanked: 0 };
    e.what.push(what);
    if (!thanked) e.unthanked++;
    map.set(p.id, e);
  };
  for (const c of contribs.filter((c) => c.occurred_at.startsWith(yr))) add(c.person_id, c.description, !!c.thanked_at || thankedBy.has(c.person_id));
  for (const a of acqs.filter((a) => a.type === "gift" && a.created_at.startsWith(yr))) add(a.person_id, "gåva", thankedBy.has(a.person_id ?? ""));
  const rows = [...map.values()];
  const not = rows.filter((r) => r.unthanked > 0);
  return {
    facts: rows.map((r) => ({ name: r.p.name, contributions: r.what, not_thanked: r.unthanked })),
    cards: rows.map((r) => ({ ...personCard(r.p, r.unthanked ? `${r.unthanked} inte tackade` : "Tackad"), href: r.unthanked ? `/person/${r.p.id}/tacka` : `/person/${r.p.id}` })),
    answer: rows.length
      ? `${rows.length} har bidragit ${yr}: ${rows.map((r) => r.p.name).join(", ")}. ${not.length ? `Inte tackade än: ${not.map((r) => r.p.name).join(", ")}.` : "Alla är tackade."}`
      : `Inga bidrag registrerade ${yr}.`,
  };
}

export async function leadsWaiting(s: KStore): Promise<ToolResult> {
  const [leads, listings, persons] = await Promise.all([s.leads(), s.listings(), s.persons()]);
  const waiting = leads.filter((l) => l.status === "new");
  if (s.role === "viewer") return { facts: null, cards: [], answer: "Intressenter syns bara för ägare och medhjälpare." };
  const rows = waiting.map((l) => ({ l, listing: listings.find((x) => x.id === l.listing_id), p: persons.find((x) => x.id === l.person_id) }));
  return {
    facts: rows.map((r) => ({ person: r.p?.name ?? null, listing: r.listing?.title, since: r.l.created_at.slice(0, 10) })),
    cards: rows.map((r) => ({ type: "listing", id: r.listing?.id ?? r.l.listing_id, title: r.listing?.title ?? "Annons", subtitle: `${r.p?.name ?? "Intressent"} väntar på svar`, href: `/annons/${r.l.listing_id}` })),
    answer: rows.length ? `${rows.length} väntar på svar: ${rows.map((r) => `${r.p?.name ?? "någon"} om ${r.listing?.title.toLowerCase()}`).join(", ")}.` : "Ingen intressent väntar på svar.",
  };
}

/** Vad behöver jag göra idag? – samma prioritering som Idag-vyn. */
export async function todo(s: KStore): Promise<ToolResult> {
  const [tasks, pickups, interactions, leads, persons, waitingReview] = await Promise.all([s.tasks(), s.pickups(), s.interactions(), s.leads(), s.persons(), s.proposalsWaiting()]);
  const t = s.today;
  const open = tasks.filter((x) => x.status === "open" || x.status === "in_progress");
  const overdue = open.filter((x) => x.due && x.due < t);
  const dueToday = open.filter((x) => x.due === t);
  const pick = pickups.filter((p) => p.scheduled_date === t && p.status !== "completed" && p.status !== "cancelled");
  const follow = interactions.filter((i) => i.follow_up && i.follow_up <= t);
  const newLeads = leads.filter((l) => l.status === "new");
  const parts: string[] = [];
  if (waitingReview) parts.push(`${waitingReview} att granska`);
  if (pick.length) parts.push(`hämtning: ${pick.map((p) => p.title).join(", ")}`);
  if (overdue.length) parts.push(`försenat: ${overdue.map((x) => x.title).join(", ")}`);
  if (dueToday.length) parts.push(`idag: ${dueToday.map((x) => x.title).join(", ")}`);
  if (newLeads.length) parts.push(`${newLeads.length} intressent${newLeads.length > 1 ? "er" : ""} väntar på svar`);
  if (follow.length) parts.push(`följ upp ${follow.map((f) => persons.find((p) => p.id === f.person_id)?.name ?? "kontakt").join(", ")}`);
  const cards: SourceCard[] = [
    ...pick.map((p): SourceCard => ({ type: "pickup", id: p.id, title: p.title, subtitle: "Hämtning idag", href: `/hamtning/${p.id}` })),
    ...[...overdue, ...dueToday].map((x): SourceCard => ({ type: "task", id: x.id, title: x.title, subtitle: x.due && x.due < t ? `Försenad sedan ${x.due}` : "Idag", href: x.entity_type === "listing" ? `/annons/${x.entity_id}` : x.entity_id ? `/objekt/${x.entity_id}` : "/" })),
    ...follow.map((f): SourceCard => ({ type: "person", id: f.person_id ?? "", title: persons.find((p) => p.id === f.person_id)?.name ?? "Kontakt", subtitle: f.summary, href: `/person/${f.person_id}` })),
  ];
  return {
    facts: { to_review: waitingReview, pickups_today: pick.map((p) => p.title), overdue: overdue.map((x) => ({ title: x.title, due: x.due })), due_today: dueToday.map((x) => x.title), leads_waiting: newLeads.length, follow_ups: follow.map((f) => f.summary) },
    cards,
    answer: parts.length ? `Idag: ${parts.join("; ")}.` : "Inget som brådskar idag.",
  };
}

export async function longestInStock(s: KStore, limit = 5): Promise<ToolResult> {
  const objects = (await s.objects()).filter((o) => o.status === "stored" || o.status === "processing");
  const allocs = await s.allocations();
  const stored = (await s.objects()).filter((o) => o.status !== "stored" && allocs.some((a) => a.object_id === o.id && a.status === "stored"));
  const rows = [...objects, ...stored].map((o) => {
    const since = allocs.filter((a) => a.object_id === o.id && a.status === "stored").map((a) => a.updated_at).sort()[0] ?? o.updated_at;
    return { o, since };
  }).sort((a, b) => a.since.localeCompare(b.since)).slice(0, limit);
  const months = (d: string) => Math.floor((Date.parse(s.today) - Date.parse(d)) / (30.4 * 864e5));
  return {
    facts: rows.map(({ o, since }) => ({ title: o.title, since: since.slice(0, 10), months: months(since) })),
    cards: rows.map(({ o, since }) => objCard(o, `I lager sedan ${since.slice(0, 10)}${months(since) >= 12 ? " – över ett år" : ""}`)),
    answer: rows.length ? `Längst i lager: ${rows.map(({ o, since }) => `${o.title} (sedan ${since.slice(0, 10)})`).join(", ")}.` : "Inget ligger i lager just nu.",
  };
}

export async function moneyYear(s: KStore, yr = year(s)): Promise<ToolResult> {
  const [acqs, disposals] = await Promise.all([s.acquisitions(), s.disposals()]);
  const bought = acqs.filter((a) => a.type === "purchase" && a.created_at.startsWith(yr));
  const sold = disposals.filter((d) => d.type === "sold" && d.occurred_at.startsWith(yr));
  if (bought.some((a) => a.price === undefined) || sold.some((d) => d.price === undefined)) {
    return { facts: { restricted: true, purchases: bought.length, sales: sold.length }, cards: [], answer: `Priser är privata. ${yr}: ${bought.length} köp och ${sold.length} försäljningar.` };
  }
  const b = bought.reduce((x, a) => x + (a.price ?? 0), 0);
  const v = sold.reduce((x, d) => x + (d.price ?? 0), 0);
  return {
    facts: { year: yr, bought_total: b, bought_count: bought.length, sold_total: v, sold_count: sold.length },
    cards: [],
    answer: `${yr} har du köpt för ${kr(b)} (${bought.length} köp) och sålt för ${kr(v)} (${sold.length} försäljningar).`,
  };
}

export async function storyIdeas(s: KStore): Promise<ToolResult> {
  const [objects, notes, content, contribs, persons] = await Promise.all([s.objects(), s.notes(), s.content(), s.contributions(), s.persons()]);
  const told = new Set(content.filter((c) => c.status === "shared").map((c) => c.source_id));
  const objs = objects.filter((o) => !told.has(o.id) && (o.status === "in_use" || notes.some((n) => n.entity_id === o.id))).slice(0, 3);
  const thank = [...new Set(contribs.filter((c) => !c.thanked_at).map((c) => c.person_id))].map((id) => persons.find((p) => p.id === id)).filter(Boolean).slice(0, 2) as KPerson[];
  return {
    facts: { objects: objs.map((o) => ({ title: o.title, status: STATUS_SV[o.status] })), thank: thank.map((p) => p.name) },
    cards: [
      ...objs.map((o): SourceCard => ({ ...objCard(o, o.status === "in_use" ? "Har fått nytt liv – före/efter?" : "Inte berättat än"), href: `/objekt/${o.id}/beratta` })),
      ...thank.map((p): SourceCard => ({ ...personCard(p, "Tacka för bidraget"), href: `/person/${p.id}/tacka` })),
    ],
    answer: objs.length || thank.length
      ? `Förslag: ${[...objs.map((o) => `berätta om ${o.title.toLowerCase()}`), ...thank.map((p) => `tacka ${p.name}`)].join(", ")}.`
      : "Inga självklara berättelser just nu – fånga gärna ett ögonblick.",
  };
}

export async function zoneOverview(s: KStore, name: string): Promise<ToolResult> {
  const zones = await s.zones();
  const z = best(zones, (x) => x.name, name, 2)[0];
  if (!z) return { facts: null, cards: [], answer: `Jag hittar ingen zon som heter ${name}.` };
  const [objects, allocs, obs, decs] = await Promise.all([s.objects(), s.allocations(), s.observations(), s.decisions()]);
  const here = objects.filter((o) => o.zone_id === z.id || allocs.some((a) => a.object_id === o.id && a.zone_id === z.id && a.status === "in_use"));
  const o = obs.filter((x) => x.zone_id === z.id).slice(0, 3);
  const d = decs.filter((x) => x.zone_id === z.id).slice(0, 2);
  return {
    facts: { zone: z.name, objects: here.map((x) => x.title), observations: o.map((x) => `${x.occurred_at.slice(0, 10)}: ${x.text}`), decisions: d.map((x) => `${x.question} → ${x.choice} (${x.rationale})`) },
    cards: [{ type: "zone", id: z.id, title: z.name, subtitle: `${here.length} objekt`, href: `/zon/${z.id}` }, ...here.slice(0, 4).map((x) => objCard(x, STATUS_SV[x.status]))],
    answer: `${z.name}: ${here.length ? here.map((x) => x.title.toLowerCase()).join(", ") : "inga objekt i bruk"}.${o.length ? ` Senaste observation: ${o[0].text}.` : ""}${d.length ? ` Beslut: ${d[0].question} – ${d[0].choice}.` : ""}`,
  };
}

/** Lagerobjekt som passar ett ändamål: "Vad har jag i lager som passar orangeriet?" */
export async function stockMatching(s: KStore, purpose: string): Promise<ToolResult> {
  const [objects, notes, allocs] = await Promise.all([s.objects(), s.notes(), s.allocations()]);
  const inStock = objects.filter((o) => o.status === "stored" || allocs.some((a) => a.object_id === o.id && a.status === "stored"));
  const text = (o: KObject) => `${o.title} ${o.category} ${o.description} ${notes.filter((n) => n.entity_id === o.id).map((n) => n.text).join(" ")}`;
  const hits = best(inStock, text, purpose, 1);
  const rows = await Promise.all(hits.slice(0, 5).map(async (o) => ({ o, where: await whereIs(s, o) })));
  return {
    facts: rows.map(({ o, where }) => ({ title: o.title, where })),
    cards: rows.map(({ o, where }) => objCard(o, where)),
    answer: rows.length ? `I lager som nämner ${purpose}: ${rows.map(({ o }) => o.title).join(", ")}.` : `Inget i lager är kopplat till ${purpose} ännu. Allt i lager: ${inStock.map((o) => o.title).join(", ") || "inget"}.`,
  };
}

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

export async function periodSummary(s: KStore, from: string, to: string): Promise<ToolResult> {
  const events = (await s.events()).filter((e) => e.occurred_at.slice(0, 10) >= from && e.occurred_at.slice(0, 10) <= to && !e.summary.includes(" → "));
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.event_type.split(".")[0], (counts.get(e.event_type.split(".")[0]) ?? 0) + 1);
  const top = events.filter((e) => e.story_worthy).slice(0, 6);
  return {
    facts: { from, to, counts: Object.fromEntries(counts), highlights: top.map((e) => `${e.occurred_at.slice(0, 10)}: ${e.summary}`) },
    cards: top.map((e) => ({ type: "journal", id: e.id, title: e.summary, subtitle: e.occurred_at.slice(0, 10), href: "/journal" })),
    answer: events.length ? `${from} – ${to}: ${events.length} händelser. ${top.map((e) => e.summary).join(". ")}.` : `Inget registrerat ${from} – ${to}.`,
  };
}

export async function objectHistory(s: KStore, objectId: string): Promise<ToolResult> {
  const o = (await s.objects()).find((x) => x.id === objectId);
  if (!o) return { facts: null, cards: [], answer: "Jag hittar inte objektet." };
  const events = (await s.eventsFor("object", objectId)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const where = await whereIs(s, o);
  return {
    facts: { title: o.title, now: where, history: events.map((e) => `${e.occurred_at.slice(0, 10)}: ${e.summary}`) },
    cards: [objCard(o, where)],
    answer: `${o.title} är nu ${where}. ${events.filter((e) => !e.summary.includes(" → ")).map((e) => `${e.occurred_at.slice(0, 10)}: ${e.summary}`).join(". ")}.`,
  };
}

export async function search(s: KStore, query: string): Promise<ToolResult> {
  const [objects, persons, events, obs] = await Promise.all([s.objects(), s.persons(), s.events(), s.observations()]);
  const o = best(objects, (x) => `${x.title} ${x.category} ${x.material} ${x.description}`, query).slice(0, 3);
  const p = best(persons, (x) => `${x.name} ${x.roles.join(" ")}`, query).slice(0, 3);
  const e = best(events, (x) => x.summary, query).slice(0, 3);
  const ob = best(obs, (x) => x.text, query).slice(0, 3);
  const cards = [
    ...o.map((x) => objCard(x, STATUS_SV[x.status])),
    ...p.map((x) => personCard(x, x.roles.join(", "))),
    ...e.map((x): SourceCard => ({ type: "journal", id: x.id, title: x.summary, subtitle: x.occurred_at.slice(0, 10), href: "/journal" })),
    ...ob.map((x): SourceCard => ({ type: "journal", id: x.id, title: x.text, subtitle: `Observation ${x.occurred_at.slice(0, 10)}`, href: "/journal" })),
  ];
  return {
    facts: { objects: o.map((x) => x.title), persons: p.map((x) => x.name), events: e.map((x) => x.summary), observations: ob.map((x) => x.text) },
    cards,
    answer: cards.length ? `Det här hittade jag om ”${query}”:` : "Jag hittar inget om det.",
  };
}

// ---------------------------------------------------------------- åtgärder (kräver bekräftelse)
export async function proposeMove(s: KStore, objectQuery: string, locationQuery: string): Promise<ToolResult> {
  if (s.role === "viewer") return { facts: null, cards: [], answer: "Läsare kan inte flytta saker." };
  const [objects, locs, allocs] = await Promise.all([s.objects(), s.storageLocations(), s.allocations()]);
  const o = best(objects.filter((x) => !["sold", "donated", "exchanged", "discarded", "declined", "lost"].includes(x.status)), (x) => `${x.title} ${x.category}`, objectQuery)[0];
  const loc = locs.find((l) => l.name.toLowerCase() === locationQuery.toLowerCase()) ?? best(locs, (l) => l.name, locationQuery, 2)[0];
  if (!o) return { facts: null, cards: [], answer: `Jag hittar inget som heter ”${objectQuery}”.` };
  if (!loc) return { facts: null, cards: [objCard(o, STATUS_SV[o.status])], answer: `Jag hittar ingen lagerplats som heter ”${locationQuery}”.` };
  const movable = allocs.filter((a) => a.object_id === o.id && ["collected", "stored", "processing"].includes(a.status));
  const qty = o.is_batch && movable.length ? movable.reduce((x, a) => x + a.quantity, 0) : o.quantity;
  if (o.status === "in_use" && !movable.length) {
    return { facts: null, cards: [objCard(o, STATUS_SV[o.status])], answer: `${o.title} är i bruk. Demontera det från objektsidan först.` };
  }
  const label = `Flytta ${qty} ${o.unit === "st" && qty === 1 ? "" : `${o.unit} `}${o.title.toLowerCase()} till ${locationPath(locs, loc.id)}`.replace(/\s+/g, " ");
  return {
    facts: { object: o.title, quantity: qty, to: locationPath(locs, loc.id), needs_confirmation: true },
    cards: [objCard(o, await whereIs(s, o)), { type: "storage", id: loc.id, title: loc.name, subtitle: locationPath(locs, loc.id), href: `/lager/${loc.id}` }],
    action: { kind: "move", object_id: o.id, location_id: loc.id, label },
    answer: `${label} – ja?`,
  };
}

export function proposeTask(s: KStore, title: string, due: string | null): ToolResult {
  if (s.role === "viewer") return { facts: null, cards: [], answer: "Läsare kan inte skapa uppgifter." };
  const label = `Skapa uppgiften ”${title}”${due ? ` till ${due}` : ""}`;
  return { facts: { title, due, needs_confirmation: true }, cards: [], action: { kind: "task", title, due, entity_id: null, label }, answer: `${label} – ja?` };
}

export async function proposeListing(s: KStore, objectQuery: string): Promise<ToolResult> {
  const o = best(await s.objects(), (x) => `${x.title} ${x.category}`, objectQuery)[0];
  if (!o) return { facts: null, cards: [], answer: `Jag hittar inget som heter ”${objectQuery}”.` };
  return { facts: { object: o.title }, cards: [objCard(o, STATUS_SV[o.status])], action: { kind: "navigate", href: `/annons/ny?objekt=${o.id}`, label: `Öppna annonsstudion för ${o.title.toLowerCase()}` }, answer: `Jag öppnar annonsstudion för ${o.title.toLowerCase()}.` };
}

export async function proposeStory(s: KStore, objectQuery: string): Promise<ToolResult> {
  const o = best(await s.objects(), (x) => `${x.title} ${x.category}`, objectQuery)[0];
  if (!o) return { facts: null, cards: [], answer: `Jag hittar inget som heter ”${objectQuery}”.` };
  const goal = o.status === "in_use" ? "fore_efter" : "fyndet";
  return { facts: { object: o.title }, cards: [objCard(o, STATUS_SV[o.status])], action: { kind: "navigate", href: `/objekt/${o.id}/beratta?mal=${goal}`, label: `Öppna Berätta för ${o.title.toLowerCase()}` }, answer: `Jag öppnar Berätta-studion för ${o.title.toLowerCase()}.` };
}

export function proposeCapture(s: KStore, text: string): ToolResult {
  if (s.role === "viewer") return { facts: null, cards: [], answer: "Läsare kan inte registrera fynd." };
  return { facts: { text }, cards: [], action: { kind: "capture", text, label: "Skapa ett förslag att granska" }, answer: "Jag gör ett förslag av det som du granskar under Att granska – ska jag det?" };
}

// ---------------------------------------------------------------- verktygsdefinitioner för Claude
export const TOOL_DEFS = [
  { name: "find_objects", description: "Hitta objekt eller partier och var de finns nu (lagerplats, zon, fördelning).", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "objects_from_person", description: "Objekt som kommit från en person (köp eller gåva), valfritt bara det som är i lager.", input_schema: { type: "object", properties: { name: { type: "string" }, in_stock_only: { type: "boolean" } }, required: ["name"] } },
  { name: "who_sold", description: "Vem ett objekt kom från och vad det kostade (pris bara om användaren får se det).", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "contributors", description: "Vilka som bidragit (bidrag och gåvor) ett visst år och vilka som inte tackats.", input_schema: { type: "object", properties: { year: { type: "string" } } } },
  { name: "leads_waiting", description: "Intressenter på annonser som väntar på svar.", input_schema: { type: "object", properties: {} } },
  { name: "todo", description: "Vad som behöver göras idag: granskning, hämtningar, försenade uppgifter, intressenter, uppföljningar.", input_schema: { type: "object", properties: {} } },
  { name: "longest_in_stock", description: "Det som legat längst i lager.", input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "money_year", description: "Hur mycket som köpts och sålts ett år (bara för den som får se priser).", input_schema: { type: "object", properties: { year: { type: "string" } } } },
  { name: "story_ideas", description: "Förslag på vad som är bra att berätta eller tacka för nu.", input_schema: { type: "object", properties: {} } },
  { name: "zone_overview", description: "Vad som finns och hänt i en zon: objekt, observationer, beslut.", input_schema: { type: "object", properties: { zone: { type: "string" } }, required: ["zone"] } },
  { name: "stock_matching", description: "Lagerobjekt som passar ett ändamål, en zon eller ett projekt.", input_schema: { type: "object", properties: { purpose: { type: "string" } }, required: ["purpose"] } },
  { name: "period_summary", description: "Sammanfatta vad som hänt mellan två datum (ÅÅÅÅ-MM-DD).", input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } },
  { name: "object_history", description: "Ett objekts resa och var det är nu, med objektets id.", input_schema: { type: "object", properties: { object_id: { type: "string" } }, required: ["object_id"] } },
  { name: "search", description: "Fritextsökning i objekt, personer, journal och observationer.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "propose_move", description: "Föreslå att flytta ett objekt eller partiets lagerdel till en lagerplats. Utförs först när användaren bekräftar.", input_schema: { type: "object", properties: { object: { type: "string" }, location: { type: "string" } }, required: ["object", "location"] } },
  { name: "propose_task", description: "Föreslå en ny uppgift med valfritt förfallodatum (ÅÅÅÅ-MM-DD). Utförs först efter bekräftelse.", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string" } }, required: ["title"] } },
  { name: "start_listing", description: "Öppna annonsstudion för ett objekt.", input_schema: { type: "object", properties: { object: { type: "string" } }, required: ["object"] } },
  { name: "start_story", description: "Öppna Berätta-studion för ett objekt.", input_schema: { type: "object", properties: { object: { type: "string" } }, required: ["object"] } },
  { name: "propose_capture", description: "Gör ett nytt fynd/en anskaffning som användaren berättar om till ett förslag att granska.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
] as const;

export async function runTool(s: KStore, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const str = (k: string) => String(input[k] ?? "").trim();
  switch (name) {
    case "find_objects": return findObjects(s, str("query"));
    case "objects_from_person": return objectsFromPerson(s, str("name"), input.in_stock_only !== false);
    case "who_sold": return whoSold(s, str("query"));
    case "contributors": return contributors(s, str("year") || undefined);
    case "leads_waiting": return leadsWaiting(s);
    case "todo": return todo(s);
    case "longest_in_stock": return longestInStock(s, Number(input.limit) || 5);
    case "money_year": return moneyYear(s, str("year") || undefined);
    case "story_ideas": return storyIdeas(s);
    case "zone_overview": return zoneOverview(s, str("zone"));
    case "stock_matching": return stockMatching(s, str("purpose"));
    case "period_summary": return periodSummary(s, str("from"), str("to"));
    case "object_history": return objectHistory(s, str("object_id"));
    case "search": return search(s, str("query"));
    case "propose_move": return proposeMove(s, str("object"), str("location"));
    case "propose_task": return proposeTask(s, str("title"), str("due") || null);
    case "start_listing": return proposeListing(s, str("object"));
    case "start_story": return proposeStory(s, str("object"));
    case "propose_capture": return proposeCapture(s, str("text"));
    default: return { facts: null, cards: [], answer: "Okänt verktyg." };
  }
}

// ---------------------------------------------------------------- lokal tolkning (demoläge och reserv)
export interface Screen { type: string | null; id: string | null; title?: string }
export type Plan = { tool: string; input: Record<string, unknown> } | { general: true } | null;

const WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

export function parseDue(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const d = new Date(`${today}T12:00:00Z`);
  if (/\bidag\b/.test(t)) return today;
  if (/\bi ?morgon\b/.test(t)) return new Date(d.getTime() + 864e5).toISOString().slice(0, 10);
  const wd = WEEKDAYS.findIndex((w) => t.includes(w));
  if (wd >= 0) {
    const diff = (wd - d.getUTCDay() + 7) % 7 || 7;
    return new Date(d.getTime() + diff * 864e5).toISOString().slice(0, 10);
  }
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return iso ? iso[1] : null;
}

/** Enkel svensk tolkning av vanliga frågor och kommandon till verktyg. */
export function planQuestion(question: string, screen: Screen, today: string): Plan {
  const q = question.trim().replace(/[?.!]+$/, "");
  const l = q.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = l.match(/^(?:gör|skapa|lägg ut)(?: en)? annons (?:av|för|på|med)\s+(.+)$/))) return { tool: "start_listing", input: { object: m[1] } };
  if ((m = q.match(/^(?:skapa|lägg till|påminn mig)(?: en)?(?: uppgift)?(?: om)?(?: att)?\s+(.+)$/i))) {
    const due = parseDue(m[1], today);
    const title = m[1].replace(/\s*(på|till)?\s*(idag|i ?morgon|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|\d{4}-\d{2}-\d{2})\s*$/i, "").trim();
    return { tool: "propose_task", input: { title: title.charAt(0).toUpperCase() + title.slice(1), due } };
  }
  if ((m = l.match(/^(?:lägg|flytta|ställ)\s+(?!till\b|ut\b)(.+?)\s+(?:på|till|i)\s+(.+)$/))) return { tool: "propose_move", input: { object: m[1], location: m[2] } };
  if ((m = l.match(/^berätta (?:om|historien om)\s+(.+?)(?: ett år senare)?$/))) return { tool: "start_story", input: { object: m[1] } };
  if (/^jag (fick|har fått|köpte|har köpt|hittade|hämtade)\b/.test(l)) return { tool: "propose_capture", input: { text: q } };
  if (screen.type === "object" && screen.id && /(den här|det här|detta|denna)/.test(l)) return { tool: "object_history", input: { object_id: screen.id } };
  if (screen.type === "zone" && screen.title && /(den här|här|zonen)/.test(l) && /vad|hänt|finns/.test(l)) return { tool: "zone_overview", input: { zone: screen.title } };
  if ((m = l.match(/vad har jag (?:i lager )?från\s+([\p{L}-]+)/u))) return { tool: "objects_from_person", input: { name: m[1], in_stock_only: /i lager/.test(l) } };
  if ((m = l.match(/vem (?:sålde|gav|skänkte)\s+(.+?)(?:\s+och\s+.*)?$/))) return { tool: "who_sold", input: { query: m[1] } };
  if ((m = l.match(/(?:vad har jag )?i lager som passar\s+(.+)$/))) return { tool: "stock_matching", input: { purpose: m[1] } };
  if (/(bidragit|inte tackat|tacka)/.test(l)) return { tool: "contributors", input: { year: l.match(/\b(20\d{2})\b/)?.[1] ?? today.slice(0, 4) } };
  if (/intressent|inte svarat|väntar (på )?svar/.test(l)) return { tool: "leads_waiting", input: {} };
  if (/(följa upp|göra idag|kvar att göra|vad ska jag göra|brådskar)/.test(l)) return { tool: "todo", input: {} };
  if (/(längst i lager|legat i lager|legat längst)/.test(l)) return { tool: "longest_in_stock", input: {} };
  if (/(köpt|sålt) .*för|hur mycket har jag/.test(l)) return { tool: "money_year", input: { year: l.match(/\b(20\d{2})\b/)?.[1] ?? today.slice(0, 4) } };
  if (/(innehåll|berätta om|att berätta|inlägg)/.test(l)) return { tool: "story_ideas", input: {} };
  if ((m = l.match(/vad (?:hände|har hänt) .*?i (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/))) {
    const mi = MONTHS.indexOf(m[1]);
    let yr = Number(today.slice(0, 4));
    if (mi + 1 > Number(today.slice(5, 7))) yr -= 1;
    const from = `${yr}-${String(mi + 1).padStart(2, "0")}-01`;
    const to = new Date(Date.UTC(yr, mi + 1, 0)).toISOString().slice(0, 10);
    return { tool: "period_summary", input: { from, to } };
  }
  if ((m = l.match(/vad (?:finns|har hänt|händer) i\s+(.+)$/))) return { tool: "zone_overview", input: { zone: m[1] } };
  if ((m = l.match(/^(?:var (?:är|finns|ligger))\s+(.+)$/))) return { tool: "find_objects", input: { query: m[1] } };
  if (/^(hur (gör|renoverar|lagar|tar|ska|kan)|vad är|varför)\b/.test(l)) return { general: true };
  if (tokens(l).length) return { tool: "search", input: { query: q } };
  return null;
}

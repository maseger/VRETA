import type { UsageType, AcquisitionStatus, AcquisitionType, InteractionChannel, PickupStatus, ReceiptStatus, Channel, ContentGoal, ObjectStatus, Visibility, ListingType, ListingStatus, LeadStatus, DisposalType, ContributionKind, PersonRelation, ProjectStatus, RelationKind } from "./types";

export const STATUS_LABEL: Record<ObjectStatus, string> = {
  discovered: "Upptäckt",
  contacted: "Kontaktad",
  reserved: "Reserverad",
  pickup_planned: "Hämtning planerad",
  collected: "Hämtad",
  stored: "I lager",
  processing: "Renoveras",
  in_use: "I bruk",
  listed: "Utannonserad",
  reserved_out: "Reserverad för köpare",
  lent: "Utlånad",
  declined: "Avstått",
  lost: "Missat",
  sold: "Såld",
  donated: "Skänkt",
  exchanged: "Bytt",
  discarded: "Kasserad",
};

/** Statusgrupper för filter i Samla. */
/** Ersätter statuskoder i en händelsetext med svenska etiketter. */
export function humanizeSummary(text: string): string {
  return text.replace(/\b([a-z_]+) → ([a-z_]+)\b/g, (m, a: string, b: string) =>
    a in STATUS_LABEL && b in STATUS_LABEL ? `${STATUS_LABEL[a as ObjectStatus]} → ${STATUS_LABEL[b as ObjectStatus]}` : m,
  );
}

export const STATUS_GROUPS: { key: string; label: string; statuses: ObjectStatus[] }[] = [
  { key: "pa-vag", label: "På väg in", statuses: ["discovered", "contacted", "reserved", "pickup_planned", "collected"] },
  { key: "lager", label: "I lager", statuses: ["stored", "processing"] },
  { key: "bruk", label: "Nytt liv", statuses: ["in_use", "lent"] },
  { key: "ut", label: "På väg ut", statuses: ["listed", "reserved_out"] },
  { key: "avslutat", label: "Avslutat", statuses: ["declined", "lost", "sold", "donated", "exchanged", "discarded"] },
];

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "Privat",
  internal: "Internt",
  shareable: "Delbart",
  public: "Publikt",
};

export const ACQUISITION_LABEL: Record<AcquisitionType, string> = {
  purchase: "Köp",
  gift: "Gåva",
  exchange: "Byte",
  loan: "Lån",
  work_trade: "Arbete mot material",
};

export const GOAL_LABEL: Record<ContentGoal, string> = {
  fyndet: "Berätta om fyndet",
  resan: "Objektets resa",
  fore_efter: "Före och efter",
  tack: "Tacka den som bidragit",
  visa_vad_som_hant: "Visa vad som hänt",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  privat: "Privat meddelande",
};

export const EVENT_LABEL: Record<string, string> = {
  "object.discovered": "Upptäckt",
  "object.status_changed": "Status ändrad",
  "content.shared": "Berättat",
  "story.moment": "Ögonblick",
  "pickup.completed": "Hämtat",
  "usage.installed": "Installerad",
  "usage.planted": "Planterad",
  "usage.built_in": "Inbyggd",
  "usage.renovated": "Renoverad",
  "usage.reused": "Återanvänd",
  "usage.moved": "Flyttad",
  "usage.removed": "Demonterad",
  "usage.replanted": "Omplanterad",
  "usage.decommissioned": "Tagen ur bruk",
  "decision": "Beslut",
  "disposal.sold": "Såld",
  "disposal.donated": "Skänkt",
  "disposal.exchanged": "Bytt",
  "disposal.lent": "Utlånad",
  "disposal.discarded": "Kasserad",
  "need.fulfilled": "Behov",
  "need.covered": "Behov uppfyllt",
};

export const CATEGORIES = [
  "Fönster och dörrar",
  "Byggnadsdelar",
  "Tegel och sten",
  "Trä och virke",
  "Beslag och smide",
  "Kakel och ugnar",
  "Belysning och el",
  "Möbler och inredning",
  "Växter",
  "Verktyg och maskiner",
  "Trädgård och utemiljö",
  "Övrigt",
];

export const ACQ_STATUS_LABEL: Record<AcquisitionStatus, string> = {
  lead: "Fynd",
  contacted: "Kontaktad",
  negotiating: "Förhandlar",
  agreed: "Överens",
  received: "Mottaget",
  settled: "Klart",
  declined: "Avstått",
  lost: "Missat",
};

export const PIPELINE: AcquisitionStatus[] = ["lead", "contacted", "negotiating", "agreed", "received", "settled"];

export const PICKUP_STATUS_LABEL: Record<PickupStatus, string> = {
  planned: "Planerad",
  confirmed: "Bekräftad",
  in_progress: "Pågår",
  completed: "Klar",
  cancelled: "Inställd",
};

export const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  received: "Allt mottaget",
  partial: "Delvis",
  deviation: "Avvikelse",
};

export const CHANNEL_INTERACTION_LABEL: Record<InteractionChannel, string> = {
  samtal: "Samtal",
  meddelande: "Meddelande",
  mote: "Möte",
  mejl: "Mejl",
  annat: "Annat",
};

export const PERSON_ROLES = ["Leverantör", "Givare", "Medskapare", "Hantverkare", "Kunskapsbärare", "Transportör", "Köpare", "Mottagare", "Följare", "Tipsare"];

export const RESOURCES = ["Släp", "Skåpbil", "Bärhjälp", "Spännband", "Verktyg", "Filtar"];

export const USAGE_LABEL: Record<UsageType, string> = {
  installed: "Installerad",
  planted: "Planterad",
  built_in: "Inbyggd",
  renovated: "Renoverad",
  reused: "Återanvänd",
  moved: "Flyttad",
  removed: "Demonterad",
  replanted: "Omplanterad",
  decommissioned: "Tagen ur bruk",
};

export const OBSERVATION_KINDS: { key: string; label: string }[] = [
  { key: "vatten", label: "Vatten" },
  { key: "blomning", label: "Blomning" },
  { key: "skord", label: "Skörd" },
  { key: "djurliv", label: "Djurliv" },
  { key: "skada", label: "Skada" },
  { key: "vader", label: "Väder" },
  { key: "byggnation", label: "Byggnation" },
  { key: "annat", label: "Annat" },
];

export function eventLabel(type: string): string {
  if (EVENT_LABEL[type]) return EVENT_LABEL[type];
  if (type.startsWith("contribution.")) {
    const k = type.slice(13) as ContributionKind;
    return `Bidrag${CONTRIBUTION_LABEL[k] ? ` · ${CONTRIBUTION_LABEL[k]}` : ""}`;
  }
  if (type.startsWith("observation.")) {
    const k = OBSERVATION_KINDS.find((o) => o.key === type.slice(12));
    return `Observation${k ? ` · ${k.label}` : ""}`;
  }
  return type;
}

/** Grupper för filter i journalen. */
export const JOURNAL_FILTERS: { key: string; label: string; match: (t: string) => boolean }[] = [
  { key: "allt", label: "Allt", match: () => true },
  { key: "liv", label: "Nytt liv", match: (t) => t.startsWith("usage.") },
  { key: "obs", label: "Observationer", match: (t) => t.startsWith("observation.") },
  { key: "beslut", label: "Beslut", match: (t) => t === "decision" },
  { key: "in", label: "Fynd och hämtningar", match: (t) => t === "object.discovered" || t === "pickup.completed" },
  { key: "ut", label: "Sålt och skänkt", match: (t) => t.startsWith("disposal.") },
  { key: "bidrag", label: "Bidrag", match: (t) => t.startsWith("contribution.") },
  { key: "behov", label: "Projektbehov", match: (t) => t.startsWith("need.") },
  { key: "berattat", label: "Berättat", match: (t) => t === "content.shared" || t === "story.moment" },
];

export const LISTING_TYPE_LABEL: Record<ListingType, string> = {
  sell: "Sälja",
  give: "Skänka",
  exchange: "Byta",
  lend: "Låna ut",
  wanted: "Söker",
  help_wanted: "Söker hjälp",
};

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Utkast",
  ready: "Klar att lägga ut",
  published: "Ute",
  agreed: "Överenskommen",
  completed: "Klar",
  archived: "Arkiverad",
  withdrawn: "Tillbakadragen",
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Ny – väntar svar",
  replied: "Svarat",
  viewing_booked: "Visning bokad",
  agreed: "Överens",
  completed: "Klart",
  no_show: "Kom inte",
  lost: "Föll bort",
  rejected: "Nej tack",
};

export const DISPOSAL_LABEL: Record<DisposalType, string> = {
  sold: "Såld",
  donated: "Skänkt",
  exchanged: "Bytt",
  lent: "Utlånad",
  discarded: "Kasserad",
};

export const CONTRIBUTION_LABEL: Record<ContributionKind, string> = {
  material: "Material",
  tid: "Tid och händer",
  kunskap: "Kunskap",
  maskin: "Maskin eller verktyg",
  transport: "Transport",
  kontakter: "Kontakter",
  mat: "Mat",
  ekonomiskt: "Ekonomiskt",
  omsorg: "Omsorg",
};

export const PAYMENT_METHODS = ["Swish", "Kontant", "Byte", "Annat"];

// ---------------------------------------------------------------- M6: projekt och platser utanför Vreta
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: "Idé",
  planned: "Planerat",
  active: "Pågår",
  paused: "Vilar",
  done: "Klart",
};
export const PROJECT_KINDS = ["Bygge", "Plantering", "Renovering", "Anläggning", "Odling", "Annat"];

export const PLACE_KINDS: { key: string; label: string }[] = [
  { key: "hamtstalle", label: "Hämtställe" },
  { key: "loppis", label: "Loppis" },
  { key: "atervinning", label: "Återvinningscentral" },
  { key: "butik", label: "Butik eller handlare" },
  { key: "gard", label: "Gård eller trädgård" },
  { key: "leverantor", label: "Leverantör" },
  { key: "annat", label: "Annat" },
];
export const placeKindLabel = (k: string) => PLACE_KINDS.find((x) => x.key === k)?.label ?? k;

// ---------------------------------------------------------------- M8: relationer och organisationer
export const RELATION_KINDS: { key: RelationKind; label: string }[] = [
  { key: "familj", label: "Familj" },
  { key: "partner", label: "Partner" },
  { key: "granne", label: "Granne" },
  { key: "van", label: "Vän" },
  { key: "kollega", label: "Kollega" },
  { key: "samarbetar", label: "Arbetar ihop" },
  { key: "introduced", label: "Tipsade oss om" },
];

/** Relationen sedd från en av personerna: "Granne", "Tipsade oss om" eller "Kom till oss via". */
export function relationLabel(r: PersonRelation, from: string): string {
  if (r.kind === "introduced") return r.person_id === from ? "Tipsade oss om" : "Kom till oss via";
  return RELATION_KINDS.find((k) => k.key === r.kind)?.label ?? r.kind;
}

export const ORG_KINDS = ["Förening", "Företag", "Kommun", "Församling", "Gård", "Annat"];

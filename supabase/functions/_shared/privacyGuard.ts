// Privacy Guard (specifikationen 11.1 och 12): deterministiska regler som avgör vilken
// data som får användas i publikt innehåll. Ingen språkmodell fattar beslutet.
// Används både i webbläsaren (demoläge) och i edge-funktionen story-agent.

export type Vis = "private" | "internal" | "shareable" | "public";
export type Consent = "yes" | "no" | "ask";

export interface RawStoryContext {
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
    status: string;
    visibility: Vis;
  };
  acquisition: { type: string; price: number | null } | null;
  people: {
    id: string;
    name: string;
    locality: string;
    contact: string;
    notes: string;
    relation: string;
    consent_name: Consent;
    consent_contribution: Consent;
    /** Samtycke för just detta inlägg när personen har "fråga varje gång" (content_consents). */
    consent_override?: { name_ok: boolean; contribution_ok: boolean } | null;
  }[];
  /** Bidrag från personerna ovan (M4). */
  contributions?: { person_id: string; kind: string; description: string; visibility: Vis }[];
  notes: { kind: "why" | "quote" | "moment"; text: string; quote_consent: boolean }[];
  events: { summary: string; occurred_at: string; visibility: Vis }[];
  media: { id: string; visibility: Vis; has_people: boolean; has_clean: boolean }[];
}

export interface SafeStoryContext {
  object: Omit<RawStoryContext["object"], "visibility" | "status"> & { status_label: string };
  acquisition_kind: string | null;
  people: { ref: string; name: string | null; relation: string; describe_contribution: boolean }[];
  contributions: { ref: string; kind: string; description: string }[];
  why: string[];
  quotes: string[];
  moments: string[];
  events: { summary: string; date: string }[];
  media_ids: string[];
}

export interface GuardResult {
  allowed: boolean;
  context: SafeStoryContext | null;
  removed: string[];
  warnings: string[];
}

const PUBLISHABLE: Vis[] = ["shareable", "public"];

const ACQ_KIND: Record<string, string> = {
  purchase: "köpt begagnat",
  gift: "fått som gåva",
  exchange: "bytt till oss",
  loan: "lånat",
  work_trade: "fått mot arbete",
};

export function guardStoryContext(raw: RawStoryContext, statusLabel: string): GuardResult {
  const removed: string[] = [];
  const warnings: string[] = [];

  if (!PUBLISHABLE.includes(raw.object.visibility)) {
    return {
      allowed: false,
      context: null,
      removed: ["hela objektet"],
      warnings: [`Objektet är markerat som ${raw.object.visibility === "private" ? "privat" : "internt"} och kan inte användas i en berättelse. Ändra synligheten till delbart först.`],
    };
  }

  const { visibility: _v, status: _s, ...objectFields } = raw.object;
  void _v;
  void _s;

  if (raw.acquisition?.price != null) removed.push("pris");

  const people = raw.people.map((p, i) => {
    const r = personRules(p, removed, warnings);
    return { ref: `person${i + 1}`, name: r.name, relation: p.relation, describe_contribution: r.describe };
  });
  const contributions = safeContributions(raw, people.map((p, i) => ({ ...p, id: raw.people[i].id })), removed);

  const quotes: string[] = [];
  for (const n of raw.notes.filter((n) => n.kind === "quote")) {
    if (n.quote_consent) quotes.push(n.text);
    else removed.push("citat utan samtycke");
  }

  const events = raw.events
    .filter((e) => {
      const ok = PUBLISHABLE.includes(e.visibility);
      if (!ok) removed.push(`intern händelse: ${e.summary}`);
      return ok;
    })
    .map((e) => ({ summary: e.summary, date: e.occurred_at.slice(0, 10) }));

  const media_ids: string[] = [];
  for (const m of raw.media) {
    if (!m.has_clean) {
      removed.push("bild utan rensad kopia");
    } else if (!PUBLISHABLE.includes(m.visibility)) {
      removed.push("intern bild");
    } else if (m.has_people) {
      removed.push("bild med personer");
      warnings.push("En bild visar personer och har tagits bort. Lägg till den manuellt först när alla i bild har sagt ja.");
    } else media_ids.push(m.id);
  }
  if (media_ids.length === 0) warnings.push("Ingen bild kan delas ännu.");

  return {
    allowed: true,
    removed,
    warnings,
    context: {
      object: { ...objectFields, status_label: statusLabel },
      acquisition_kind: raw.acquisition ? ACQ_KIND[raw.acquisition.type] ?? null : null,
      people,
      contributions,
      why: raw.notes.filter((n) => n.kind === "why").map((n) => n.text),
      quotes,
      moments: raw.notes.filter((n) => n.kind === "moment").map((n) => n.text),
      events,
      media_ids,
    },
  };
}

/** Namn- och bidragsregler för en person (12.2). Gemensamt för berättelser och tack. */
export function personRules(
  p: { name: string; locality: string; consent_name: Consent; consent_contribution: Consent; consent_override?: { name_ok: boolean; contribution_ok: boolean } | null },
  removed: string[],
  warnings: string[],
): { name: string | null; describe: boolean } {
  removed.push(`kontaktuppgifter och anteckningar för ${p.name}`);
  if (p.locality) removed.push(`hemort för ${p.name}`);
  let name: string | null = null;
  if (p.consent_name === "yes") name = p.name;
  else if (p.consent_name === "ask" && p.consent_override?.name_ok) name = p.name;
  else if (p.consent_name === "ask") {
    warnings.push(`Fråga ${p.name} om namnet får nämnas – tills dess skrivs personen utan namn.`);
    removed.push(`namn: ${p.name} (samtycke saknas)`);
  } else {
    warnings.push(`${p.name} har sagt nej till att nämnas vid namn – utkastet nämner inte personen.`);
    removed.push(`namn: ${p.name} (har sagt nej)`);
  }
  let describe = p.consent_contribution === "yes" || (p.consent_contribution === "ask" && !!p.consent_override?.contribution_ok);
  if (p.consent_contribution === "ask" && !describe) warnings.push(`Fråga ${p.name} om bidraget får beskrivas.`);
  if (p.consent_contribution === "no") describe = false;
  return { name, describe };
}

function safeContributions(
  raw: Pick<RawStoryContext, "contributions">,
  people: { id: string; ref: string; describe_contribution: boolean }[],
  removed: string[],
): { ref: string; kind: string; description: string }[] {
  const out: { ref: string; kind: string; description: string }[] = [];
  for (const c of raw.contributions ?? []) {
    const p = people.find((x) => x.id === c.person_id);
    if (!p) continue;
    if (!PUBLISHABLE.includes(c.visibility)) removed.push("internt bidrag");
    else if (!p.describe_contribution) removed.push("bidrag utan samtycke");
    else out.push({ ref: p.ref, kind: c.kind, description: c.description });
  }
  return out;
}

// ---------------------------------------------------------------- tack till en person (4.8, AC-10)
export interface RawThanksContext {
  person: {
    name: string;
    locality: string;
    contact: string;
    notes: string;
    consent_name: Consent;
    consent_image: Consent;
    consent_contribution: Consent;
    consent_override?: { name_ok: boolean; contribution_ok: boolean } | null;
  };
  contributions: { kind: string; description: string; visibility: Vis; hours: number | null }[];
  /** Objekt som kommit från personen, med var de fått nytt liv (zon eller byggnad). */
  objects: { title: string; visibility: Vis; status: string; new_life_place: string | null; price: number | null }[];
  media: { id: string; visibility: Vis; has_people: boolean; has_clean: boolean }[];
}

export interface SafeThanksContext {
  name: string | null;
  contributions: { kind: string; description: string }[];
  objects: { title: string; new_life_place: string | null }[];
  media_ids: string[];
}

export function guardThanks(raw: RawThanksContext): GuardResult & { thanks: SafeThanksContext | null } {
  const removed: string[] = [];
  const warnings: string[] = [];
  const r = personRules(raw.person, removed, warnings);
  const contributions: SafeThanksContext["contributions"] = [];
  for (const c of raw.contributions) {
    if (!PUBLISHABLE.includes(c.visibility)) removed.push("internt bidrag");
    else if (!r.describe) removed.push("bidrag utan samtycke");
    else contributions.push({ kind: c.kind, description: c.description });
  }
  const objects: SafeThanksContext["objects"] = [];
  for (const o of raw.objects) {
    if (o.price != null) removed.push("pris");
    if (!PUBLISHABLE.includes(o.visibility)) removed.push(`internt objekt: ${o.title}`);
    else objects.push({ title: o.title, new_life_place: o.status === "in_use" ? o.new_life_place : null });
  }
  const media_ids: string[] = [];
  for (const m of raw.media) {
    if (!m.has_clean) removed.push("bild utan rensad kopia");
    else if (!PUBLISHABLE.includes(m.visibility)) removed.push("intern bild");
    else if (m.has_people) {
      removed.push("bild med personer");
      if (raw.person.consent_image !== "yes") warnings.push("En bild visar personer och har tagits bort.");
    } else media_ids.push(m.id);
  }
  return { allowed: true, context: null, removed, warnings, thanks: { name: r.name, contributions, objects, media_ids } };
}

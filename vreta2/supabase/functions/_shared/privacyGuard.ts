// Privacy Guard: deterministisk kod med regler, inte en språkmodell (R1.1 11.1). Bygger den rensade
// kontext som Story Agent och mallarna får, och listar det som togs bort så att granskningen kan visa
// "Togs bort av integritetsfiltret". Körs både före AI-anropet och efter (checkText) – och databasen gör
// en sista kontroll innan något godkänns (story.privacy_violations).
import type { CleanContext, GuardResult, RemovedItem, StoryContextRaw, StoryPerson } from "./types.ts";

const PHONE = /(?:\+46|0)\s?7\d[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\b0\d{1,3}[\s-]\d{2,3}[\s-]?\d{2}[\s-]?\d{2}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const STREET = /\b[A-ZÅÄÖ][a-zåäöé]+(?:vägen|gatan|stigen|gränd|backe|backen|torg|torget|plan|allén|leden|väg|gata)\s+\d+[A-Za-z]?\b/g;
const PRICE = /\b\d+(?:[\s\u00a0]\d{3})*\s*(?:(?:kr|kronor|SEK)\b|:-)/gi;
const POSTCODE = /\b\d{3}\s?\d{2}\s+[A-ZÅÄÖ][a-zåäö]+/g;

export function consentFor(p: StoryPerson, aspect: "name" | "image" | "contribution" | "quote"): "yes" | "no" | "ask" {
  if (p.erased) return "no";
  const post = p.post_consent?.[aspect];
  if (post) return post;
  if (aspect === "quote") return "no";
  return (p.consent?.[aspect] as "yes" | "no" | "ask") ?? "ask";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function nameRe(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(name)}(?![\\p{L}\\p{N}_])`, "giu");
}
export function firstName(name: string): string {
  return name.split(/\s+/)[0];
}

export const ASK_MESSAGE = (name: string) =>
  `Hej ${firstName(name)}! Jag berättar gärna om Vreta på Facebook och Instagram. Okej om jag nämner dig vid namn, visar bild på dig eller berättar vad du bidragit med?`;

// Tar bort adresser, telefonnummer, mejl, priser och namn på personer utan samtycke ur fritext.
export function scrubText(text: string | null | undefined, opts: { forbiddenNames?: string[]; forbiddenPlaces?: string[]; keepPrices?: boolean } = {}): { text: string; removed: RemovedItem[] } {
  let t = text ?? "";
  const removed: RemovedItem[] = [];
  const take = (re: RegExp, kind: string, replacement = "") => {
    t = t.replace(re, (m) => { removed.push({ kind, text: m.trim() }); return replacement; });
  };
  take(EMAIL, "email");
  take(PHONE, "phone");
  take(STREET, "address");
  take(POSTCODE, "address");
  if (!opts.keepPrices) take(PRICE, "price");
  for (const n of [...(opts.forbiddenNames ?? [])].sort((a, b) => b.length - a.length)) {
    if (n.length < 2) continue;
    take(nameRe(n), "name", "någon");
  }
  // Givares hemorter nämns aldrig (R1.1 8.6): "i Ockelbo", "från Ockelbo"
  for (const pl of opts.forbiddenPlaces ?? []) {
    if (pl.length < 3) continue;
    take(new RegExp(`(?:\\s*(?:i|från|på|utanför)\\s+)?(?<![\\p{L}])${escapeRe(pl)}(?![\\p{L}])`, "giu"), "locality");
  }
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/(?:,\s*){2,}/g, ", ").trim();
  return { text: t, removed };
}

// Kontrollerar en färdig text (efter AI eller manuell redigering). Tom lista = inget hittat.
export function checkText(text: string, opts: { forbiddenNames?: string[]; storagePlaces?: string[]; allowPrices?: boolean } = {}): RemovedItem[] {
  const found: RemovedItem[] = [];
  for (const [re, kind] of [[EMAIL, "email"], [PHONE, "phone"], [STREET, "address"], [POSTCODE, "address"]] as const) {
    for (const m of text.matchAll(re)) found.push({ kind, text: m[0] });
  }
  if (!opts.allowPrices) for (const m of text.matchAll(PRICE)) found.push({ kind: "price", text: m[0] });
  for (const n of opts.forbiddenNames ?? []) {
    if (n.length >= 2 && nameRe(n).test(text)) found.push({ kind: "name", text: n });
    const f = firstName(n);
    if (f !== n && f.length >= 3 && nameRe(f).test(text)) found.push({ kind: "name", text: f });
  }
  for (const s of opts.storagePlaces ?? []) if (s.length >= 4 && nameRe(s).test(text)) found.push({ kind: "storage_location", text: s });
  return dedupe(found);
}

export function guardStory(raw: StoryContextRaw, opts: { goal: string; channelKind: "public" | "private"; personIds?: string[] }): GuardResult {
  const removed: RemovedItem[] = [];
  const warnings: string[] = [];
  const ask_messages: GuardResult["ask_messages"] = [];
  const people = new Map(raw.people.map((p) => [p.id, p]));
  const allowedPeople = raw.people.filter((p) => consentFor(p, "name") === "yes");
  const forbidden = raw.people.filter((p) => consentFor(p, "name") !== "yes");
  const forbiddenNames = forbidden.flatMap((p) => [p.display_name, ...(firstName(p.display_name).length >= 3 ? [firstName(p.display_name)] : [])])
    // Ett förnamn som också tillhör någon med samtycke tas inte bort
    .filter((n) => !allowedPeople.some((a) => a.display_name === n || firstName(a.display_name) === n));

  const forbiddenPlaces = [...new Set([
    ...raw.sources.map((x) => x.facts?.from_locality).filter((x): x is string => typeof x === "string" && !!x),
    ...raw.people.map((p) => p.locality).filter((x): x is string => !!x),
  ])];

  // Källor: privata poster berättas aldrig; interna bara i privata meddelanden (R1.1 12.1)
  const blocked = raw.sources.filter((s) => s.visibility === "private" || (opts.channelKind === "public" && s.visibility === "internal"));
  if (blocked.length) {
    const why = blocked.some((s) => s.visibility === "private") ? "är privat" : "är intern – gör den delbar för att berätta publikt";
    return {
      allowed: false, blocked_reason: `${blocked.map((b) => b.title).join(", ")} ${why}`,
      context: emptyContext(raw, opts.goal, opts.channelKind), removed, warnings, ask_messages,
    };
  }

  for (const p of raw.people) {
    const c = consentFor(p, "name");
    if (c === "no") removed.push({ kind: "name", text: `${p.display_name} (samtycke nej)` });
    if (c === "ask" && (opts.personIds?.includes(p.id) || opts.goal === "thanks")) {
      warnings.push(`Fråga ${firstName(p.display_name)} innan du nämner hen`);
      ask_messages.push({ person_id: p.id, name: p.display_name, message: ASK_MESSAGE(p.display_name) });
    }
  }

  const sources = raw.sources.map((s) => {
    const facts: Record<string, any> = {};
    for (const [k, v] of Object.entries(s.facts ?? {})) {
      if (k === "from_locality") { if (v) removed.push({ kind: "locality", text: `${v} (givarens hemort)` }); continue; }
      if (k === "price" && s.type !== "listing") { if (v) removed.push({ kind: "price", text: `${v} kr` }); continue; }
      if (typeof v === "string") {
        const r = scrubText(v, { forbiddenNames, forbiddenPlaces: k === "place" ? [] : forbiddenPlaces, keepPrices: s.type === "listing" && k === "price" });
        removed.push(...r.removed);
        facts[k] = r.text;
      } else if (k === "usage" && Array.isArray(v)) {
        facts[k] = v.map((u) => ({ ...u }));
      } else facts[k] = v;
    }
    const moments = (s.timeline ?? []).filter((e) => !/^(acquisition|pickup|disposal|person|reciprocity|task)\./.test(e.event_type))
      .map((e) => { const r = scrubText(e.summary, { forbiddenNames, forbiddenPlaces }); removed.push(...r.removed); return r.text; });
    return { id: s.id, type: s.type, title: scrubText(s.title, { forbiddenNames }).text, facts, moments };
  });

  const ctxPeople = allowedPeople.map((p) => {
    const contributions = raw.contributions.filter((c) => c.person_id === p.id);
    const canTell = consentFor(p, "contribution") === "yes";
    if (contributions.length && !canTell) removed.push({ kind: "contribution", text: `Bidrag från ${p.display_name} (samtycke saknas)` });
    const contribution = canTell && contributions.length
      ? contributions.map((c) => scrubText(c.description || c.type_code, { forbiddenNames }).text).filter(Boolean).join(", ")
      : null;
    return { id: p.id, name: p.display_name, contribution };
  });

  const quotes = raw.notes.filter((n) => n.kind === "quote" && n.text).flatMap((n) => {
    const p = n.person_id ? people.get(n.person_id) : undefined;
    if (!n.quote_consent || !p || consentFor(p, "name") !== "yes") {
      removed.push({ kind: "quote", text: `Citat${p ? ` från ${p.display_name}` : ""} (samtycke för citat saknas)` });
      return [];
    }
    return [{ text: scrubText(n.text, { forbiddenNames, forbiddenPlaces }).text, person_name: p.display_name }];
  });
  const why = raw.notes.filter((n) => n.kind !== "quote" && n.text).map((n) => {
    const r = scrubText(n.text, { forbiddenNames, forbiddenPlaces });
    removed.push(...r.removed);
    return r.text;
  });

  const media_ids: string[] = [];
  for (const m of raw.media) {
    if (m.visibility === "private") { removed.push({ kind: "image", text: "Privat bild" }); continue; }
    const without = (m.depicts ?? []).filter((d) => {
      const p = people.get(d.person_id);
      return (p ? consentFor(p, "image") : (d.image_consent ?? "ask")) !== "yes";
    });
    if (without.length) {
      removed.push({ kind: "image", text: `Bild på ${without.map((d) => people.get(d.person_id)?.display_name ?? "en person").join(", ")} (bildsamtycke saknas)` });
      continue;
    }
    if (m.flagged) warnings.push("En bild är flaggad för granskning (skylt eller hemmiljö) – kontrollera innan delning");
    if (opts.channelKind === "public" && m.visibility === "internal") warnings.push("En vald bild är intern – den blir delbar när du delar");
    if (m.share_path || m.thumb_path) media_ids.push(m.id);
  }

  return {
    allowed: true,
    context: { site_name: raw.site?.name ?? "Vreta", goal: opts.goal, channel_kind: opts.channelKind, sources, people: ctxPeople, quotes, why, media_ids },
    removed: dedupe(removed), warnings: [...new Set(warnings)], ask_messages,
  };
}

function emptyContext(raw: StoryContextRaw, goal: string, channelKind: "public" | "private"): CleanContext {
  return { site_name: raw.site?.name ?? "Vreta", goal, channel_kind: channelKind, sources: [], people: [], quotes: [], why: [], media_ids: [] };
}

function dedupe(items: RemovedItem[]): RemovedItem[] {
  const seen = new Set<string>();
  return items.filter((i) => { const k = `${i.kind}:${i.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Namn som inte får förekomma i text som lämnar appen (för efterkontrollen av AI-svar).
export function forbiddenNamesFor(raw: StoryContextRaw): string[] {
  const allowed = raw.people.filter((p) => consentFor(p, "name") === "yes");
  return raw.people.filter((p) => consentFor(p, "name") !== "yes")
    .flatMap((p) => [p.display_name, firstName(p.display_name)])
    .filter((n) => n.length >= 3 && !allowed.some((a) => a.display_name === n || firstName(a.display_name) === n));
}

// Den lokala tolkningen av en fångst: reserven när Capture Agent (Claude) inte går att nå, och tolkningen
// i demoläget. Regelbaserad, med låg confidence och evidens per fält, så att granskningen visar varför
// något föreslås (2.0). Den gissar aldrig fält den inte ser stöd för, och den kopplar bara projekt och
// platser som redan finns (R1.1 11.2).
import type { CaptureKnowledge, CardKind, Evidence, MatchCandidate, ProposalCard, ProposalDraft, ProposalField } from "./types.ts";

const NUMBER_WORDS: Record<string, number> = {
  en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, elva: 11, tolv: 12,
  tretton: 13, fjorton: 14, femton: 15, sexton: 16, sjutton: 17, arton: 18, nitton: 19, tjugo: 20, trettio: 30,
  fyrtio: 40, femtio: 50, hundra: 100, "ett par": 2,
};
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const UNITS: Record<string, string> = {
  st: "st", styck: "st", kg: "kg", kilo: "kg", ton: "ton", m: "m", meter: "m", m2: "m²", kvm: "m²", liter: "l", l: "l",
  säck: "säckar", säckar: "säckar", pall: "pallar", pallar: "pallar", lass: "lass", rullar: "rullar", rulle: "rullar",
};
// Ord som börjar med versal men aldrig är namn.
const NOT_NAMES = new Set(["Jag", "Vi", "Det", "Den", "De", "En", "Ett", "Två", "Tre", "Fyra", "Fem", "Sex", "Sju", "Åtta", "Nio", "Tio",
  "Elva", "Tolv", "Hos", "Från", "Av", "Till", "Köpte", "Fick", "Hittade", "Hämta", "Hämtas", "Gratis", "Ring", "Idag", "Igår", "Imorgon",
  "Vreta", "Blocket", "Facebook", "Instagram", "Marketplace", "Swish", "Gammal", "Gamla", "Ny", "Nya", "Stor", "Stora", "Fin", "Fina"]);

const CATEGORY_RULES: [RegExp, string][] = [
  [/fönster/i, "windows"], [/dörr|port\b|lucka/i, "doors"], [/tegel/i, "brick"], [/\bsten|platta|marksten|kullersten/i, "stone"],
  [/virke|bräd|plank|balk|panel|reglar/i, "timber"], [/handtag|beslag|gångjärn|spanjolett|krok/i, "fittings"],
  [/kakel|klinker/i, "tiles"], [/radiator|element/i, "radiators"], [/lampa|armatur/i, "lamps"],
  [/takpann|takplåt|takstol/i, "roofing"], [/isolering|lösull/i, "insulation"], [/rör|kran|handfat|toalett|vvs/i, "plumbing"],
  [/stol|bord|skåp|byrå|soffa|säng|möbel/i, "furniture"], [/utemöbel|trädgårdsbänk|parkbänk/i, "outdoor_furniture"],
  [/rhododendron|buske|träd|häck/i, "trees"], [/perenn|ros|lök|planta|plantor/i, "perennials"], [/frö/i, "seeds"],
  [/jord|kompost|flis|bark|täckmaterial/i, "soil"], [/kruka|krukor/i, "pots"], [/spade|kratta|grep|trädgårdsredskap/i, "garden_tools"],
  [/verktyg|maskin|såg|borr|skottkärra/i, "tools"], [/släp|bil|traktor/i, "vehicles"], [/gjutjärn|smide/i, "cast_iron"],
  [/glas|flaska/i, "glass"], [/keramik|porslin/i, "ceramics"], [/tavla|skulptur|konst/i, "art"], [/textil|matta|gardin/i, "textiles"],
  [/kök|gryta|kastrull/i, "kitchen"], [/metall|plåt|järn/i, "metal"],
];
const LIVING = /rhododendron|buske|träd|häck|perenn|ros\b|rosor|lök|planta|plantor|frö|sticklingar|växt/i;
const OBSERVATION = /\b(såg|sågs|hörde|hördes|observer\w*|blommar|blomning|knopp\w*|skörd\w*|frost\w*|grodrom|häckar|bygger bo|ruvar|flygga|regn\w*|översvämn\w*|stående vatten|vind|torka|skada\w*|angrep\w*)\b/i;
const CONTRIBUTION = /\b(hjälpte|bidrog|jobbade|arbetade|murade|snickrade|lagade|bjöd på|kom med)\b/i;
const GIFT = /\b(gratis|skänk\w*|gåva|fick|fått|ge bort|bortskänk\w*)\b/i;

const NAME = "[A-ZÅÄÖ][a-zåäöéü]+";
const FULL_NAME = `${NAME}(?:-${NAME})?(?:\\s+${NAME}(?:-${NAME})?)?`;

function cap(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("sv") + s.slice(1) : s;
}
function norm(s: string): string {
  return s.toLocaleLowerCase("sv").trim();
}
function ev(excerpt: string | undefined | null): Evidence[] {
  return excerpt ? [{ kind: "text_excerpt", excerpt: excerpt.trim() }] : [];
}
function isName(candidate: string): boolean {
  return candidate.split(/\s+/).every((w) => !NOT_NAMES.has(w));
}

export function parseNumberToken(token: string): number | null {
  const t = token.replace(/\s/g, "").replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return NUMBER_WORDS[token.toLocaleLowerCase("sv")] ?? null;
}

// "före november", "senast 1 november", "innan 15 mars" → nästa sådant datum.
export function parseDeadline(text: string, today = new Date()): { date: string; excerpt: string } | null {
  const m = text.match(/(före|innan|senast)\s+(?:den\s+)?(?:(\d{1,2})\s+)?(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[3].toLowerCase());
  const dayOfMonth = m[2] ? Number(m[2]) : 1;
  let year = today.getFullYear();
  if (Date.UTC(year, month, dayOfMonth) < Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) year += 1;
  return { date: `${year}-${String(month + 1).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`, excerpt: m[0] };
}

// En ort som är en del av personens namn är ett feltolkat efternamn (FR-088).
export function localityOutsideName(name: string | null | undefined, locality: string | null | undefined): string | null {
  const loc = (locality ?? "").trim();
  if (!loc) return null;
  const words = new Set(norm(name ?? "").split(/[\s-]+/).filter(Boolean));
  return norm(loc).split(/[\s-]+/).some((w) => words.has(w)) ? null : loc;
}

export type ParsedCapture = {
  title: string | null; titleExcerpt: string | null;
  quantity: number | null; quantityExcerpt: string | null; unit: string | null;
  price: number | null; priceExcerpt: string | null; acquisitionType: "purchase" | "gift" | null; typeExcerpt: string | null;
  personName: string | null; personExcerpt: string | null; locality: string | null; localityExcerpt: string | null;
  tipster: string | null; tipsterExcerpt: string | null;
  placeName: string | null; placeExcerpt: string | null;
  projectName: string | null; projectExcerpt: string | null;
  deadline: string | null; deadlineExcerpt: string | null;
  needsTransport: boolean; transportExcerpt: string | null;
  category: string | null; living: boolean;
  hours: number | null;
};

export function parseCapture(text: string, today = new Date()): ParsedCapture {
  const original = text.replace(/\s+/g, " ").trim();
  // Tipsaren tas bort först så att "tips från Anders" aldrig gör Anders till säljare.
  const tipRe = [new RegExp(`(${FULL_NAME})\\s+tipsade(?:\\s+om\\s+\\w+)?`), new RegExp(`(?:tips(?:at)?\\s+(?:från|av)|via)\\s+(${FULL_NAME})`)];
  let tipster: string | null = null;
  let tipsterExcerpt: string | null = null;
  let rest = original;
  for (const re of tipRe) {
    const m = rest.match(re);
    if (m && isName(m[1])) {
      tipster = m[1];
      tipsterExcerpt = m[0];
      rest = rest.replace(m[0], " ").replace(/\s+/g, " ").trim();
      break;
    }
  }

  // Plats utanför: "på Återbruket", "på Kyrkans loppis", "på loppisen"
  let placeName: string | null = null;
  let placeExcerpt: string | null = null;
  const pm = rest.match(new RegExp(`\\b(?:på|vid)\\s+(${NAME}(?:s)?(?:\\s+(?:loppis\\w*|marknad\\w*|gård\\w*|butik\\w*|handel\\w*|återbruk\\w*))?)`))
    ?? rest.match(/\b(?:på|vid)\s+(loppis(?:en)?|återvinning(?:en|scentralen)?|återbruk(?:et)?|tippen|auktion(?:en)?|byggåterbruk(?:et)?)\b/i);
  if (pm && isName(pm[1].split(" ")[0]) ) {
    placeName = pm[1];
    placeExcerpt = pm[0];
  }

  // Projekt: "till orangeriet"
  const prm = rest.match(/\btill\s+(?:den\s+|det\s+|vårt\s+|nya\s+)?([a-zåäöA-ZÅÄÖ]{4,})/);
  const projectName = prm ? prm[1] : null;

  const clauses = rest.split(/[,.;\n]/).map((c) => c.trim()).filter(Boolean);
  let first = (clauses[0] ?? "").replace(/^(?:jag\s+|vi\s+)?(?:har\s+)?(?:köpte|köpt|fick|fått|hittade|hittat|hämtade|hämtat|såg)\s+/i, "");

  // Antal, enhet och benämning: "sex gjutjärnsfönster", "400 tegel", "12 st rhododendron", "4 ton lera", "1 500 tegel"
  let quantity: number | null = null;
  let quantityExcerpt: string | null = null;
  let unit: string | null = null;
  let title = first;
  const qm = first.match(/^(\d{1,3}(?:\s\d{3})+|\d+(?:[.,]\d+)?|ett par|[a-zåäö]+)\s+(?:(st|styck|kg|kilo|ton|m|meter|m2|kvm|liter|l|säckar?|pallar?|lass|rullar?|rulle)\.?\s+)?(.+)$/i);
  if (qm) {
    const n = parseNumberToken(qm[1]);
    if (n !== null) {
      quantity = n;
      quantityExcerpt = qm[2] ? `${qm[1]} ${qm[2]}` : qm[1];
      unit = qm[2] ? UNITS[qm[2].toLowerCase()] ?? qm[2].toLowerCase() : "st";
      title = qm[3];
    }
  }
  const titleExcerpt = title;
  title = title
    .replace(/\s+(?:från|av|hos|på|vid|till|via|i)\s+.*$/i, "")
    .replace(/\d[\d\s]*\s*(?:kr|kronor|:-).*$/i, "")
    .replace(/\b(gratis|billigt|säljes|skänkes)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Pris
  let price: number | null = null;
  let priceExcerpt: string | null = null;
  const pr = rest.match(/(\d{1,3}(?:\s\d{3})+|\d+)\s*(?:kr|kronor|:-)(\s*(?:\/\s*st|styck|st\b|per styck|\/styck))?/i);
  if (pr) {
    const each = Number(pr[1].replace(/\s/g, ""));
    price = pr[2] && quantity ? each * quantity : each;
    priceExcerpt = pr[0];
  }
  const gift = rest.match(GIFT);
  const acquisitionType = gift ? "gift" : price !== null ? "purchase" : null;

  // Person och ort: "Anders i Ockelbo", "från Lena", "hos Torsten Lindholm i Gävle". Efternamn hör till namnet.
  let personName: string | null = null;
  let personExcerpt: string | null = null;
  let locality: string | null = null;
  let localityExcerpt: string | null = null;
  const withLoc = rest.match(new RegExp(`(?:^|[\\s,])(?:(?:[Ff]rån|[Aa]v|[Hh]os)\\s+)?(${FULL_NAME})\\s+i\\s+(${NAME})`));
  if (withLoc && isName(withLoc[1])) {
    personName = withLoc[1];
    personExcerpt = withLoc[0];
    locality = withLoc[2];
    localityExcerpt = `i ${withLoc[2]}`;
  } else {
    const pn = rest.match(new RegExp(`(?:^|\\s)(?:[Ff]rån|[Aa]v|[Hh]os)\\s+(${FULL_NAME})`));
    if (pn && isName(pn[1]) && norm(pn[1]) !== norm(placeName ?? "")) {
      personName = pn[1];
      personExcerpt = pn[0];
    } else if (CONTRIBUTION.test(rest)) {
      const subj = rest.match(new RegExp(`(${FULL_NAME})\\s+(?:och\\s+${FULL_NAME}\\s+)?(?:hjälpte|bidrog|jobbade|arbetade|murade|snickrade|lagade|bjöd|kom)`));
      if (subj && isName(subj[1])) { personName = subj[1]; personExcerpt = subj[0]; }
    }
  }
  locality = localityOutsideName(personName, locality);
  if (!locality) localityExcerpt = null;
  // En person som också är platsen ("på Återbruket") är ingen person
  if (personName && placeName && norm(personName) === norm(placeName)) { personName = null; personExcerpt = null; }

  const dl = parseDeadline(rest, today);
  const tr = rest.match(/\b(hämta\w*|släp|bära|bärhjälp|lastbil|skåpbil)\b/i);
  const hm = rest.match(/(\d+(?:[.,]\d+)?)\s*(?:timmar|tim|h)\b/i);
  const category = CATEGORY_RULES.find(([re]) => re.test(title || rest))?.[1] ?? null;

  return {
    title: title ? cap(title) : null, titleExcerpt,
    quantity, quantityExcerpt, unit,
    price, priceExcerpt, acquisitionType, typeExcerpt: gift ? gift[0] : priceExcerpt,
    personName, personExcerpt, locality, localityExcerpt,
    tipster, tipsterExcerpt, placeName, placeExcerpt,
    projectName, projectExcerpt: prm ? prm[0] : null,
    deadline: dl?.date ?? null, deadlineExcerpt: dl?.excerpt ?? null,
    needsTransport: !!tr || !!dl, transportExcerpt: tr ? tr[0] : dl?.excerpt ?? null,
    category, living: LIVING.test(title || rest),
    hours: hm ? Number(hm[1].replace(",", ".")) : null,
  };
}

export function guessKind(text: string, hint?: string | null): CardKind | "find" {
  if (hint && hint !== "other") return hint === "find" ? "find" : (hint as CardKind);
  if (CONTRIBUTION.test(text) && !/\b(köpte|kr|kronor)\b/i.test(text)) return "contribution";
  if (OBSERVATION.test(text) && !/\b(köpte|fick|hämta|kr\b)\b/i.test(text)) return "observation";
  return "find";
}

function observationType(text: string): string {
  if (/blomm|knopp/i.test(text)) return "bloom";
  if (/skörd/i.test(text)) return "harvest";
  if (/frost|regn|vind|torka|stående vatten|översvämn/i.test(text)) return "weather_local";
  if (/skada|angrep|trasig/i.test(text)) return "damage";
  if (/damm|vatten|grodrom/i.test(text)) return "water";
  if (/fågel|fåglar|groda|grodor|humla|humlor|bi\b|fjäril|snok|igelkott|rådjur|älg|räv|häckar|bygger bo|ruvar|sjunger/i.test(text)) return "species";
  return "plant";
}

function matchPerson(name: string | null, locality: string | null, k: CaptureKnowledge): { id: string | null; candidates: MatchCandidate[]; confidence: number } {
  if (!name) return { id: null, candidates: [], confidence: 0 };
  const exact = k.people.filter((p) => norm(p.display_name) === norm(name));
  if (exact.length === 1) {
    return { id: exact[0].id, confidence: 0.9, candidates: [{ entity_id: exact[0].id, title: exact[0].display_name, shared: ["samma namn", ...(locality && norm(exact[0].locality ?? "") === norm(locality) ? ["samma ort"] : [])] }] };
  }
  const firstName = norm(name.split(" ")[0]);
  const byFirst = k.people.filter((p) => norm(p.display_name.split(" ")[0]) === firstName);
  const candidates = byFirst.map((p) => {
    const shared = ["samma förnamn"];
    if (locality && norm(p.locality ?? "") === norm(locality)) shared.push("samma ort");
    if (p.roles?.includes("supplier")) shared.push("har sålt till oss förut");
    if (p.roles?.includes("giver")) shared.push("har gett oss saker förut");
    return { entity_id: p.id, title: p.display_name, shared };
  }).sort((a, b) => b.shared.length - a.shared.length);
  // Säker bara när exakt en kandidat också delar ort; annars får människan välja
  const sameLocality = candidates.filter((c) => c.shared.includes("samma ort"));
  const sure = sameLocality.length === 1;
  return { id: sure ? sameLocality[0].entity_id : null, candidates, confidence: sure ? 0.75 : 0.45 };
}

const f = (field: string, value: unknown, confidence: number, excerpt?: string | null, extra: Evidence[] = []): ProposalField =>
  ({ field, value, confidence, evidence: [...ev(excerpt), ...extra] });

// Gör en fångst till ett förslag med kort och evidens – samma format som Capture Agent lämnar.
export function interpretLocally(input: { text?: string | null; transcript?: string | null; kind_hint?: string | null; url?: string | null },
                                 k: CaptureKnowledge, today = new Date()): ProposalDraft {
  const text = [input.text, input.transcript].filter(Boolean).join(". ").trim();
  const kind = guessKind(text, input.kind_hint);
  const p = parseCapture(text, today);
  const cards: ProposalCard[] = [];
  const evKind = input.transcript && !input.text ? "transcript_excerpt" : "text_excerpt";
  const fx = (field: string, value: unknown, confidence: number, excerpt?: string | null): ProposalField => {
    const x = f(field, value, confidence, excerpt);
    x.evidence = x.evidence?.map((e) => ({ ...e, kind: evKind }));
    return x;
  };
  const person = matchPerson(p.personName, p.locality, k);

  if (kind === "observation") {
    const fields = [fx("description", text, 0.9, text.slice(0, 80)), fx("kind_code", observationType(text), 0.5)];
    if (k.here?.place_id) fields.push({ field: "place_id", value: k.here.place_id, confidence: 0.7, evidence: [{ kind: "context", reference: "Här", excerpt: k.here.place_name ?? "GPS" }] });
    cards.push({ key: "observation", kind: "observation", fields });
    return { summary: `Observation: ${text.slice(0, 60)}`, agent: "local_heuristics", cards };
  }
  if (kind === "moment") {
    cards.push({ key: "moment", kind: "moment", fields: [fx("title", cap(text.split(/[.!?]/)[0].slice(0, 80)), 0.7, text.slice(0, 80)), fx("note", text, 0.9)] });
    return { summary: `Ögonblick: ${text.slice(0, 60)}`, agent: "local_heuristics", cards };
  }
  if (kind === "contribution" || (kind === "person" && !p.title)) {
    if (p.personName) {
      cards.push({ key: "person", kind: "person", fields: [fx("display_name", p.personName, 0.6, p.personExcerpt), ...(p.locality ? [fx("locality", p.locality, 0.55, p.localityExcerpt)] : []), f("_match", null, 0)],
        match_entity_id: person.id, match_candidates: person.candidates });
    }
    if (kind === "contribution") {
      const type = /mat|lunch|fika|bjöd/i.test(text) ? "food" : /körde|släp|transport/i.test(text) ? "transport" : /lärde|visade hur|kunskap/i.test(text) ? "knowledge" : /gav|skänkte/i.test(text) ? "material" : "time";
      const fields = [fx("type_code", type, 0.55), fx("description", text, 0.8)];
      if (p.hours) fields.push(fx("hours", p.hours, 0.7, `${p.hours} timmar`));
      cards.push({ key: "contribution", kind: "contribution", fields });
    }
    return { summary: p.personName ? `${p.personName}${kind === "contribution" ? " bidrog" : ""}` : text.slice(0, 60), agent: "local_heuristics", cards };
  }

  // Fynd: sak, person, anskaffning, uppgift och kopplingar
  const objectFields: ProposalField[] = [fx("title", p.title ?? "Nytt fynd", p.title ? 0.7 : 0.3, p.titleExcerpt)];
  if (p.quantity !== null && (p.quantity !== 1 || (p.unit && p.unit !== "st"))) {
    objectFields.push(fx("quantity", p.quantity, 0.85, p.quantityExcerpt), fx("unit", p.unit ?? "st", 0.8, p.quantityExcerpt));
  }
  if (p.category) objectFields.push(fx("category", p.category, 0.6, p.titleExcerpt));
  if (p.living) objectFields.push(fx("living_material", true, 0.6, p.titleExcerpt));
  cards.push({ key: "object", kind: "object", fields: objectFields });

  if (p.personName) {
    cards.push({
      key: "person", kind: "person",
      fields: [fx("display_name", p.personName, person.id ? 0.85 : 0.6, p.personExcerpt), ...(p.locality ? [fx("locality", p.locality, 0.6, p.localityExcerpt)] : []), f("_match", null, 0)],
      match_entity_id: person.id, match_candidates: person.candidates,
    });
  }
  if (p.acquisitionType || p.personName || p.placeName) {
    const fields: ProposalField[] = [fx("type", p.acquisitionType ?? "purchase", p.acquisitionType ? 0.65 : 0.4, p.typeExcerpt)];
    // Pris är ett kritiskt fält och kräver alltid mänskligt beslut (R1.1 11.2)
    if (p.price !== null) fields.push(fx("price", p.price, 0.6, p.priceExcerpt));
    cards.push({ key: "acquisition", kind: "acquisition", fields });
  }
  if (p.needsTransport) {
    const fields: ProposalField[] = [fx("title", `Hämta ${(p.title ?? "fyndet").toLocaleLowerCase("sv")}${p.personName ? ` hos ${p.personName.split(" ")[0]}` : ""}`, 0.6, p.transportExcerpt)];
    if (p.deadline) fields.push(fx("due_at", p.deadline, 0.65, p.deadlineExcerpt));
    if (/släp/i.test(text)) fields.push(fx("note", "Behöver släp", 0.6, "släp"));
    cards.push({ key: "task", kind: "pickup", fields });
  }
  // Kopplingar: plats utanför Vreta, projekt (bara befintliga) och tipsare
  const links: ProposalField[] = [];
  if (p.placeName) {
    const known = k.places.find((x) => norm(x.name) === norm(p.placeName!) || norm(x.name) === norm(p.placeName!.replace(/(en|et)$/i, "")));
    if (known) links.push(fx("external_place_id", known.id, 0.75, p.placeExcerpt));
    else links.push(fx("external_place", cap(p.placeName), 0.5, p.placeExcerpt));
  }
  if (p.projectName) {
    const proj = k.projects.find((x) => norm(x.name).startsWith(norm(p.projectName!).replace(/(et|en|n)$/i, "")) || norm(p.projectName!).startsWith(norm(x.name)));
    if (proj) {
      links.push(fx("project_id", proj.id, 0.7, p.projectExcerpt));
      const word = norm(p.title ?? "").split(" ")[0];
      const need = proj.needs?.find((n) => word && norm(n.title).includes(word)) ?? proj.needs?.find((n) => n.unit && n.unit === p.unit && proj.needs!.length === 1);
      if (need) links.push(fx("need_id", need.id, 0.6, p.projectExcerpt));
    }
  }
  if (p.tipster) {
    const t = matchPerson(p.tipster, null, k);
    links.push(fx("tipster", p.tipster, 0.65, p.tipsterExcerpt));
    if (t.id || t.candidates.length === 1) links.push(fx("tipster_person_id", t.id ?? t.candidates[0].entity_id, 0.6, p.tipsterExcerpt));
  }
  if (links.length) cards.push({ key: "links", kind: "links", fields: links });

  const parts = [p.quantity && p.quantity !== 1 ? `${p.quantity} ${p.unit === "st" ? "" : p.unit + " "}`.trim() : null, (p.title ?? "Nytt fynd").toLocaleLowerCase("sv")]
    .filter(Boolean).join(" ");
  const summary = `${cap(parts)}${p.personName ? ` från ${p.personName}` : ""}${p.locality ? `, ${p.locality}` : ""}${p.placeName ? ` på ${p.placeName}` : ""}`;
  return { summary, agent: "local_heuristics", cards };
}

// Plattar ut ett förslag till fältvärden per kort (för tester och snabba sammanfattningar).
export function flatten(d: ProposalDraft): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const c of d.cards) out[c.key] = Object.fromEntries(c.fields.filter((x) => x.field !== "_match").map((x) => [x.field, x.value]));
  return out;
}

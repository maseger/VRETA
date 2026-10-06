// Enkel regelbaserad tolkning av en fångst. Används i demoläge och som reserv när
// AI inte går att nå (offline, fel, avvisad förfrågan). Ger alltid låg confidence,
// så att gränssnittet visar fälten som förslag (INV-02).

export interface HeuristicResult {
  title: string;
  category: string;
  quantity: number;
  unit: string;
  price_total: number | null;
  acquisition_type: "purchase" | "gift" | null;
  person_name: string | null;
  person_locality: string | null;
  deadline: string | null;
  task_title: string | null;
  /** "på Återbruket", "på loppisen" – plats utanför Vreta (M6). */
  place_name: string | null;
  /** "till orangeriet" – kandidat; kopplas bara om ett projekt med namnet finns. */
  project_name: string | null;
  /** "Anders tipsade", "tips från Anders", "via Anders" (M8). */
  introduced_by: string | null;
}

const NUMBER_WORDS: Record<string, number> = {
  en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, elva: 11, tolv: 12, femton: 15, tjugo: 20,
};

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/fönster|dörr|port|lucka/i, "Fönster och dörrar"],
  [/tegel|sten|platta|marksten/i, "Tegel och sten"],
  [/virke|bräd|plank|balk|panel|trä/i, "Trä och virke"],
  [/handtag|beslag|gångjärn|smide|spanjolett|krok/i, "Beslag och smide"],
  [/kakel|kakelugn|ugn|spis/i, "Kakel och ugnar"],
  [/lampa|armatur|ljus|kabel/i, "Belysning och el"],
  [/stol|bord|skåp|byrå|soffa|möbel/i, "Möbler och inredning"],
  [/rhododendron|buske|träd|planta|perenn|ros|växt|lök/i, "Växter"],
  [/verktyg|maskin|såg|borr|skottkärra/i, "Verktyg och maskiner"],
  [/radiator|element|takpanna|takplåt|trappa|räcke|list/i, "Byggnadsdelar"],
];

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function parseNumber(token: string): number | null {
  const n = Number(token.replace(/\s/g, ""));
  if (!Number.isNaN(n)) return n;
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

export function parseDeadline(text: string, today = new Date()): string | null {
  const m = text.toLowerCase().match(/(?:före|innan|senast)\s+(?:(\d{1,2})\s+)?(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]);
  const day = m[1] ? Number(m[1]) : 1;
  let year = today.getFullYear();
  const candidate = new Date(Date.UTC(year, month, day));
  if (candidate.getTime() < Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) year += 1;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const NAME = "[A-ZÅÄÖ][a-zåäöé]+";
/** För- och efternamn, med bindestreck: "Torsten Lindholm", "Anna-Karin Berg". */
const FULL_NAME = `${NAME}(?:-${NAME})?(?:\\s+${NAME}(?:-${NAME})?)?`;
const PLACE_WORDS = /\b(?:på|vid)\s+(loppis(?:en)?|återvinning(?:en|scentralen)?|återbruk(?:et)?|tippen|auktion(?:en)?|byggåterbruk(?:et)?)\b/i;

export function parseCaptureText(text: string, today = new Date()): HeuristicResult {
  const original = text.replace(/\s+/g, " ").trim();
  // Vem som tipsade tas bort innan säljaren letas upp, så att "tips från Anders" inte gör Anders till säljare
  const tip = original.match(new RegExp(`(${FULL_NAME})\\s+tipsade`)) ?? original.match(new RegExp(`(?:tips(?:at)?\\s+(?:från|av)|via)\\s+(${FULL_NAME})`));
  const introduced_by = tip?.[1] ?? null;
  const clean = tip ? original.replace(tip[0], "").replace(/\s+/g, " ").trim() : original;

  // Plats: "på Återbruket", "på Kyrkans loppis", "på loppisen"
  const placeMatch = clean.match(new RegExp(`\\b(?:på|vid)\\s+((?:${NAME})(?:\\s+[a-zåäö]+)?)`)) ?? clean.match(PLACE_WORDS);
  let place_name = placeMatch?.[1] ?? null;
  // Ett andra ord hör bara till namnet om det är ett platsord: "Kyrkans loppis", men inte "Återbruket till"
  if (place_name && /\s/.test(place_name) && !/^(loppis\w*|marknad\w*|gård\w*|butik\w*|handel\w*)$/i.test(place_name.split(" ")[1])) place_name = place_name.split(" ")[0];
  // Projekt: "till orangeriet", "till jordkällaren"
  const project_name = clean.match(/\btill\s+(?:den\s+|det\s+|vårt\s+|nya\s+)?([a-zåäöA-ZÅÄÖ]{4,})/)?.[1] ?? null;
  const clauses = clean.split(/[,.;\n]/).map((c) => c.trim()).filter(Boolean);
  const first = (clauses[0] ?? "").replace(/^(?:jag\s+|vi\s+)?(?:har\s+)?(?:köpte|köpt|fick|fått|hittade|hittat|hämtade|hämtat)\s+/i, "");

  // Antal och benämning: "sex gjutjärnsfönster", "400 tegel", "12 st rhododendron"
  let quantity = 1;
  let title = first;
  const qm = first.match(/^(\d+|[a-zåäö]+)\s+(?:st\.?\s+)?(.+)$/i);
  if (qm) {
    const n = parseNumber(qm[1]);
    if (n !== null) {
      quantity = n;
      title = qm[2];
    }
  }
  title = title
    .replace(/\s+(från|av|hos|på|vid|till|via)\s+.*$/i, "")
    .replace(/\d[\d\s]*\s*(kr|kronor|:-).*$/i, "")
    .replace(/\b(gratis|billigt|säljes|skänkes)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  title = capitalize(title);

  // Pris
  let price_total: number | null = null;
  const pm = clean.match(/(\d[\d\s]*)\s*(?:kr|kronor|:-)(\s*(?:\/\s*st|styck|st\b|per styck))?/i);
  if (pm) {
    const each = Number(pm[1].replace(/\s/g, ""));
    price_total = pm[2] ? each * quantity : each;
  }

  const isGift = /gratis|skänk|gåva|ge bort|bortskänk/i.test(clean);
  const acquisition_type = isGift ? "gift" : price_total !== null ? "purchase" : null;

  // Person och ort: "Anders i Ockelbo", "från Lena", "hos Karin Berg i Gävle". Efternamn hör till namnet, aldrig till orten.
  let person_name: string | null = null;
  let person_locality: string | null = null;
  const pl = clean.match(new RegExp(`(?:^|[\\s,])(?:(?:[Ff]rån|[Aa]v|[Hh]os)\\s+)?(${FULL_NAME})\\s+i\\s+([A-ZÅÄÖ][a-zåäöé]+)`));
  if (pl) {
    person_name = pl[1];
    person_locality = pl[2];
  } else {
    const pn = clean.match(new RegExp(`(?:^|\\s)(?:[Ff]rån|[Aa]v|[Hh]os)\\s+(${FULL_NAME})`));
    if (pn) person_name = pn[1];
  }
  person_locality = localityOutsideName(person_name, person_locality);

  const category = CATEGORY_KEYWORDS.find(([re]) => re.test(clean))?.[1] ?? "Övrigt";
  const deadline = parseDeadline(clean, today);
  const needsPickup = /hämta|hämtas|släp|bära|bärhjälp/i.test(clean) || deadline !== null;
  const task_title = needsPickup ? `Hämta ${title.toLowerCase()}${person_name ? ` hos ${person_name}` : ""}` : null;

  return {
    title: title || "Nytt fynd",
    category,
    quantity,
    unit: "st",
    price_total,
    acquisition_type,
    person_name,
    person_locality,
    deadline,
    task_title,
    place_name,
    project_name,
    introduced_by,
  };
}

/** En ort som är en del av personens namn är ett feltolkat efternamn ("Torsten Lindholm" ≠ Lindholm som ort). */
export function localityOutsideName(name: string | null | undefined, locality: string | null | undefined): string | null {
  const loc = (locality ?? "").trim();
  if (!loc) return null;
  const words = new Set((name ?? "").toLocaleLowerCase("sv").split(/[\s-]+/).filter(Boolean));
  return loc.toLocaleLowerCase("sv").split(/[\s-]+/).some((w) => words.has(w)) ? null : loc;
}

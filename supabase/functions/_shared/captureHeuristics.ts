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

export function parseCaptureText(text: string, today = new Date()): HeuristicResult {
  const clean = text.replace(/\s+/g, " ").trim();
  const clauses = clean.split(/[,.;\n]/).map((c) => c.trim()).filter(Boolean);
  const first = clauses[0] ?? "";

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
    .replace(/\s+(från|av|hos)\s+.*$/i, "")
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

  // Person och ort: "Anders i Ockelbo", "från Lena", "hos Karin i Gävle"
  let person_name: string | null = null;
  let person_locality: string | null = null;
  const pl = clean.match(/(?:^|[\s,])(?:från\s+|av\s+|hos\s+)?([A-ZÅÄÖ][a-zåäöé]+)\s+i\s+([A-ZÅÄÖ][a-zåäöé]+)/);
  if (pl) {
    person_name = pl[1];
    person_locality = pl[2];
  } else {
    const pn = clean.match(/(?:från|av|hos)\s+([A-ZÅÄÖ][a-zåäöé]+)/);
    if (pn) person_name = pn[1];
  }

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
  };
}

// Platstyper för en regenerativ återbruksfastighet med skogsträdgård och permakultur.
// Typen sparas som text på zonen eller byggnaden (kind), så listan kan växa utan databasändring.
// Permakulturzon anger hur ofta platsen besöks: 0 = huset, 1 = dagligen … 5 = vild natur.

export interface PlaceType {
  name: string;
  hint?: string;
  /** Typisk permakulturzon (0–5). */
  pzone?: number;
}

export interface PlaceTypeGroup {
  group: string;
  types: PlaceType[];
}

/** Områden på Vreta: ytor som ritas på kartan. */
export const AREA_TYPES: PlaceTypeGroup[] = [
  {
    group: "Hem och vardag",
    types: [
      { name: "Hushåll", hint: "Bostaden med kök, tvätt och förråd för vardagen", pzone: 0 },
      { name: "Gårdsplan", pzone: 1 },
      { name: "Uteplats", pzone: 1 },
      { name: "Lekplats", pzone: 1 },
      { name: "Gäst- och samlingsplats", hint: "Där kurser, fikor och arbetsdagar hålls", pzone: 1 },
    ],
  },
  {
    group: "Odling och mat",
    types: [
      { name: "Köksträdgård", hint: "Grönsaker och kryddor nära köket", pzone: 1 },
      { name: "Odlingsbäddar", pzone: 1 },
      { name: "Örtagård", pzone: 1 },
      { name: "Skogsträdgård", hint: "Food forest: flerskiktad odling av träd, buskar, perenner och marktäckare", pzone: 2 },
      { name: "Fruktträdgård", pzone: 2 },
      { name: "Bärodling", pzone: 2 },
      { name: "Plantering", hint: "Nyplanterade träd, buskar eller perenner", pzone: 2 },
      { name: "Perennrabatt", pzone: 1 },
      { name: "Hügelkultur", hint: "Odlingsbädd byggd på ved och ris som långsamt förmultnar", pzone: 2 },
      { name: "Plantskola", hint: "Sticklingar, fröplantor och plantor som väntar på sin plats", pzone: 1 },
      { name: "Åker", pzone: 3 },
    ],
  },
  {
    group: "Djur och pollinatörer",
    types: [
      { name: "Hönsgård", pzone: 2 },
      { name: "Bete och hage", pzone: 3 },
      { name: "Bigård", pzone: 2 },
      { name: "Blomsteräng för pollinatörer", pzone: 3 },
    ],
  },
  {
    group: "Vatten",
    types: [
      { name: "Damm", hint: "Vattenmagasin, livsmiljö och mikroklimat", pzone: 2 },
      { name: "Våtmark" , pzone: 4 },
      { name: "Svackdike", hint: "Swale: dike längs höjdkurvan som håller kvar regnvatten i marken", pzone: 3 },
      { name: "Regnträdgård", hint: "Sänka som tar emot dagvatten från tak och hårdgjorda ytor", pzone: 1 },
      { name: "Bäck eller dike", pzone: 4 },
    ],
  },
  {
    group: "Kretslopp",
    types: [
      { name: "Kompost", hint: "Kompostplats för trädgårds- och matavfall", pzone: 1 },
      { name: "Gödselstad", pzone: 2 },
      { name: "Flis- och lövupplag", hint: "Material för täckodling och jordbyggande", pzone: 2 },
      { name: "Vedupplag", pzone: 2 },
    ],
  },
  {
    group: "Natur",
    types: [
      { name: "Äng", pzone: 3 },
      { name: "Skog", pzone: 4 },
      { name: "Skogsbryn och häck", hint: "Lä, bärbuskar och boplatser i övergången mellan skog och öppen mark", pzone: 3 },
      { name: "Läplantering", pzone: 3 },
      { name: "Stenmur eller stenröse", hint: "Värmemagasin och boplatser för insekter, ödlor och fåglar", pzone: 3 },
      { name: "Vild zon", hint: "Lämnas åt naturen – för att observera och lära", pzone: 5 },
    ],
  },
  {
    group: "Återbruk och infrastruktur",
    types: [
      { name: "Materialgård", hint: "Uteplats för återbruksmaterial: tegel, virke, sten, fönster", pzone: 2 },
      { name: "Arbetsyta", hint: "Där man snickrar, demonterar och renoverar utomhus", pzone: 1 },
      { name: "Parkering", pzone: 1 },
      { name: "Väg och stig" },
      { name: "Uppställningsplats för släp och maskiner", pzone: 2 },
    ],
  },
];

/** Byggnader och anläggningar. */
export const STRUCTURE_TYPES: PlaceTypeGroup[] = [
  {
    group: "Hus",
    types: [
      { name: "Bostadshus", hint: "Hushållet – permakulturens zon 0", pzone: 0 },
      { name: "Gästhus" },
      { name: "Ladugård" },
      { name: "Stall" },
      { name: "Garage" },
      { name: "Verkstad" },
      { name: "Förråd" },
      { name: "Bod" },
      { name: "Vedbod" },
      { name: "Jordkällare", hint: "Svalt förråd för rotfrukter, äpplen och konserver" },
    ],
  },
  {
    group: "Odling",
    types: [
      { name: "Växthus" },
      { name: "Orangeri" },
      { name: "Drivbänk", hint: "Kallbänk eller varmbänk för förodling" },
      { name: "Odlingslåda eller pallkrage" },
      { name: "Spaljé eller pergola" },
    ],
  },
  {
    group: "Djur och pollinatörer",
    types: [
      { name: "Hönshus" },
      { name: "Bikupa" },
      { name: "Insektshotell" },
      { name: "Fågelholkar" },
      { name: "Stängsel och grind" },
    ],
  },
  {
    group: "Vatten och energi",
    types: [
      { name: "Brunn" },
      { name: "Regnvattentank", hint: "Samlar takvatten för bevattning" },
      { name: "Bevattning" },
      { name: "Avloppsanläggning" },
      { name: "Solceller" },
      { name: "Laddplats" },
    ],
  },
  {
    group: "Kretslopp",
    types: [
      { name: "Kompostbehållare" },
      { name: "Maskkompost" },
      { name: "Torrdass" },
      { name: "Biokolsugn", hint: "Gör biokol av ris och ved för jordförbättring" },
    ],
  },
  {
    group: "Utemiljö",
    types: [
      { name: "Altan eller trädäck" },
      { name: "Vindskydd" },
      { name: "Eldplats" },
      { name: "Bro eller spång" },
      { name: "Lekstuga" },
    ],
  },
];

export function findPlaceType(groups: PlaceTypeGroup[], name: string): PlaceType | null {
  for (const g of groups) for (const t of g.types) if (t.name === name) return t;
  return null;
}

export const PERMACULTURE_ZONE: Record<number, string> = {
  0: "Zon 0 – huset",
  1: "Zon 1 – dagligen",
  2: "Zon 2 – ofta",
  3: "Zon 3 – ibland",
  4: "Zon 4 – sällan",
  5: "Zon 5 – vild natur",
};

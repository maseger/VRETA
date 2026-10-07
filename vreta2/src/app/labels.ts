// Svenska etiketter för värden som inte är kodlistor (enum-värden i databasen).
export const ACQUISITION_TYPES: Record<string, string> = { purchase: "Köp", gift: "Gåva", exchange: "Byte", loan: "Lån", work_trade: "Arbete mot vara" };
export const LISTING_TYPES: Record<string, string> = { sell: "Sälja", give: "Skänka", exchange: "Byta", lend: "Låna ut", wanted: "Efterlysa", help_wanted: "Söka hjälp" };
export const DISPOSAL_TYPES: Record<string, string> = { sold: "Såld", donated: "Skänkt", exchanged: "Bytt", lent: "Utlånad", discarded: "Kasserad" };
export const USAGE_TYPES: Record<string, string> = {
  mounted: "Monterad", planted: "Planterad", installed: "Installerad", built_in: "Inbyggd", renovated: "Renoverad", moved: "Flyttad", dismantled: "Demonterad",
};
export const HEALTH: Record<string, string> = { establishing: "Etablerar sig", healthy: "Mår bra", struggling: "Kämpar", dead: "Död" };
export const CONDITION: Record<string, string> = { "1": "1 – slitet, behöver lagas", "2": "2 – tydliga spår", "3": "3 – gott begagnat", "4": "4 – fint skick", "5": "5 – som nytt" };
export const CONSENT: Record<string, string> = { yes: "Ja", no: "Nej", ask: "Fråga först" };
export const VISIBILITY: Record<string, string> = { private: "Privat", internal: "Intern", shareable: "Delbar", public: "Publik" };
export const ROLE: Record<string, string> = { owner: "Ägare", helper: "Medhjälpare", reader: "Läsare", guest: "Gäst", host: "Värd" };
export const CERTAINTY: Record<string, string> = { certain: "Säker", probable: "Trolig", uncertain: "Osäker" };

export const CARD_KIND: Record<string, string> = {
  object: "Saken", person: "Personen", acquisition: "Hur den kom till oss", task: "Att göra", pickup: "Hämtning",
  links: "Kopplingar", observation: "Observation", moment: "Ögonblick", contribution: "Bidrag",
};

export const FIELD: Record<string, string> = {
  title: "Vad", quantity: "Antal", unit: "Enhet", category: "Kategori", material: "Material", dimensions: "Mått", condition: "Skick",
  weight_kg: "Vikt (kg)", age_period: "Ålder/period", description: "Beskrivning", status: "Status", place_id: "Plats", story_why: "Varför vi sparade den",
  living_material: "Levande material", species_variety: "Art/sort", display_name: "Namn", locality: "Ort", phone: "Telefon", how_we_met: "Hur vi träffades",
  roles: "Roller", type: "Typ", price: "Pris (kr)", payment_method: "Betalning", due_at: "Senast", note: "Anteckning", external_place: "Plats utanför Vreta",
  project: "Projekt", project_id: "Projekt", need_id: "Behov", new_need_title: "Nytt behov", tipster: "Tipsare", kind_code: "Slag",
  taxon_suggestion: "Art (förslag)", occurred_at: "När", type_code: "Typ av bidrag", hours: "Timmar", amount: "Mängd", person_name: "Vem",
  count: "Antal", certainty: "Säkerhet", place_name: "Var", summary: "Sammanfattning",
};

export function fieldLabel(f: string): string {
  return FIELD[f] ?? f.replace(/_/g, " ");
}

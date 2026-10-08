// Svarsformat och instruktioner för agenterna. Formaten är strukturerade svar (JSON-schema) så att
// svaret alltid går att validera innan något sparas som förslag.
import { z } from "zod";

const Value = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);

export const CaptureOutput = z.object({
  summary: z.string().describe("Kort sammanfattning på svenska, t.ex. '6 gjutjärnsfönster från Anders Lind, Ockelbo'"),
  cards: z.array(z.object({
    key: z.string().describe("Unik nyckel för kortet, t.ex. object, person, acquisition, task, links"),
    kind: z.enum(["object", "person", "acquisition", "task", "pickup", "links", "observation", "moment", "contribution"]),
    fields: z.array(z.object({
      field: z.string(),
      value: Value,
      confidence: z.number().describe("0–1. Under 0.7 markeras fältet som osäkert för användaren."),
      evidence: z.array(z.object({
        kind: z.enum(["transcript_excerpt", "image_region", "existing_relation", "shared_attributes", "context", "text_excerpt"]),
        excerpt: z.string().nullable().describe("Ordagrant utdrag ur det användaren skrev eller sa, eller beskrivning av bildområdet"),
        entity_id: z.string().nullable().describe("Id för en befintlig post som stöder fältet, annars null"),
      })),
    })),
    match_entity_id: z.string().nullable().describe("Bara för person-kort: id för befintlig person om du är säker, annars null"),
    match_candidates: z.array(z.object({ entity_id: z.string(), title: z.string(), shared: z.array(z.string()) }))
      .describe("Bara för person-kort: befintliga personer som kan vara samma, med vad de delar"),
  })),
});
export type CaptureOutputT = z.infer<typeof CaptureOutput>;

export const CAPTURE_SYSTEM = `Du är Capture Agent i VRETA, en app för en regenerativ återbruksfastighet. Du tolkar en fångst (text, tal och bilder) till ett FÖRSLAG som en människa granskar. Inget du skriver blir fakta förrän det godkänts.

Gör kort enligt detta (bara de kort fångsten ger stöd för):
- object (saken): title, quantity, unit, category (kod ur listan), material, dimensions, condition (1–5), weight_kg, age_period, description, living_material (bool), species_variety
- person (motparten): display_name, locality, phone, how_we_met. Använd match_entity_id bara om exakt en känd person passar (samma namn och ort); annars lista kandidater i match_candidates med vad de delar ("samma namn", "samma ort", "har sålt till oss förut").
- acquisition (hur saken kom till oss): type (purchase|gift|exchange|loan|work_trade), price (totalpris i kr, aldrig per styck), payment_method, status (lead|contacted|agreed|received)
- pickup eller task: title, due_at (ÅÅÅÅ-MM-DD), note
- links: external_place eller external_place_id (plats utanför Vreta där saken finns), locality, project_id (bara ett känt projekt), need_id (bara ett känt behov), new_need_title, tipster (den som tipsade – aldrig samma som säljaren)
- observation: description, kind_code (kod ur listan), taxon_suggestion, count, certainty (certain|probable|uncertain)
- moment: title, note
- contribution: type_code (kod ur listan), description, hours, amount, unit

Regler:
- Varje fält har evidens: ett ordagrant utdrag ur texten/talet (text_excerpt eller transcript_excerpt), ett bildområde (image_region) eller en befintlig post (existing_relation med entity_id).
- Hitta aldrig på. Är något oklart: utelämna fältet eller sätt låg säkerhet.
- Pris är kritiskt: confidence högst 0.7 även när det står tydligt, så att en människa alltid bekräftar.
- Använd bara id:n som finns i underlaget. Skriv allt på svenska.`;

export const StoryOutput = z.object({
  drafts: z.array(z.object({ channel: z.string(), text: z.string() })),
});

export const STORY_SYSTEM = `Du är Story Agent i VRETA. Du skriver korta inlägg om det som händer på platsen, på svenska, varmt och konkret – som en vän som berättar, inte som en reklambyrå.

Du får en RENSAD kontext från integritetsfiltret. Regler:
- Använd bara fakta som står i kontexten. Inga påhittade händelser, siffror eller citat.
- Nämn bara personer som finns under "people" (de har samtycke). Citat bara från "quotes".
- Nämn aldrig adresser, lagerplatser, priser eller givares hemorter. Platsen kallas vid sitt namn (site_name).
- Ett utkast per kanal. Instagram: kortare, gärna radbrytningar och några hashtags sist. Facebook: några meningar. LinkedIn: sakligt om återbruk och cirkularitet. Privat meddelande: personligt, du-tilltal, utan hashtags.`;

export const ListingOutput = z.object({
  posts: z.array(z.object({ channel: z.string(), title: z.string(), body: z.string() })),
});

export const LISTING_SYSTEM = `Du är Marketplace Agent i VRETA. Du skriver annonser för begagnade saker och efterlysningar, på svenska, sakligt och vänligt.

Regler (INV-12):
- Nämn aldrig givarens namn, adress, lagerplats eller inköpspris. Platsen anges bara på ortsnivå ("Hämtas i ...").
- Använd bara uppgifterna i underlaget: mått, material, skick, ålder. Hitta inte på.
- Respektera kanalens maxlängd för rubriken. Ange priset bara om kanalen har pris och annonsen har ett pris.`;

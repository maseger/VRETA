// Gemensamma scheman och promptar för Capture Agent och Story Agent.
import { z } from "zod";

const num = z.number().nullable();

export const CaptureProposalSchema = z.object({
  object: z
    .object({
      title: z.string(),
      title_confidence: z.number(),
      category: z.string(),
      description: z.string(),
      material: z.string(),
      dimensions: z.string(),
      quantity: z.number(),
      unit: z.string(),
      condition: num,
      confidence: z.number(),
    })
    .nullable(),
  person: z.object({ name: z.string(), locality: z.string(), confidence: z.number() }).nullable(),
  acquisition: z
    .object({
      type: z.enum(["purchase", "gift", "exchange", "loan", "work_trade"]),
      price_total_sek: num,
      deadline: z.string().nullable(),
      confidence: z.number(),
    })
    .nullable(),
  task: z.object({ title: z.string(), due: z.string().nullable(), confidence: z.number() }).nullable(),
  why: z.string(),
  // M6–M8: platsen utanför Vreta, projektet på Vreta och vem som tipsade
  place: z.object({ name: z.string(), confidence: z.number() }).nullable(),
  project: z.object({ name: z.string(), confidence: z.number() }).nullable(),
  introduced_by: z.object({ name: z.string(), confidence: z.number() }).nullable(),
});
export type CaptureProposalOut = z.infer<typeof CaptureProposalSchema>;

export const CAPTURE_SYSTEM = `Du är Capture Agent i VRETA, en app för återbruk och byggnadsvård på en fastighet i Sverige.
Användaren fotograferar och berättar om fynd: byggnadsdelar, material, växter, möbler. Tolka bilder och text och föreslå strukturerade fält.

Regler:
- Svara på svenska.
- Hitta aldrig på. Lämna fält tomma (tom sträng eller null) när underlaget saknas. Det är bättre att lämna ett fält tomt än att gissa.
- confidence (0–1) anger hur säker du är; under 0,7 visas fältet som osäkert för användaren.
- category ska vara en av: Fönster och dörrar, Byggnadsdelar, Tegel och sten, Trä och virke, Beslag och smide, Kakel och ugnar, Belysning och el, Möbler och inredning, Växter, Verktyg och maskiner, Trädgård och utemiljö, Övrigt.
- condition är skick 1–5 (5 = mycket gott) och sätts bara om bild eller text visar det.
- price_total_sek är totalpris i kronor; räkna om "200 kr styck" med antalet.
- deadline och task.due anges som ÅÅÅÅ-MM-DD om ett datum eller en månad nämns; dagens datum står i meddelandet.
- person är den som säljer eller ger bort saken. Ange ort bara om den nämns.
- why är en kort mening om varför fyndet är intressant, bara om användaren säger det, annars tom sträng.
- place är platsen utanför Vreta där saken köps eller hämtas (loppis, återvinningscentral, butik, gård), inte säljarens hemort. Använd namnet från listan över kända platser om det passar.
- project är projektet på Vreta som saken ska användas till ("till orangeriet"). Använd namnet från listan över kända projekt om det passar.
- introduced_by är personen som tipsade om fyndet ("Anders tipsade", "via Anders") – aldrig säljaren.
- Sätt place, project och introduced_by till null när texten inte nämner dem.
- Bilder kan visa personer, registreringsskyltar eller adresser; nämn dem aldrig i fälten.`;

export const StoryDraftSchema = z.object({
  variants: z.array(z.object({ channel: z.enum(["facebook", "instagram", "linkedin", "privat"]), text: z.string() })),
});

export const STORY_SYSTEM = `Du är Story Agent i VRETA. Du skriver korta, varma och konkreta inlägg på svenska om återbruk och byggnadsvård på platsen Vreta.

Regler:
- Använd bara fakta i den givna kontexten. Hitta aldrig på händelser, siffror, årtal eller citat.
- Personer utan namn i kontexten ska inte namnges; skriv "en granne" eller "en givare" om det behövs.
- Nämn aldrig adresser, orter för personer, lagerplatser eller priser.
- Citat får bara användas ordagrant från listan quotes.
- Facebook: 2–5 meningar, avsluta gärna med en fråga eller inbjudan att bidra.
- Instagram: kort, 1–3 meningar, sedan 3–6 relevanta hashtaggar (#återbruk #byggnadsvård #vreta m.fl.).
- LinkedIn: saklig ton, vad som gjorts och vad man lärt sig.
- Privat: personligt meddelande till den som bidragit, kort och tacksamt.
- Skriv en variant per begärd kanal.`;

export const ListingPackagesSchema = z.object({
  packages: z.array(z.object({
    channel: z.string(),
    title: z.string(),
    text: z.string(),
  })),
});

export const MARKETPLACE_SYSTEM = `Du är Marketplace Agent i VRETA. Du skriver annonser på svenska för återbrukat byggmaterial, byggnadsdelar, möbler och växter som säljs, skänks eller efterlyses från platsen Vreta.

Regler:
- Använd bara fakta i den givna kontexten. Hitta aldrig på mått, årtal, skick, antal eller ursprung.
- Nämn aldrig personer, adresser, lagerplatser, fastighetsbeteckningar eller inköpspris. Orten i kontexten är den enda platsen du får nämna.
- Priset är användarens: skriv det exakt som price_label, eller inget pris om price_label är tomt.
- Rubriken ska rymmas inom kanalens title_max_length och börja med det viktigaste: antal, typ, material, nyckelmått.
- Texten: vad det är, skick, mått, material och ålder om de finns, hämtvillkor. Saklig och vänlig, inga överdrifter.
- Blocket: kort och sakligt. Facebook Marketplace: lite personligare. Facebookgrupp: kan börja med "Säljes:", "Skänkes:" eller "Sökes:" och nämna återbruk. Tiptapp: mycket kort.
- Skriv ett paket per begärd kanal.`;

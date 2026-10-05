// AC-11: inget utkast i Berätta eller annonsstudion innehåller private-fält, adresser eller
// lagerplatser. Fallen genereras som kombinationer av samtycke, mål, kanal och känsligt innehåll.
// Alla namn, platser och uppgifter är påhittade.
import { describe, expect, it } from "vitest";
import { guardStoryContext, guardThanks, type Consent, type RawStoryContext, type RawThanksContext } from "../../supabase/functions/_shared/privacyGuard";
import { draftStory, draftThanks, type Goal, type StoryChannel } from "../../supabase/functions/_shared/storyTemplates";
import { buildPackage, draftLeadReply, guardListing, type RawListingContext } from "../../supabase/functions/_shared/listingPackage";
import { adaptersFor } from "../../supabase/functions/_shared/channels";

const CONSENTS: Consent[] = ["yes", "no", "ask"];
const GOALS: Goal[] = ["fyndet", "resan", "fore_efter", "tack", "visa_vad_som_hant"];
const CHANNELS: StoryChannel[] = ["facebook", "instagram", "linkedin", "privat"];

const ALWAYS_SECRET = ["070-555 12 34", "NYCKEL-UNDER-KRUKAN", "4321", "Hamrånge", "Min mormor byggde", "INTERN-HÄNDELSE", "PRIVAT-BIDRAG", "INTERNT-BIDRAG"];

function storyRaw(name: Consent, contribution: Consent, override: { name_ok: boolean; contribution_ok: boolean } | null = null): RawStoryContext {
  return {
    object: { title: "Spröjsat fönster", category: "Fönster och dörrar", description: "Sex rutor", material: "Furu", dimensions: "60 x 90 cm", era: "1920-tal", condition: 3, quantity: 1, unit: "st", is_batch: false, status: "in_use", visibility: "shareable" },
    acquisition: { type: "gift", price: 4321 },
    people: [{ id: "p1", name: "Gunilla", locality: "Hamrånge", contact: "070-555 12 34", notes: "NYCKEL-UNDER-KRUKAN", relation: "givare", consent_name: name, consent_contribution: contribution, consent_override: override }],
    contributions: [
      { person_id: "p1", kind: "tid", description: "Skrapade fönsterbågarna", visibility: "shareable" },
      { person_id: "p1", kind: "material", description: "PRIVAT-BIDRAG", visibility: "private" },
      { person_id: "p1", kind: "kunskap", description: "INTERNT-BIDRAG", visibility: "internal" },
    ],
    notes: [
      { kind: "why", text: "Passar orangeriet", quote_consent: false },
      { kind: "quote", text: "Min mormor byggde huset", quote_consent: false },
    ],
    events: [
      { summary: "Hämtat", occurred_at: "2026-09-01T10:00:00Z", visibility: "shareable" },
      { summary: "INTERN-HÄNDELSE", occurred_at: "2026-09-02T10:00:00Z", visibility: "internal" },
    ],
    media: [{ id: "m1", visibility: "shareable", has_people: false, has_clean: true }],
  };
}

describe("AC-11 · Berätta: objektberättelser", () => {
  const cases = CONSENTS.flatMap((n) => CONSENTS.flatMap((c) => GOALS.flatMap((g) => CHANNELS.map((ch) => ({ n, c, g, ch })))));
  it(`har minst 50 fall (${cases.length})`, () => expect(cases.length).toBeGreaterThanOrEqual(50));
  it.each(cases)("namn=$n bidrag=$c mål=$g kanal=$ch", ({ n, c, g, ch }) => {
    const guard = guardStoryContext(storyRaw(n, c), "I bruk");
    const text = draftStory(guard.context!, g, ch);
    const context = JSON.stringify(guard.context);
    for (const secret of ALWAYS_SECRET) {
      expect(text).not.toContain(secret);
      expect(context).not.toContain(secret);
    }
    if (n !== "yes") {
      expect(text).not.toContain("Gunilla");
      expect(context).not.toContain("Gunilla");
      expect(guard.warnings.length).toBeGreaterThan(0);
    }
    if (c !== "yes") expect(context).not.toContain("Skrapade");
  });
  it("samtycke för inlägget släpper bara igenom det som sagts ja till", () => {
    const g = guardStoryContext(storyRaw("ask", "ask", { name_ok: true, contribution_ok: false }), "I bruk");
    expect(g.context!.people[0].name).toBe("Gunilla");
    expect(JSON.stringify(g.context)).not.toContain("Skrapade");
    const no = guardStoryContext(storyRaw("no", "no", { name_ok: true, contribution_ok: true }), "I bruk");
    expect(JSON.stringify(no.context)).not.toContain("Gunilla"); // ett nej går inte att överstyra per inlägg
  });
});

function thanksRaw(name: Consent, contribution: Consent, override: boolean): RawThanksContext {
  return {
    person: { name: "Gunilla", locality: "Hamrånge", contact: "070-555 12 34", notes: "NYCKEL-UNDER-KRUKAN", consent_name: name, consent_image: "no", consent_contribution: contribution, consent_override: override ? { name_ok: true, contribution_ok: true } : null },
    contributions: [
      { kind: "tid", description: "Skrapade fönsterbågarna", visibility: "shareable", hours: 4 },
      { kind: "material", description: "PRIVAT-BIDRAG", visibility: "private", hours: null },
      { kind: "kunskap", description: "INTERNT-BIDRAG", visibility: "internal", hours: null },
    ],
    objects: [
      { title: "Spröjsat fönster", visibility: "shareable", status: "in_use", new_life_place: "Orangeriet", price: 4321 },
      { title: "INTERN-HÄNDELSE", visibility: "internal", status: "stored", new_life_place: null, price: null },
    ],
    media: [{ id: "m1", visibility: "shareable", has_people: true, has_clean: true }, { id: "m2", visibility: "shareable", has_people: false, has_clean: true }],
  };
}

describe("AC-11 · Berätta: tack till en person (AC-10)", () => {
  const cases = CONSENTS.flatMap((n) => CONSENTS.flatMap((c) => [false, true].flatMap((o) => CHANNELS.map((ch) => ({ n, c, o, ch })))));
  it(`har minst 50 fall (${cases.length})`, () => expect(cases.length).toBeGreaterThanOrEqual(50));
  it.each(cases)("namn=$n bidrag=$c samtycke-för-inlägget=$o kanal=$ch", ({ n, c, o, ch }) => {
    const g = guardThanks(thanksRaw(n, c, o));
    const text = draftThanks(g.thanks!, ch);
    for (const secret of ALWAYS_SECRET) expect(text).not.toContain(secret);
    const named = n === "yes" || (n === "ask" && o);
    if (!named) {
      expect(text).not.toContain("Gunilla");
      expect(g.warnings.length).toBeGreaterThan(0);
    }
    expect(g.thanks!.media_ids).toEqual(["m2"]);
    const described = c === "yes" || (c === "ask" && o);
    if (!described) expect(text).not.toContain("Skrapade");
  });
});

const INJECTIONS: { label: string; text: string; secret: string }[] = [
  { label: "givarens namn", text: "Från Gunillas torp, Gunilla vill bli av med dem", secret: "Gunilla" },
  { label: "lagerplats", text: "Står i Snickarboden på Hylla 3", secret: "Hylla 3" },
  { label: "byggnad", text: "Förvaras i Snickarboden", secret: "Snickarboden" },
  { label: "gatuadress", text: "Hämtas på Björkvägen 12", secret: "Björkvägen 12" },
  { label: "postnummer", text: "Adress 811 92 Storvik", secret: "811 92" },
  { label: "telefon", text: "Ring 070-555 12 34", secret: "070-555 12 34" },
  { label: "e-post", text: "Mejla gunilla@example.com", secret: "@example.com" },
  { label: "fastighetsbeteckning", text: "Ligger på Ekbacken 3:12", secret: "3:12" },
  { label: "koordinater", text: "Position 60.12345, 16.54321", secret: "60.12345" },
];

function listingRaw(type: RawListingContext["listing"]["type"], description: string): RawListingContext {
  return {
    listing: { type, title: "Spröjsade fönster", description, price: type === "sell" ? 800 : null, quantity: 4, locality: "Björkvägen 12, Storvik" },
    object: { title: "Spröjsade fönster", category: "Fönster och dörrar", description: "", material: "Furu", dimensions: "60 x 90 cm", era: "1920-tal", condition: 3, quantity: 4, unit: "st", is_batch: true, visibility: "shareable" },
    person_names: ["Gunilla"],
    place_names: ["Snickarboden", "Hylla 3", "Ekbacken"],
    purchase_price: 4321,
    media: [{ id: "m1", visibility: "shareable", has_people: false, has_clean: true }, { id: "m2", visibility: "shareable", has_people: true, has_clean: true }, { id: "m3", visibility: "internal", has_people: false, has_clean: true }],
  };
}

describe("AC-11 · Annonsstudion: annonspaket och svarsutkast", () => {
  const types = ["sell", "give", "wanted"] as const;
  const cases = INJECTIONS.flatMap((inj) => types.flatMap((t) => adaptersFor(t).map((a) => ({ inj: inj.label, text: inj.text, secret: inj.secret, t, ch: a.id }))));
  it(`har minst 50 fall (${cases.length})`, () => expect(cases.length).toBeGreaterThanOrEqual(50));
  it.each(cases)("$inj i $t på $ch", ({ text, secret, t, ch }) => {
    const g = guardListing(listingRaw(t, text));
    const pkg = buildPackage(g.context!, ch);
    const all = `${pkg.title}\n${pkg.text}\n${JSON.stringify(g.context)}`;
    for (const s of [secret, "4321", "Björkvägen", "Gunilla", "Hylla 3", "Snickarboden"]) expect(all).not.toContain(s);
    expect(pkg.image_ids).toEqual(["m1"]);
    expect(g.context!.locality).toBe("Storvik");
    for (const stage of ["available", "booking", "agreed", "taken", "next_in_line"] as const) {
      const reply = draftLeadReply(g.context!, stage, "Sara");
      for (const s of [secret, "4321", "Björkvägen", "Hylla 3"]) expect(reply).not.toContain(s);
    }
  });
  it("ett privat objekt kan inte annonseras", () => {
    const raw = listingRaw("sell", "");
    expect(guardListing({ ...raw, object: { ...raw.object!, visibility: "private" } }).allowed).toBe(false);
  });
});

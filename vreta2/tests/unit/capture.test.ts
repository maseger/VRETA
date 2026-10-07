// Prototypens testfall för fångsttolkningen blir testfall i den nya kodbasen (Designdokument 2.0).
import { describe, expect, it } from "vitest";
import { flatten, interpretLocally, localityOutsideName, parseCapture, parseDeadline } from "@shared/captureLocal.ts";
import type { CaptureKnowledge } from "@shared/types.ts";

const today = new Date("2026-10-07T10:00:00Z");
const none: CaptureKnowledge = { people: [], places: [], projects: [] };
const known: CaptureKnowledge = {
  people: [
    { id: "p-anders", display_name: "Anders Lind", locality: "Ockelbo", roles: ["supplier"] },
    { id: "p-anders2", display_name: "Anders Berg", locality: "Uppsala" },
    { id: "p-lena", display_name: "Lena Berg", locality: "Uppsala" },
  ],
  places: [{ id: "x-aterbruket", name: "Återbruket", type: "reuse_store" }],
  projects: [{ id: "pr-or", name: "Orangeriet", needs: [{ id: "n-tegel", title: "Tegel till muren", unit: "st", quantity: 1500 }] }],
};

describe("lokal fångsttolkning", () => {
  it("tolkar specifikationens exempel", () => {
    const d = flatten(interpretLocally({ text: "Sex gjutjärnsfönster, Anders i Ockelbo, 200 kr styck, måste hämtas före november, behöver släp" }, none, today));
    expect(d.object).toMatchObject({ title: "Gjutjärnsfönster", quantity: 6, unit: "st", category: "windows" });
    expect(d.person).toMatchObject({ display_name: "Anders", locality: "Ockelbo" });
    expect(d.acquisition).toMatchObject({ type: "purchase", price: 1200 });
    expect(d.task).toMatchObject({ title: "Hämta gjutjärnsfönster hos Anders", due_at: "2026-11-01", note: "Behöver släp" });
  });

  it("varje förslag bär evidens från texten", () => {
    const d = interpretLocally({ text: "Sex gjutjärnsfönster, Anders i Ockelbo, 200 kr styck" }, none, today);
    const qty = d.cards.find((c) => c.key === "object")!.fields.find((f) => f.field === "quantity")!;
    expect(qty.evidence?.[0].excerpt).toBe("Sex");
    const price = d.cards.find((c) => c.key === "acquisition")!.fields.find((f) => f.field === "price")!;
    expect(price.evidence?.[0].excerpt).toBe("200 kr styck");
  });

  it("känner igen gåvor och rensar titeln", () => {
    const d = flatten(interpretLocally({ text: "400 tegel gratis från Karin i Gävle" }, none, today));
    expect(d.object).toMatchObject({ title: "Tegel", quantity: 400 });
    expect(d.acquisition.type).toBe("gift");
    expect(d.acquisition.price).toBeUndefined();
    expect(d.person.display_name).toBe("Karin");
  });

  it("lägger passerade månader på nästa år", () => expect(parseDeadline("före mars", today)?.date).toBe("2027-03-01"));

  it("håller ihop för- och efternamn och gör aldrig efternamnet till ort (FR-088)", () => {
    expect(parseCapture("Byrå från Torsten Lindholm", today)).toMatchObject({ personName: "Torsten Lindholm", locality: null, title: "Byrå" });
    expect(parseCapture("Hämta byrå hos Torsten Lindholm i Gävle", today)).toMatchObject({ personName: "Torsten Lindholm", locality: "Gävle" });
    expect(parseCapture("Hos Torsten Lindholm finns tegel", today).personName).toBe("Torsten Lindholm");
    expect(localityOutsideName("Torsten Lindholm", "Lindholm")).toBeNull();
    expect(localityOutsideName("Torsten Lindholm", "Ockelbo")).toBe("Ockelbo");
  });

  it("hittar inte på någon person när ingen nämns", () => {
    expect(parseCapture("Gammal kakelugn").personName).toBeNull();
    expect(flatten(interpretLocally({ text: "Gammal kakelugn" }, none, today)).person).toBeUndefined();
  });

  it("tolkar plats, projekt och vem som tipsade utan att göra tipsaren till säljare (AC-26)", () => {
    const h = parseCapture("Köpte 40 tegel på Återbruket till orangeriet, 200 kr. Anders tipsade");
    expect(h).toMatchObject({ title: "Tegel", quantity: 40, placeName: "Återbruket", projectName: "orangeriet", tipster: "Anders", personName: null, price: 200 });
    const g = parseCapture("Två dörrar från Lena i Storvik, tips från Maja");
    expect(g).toMatchObject({ personName: "Lena", locality: "Storvik", tipster: "Maja", placeName: null });
    expect(parseCapture("Fyra stolar på Kyrkans loppis").placeName).toBe("Kyrkans loppis");
    expect(parseCapture("Sex fönster på loppisen").placeName).toBe("loppisen");
  });

  it("kopplar bara projekt och platser som finns, och föreslår behovet", () => {
    const d = flatten(interpretLocally({ text: "Tegel till orangeriet från Lena, Anders tipsade" }, known, today));
    expect(d.links).toMatchObject({ project_id: "pr-or", need_id: "n-tegel", tipster: "Anders" });
    expect(d.person.display_name).toBe("Lena");
    const unknown = flatten(interpretLocally({ text: "Fönster till jordkällaren" }, known, today));
    expect(unknown.links).toBeUndefined();
    const place = flatten(interpretLocally({ text: "Köpte 40 tegel på Återbruket" }, known, today));
    expect(place.links.external_place_id).toBe("x-aterbruket");
  });

  it("föreslår befintlig person med gemensamma attribut men väljer inte vid tvekan", () => {
    const d = interpretLocally({ text: "Tre stolar från Anders i Ockelbo" }, known, today);
    const person = d.cards.find((c) => c.key === "person")!;
    expect(person.match_entity_id).toBe("p-anders");
    expect(person.match_candidates![0].shared).toEqual(expect.arrayContaining(["samma förnamn", "samma ort"]));
    const unsure = interpretLocally({ text: "Tre stolar från Anders" }, known, today).cards.find((c) => c.key === "person")!;
    expect(unsure.match_entity_id).toBeNull();
    expect(unsure.match_candidates!.length).toBe(2);
    const exact = interpretLocally({ text: "Tre stolar från Lena Berg" }, known, today).cards.find((c) => c.key === "person")!;
    expect(exact.match_entity_id).toBe("p-lena");
  });

  it("känner igen enheter och stora tal", () => {
    expect(parseCapture("4 ton lera till dammen")).toMatchObject({ quantity: 4, unit: "ton", title: "Lera" });
    expect(parseCapture("1 500 tegel från rivningen")).toMatchObject({ quantity: 1500, title: "Tegel" });
    expect(parseCapture("12 st rhododendron")).toMatchObject({ quantity: 12, unit: "st", living: true });
  });

  it("gör observationer och bidrag till egna kort", () => {
    const o = flatten(interpretLocally({ text: "Grodrom i dammens grunda del" }, { ...none, here: { place_id: "z-dammen", place_name: "Dammen" } }, today));
    expect(o.observation).toMatchObject({ kind_code: "water", place_id: "z-dammen" });
    const c = flatten(interpretLocally({ text: "Johan Ek hjälpte till att mura i 6 timmar" }, none, today));
    expect(c.contribution).toMatchObject({ type_code: "time", hours: 6 });
    expect(c.person.display_name).toBe("Johan Ek");
  });

  it("röstfångst får evidens som transkriptutdrag", () => {
    const d = interpretLocally({ transcript: "sex gjutjärnsfönster från Anders" }, none, today);
    expect(d.cards[0].fields[0].evidence?.[0].kind).toBe("transcript_excerpt");
  });
});

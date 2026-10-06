import { describe, expect, it } from "vitest";
import { canTransition, nextStep, OBJECT_TRANSITIONS } from "../domain/stateMachine";
import { parseCaptureText, parseDeadline } from "../../supabase/functions/_shared/captureHeuristics";
import { guardStoryContext, type RawStoryContext } from "../../supabase/functions/_shared/privacyGuard";
import { draftStory } from "../../supabase/functions/_shared/storyTemplates";

describe("tillståndsmaskinen", () => {
  it("tillåter genvägen köpt och hämtat direkt", () => expect(canTransition("discovered", "collected")).toBe(true));
  it("nekar att sälja något som bara är upptäckt", () => expect(canTransition("discovered", "sold")).toBe(false));
  it("låter ett objekt i bruk demonteras tillbaka till lager", () => expect(canTransition("in_use", "stored")).toBe(true));
  it("har inga övergångar från terminala statusar", () => expect(OBJECT_TRANSITIONS.sold).toEqual([]));
  it("föreslår nästa steg som är en tillåten övergång", () => {
    for (const s of Object.keys(OBJECT_TRANSITIONS) as (keyof typeof OBJECT_TRANSITIONS)[]) {
      const n = nextStep(s);
      if (n) expect(canTransition(s, n.to)).toBe(true);
    }
  });
});

describe("lokal tolkning av fångst", () => {
  const today = new Date("2026-10-05T12:00:00Z");
  it("tolkar specifikationens exempel", () => {
    const r = parseCaptureText("Sex gjutjärnsfönster, Anders i Ockelbo, 200 kr styck, måste hämtas före november, behöver släp", today);
    expect(r).toMatchObject({
      title: "Gjutjärnsfönster", quantity: 6, price_total: 1200, acquisition_type: "purchase",
      person_name: "Anders", person_locality: "Ockelbo", deadline: "2026-11-01", category: "Fönster och dörrar",
    });
    expect(r.task_title).toBe("Hämta gjutjärnsfönster hos Anders");
  });
  it("känner igen gåvor och rensar titeln", () => {
    const r = parseCaptureText("400 tegel gratis från Karin i Gävle", today);
    expect(r).toMatchObject({ title: "Tegel", quantity: 400, acquisition_type: "gift", person_name: "Karin", price_total: null });
  });
  it("lägger passerade månader på nästa år", () => expect(parseDeadline("före mars", today)).toBe("2027-03-01"));
  it("hittar inte på person när ingen nämns", () => expect(parseCaptureText("Gammal kakelugn").person_name).toBeNull());
});

const raw = (over: Partial<RawStoryContext> = {}): RawStoryContext => ({
  object: { title: "Gjutjärnsfönster", category: "Fönster och dörrar", description: "", material: "Gjutjärn", dimensions: "", era: "1890-tal", condition: 4, quantity: 6, unit: "st", is_batch: true, status: "stored", visibility: "shareable" },
  acquisition: { type: "purchase", price: 1200 },
  people: [{ id: "p1", name: "Anders", locality: "Ockelbo", contact: "070-123", notes: "privat", relation: "leverantör", consent_name: "no", consent_contribution: "ask" }],
  notes: [{ kind: "why", text: "Från ett torp", quote_consent: false }, { kind: "quote", text: "Min farfar satte in dem", quote_consent: false }],
  events: [{ summary: "Upptäckt", occurred_at: "2026-10-01T10:00:00Z", visibility: "shareable" }, { summary: "Intern notering", occurred_at: "2026-10-02T10:00:00Z", visibility: "internal" }],
  media: [{ id: "m1", visibility: "shareable", has_people: false, has_clean: true }, { id: "m2", visibility: "shareable", has_people: true, has_clean: true }],
  ...over,
});

describe("Privacy Guard (AC-10, AC-11)", () => {
  it("släpper aldrig igenom privata fält", () => {
    const g = guardStoryContext(raw(), "I lager");
    const json = JSON.stringify(g.context);
    for (const secret of ["070-123", "privat", "1200", "Ockelbo", "Anders", "Min farfar"]) expect(json).not.toContain(secret);
    expect(g.context!.media_ids).toEqual(["m1"]);
    expect(g.context!.events.map((e) => e.summary)).toEqual(["Upptäckt"]);
  });
  it("nämner personen bara med samtycke", () => {
    const g = guardStoryContext(raw({ people: [{ ...raw().people[0], consent_name: "yes" }] }), "I lager");
    expect(g.context!.people[0].name).toBe("Anders");
    expect(JSON.stringify(g.context)).not.toContain("Ockelbo");
  });
  it("varnar när samtycke ska frågas", () => {
    const g = guardStoryContext(raw({ people: [{ ...raw().people[0], consent_name: "ask" }] }), "I lager");
    expect(g.warnings.join(" ")).toContain("Fråga Anders");
  });
  it("stoppar interna och privata objekt helt", () => {
    const g = guardStoryContext(raw({ object: { ...raw().object, visibility: "internal" } }), "I lager");
    expect(g.allowed).toBe(false);
  });
  it("tackutkast utan samtycke till namn nämner inte personen (AC-10)", () => {
    const g = guardStoryContext(raw(), "I lager");
    const text = draftStory(g.context!, "tack", "facebook");
    expect(text).not.toContain("Anders");
    expect(text).toContain("tack");
  });
});

describe("Fånga känner igen plats, projekt och tipsare (M6–M8)", () => {
  it("tolkar plats, projekt och vem som tipsade utan att göra tipsaren till säljare", () => {
    const h = parseCaptureText("Köpte 40 tegel på Återbruket till orangeriet, 200 kr. Anders tipsade");
    expect(h).toMatchObject({ title: "Tegel", quantity: 40, place_name: "Återbruket", project_name: "orangeriet", introduced_by: "Anders", person_name: null, price_total: 200 });
    const g = parseCaptureText("Två dörrar från Lena i Storvik, tips från Maja");
    expect(g).toMatchObject({ person_name: "Lena", person_locality: "Storvik", introduced_by: "Maja", place_name: null });
    expect(parseCaptureText("Fyra stolar på Kyrkans loppis").place_name).toBe("Kyrkans loppis");
    expect(parseCaptureText("Sex fönster på loppisen").place_name).toBe("loppisen");
  });
});

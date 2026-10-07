// Privacy Guard och utgående texter (AC-10, AC-11 med genererade fall, INV-03, INV-06, INV-12).
import { describe, expect, it } from "vitest";
import { checkText, guardStory, scrubText } from "@shared/privacyGuard.ts";
import { writeStory } from "@shared/storyTemplates.ts";
import { buildChannelPackage, suggestPrice } from "@shared/listingPackage.ts";
import type { ChannelAdapter, StoryContextRaw } from "@shared/types.ts";

const ig: ChannelAdapter = { code: "instagram", label: "Instagram", kind: "social", max_images: 10, share_text: false, hashtags: true };
const fb: ChannelAdapter = { code: "facebook", label: "Facebook", kind: "social", max_images: 10, share_text: false };
const blocket: ChannelAdapter = { code: "blocket", label: "Blocket", kind: "marketplace", max_images: 3, title_max_length: 40, share_text: false, supports_price: true };

function raw(over: Partial<StoryContextRaw> = {}): StoryContextRaw {
  return {
    site: { name: "Vreta" },
    sources: [{ id: "o1", type: "object", title: "Gjutjärnsfönster", visibility: "shareable", facts: {
      label: "6 st gjutjärnsfönster", material: "Gjutjärn", age_period: "1890-tal", story_why: "Min farfar Anders Lind byggde torpet på Byvägen 4 i Ockelbo. Köpta för 1200 kr.",
      from_locality: "Ockelbo", usage: [{ type: "mounted", place: "Orangeriet", occurred_at: "2026-10-03" }] },
      timeline: [{ summary: "Upptäckt: 6 st gjutjärnsfönster från Anders Lind", occurred_at: "2026-09-12", event_type: "object.discovered" },
                 { summary: "Hämtning · Ockelbo klar", occurred_at: "2026-09-20", event_type: "pickup.completed" }] }],
    people: [{ id: "p1", display_name: "Anders Lind", consent: { name: "no", image: "no", contribution: "yes" } }],
    contributions: [{ person_id: "p1", type_code: "material", description: "Gav fönstren" }],
    notes: [{ kind: "quote", text: "De har suttit i 130 år", person_id: "p1", quote_consent: false }],
    media: [{ id: "m1", visibility: "shareable", share_path: "a/m1/share.jpg" }, { id: "m2", visibility: "private", share_path: "a/m2/share.jpg" },
            { id: "m3", visibility: "shareable", share_path: "a/m3/share.jpg", depicts: [{ person_id: "p1", image_consent: "no" }] }],
    ...over,
  };
}

describe("Privacy Guard", () => {
  it("släpper aldrig igenom privata fält", () => {
    const g = guardStory(raw(), { goal: "story", channelKind: "public" });
    expect(g.allowed).toBe(true);
    const json = JSON.stringify(g.context);
    for (const secret of ["070-", "Byvägen", "1200", "Ockelbo", "Anders", "Lind"]) expect(json).not.toContain(secret);
    expect(g.context.media_ids).toEqual(["m1"]);
    expect(g.context.sources[0].moments).toEqual(["Upptäckt: 6 st gjutjärnsfönster från någon"]);
    expect(g.removed.map((r) => r.kind)).toEqual(expect.arrayContaining(["name", "address", "price", "locality", "quote", "image"]));
  });

  it("nämner personen bara med samtycke", () => {
    const g = guardStory(raw({ people: [{ id: "p1", display_name: "Anders Lind", consent: { name: "yes", image: "no", contribution: "yes" } }] }), { goal: "thanks", channelKind: "public" });
    expect(g.context.people[0]).toMatchObject({ name: "Anders Lind", contribution: "Gav fönstren" });
    expect(JSON.stringify(g.context)).not.toContain("Ockelbo");
  });

  it("varnar och ger ett färdigt meddelande när samtycke ska frågas", () => {
    const g = guardStory(raw({ people: [{ id: "p1", display_name: "Anders Lind", consent: { name: "ask", image: "ask", contribution: "ask" } }] }), { goal: "thanks", channelKind: "public" });
    expect(g.warnings.join(" ")).toContain("Fråga Anders");
    expect(g.ask_messages[0].message).toMatch(/Okej om jag nämner dig vid namn/);
  });

  it("samtycke för just inlägget räcker", () => {
    const g = guardStory(raw({ people: [{ id: "p1", display_name: "Anders Lind", consent: { name: "ask", image: "ask", contribution: "ask" }, post_consent: { name: "yes" } }] }), { goal: "story", channelKind: "public" });
    expect(g.context.people.map((p) => p.name)).toEqual(["Anders Lind"]);
  });

  it("stoppar privata poster helt och interna i publika kanaler", () => {
    const priv = raw();
    priv.sources[0].visibility = "private";
    expect(guardStory(priv, { goal: "story", channelKind: "private" }).allowed).toBe(false);
    const internal = raw();
    internal.sources[0].visibility = "internal";
    expect(guardStory(internal, { goal: "story", channelKind: "public" }).allowed).toBe(false);
    expect(guardStory(internal, { goal: "thanks", channelKind: "private" }).allowed).toBe(true);
  });

  it("AC-10: ett tackutkast utan samtycke till namn nämner inte personen", () => {
    const g = guardStory(raw(), { goal: "thanks", channelKind: "public" });
    const text = writeStory(g.context, fb);
    expect(text).not.toContain("Anders");
    expect(text.toLowerCase()).toContain("tack");
  });

  it("efterkontrollen hittar namn, adresser, telefon och priser i färdig text", () => {
    const found = checkText("Tack Anders! Hämtas på Byvägen 4, ring 070-123 45 67. Köpt för 1 200 kr.", { forbiddenNames: ["Anders Lind", "Anders"] });
    expect(found.map((f) => f.kind).sort()).toEqual(["address", "name", "phone", "price"]);
  });

  // AC-11: minst 50 fall – kombinationer av hemligheter i fritext ska aldrig nå ett utkast.
  const secrets = [
    ["Byvägen 4", "address"], ["Storgatan 12B", "address"], ["Kvarnstigen 3", "address"], ["070-123 45 67", "phone"], ["0731234567", "phone"],
    ["018-12 34 56", "phone"], ["anders@exempel.se", "email"], ["lena.berg@mejl.nu", "email"], ["1200 kr", "price"], ["1 500 kronor", "price"],
    ["350:-", "price"], ["755 91 Uppsala", "address"],
  ] as const;
  const frames = ["Fönstren kom från {x}.", "Kontakt: {x}", "Min granne ({x}) skänkte dem", "{x} – tack!", "Hämtades {x} i somras"];
  let n = 0;
  for (const [secret, kind] of secrets) {
    for (const frame of frames) {
      n++;
      it(`fall ${n}: ${kind} i "${frame}"`, () => {
        const text = frame.replace("{x}", secret);
        const g = guardStory(raw({ sources: [{ id: "o", type: "object", title: "Fönster", visibility: "shareable", facts: { story_why: text } }], people: [], media: [], notes: [], contributions: [] }), { goal: "story", channelKind: "public" });
        const out = writeStory(g.context, ig) + JSON.stringify(g.context);
        expect(out).not.toContain(secret);
        expect(checkText(out)).toEqual([]);
      });
    }
  }
  it("har minst 50 genererade fall", () => expect(n).toBeGreaterThanOrEqual(50));
});

describe("annonspaket", () => {
  const pkg = {
    type: "sell", title: "Spegeldörrar i furu", quantity: 3, unit: "st", condition: 4, price: 300,
    description: "Gamla innerdörrar från Torsten Lindholm på Kvarnstigen 3. De låg på Hylla 3.",
    object: { title: "Spegeldörrar i furu", material: "Furu", dimensions: "70 × 200 cm" }, locality: "Uppsala",
    media: [{ id: "a", share_path: "1" }, { id: "b", share_path: "2" }, { id: "c", share_path: "3" }, { id: "d", share_path: "4" }],
    purchase_price: 450, comparable_sales: [{ title: "Dörr", price: 250 }, { title: "Dörr", price: 400 }, { title: "Dörr", price: 300 }],
  };
  it("anger ort men aldrig givare, adress, lagerplats eller inköpspris (INV-12)", () => {
    const p = buildChannelPackage(pkg, blocket, { forbiddenNames: ["Torsten Lindholm", "Torsten"], storagePlaces: ["Hylla 3"] });
    expect(p.body).toContain("Hämtas i Uppsala");
    expect(p.body).not.toContain("Torsten");
    expect(p.body).not.toContain("Kvarnstigen");
    expect(p.body).not.toContain("450");
    expect(p.warnings.join(" ")).toContain("Hylla 3");
    expect(p.title.length).toBeLessThanOrEqual(40);
    expect(p.media_ids).toEqual(["a", "b", "c"]);
  });
  it("prisförslaget bygger på tidigare försäljningar och skick, med motivering", () => {
    const s = suggestPrice(pkg);
    expect(s.price).toBe(300);
    expect(s.rationale).toContain("sålda liknande 250–400 kr");
  });
  it("scrubText tar bort det känsliga och lämnar resten", () => {
    expect(scrubText("Ring 070-123 45 67 eller kom till Storgatan 1", {}).text).toBe("Ring eller kom till");
  });
});

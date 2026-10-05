import { beforeEach, describe, expect, it } from "vitest";
import { LocalRepo } from "../data/localRepo";
import { seedDemo } from "../data/demoSeed";
import { buildRawStoryContext } from "../../supabase/functions/_shared/storyContext";
import { guardStoryContext } from "../../supabase/functions/_shared/privacyGuard";

let repo: LocalRepo;
let n = 0;

beforeEach(async () => {
  repo = new LocalRepo(`test-${n++}`);
  await seedDemo(repo, false);
});

describe("lokalt datalager", () => {
  it("skapar objekt, person, anskaffning, händelse och audit från ett förslag (AC-01)", async () => {
    const [prop] = await repo.proposals();
    expect(prop.content.person?.existing_person_id).toBeTruthy(); // matchar Anders från tidigare fynd
    const id = await repo.approveProposal({
      proposal_id: prop.id, partial: false,
      object: { title: "Mässingshandtag", category: "Beslag och smide", description: "", material: "Mässing", dimensions: "", quantity: 4, unit: "st", condition: 4, field_meta: {} },
      person: { name: "Anders", locality: "", existing_person_id: prop.content.person!.existing_person_id },
      acquisition: { type: "purchase", price: 200, deadline: "2026-11-15" },
      task: { title: "Hämta mässingshandtag", due: "2026-11-15" },
      why: "", media_ids: [],
    });
    const obj = await repo.object(id);
    expect(obj).toMatchObject({ title: "Mässingshandtag", is_batch: true, status: "discovered" });
    expect((await repo.acquisitionsFor(id))[0].price).toBe(200);
    expect((await repo.eventsFor("object", id)).map((e) => e.event_type)).toContain("object.discovered");
    expect((await repo.audit()).some((a) => a.action === "create_from_proposal" && a.entity_id === id)).toBe(true);
    expect(await repo.proposals()).toHaveLength(0);
    expect((await repo.persons()).filter((p) => p.name === "Anders")).toHaveLength(1);
  });

  it("följer tillståndsmaskinen och kräver plats för i bruk", async () => {
    const obj = (await repo.objects()).find((o) => o.title === "Tegel")!;
    await expect(repo.changeStatus(obj.id, "sold")).rejects.toThrow(/Otillåten/);
    await repo.changeStatus(obj.id, "stored");
    await expect(repo.changeStatus(obj.id, "in_use")).rejects.toThrow(/plats/);
    const zone = (await repo.zones())[0];
    await repo.changeStatus(obj.id, "in_use", { zone_id: zone.id });
    expect((await repo.object(obj.id))!.status).toBe("in_use");
  });

  it("medhjälparen registrerar men ser inga privata uppgifter och kan inte publicera (AC-17)", async () => {
    const obj = (await repo.objects())[0];
    const item = await repo.saveContent({ goal: "fyndet", source_type: "object", source_id: obj.id, variants: [], status: "draft" });
    await repo.setDemoRole("contributor");
    expect((await repo.acquisitionsFor(obj.id))[0].price).toBeUndefined();
    expect((await repo.persons()).every((p) => p.contact === undefined)).toBe(true);
    expect(await repo.audit()).toEqual([]);
    await expect(repo.saveContent({ ...item, status: "approved" })).rejects.toThrow(/ägaren/);
    await expect(repo.markShared(item.id, "")).rejects.toThrow(/ägaren/);
    await expect(repo.updateConsent((await repo.persons())[0].id, { consent_name: "yes" })).rejects.toThrow(/ägaren/);
    await repo.saveCapture(crypto.randomUUID(), { text: "Gammal spis", kind: "find", media_ids: [] });
    await repo.setDemoRole("viewer");
    await expect(repo.saveCapture(crypto.randomUUID(), { text: "x", kind: "find", media_ids: [] })).rejects.toThrow(/Läsare/);
  });

  it("berättelsekontexten innehåller aldrig priser eller kontaktuppgifter (AC-11)", async () => {
    for (const o of await repo.objects()) {
      const g = guardStoryContext(buildRawStoryContext(await repo.storyRows(o.id)), "x");
      const json = JSON.stringify(g.context);
      expect(json).not.toMatch(/1200|Ockelbo|Gävle|Storvik/);
    }
  });
});

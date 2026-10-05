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
    expect(prop.content.person?.existing_person_id).toBeTruthy(); // matchar Lena från tidigare fynd
    const id = await repo.approveProposal({
      proposal_id: prop.id, partial: false,
      object: { title: "Ekdörrar", category: "Fönster och dörrar", description: "", material: "Ek", dimensions: "", quantity: 3, unit: "st", condition: 4, field_meta: {} },
      person: { name: "Lena", locality: "", existing_person_id: prop.content.person!.existing_person_id },
      acquisition: { type: "purchase", price: 300, deadline: "2026-12-01" },
      task: { title: "Hämta ekdörrarna", due: "2026-12-01" },
      why: "", media_ids: [],
    });
    const obj = await repo.object(id);
    expect(obj).toMatchObject({ title: "Ekdörrar", is_batch: true, status: "discovered" });
    expect((await repo.acquisitionsFor(id))[0].price).toBe(300);
    expect((await repo.eventsFor("object", id)).map((e) => e.event_type)).toContain("object.discovered");
    expect((await repo.audit()).some((a) => a.action === "create_from_proposal" && a.entity_id === id)).toBe(true);
    expect(await repo.proposals()).toHaveLength(0);
    expect((await repo.persons()).filter((p) => p.name === "Lena")).toHaveLength(1);
  });

  it("följer tillståndsmaskinen och kräver plats för i bruk", async () => {
    const obj = (await repo.objects()).find((o) => o.title === "Vit kakelugn")!;
    await expect(repo.changeStatus(obj.id, "sold")).rejects.toThrow(/Otillåten/);
    await repo.changeStatus(obj.id, "collected");
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

describe("M2: inflöde och lager", () => {
  it("avslutad hämtning uppdaterar objekt, anskaffning, lager och händelse utan dubbelregistrering (AC-03)", async () => {
    const pickup = (await repo.pickups()).find((p) => p.title.includes("kakelugn"))!;
    const [item] = await repo.pickupItems(pickup.id);
    expect((await repo.object(item.object_id))!.status).toBe("pickup_planned");
    expect((await repo.checklist(pickup.id)).length).toBe(6);
    await expect(repo.completePickup(pickup.id, [], null)).rejects.toThrow(/kvitteras/);

    const hylla = (await repo.storageLocations()).find((l) => l.name === "Hylla 2")!;
    await repo.completePickup(pickup.id, [{ object_id: item.object_id, receipt: "received", note: "" }], hylla.id);

    const obj = (await repo.object(item.object_id))!;
    expect(obj.status).toBe("stored");
    expect(obj.storage_location_id).toBe(hylla.id);
    expect((await repo.pickup(pickup.id))!.status).toBe("completed");
    expect((await repo.acquisitionsFor(obj.id))[0].status).toBe("received");
    const pickupEvents = (await repo.eventsFor("object", obj.id)).filter((e) => e.event_type === "pickup.completed");
    expect(pickupEvents).toHaveLength(1);
    expect((await repo.eventsFor("pickup", pickup.id))).toHaveLength(1);
  });

  it("följer anskaffningsflödet", async () => {
    const [prop] = await repo.proposals();
    await repo.approveProposal({
      proposal_id: prop.id, partial: false,
      object: { title: "Ekdörrar", category: "Fönster och dörrar", description: "", material: "", dimensions: "", quantity: 3, unit: "st", condition: null, field_meta: {} },
      person: null, acquisition: { type: "purchase", price: 300, deadline: null }, task: null, why: "", media_ids: [],
    });
    const acq = (await repo.allAcquisitions()).find((a) => a.status === "lead")!;
    await expect(repo.setAcquisitionStatus(acq.id, "settled")).rejects.toThrow(/Otillåten/);
    await repo.setAcquisitionStatus(acq.id, "negotiating");
    expect((await repo.allAcquisitions()).find((a) => a.id === acq.id)!.status).toBe("negotiating");
  });

  it("visar personens roller, affärer och samtycke (AC-09) men håller kontakthistoriken privat", async () => {
    const anders = (await repo.persons()).find((p) => p.name === "Anders")!;
    expect(anders.roles).toContain("Leverantör");
    expect(anders.consent_name).toBe("yes");
    expect((await repo.allAcquisitions()).filter((a) => a.person_id === anders.id).length).toBeGreaterThanOrEqual(1);
    expect(await repo.interactions(anders.id)).toHaveLength(1);
    await repo.setDemoRole("contributor");
    expect(await repo.interactions(anders.id)).toHaveLength(0);
    expect((await repo.persons()).find((p) => p.id === anders.id)!.contact).toBeUndefined();
    await repo.setDemoRole("viewer");
    expect((await repo.pickups())[0].address).toBeUndefined();
  });

  it("flyttar objekt mellan lagerplatser och loggar flytten", async () => {
    const fonster = (await repo.objects()).find((o) => o.title === "Gjutjärnsfönster")!;
    const pall = (await repo.storageLocations()).find((l) => l.name === "Pall A")!;
    await repo.storeObject(fonster.id, pall.id);
    expect((await repo.object(fonster.id))!.storage_location_id).toBe(pall.id);
    expect((await repo.audit()).some((a) => a.action === "moved_in_storage")).toBe(true);
  });
});

describe("M3: nytt liv, partier och journal", () => {
  const usage = (over: Partial<import("../data/repo").UsageInput> = {}) => ({ type: "built_in" as const, zone_id: null, structure_id: null, quantity: null, project: "", note: "", occurred_at: null, geom: null, from_allocation_id: null, ...over });

  it("delar ett parti och summan stämmer alltid (AC-04)", async () => {
    const tegel = (await repo.objects()).find((o) => o.title === "Tegel")!;
    let allocs = await repo.allocations(tegel.id);
    // Demodatan har redan sålt 30 via en annons (M4): 250 i bruk, 120 i lager, 30 sålda
    expect(allocs.map((a) => [a.quantity, a.status])).toEqual([[250, "in_use"], [120, "stored"], [30, "sold"]]);
    expect((await repo.object(tegel.id))!.status).toBe("in_use");

    const zone = (await repo.zones()).find((z) => z.name === "Trädgården")!;
    await expect(repo.recordUsage(tegel.id, usage({ zone_id: zone.id, quantity: 200 }))).rejects.toThrow(/inte 200/);
    await repo.recordUsage(tegel.id, usage({ zone_id: zone.id, quantity: 100 }));
    allocs = await repo.allocations(tegel.id);
    expect(allocs.reduce((s, a) => s + a.quantity, 0)).toBe(400);
    expect(allocs.find((a) => a.status === "stored")!.quantity).toBe(20);
    await expect(repo.changeStatus(tegel.id, "stored")).rejects.toThrow(/uppdelat/);

    const inUse = allocs.find((a) => a.zone_id === zone.id)!;
    const loc = (await repo.storageLocations())[0];
    await repo.storeAllocation(inUse.id, 20, loc.id);
    allocs = await repo.allocations(tegel.id);
    expect(allocs.reduce((s, a) => s + a.quantity, 0)).toBe(400);
    expect(allocs.filter((a) => a.status === "stored").reduce((s, a) => s + a.quantity, 0)).toBe(40);
  });

  it("nytt liv syns i objekt-, zon- och platsjournal från en händelse (AC-05)", async () => {
    const kakel = (await repo.objects()).find((o) => o.title === "Vit kakelugn")!;
    await repo.changeStatus(kakel.id, "collected");
    const zone = (await repo.zones()).find((z) => z.name === "Orangeriet")!;
    await expect(repo.recordUsage(kakel.id, usage({ type: "installed" }))).rejects.toThrow(/plats/);
    await repo.recordUsage(kakel.id, usage({ type: "installed", zone_id: zone.id }));
    const site = (await repo.site())!;
    const inObject = (await repo.eventsFor("object", kakel.id)).find((e) => e.event_type === "usage.installed")!;
    expect((await repo.eventsFor("zone", zone.id)).map((e) => e.id)).toContain(inObject.id);
    expect((await repo.eventsFor("site", site.id)).map((e) => e.id)).toContain(inObject.id);
    expect((await repo.object(kakel.id))!.status).toBe("in_use");
  });

  it("ett objekt i bruk kan demonteras, lagras och säljas med hela resan kvar (AC-06)", async () => {
    const rhodo = (await repo.objects()).find((o) => o.title === "Rhododendron")!;
    expect(rhodo.status).toBe("in_use");
    await repo.recordUsage(rhodo.id, usage({ type: "removed" }));
    await repo.storeObject(rhodo.id, (await repo.storageLocations())[0].id);
    await repo.changeStatus(rhodo.id, "listed");
    await repo.changeStatus(rhodo.id, "reserved_out");
    await repo.changeStatus(rhodo.id, "sold");
    const types = (await repo.eventsFor("object", rhodo.id)).map((e) => e.event_type);
    expect(types).toEqual(expect.arrayContaining(["object.discovered", "usage.planted", "usage.removed", "object.status_changed"]));
    expect((await repo.usageEvents(rhodo.id)).map((u) => u.type)).toEqual(expect.arrayContaining(["planted", "removed"]));
  });

  it("observationer och beslut hamnar i zon- och platsjournal", async () => {
    const zone = (await repo.zones()).find((z) => z.name === "Odlingen")!;
    const zoneEvents = await repo.eventsFor("zone", zone.id);
    expect(zoneEvents.some((e) => e.event_type === "observation.vatten")).toBe(true);
    const site = (await repo.site())!;
    expect((await repo.eventsFor("site", site.id)).some((e) => e.event_type === "decision")).toBe(true);
  });

  it("Vretakartan har grundbild och inritade zoner i demoläget", async () => {
    const [layer] = await repo.mapLayers();
    expect(layer.kind).toBe("base");
    expect(layer.corners).toHaveLength(4);
    expect(await repo.mapImage(layer)).toBeTruthy();
    expect((await repo.zones()).filter((z) => z.geom).length).toBe(4);
  });
});

describe("M4: utflöde, intressenter och bidrag", () => {
  it("ett lagerobjekt blir annonspaket för Blocket och Facebook Marketplace utan platsdata (AC-07)", async () => {
    const { packagesForListing } = await import("../services/marketplaceAgent");
    const fonster = (await repo.objects()).find((o) => o.title === "Gjutjärnsfönster")!;
    const l = await repo.saveListing({ object_id: fonster.id, type: "sell", title: "Gjutjärnsfönster", description: "Från Anders torp, förvaras i Garaget på Hylla 3", price: 1500, quantity: 6, locality: "Storgatan 4, Storvik", image_ids: [] });
    const t0 = performance.now();
    const r = await packagesForListing(repo, l, ["blocket", "facebook_marketplace"]);
    expect(performance.now() - t0).toBeLessThan(3 * 60 * 1000);
    expect(r.ok).toBe(true);
    expect(r.packages.map((p) => p.channel)).toEqual(["blocket", "facebook_marketplace"]);
    for (const p of r.packages) {
      const all = `${p.title}\n${p.text}`;
      for (const secret of ["Anders", "Garaget", "Hylla 3", "Storgatan", "200 kr"]) expect(all).not.toContain(secret);
      expect(p.text).toContain("Storvik");
      expect(p.title.length).toBeLessThanOrEqual(p.channel === "blocket" ? 50 : 100);
    }
    expect(r.price?.price).toBeGreaterThan(0); // förslag från inköpspriset, som aldrig syns i texten
    expect(r.warnings.join(" ")).toMatch(/ort/i);
  });

  it("en såld annons uppdaterar objekt, köpare, pris och påminner om nedtagning (AC-08)", async () => {
    const fonster = (await repo.objects()).find((o) => o.title === "Gjutjärnsfönster")!;
    const l = await repo.saveListing({ object_id: fonster.id, type: "sell", title: "Sex gjutjärnsfönster", description: "", price: 1500, quantity: 6, locality: "Storvik", image_ids: [] });
    await repo.publishChannel(l.id, "blocket", "https://www.blocket.se/annons/1", "manual");
    await repo.publishChannel(l.id, "facebook_marketplace", "https://www.facebook.com/marketplace/item/1", "browser_agent");
    expect((await repo.object(fonster.id))!.status).toBe("listed");
    const p1 = await repo.createPerson({ name: "Sara", locality: "", roles: [], how_we_met: "", organization_id: null, contact: "", notes: "" });
    const p2 = await repo.createPerson({ name: "Olle", locality: "", roles: [], how_we_met: "", organization_id: null, contact: "", notes: "" });
    const a = await repo.addLead({ listing_id: l.id, person_id: p1.id, channel: "blocket", message: "", bid: null });
    const b = await repo.addLead({ listing_id: l.id, person_id: p2.id, channel: "facebook_marketplace", message: "", bid: 1400 });
    expect(b.queue_position).toBe(2);
    await expect(repo.setLeadStatus(a.id, "completed")).rejects.toThrow(/Otillåten/);
    await repo.agreeLead(a.id);
    expect((await repo.object(fonster.id))!.status).toBe("reserved_out");
    await repo.releaseLead(a.id, "no_show");
    expect((await repo.object(fonster.id))!.status).toBe("listed");
    expect((await repo.listing(l.id))!.status).toBe("published");
    await repo.agreeLead(b.id);
    await repo.completeDisposal(l.id, { price: 1400, payment_method: "Swish" });

    expect((await repo.object(fonster.id))!.status).toBe("sold");
    expect((await repo.listing(l.id))!.status).toBe("completed");
    expect((await repo.person(p2.id))!.roles).toContain("Köpare");
    expect((await repo.disposals(fonster.id))[0]).toMatchObject({ type: "sold", price: 1400, person_id: p2.id });
    const reminders = (await repo.tasks()).filter((t) => t.entity_id === l.id);
    expect(reminders.map((t) => t.title)).toEqual(expect.arrayContaining([expect.stringContaining("blocket"), expect.stringContaining("facebook_marketplace")]));
    expect((await repo.eventsFor("person", p2.id)).map((e) => e.event_type)).toContain("disposal.sold");
    await repo.removeChannel(l.id, "blocket");
    expect((await repo.tasks()).filter((t) => t.entity_id === l.id)).toHaveLength(1);

    await repo.setDemoRole("contributor");
    expect((await repo.disposals(fonster.id))[0].price).toBeUndefined();
    await repo.setDemoRole("viewer");
    expect(await repo.leads()).toHaveLength(0);
  });

  it("demodatan har 30 tegel sålda via annons och partiet summerar till 400 (AC-04)", async () => {
    const tegel = (await repo.objects()).find((o) => o.title === "Tegel")!;
    const allocs = await repo.allocations(tegel.id);
    expect(allocs.reduce((s, a) => s + a.quantity, 0)).toBe(400);
    expect(allocs.find((a) => a.status === "sold")!.quantity).toBe(30);
    const johan = (await repo.persons()).find((p) => p.name === "Johan")!;
    expect(johan.roles).toContain("Köpare");
  });

  it("en tillbakadragen annons lägger tillbaka delen i lager", async () => {
    const tegel = (await repo.objects()).find((o) => o.title === "Tegel")!;
    const l = await repo.saveListing({ object_id: tegel.id, type: "sell", title: "20 tegel", description: "", price: 300, quantity: 20, locality: "Storvik", image_ids: [] });
    await repo.publishChannel(l.id, "blocket", "", "manual");
    expect((await repo.allocations(tegel.id)).find((a) => a.status === "listed")!.quantity).toBe(20);
    await repo.setListingStatus(l.id, "withdrawn");
    const allocs = await repo.allocations(tegel.id);
    expect(allocs.some((a) => a.status === "listed")).toBe(false);
    expect(allocs.filter((a) => a.status === "stored").reduce((s, a) => s + a.quantity, 0)).toBe(120);
    expect((await repo.tasks()).some((t) => t.entity_id === l.id)).toBe(true);
  });

  it("bidrag ger roll och syns i personens och platsens journal", async () => {
    const erik = (await repo.persons()).find((p) => p.name === "Erik")!;
    expect(erik.roles).toEqual(expect.arrayContaining(["Medskapare", "Kunskapsbärare"]));
    const site = (await repo.site())!;
    const ev = (await repo.eventsFor("person", erik.id)).find((e) => e.event_type === "contribution.tid")!;
    expect((await repo.eventsFor("site", site.id)).map((e) => e.id)).toContain(ev.id);
  });

  it("tack till en person som sagt nej till namn nämner inte personen och varnar (AC-10)", async () => {
    const { draftThanksForPerson } = await import("../services/thanks");
    const erik = (await repo.persons()).find((p) => p.name === "Erik")!;
    await repo.updateConsent(erik.id, { consent_name: "no", consent_contribution: "yes" });
    const d = await draftThanksForPerson(repo, erik.id, ["facebook", "instagram", "privat"]);
    for (const v of d.variants) expect(v.text).not.toContain("Erik");
    expect(d.warnings.join(" ")).toMatch(/nej/);
    expect(d.variants[0].text).toMatch(/mura/);
  });

  it("samtycke för ett enskilt inlägg låter namnet stå med, och bara ägaren kan ge det", async () => {
    const { draftThanksForPerson } = await import("../services/thanks");
    const erik = (await repo.persons()).find((p) => p.name === "Erik")!;
    const item = await repo.saveContent({ goal: "tack", source_type: "person", source_id: erik.id, status: "draft", variants: [] });
    let d = await draftThanksForPerson(repo, erik.id, ["facebook"], item.id);
    expect(d.variants[0].text).not.toContain("Erik");
    expect(d.warnings.join(" ")).toMatch(/Fråga Erik/);
    await repo.setContentConsent({ content_id: item.id, person_id: erik.id, name_ok: true, image_ok: false, contribution_ok: true, how: "muntligt" });
    d = await draftThanksForPerson(repo, erik.id, ["facebook"], item.id);
    expect(d.variants[0].text).toContain("Erik");
    expect((await repo.audit()).some((a) => a.action === "content_consent")).toBe(true);
    await repo.setDemoRole("contributor");
    await expect(repo.setContentConsent({ content_id: item.id, person_id: erik.id, name_ok: true, image_ok: false, contribution_ok: true, how: "" })).rejects.toThrow(/ägaren/);
  });
});

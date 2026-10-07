// Prototypens acceptanskriterier (R1.1 avsnitt 15) som databastester i det nya bygget. Det som kräver en
// riktig telefon (kamera, delningsmeny, flygplansläge) prövas i fälttestet; här prövas reglerna bakom.
import { beforeAll, describe, expect, test } from "vitest";
import { seeded, type Seeded } from "./seeded";
import { point } from "../../src/data/seed/demoSeed";

let s: Seeded;
beforeAll(async () => { s = await seeded(); });

describe("acceptanskriterier", () => {
  test("AC-23: en fångst med \"Här\" blir en nål i rätt zon på Vretakartan när den godkänns", async () => {
    const { h, owner, helper, ids } = s;
    const id = crypto.randomUUID();
    await h.ok(helper, "RecordCapture", { id, text: "Humlor i hallonen", kind_hint: "observation", context: { geometry: point(-15, 12) } });
    const p = await h.ok(helper, "CreateProposal", { capture_id: id, agent: "test", summary: "Humlor", cards: [{ key: "observation", kind: "observation",
      fields: [{ field: "description", value: "Humlor i hallonen", confidence: 0.9 }, { field: "kind_code", value: "species", confidence: 0.8 }] }] });
    const r = await h.ok(helper, "ApproveProposal", { proposal_id: p.proposal_id,
      cards: [{ key: "observation", kind: "observation", decision: "accept", fields: { description: "Humlor i hallonen", kind_code: "species" } }] });
    const obsId = r.other[0].observation_id;
    const obs = await h.sql("select place_id from life.observation where id = $1", [obsId]);
    expect(obs[0].place_id).toBe(ids.skogstradgarden);
    await h.jobs(owner);
    const map = await h.q(owner, "q_map");
    expect(map.features.some((f: any) => f.entity_id === obsId && f.geometry.type === "Point")).toBe(true);
  });

  test("AC-05: ett monterat objekt syns i objekt-, plats- och byggnadsjournal från en och samma händelse", async () => {
    const { h, owner, ids } = s;
    const obj = await h.q(owner, "q_object", { id: ids.fonster });
    const mounted = obj.timeline.find((e: any) => e.event_type === "usage.mounted");
    expect(mounted).toBeTruthy();
    const space = await h.q(owner, "q_place", { id: ids.sodra_vaggen });
    const structure = await h.q(owner, "q_place", { id: ids.orangeriet });
    const project = await h.q(owner, "q_project", { id: ids.p_orangeriet });
    for (const tl of [space.timeline, structure.timeline, project.timeline]) {
      expect(tl.map((e: any) => e.id)).toContain(mounted.id);
    }
    const n = await h.sql("select count(*)::int n from core.history_event where event_type = 'usage.mounted'");
    expect(n[0].n).toBe(1);
  });

  test("AC-08: en såld sak uppdaterar status, köpare, privat pris och påminner om nedtagning i alla kanaler", async () => {
    const { h, owner, ids } = s;
    const listing = await h.q(owner, "q_listing", { id: ids.listing_dorrar });
    const johanLead = listing.leads.find((l: any) => l.person?.display_name === "Johan Ek");
    await h.ok(owner, "SetLeadStatus", { lead_id: johanLead.id, status: "agreed" });
    const r = await h.ok(owner, "CompleteDisposal", { object_id: ids.dorrar, type: "sold", lead_id: johanLead.id, price: 900, payment_method: "Swish" });
    expect(r.remove_from_channels.sort()).toEqual(["blocket", "facebook_marketplace"]);
    const obj = await h.q(owner, "q_object", { id: ids.dorrar });
    expect(obj.status).toBe("sold");
    expect(obj.disposals[0].price).toBe(900);
    const person = await h.q(owner, "q_person", { id: ids.johan });
    expect(person.roles).toContain("buyer");
    const tasks = await h.q(owner, "q_tasks");
    expect(tasks.filter((t: any) => t.kind === "remove_listing").length).toBe(2);
    // Medhjälparen ser försäljningen men inte priset
    const forHelper = await h.q(s.helper, "q_object", { id: ids.dorrar });
    expect(forHelper.disposals[0].price).toBeNull();
    await h.ok(owner, "MarkChannelRemoved", { listing_id: ids.listing_dorrar, channel_code: "blocket" });
    expect((await h.q(owner, "q_tasks")).filter((t: any) => t.kind === "remove_listing").length).toBe(1);
  });

  test("AC-09: en person visar roller, alla affärer och bidrag, och sitt samtycke", async () => {
    const p = await s.h.q(s.owner, "q_person", { id: s.ids.anders });
    expect(p.roles).toEqual(expect.arrayContaining(["supplier", "tipster"]));
    expect(p.objects_from.length).toBeGreaterThan(0);
    expect(p.contributions.length).toBeGreaterThan(0);
    expect(p.consent).toEqual({ name: "yes", image: "no", contribution: "yes" });
    const j = await s.h.q(s.owner, "q_person", { id: s.ids.johan });
    expect(j.roles).toEqual(expect.arrayContaining(["cocreator", "knowledge_bearer", "craftsperson"]));
  });

  test("AC-10: ett tack som nämner en person med samtycke nej kan inte godkännas", async () => {
    const { h, owner, ids } = s;
    const c = await h.ok(owner, "CreateContent", { goal_code: "thanks", title: "Tack för lunchen", source_ids: [ids.p_orangeriet], person_ids: [ids.karin], channels: ["facebook"] });
    await h.ok(owner, "SaveChannelVariant", { content_id: c.content_id, channel_code: "facebook", body: "Tack Karin Söder för den fantastiska lunchen!" });
    const r = await h.cmd(owner, "ApproveContent", { content_id: c.content_id });
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/^privacy/);
    expect(JSON.stringify(r.suggestion)).toMatch(/name_without_consent/);
    await h.ok(owner, "SaveChannelVariant", { content_id: c.content_id, channel_code: "facebook", body: "Tack till alla som bidrog med lunch till arbetslaget!" });
    expect((await h.cmd(owner, "ApproveContent", { content_id: c.content_id })).status).toBe("accepted");
  });

  test("AC-11: utkast med adress, lagerplats eller inköpspris stoppas", async () => {
    const { h, owner, ids } = s;
    const cases = [
      "Hämta på Byvägen 4 i Ockelbo",
      "De ligger på Hylla 3 i garaget",
      "Vi köpte fönstren för 1200 kr",
      "Ring Anders på Byvägen 4",
    ];
    for (const body of cases) {
      const c = await h.ok(owner, "CreateContent", { goal_code: "story", title: "Test", source_ids: [ids.fonster], channels: ["instagram"] });
      await h.ok(owner, "SaveChannelVariant", { content_id: c.content_id, channel_code: "instagram", body });
      const r = await h.cmd(owner, "ApproveContent", { content_id: c.content_id });
      expect(r.status, body).toBe("rejected");
    }
  });

  test("AC-13: \"Var är mässingshandtagen?\" ger aktuell lagerplats med källa", async () => {
    const r = await s.h.q(s.owner, "q_tool", { tool: "find_object", args: { q: "mässingshandtag" } });
    expect(r[0].place).toMatch(/Hylla 3/);
    expect(r[0].source.route).toBe(`/objekt/${s.ids.handtag}`);
  });

  test("AC-14: vilka har bidragit i år och vilka har inte tackats", async () => {
    const r = await s.h.q(s.owner, "q_tool", { tool: "contributors", args: {} });
    const names = Object.fromEntries(r.map((x: any) => [x.source.title, x.unthanked]));
    expect(names["Johan Ek"]).toBe(2);
    expect(names["Karin Söder"]).toBe(1);
  });

  test("AC-15: publiceringar, samtyckesändringar och statusbyten finns i audit-loggen", async () => {
    const rows = await s.h.q(s.owner, "q_audit", { limit: 5000 });
    const tables = new Set(rows.map((r: any) => r.table_name));
    for (const t of ["people.consent_policy", "resources.object", "story.content_item", "resources.channel_post"]) expect(tables).toContain(t);
    const consent = rows.find((r: any) => r.table_name === "people.consent_policy" && r.operation === "update");
    expect(consent.before).toBeTruthy();
    expect(consent.after).toBeTruthy();
    expect(await s.h.q(s.helper, "q_audit", {})).toEqual([]);
  });

  test("AC-17: en medhjälpare kan registrera fynd men inte se privata anteckningar eller publicera", async () => {
    const { h, helper, ids } = s;
    expect((await h.cmd(helper, "RecordCapture", { text: "Gammal symaskin" })).status).toBe("accepted");
    expect((await h.cmd(helper, "CreateObject", { title: "Symaskin" })).status).toBe("accepted");
    const p = await h.q(helper, "q_person", { id: ids.anders });
    expect(p.private).toBeNull();
    expect(p.interactions).toEqual([]);
    expect((await h.cmd(helper, "ApproveContent", { content_id: ids.story_fonster })).reason).toMatch(/^forbidden/);
    expect((await h.cmd(helper, "MarkChannelPosted", { listing_id: ids.listing_help, channel_code: "facebook" })).reason).toMatch(/^forbidden/);
  });

  test("AC-20/AC-26/AC-27: behovet visar 1 020 av 1 500 utan dubbelregistrering, och Anders tipsade om Lena", async () => {
    const { h, owner, ids } = s;
    const proj = await h.q(owner, "q_project", { id: ids.p_orangeriet });
    const need = proj.needs.find((n: any) => n.id === ids.need_tegel);
    expect(need.progress).toBe("1 020 av 1 500 st");
    expect(Number(need.fulfilled)).toBe(1020);
    // 340 av tegelstenarna har använts i projektet utan att räknas en gång till
    expect(need.fulfillments.length).toBe(2);
    const lena = await h.q(owner, "q_person", { id: ids.lena });
    const intro = lena.relations.find((r: any) => r.kind_code === "introduced");
    expect(intro.direction).toBe("in");
    expect(intro.other.display_name).toBe("Anders Lind");
    const tegel = await h.q(owner, "q_object", { id: ids.tegel });
    expect(tegel.acquisitions[0].counterpart.display_name).toBe("Lena Berg");
    expect(tegel.acquisitions[0].tipster.title).toBe("Anders Lind");
  });

  test("AC-25: medhjälparen som frågar om lager från en person får inga privata priser", async () => {
    const owner = await s.h.q(s.owner, "q_tool", { tool: "stock_from_person", args: { name: "Anders" } });
    const helper = await s.h.q(s.helper, "q_tool", { tool: "stock_from_person", args: { name: "Anders" } });
    expect(owner.objects.length).toBe(helper.objects.length);
    expect(owner.objects.some((o: any) => o.price !== null)).toBe(true);
    expect(helper.objects.every((o: any) => o.price === null)).toBe(true);
  });

  test("AC-29: ett foto på en ny person är privat; ja till bild gör det internt, nej privat igen", async () => {
    const { h, owner } = s;
    const m = await h.ok(owner, "RegisterMedia", { kind: "photo", share_path: "x/y/share.jpg" });
    const p = await h.ok(owner, "CreatePerson", { display_name: "Ny Person", photo_media_id: m.media_id });
    const vis = async () => (await h.sql("select visibility from core.media where id = $1", [m.media_id]))[0].visibility;
    expect(await vis()).toBe("private");
    await h.ok(owner, "ChangeConsent", { person_id: p.person_id, image: "yes" });
    expect(await vis()).toBe("internal");
    await h.ok(owner, "ChangeConsent", { person_id: p.person_id, image: "no" });
    expect(await vis()).toBe("private");
    expect((await h.cmd(owner, "SetVisibility", { id: m.media_id, visibility: "shareable" })).reason).toMatch(/^consent/);
  });

  test("INV-13: kontakthistorik kan aldrig bli publik", async () => {
    const { h, owner, ids } = s;
    const i = await h.ok(owner, "LogInteraction", { person_id: ids.lena, summary: "Pratade om teglet" });
    expect((await h.cmd(owner, "SetVisibility", { id: i.interaction_id, visibility: "public" })).status).toBe("rejected");
  });

  test("Idag prioriterar granskning, hämtningar, försenat och obesvarade intressenter (FR-045)", async () => {
    const t = await s.h.q(s.owner, "q_today");
    const kinds = t.items.map((i: any) => i.kind);
    expect(kinds[0]).toBe("review");
    expect(kinds).toContain("overdue");
    expect(kinds).toContain("lead_waiting");
    expect(kinds).toContain("long_stored");
    expect(kinds).toContain("thank");
  });

  test("Granska: förslaget visar evidens per fält och kandidaten med gemensamma attribut", async () => {
    const q = await s.h.q(s.owner, "q_review_queue");
    expect(q.proposals.length).toBe(1);
    const p = await s.h.q(s.owner, "q_proposal", { id: q.proposals[0].id });
    const person = p.cards.find((c: any) => c.kind === "person");
    expect(person.match_candidates[0].shared).toContain("samma ort");
    const qty = p.cards.find((c: any) => c.kind === "object").fields.find((f: any) => f.field === "quantity");
    expect(qty.evidence[0].excerpt).toBe("Tre");
  });

  test("Godkänn förslaget som ett kommando: objekt, befintlig person, anskaffning och uppgift i ett steg", async () => {
    const { h, owner, ids } = s;
    const q = await h.q(owner, "q_review_queue");
    const p = await h.q(owner, "q_proposal", { id: q.proposals[0].id });
    const cards = p.cards.map((c: any) => ({ key: c.key, kind: c.kind, decision: "accept",
      match_entity_id: c.kind === "person" ? ids.torsten : undefined,
      fields: Object.fromEntries(c.fields.map((f: any) => [f.field, f.value])) }));
    const r = await h.ok(owner, "ApproveProposal", { proposal_id: p.id, cards });
    expect(r.person_id).toBe(ids.torsten);
    expect(r.object_id).toBeTruthy();
    expect(r.acquisition_id).toBeTruthy();
    expect(r.task_id).toBeTruthy();
    const again = await h.cmd(owner, "ApproveProposal", { proposal_id: p.id, cards });
    expect(again.reason).toMatch(/^not_pending/);
    const events = await h.sql("select count(*)::int n from core.history_event where id = $1", [r.history_event_id]);
    expect(events[0].n).toBe(1);
    const ev = await h.q(owner, "q_event", { id: r.history_event_id });
    expect(ev.links.map((l: any) => l.role)).toEqual(expect.arrayContaining(["object", "counterpart", "acquisition", "capture"]));
  });
});

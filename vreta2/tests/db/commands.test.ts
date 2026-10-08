// Varje kommando: giltiga och ogiltiga övergångar, atomär skrivning (tillstånd + HistoryEvent + AuditEntry)
// och idempotens (Designdokument 2.0, Kvalitet och test).
import { beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { seeded, type Seeded } from "./seeded";

let s: Seeded;
beforeAll(async () => { s = await seeded(); });

async function counts() {
  const r = await s.h.sql<{ h: number; a: number; o: number }>(
    "select (select count(*) from core.history_event)::int h, (select count(*) from core.audit_entry)::int a, (select count(*) from resources.object)::int o");
  return r[0];
}

describe("Domain API", () => {
  test("ett giltigt kommando skriver tillstånd, händelse och audit med samma kommando-id", async () => {
    const r = await s.h.cmd(s.owner, "CreateObject", { title: "Zinkbalja", occurred_at: "2026-10-01T10:00:00Z" });
    expect(r.status).toBe("accepted");
    const id = (r.result as any).object_id;
    const obj = await s.h.sql("select command_id from resources.object where id = $1", [id]);
    expect(obj[0].command_id).toBe(r.command_id);
    const ev = await s.h.sql("select e.command_id from core.history_event e join core.history_event_link l on l.event_id = e.id where l.entity_id = $1", [id]);
    expect(ev.length).toBe(1);
    expect(ev[0].command_id).toBe(r.command_id);
    const au = await s.h.sql("select count(*)::int n from core.audit_entry where command_id = $1 and table_name = 'resources.object'", [r.command_id]);
    expect(au[0].n).toBe(1);
    const dc = await s.h.sql("select status, issued_by from core.domain_command where id = $1", [r.command_id]);
    expect(dc[0]).toEqual({ status: "accepted", issued_by: s.owner.id });
  });

  test("ett avvisat kommando lämnar inga halva skrivningar men sparas med orsak", async () => {
    const before = await counts();
    const r = await s.h.cmd(s.owner, "UseObject", { object_id: s.ids.handtag, type: "mounted", occurred_at: "2026-10-01T10:00:00Z" });
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/^missing_place: /);
    expect(await counts()).toEqual(before);
    const dc = await s.h.sql("select status, rejection_reason from core.domain_command where id = $1", [r.command_id]);
    expect(dc[0].status).toBe("rejected");
  });

  test("samma idempotensnyckel två gånger ger ett resultat och ingen dubblett", async () => {
    const key = randomUUID();
    const a = await s.h.cmd(s.owner, "RecordObservation", { description: "Två rödhakar vid dammen", place_id: s.ids.dammen }, { idempotencyKey: key, origin: "offline" });
    const before = await counts();
    const b = await s.h.cmd(s.owner, "RecordObservation", { description: "Två rödhakar vid dammen", place_id: s.ids.dammen }, { idempotencyKey: key, origin: "offline" });
    expect(b.duplicate).toBe(true);
    expect(b.command_id).toBe(a.command_id);
    expect(await counts()).toEqual(before);
  });

  test("okända kommandon, fel roll och avslagna funktioner avvisas", async () => {
    expect((await s.h.cmd(s.owner, "DropDatabase", {})).reason).toMatch(/^unknown_command/);
    expect((await s.h.cmd(s.reader, "CreateObject", { title: "x" })).reason).toMatch(/^forbidden/);
    expect((await s.h.cmd(s.helper, "ChangeConsent", { person_id: s.ids.anders, image: "yes" })).reason).toMatch(/^forbidden/);
    expect((await s.h.cmd(s.owner, "RecordMoment", { title: "Första isen" })).reason).toMatch(/^feature_disabled/);
    await s.h.ok(s.owner, "SetFeatureFlag", { flag: "canvas", enabled: true });
    expect((await s.h.cmd(s.owner, "RecordMoment", { title: "Första isen på dammen", place_id: s.ids.dammen })).status).toBe("accepted");
  });

  test("en icke-medlem kan inte köra kommandon", async () => {
    const x = await s.h.user("utomstaende");
    await expect(s.h.cmd(x, "CreateObject", { title: "x", site_id: s.ids.site })).rejects.toThrow(/forbidden/);
  });

  test("ett kommando kan inte röra en annan plats data", async () => {
    const other = await s.h.user("annan_agare");
    await s.h.api(other, "bootstrap_site", { name: "Annan plats" });
    const r = await s.h.cmd(other, "MoveObject", { object_id: s.ids.handtag, to_place_id: s.ids.pall_a });
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/^not_found/);
  });
});

describe("tillståndsmaskiner", () => {
  test("objekt: ogiltig övergång nekas, ägarens override loggas", async () => {
    const o = await s.h.ok(s.owner, "CreateObject", { title: "Kakelugn", status: "stored", place_id: s.ids.pall_a });
    const bad = await s.h.cmd(s.owner, "ChangeObjectStatus", { object_id: o.object_id, status: "contacted" });
    expect(bad.status).toBe("rejected");
    expect(bad.reason).toMatch(/^invalid_transition: Det går inte att gå från i lager till kontaktad/);
    const helperOverride = await s.h.cmd(s.helper, "ChangeObjectStatus", { object_id: o.object_id, status: "contacted", override_reason: "Fel i historiken" });
    expect(helperOverride.status).toBe("rejected");
    const ok = await s.h.cmd(s.owner, "ChangeObjectStatus", { object_id: o.object_id, status: "contacted", override_reason: "Fel i historiken" });
    expect(ok.status).toBe("accepted");
    const audit = await s.h.sql("select count(*)::int n from core.audit_entry where command_id = $1", [ok.command_id]);
    expect(audit[0].n).toBeGreaterThan(0);
  });

  test("objekt: hela kedjan upptäckt → hämtad → lager → bruk → demonterad → annons → såld", async () => {
    const { h, owner } = s;
    const o = (await h.ok(owner, "CreateObject", { title: "Gjutjärnsspis" })).object_id;
    await h.ok(owner, "ChangeObjectStatus", { object_id: o, status: "contacted" });
    await h.ok(owner, "ChangeObjectStatus", { object_id: o, status: "reserved" });
    expect((await h.cmd(owner, "ChangeObjectStatus", { object_id: o, status: "collected" })).reason).toMatch(/^use_flow/);
    const acq = await h.ok(owner, "CreateAcquisition", { object_id: o, type: "gift", counterpart_name: "Greta Grann", status: "agreed" });
    const pk = await h.ok(owner, "PlanPickup", { acquisition_id: acq.acquisition_id, scheduled_on: "2026-10-10" });
    expect((await h.q(owner, "q_object", { id: o })).status).toBe("pickup_planned");
    const done = await h.ok(owner, "CompletePickup", { pickup_id: pk.pickup_id, receipts: [{ object_id: o, receipt_status: "received" }] });
    expect(done.ask_storage).toBe(true);
    expect((await h.q(owner, "q_object", { id: o })).status).toBe("collected");
    await h.ok(owner, "MoveObject", { object_id: o, to_place_id: s.ids.pall_a });
    await h.ok(owner, "UseObject", { object_id: o, type: "installed", place_id: s.ids.villan, occurred_at: "2026-10-12T10:00:00Z" });
    await h.ok(owner, "DismantleObject", { object_id: o, to_place_id: s.ids.pall_a });
    const lst = await h.ok(owner, "CreateListing", { type: "sell", object_id: o, price: 1500 });
    await h.ok(owner, "SetListingStatus", { listing_id: lst.listing_id, status: "published" });
    expect((await h.q(owner, "q_object", { id: o })).status).toBe("listed");
    const lead = await h.ok(owner, "LogLead", { listing_id: lst.listing_id, person_name: "Köpare Kalle" });
    await h.ok(owner, "SetLeadStatus", { lead_id: lead.lead_id, status: "agreed" });
    expect((await h.q(owner, "q_object", { id: o })).status).toBe("reserved_out");
    await h.ok(owner, "CompleteDisposal", { object_id: o, type: "sold", lead_id: lead.lead_id, price: 1400, payment_method: "Swish" });
    const obj = await h.q(owner, "q_object", { id: o });
    expect(obj.status).toBe("sold");
    // AC-06: hela resan syns på objektsidan
    const types = obj.timeline.map((e: any) => e.event_type);
    for (const t of ["usage.installed", "usage.dismantled", "disposal.sold", "pickup.completed"]) expect(types).toContain(t);
    expect(obj.usage.length).toBe(2);
  });

  test("hämtning: dubbelt avslut registreras inte två gånger (AC-03)", async () => {
    const { h, owner } = s;
    const o = (await h.ok(owner, "CreateObject", { title: "Trädgårdsbänk", status: "reserved" })).object_id;
    const pk = await h.ok(owner, "PlanPickup", { items: [{ object_id: o }], scheduled_on: "2026-10-09", checklist_template: "general" });
    const before = await counts();
    const a = await h.ok(owner, "CompletePickup", { pickup_id: pk.pickup_id });
    const mid = await counts();
    const b = await h.ok(owner, "CompletePickup", { pickup_id: pk.pickup_id });
    expect(b.already_completed).toBe(true);
    expect(await counts()).toEqual(mid);
    expect(mid.h - before.h).toBe(1);
    expect(a.collected_object_ids).toEqual([o]);
  });

  test("anskaffning, annons, intressent, innehåll och uppgift följer sina maskiner", async () => {
    const { h, owner } = s;
    const o = (await h.ok(owner, "CreateObject", { title: "Pallkrage" })).object_id;
    const acq = await h.ok(owner, "CreateAcquisition", { object_id: o });
    expect((await h.cmd(owner, "AdvanceAcquisition", { acquisition_id: acq.acquisition_id, status: "settled" })).reason).toMatch(/^invalid_transition/);
    const t = await h.ok(owner, "CreateTask", { title: "Test" });
    await h.ok(owner, "SetTaskStatus", { task_id: t.task_id, status: "done" });
    expect((await h.cmd(owner, "SetTaskStatus", { task_id: t.task_id, status: "open" })).reason).toMatch(/^invalid_transition/);
    expect((await h.cmd(owner, "SetTaskStatus", { task_id: (await h.ok(owner, "CreateTask", { title: "Senare" })).task_id, status: "snoozed" })).reason).toMatch(/^missing_field/);
  });
});

describe("partier (INV-11)", () => {
  test("400 tegel fördelas 250 i bruk, 120 i lager, 30 sålda och summan stämmer alltid (AC-04)", async () => {
    const { h, owner } = s;
    const o = (await h.ok(owner, "CreateObject", { title: "Tegel, gula", quantity: 400, unit: "st", status: "collected" })).object_id;
    await h.ok(owner, "MoveObject", { object_id: o, to_place_id: s.ids.pall_a });
    await h.ok(owner, "UseObject", { object_id: o, quantity: 250, type: "built_in", place_id: s.ids.sodra_vaggen, occurred_at: "2026-10-02T10:00:00Z" });
    await h.ok(owner, "CompleteDisposal", { object_id: o, quantity: 30, type: "sold", counterpart_name: "Bygg-Berit", price: 300 });
    const obj = await h.q(owner, "q_object", { id: o });
    const byStatus = Object.fromEntries(obj.allocations.map((a: any) => [a.status, Number(a.quantity)]));
    expect(byStatus).toEqual({ in_use: 250, stored: 120, sold: 30 });
    const sum = obj.allocations.reduce((n: number, a: any) => n + Number(a.quantity), 0);
    expect(sum).toBe(400);
  });

  test("en flytt större än det som finns kvar avvisas med förslag", async () => {
    const { h, owner } = s;
    const o = (await h.ok(owner, "CreateObject", { title: "Takpannor", quantity: 60, unit: "st", status: "stored", place_id: s.ids.pall_a })).object_id;
    const r = await h.cmd(owner, "MoveObject", { object_id: o, quantity: 80, to_place_id: s.ids.hylla3 });
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/^quantity_exceeded/);
    expect(r.suggestion).toMatchObject({ quantity: 60 });
  });

  test("ett objekt i bruk måste ha plats och datum (INV-05)", async () => {
    const r = await s.h.cmd(s.owner, "UseObject", { object_id: s.ids.lampa, type: "mounted", place_id: s.ids.villan });
    expect(r.reason).toMatch(/^missing_field/);
    await expect(s.h.sql("update resources.object set status = 'in_use', place_id = null where id = $1", [s.ids.lampa])).rejects.toThrow(/object_in_use_has_place/);
  });

  test("totalen kan inte manipuleras så att summan slutar stämma", async () => {
    await expect(s.h.db.transaction(async (tx) => {
      await tx.query("update resources.object_batch set total_quantity = total_quantity + 1 where object_id = $1", [s.ids.tegel]);
    })).rejects.toThrow(/batch_sum/);
  });
});

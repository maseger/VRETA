// Offline command journal (ADR-013): två enheter gör motstridiga handlingar offline. Servern validerar varje
// kommando mot aktuellt läge när nätet kommer tillbaka; ogiltiga avvisas med orsak och förslag och visas i
// "Synk att lösa" – inget slås ihop tyst.
import { beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { seeded, type Seeded } from "./seeded";

let s: Seeded;
beforeAll(async () => { s = await seeded(); });

describe("offlinesynk", () => {
  test("två telefoner flyttar samma tegel: den andra avvisas med förslag på det som finns kvar", async () => {
    const { h, owner, helper, ids } = s;
    const o = (await h.ok(owner, "CreateObject", { title: "Tegel, gamla", quantity: 60, unit: "st", status: "stored", place_id: ids.pall_a })).object_id;
    // Båda telefonerna såg 60 tegel på pall A när de gick offline
    const a = await h.cmd(owner, "MoveObject", { object_id: o, quantity: 40, from_place_id: ids.pall_a, to_place_id: ids.hylla3 },
      { idempotencyKey: randomUUID(), origin: "offline", clientTime: new Date(Date.now() - 600000).toISOString() });
    const b = await h.cmd(helper, "MoveObject", { object_id: o, quantity: 40, from_place_id: ids.pall_a, to_place_id: ids.lager_vanster },
      { idempotencyKey: randomUUID(), origin: "offline", clientTime: new Date(Date.now() - 500000).toISOString() });
    expect(a.status).toBe("accepted");
    expect(b.status).toBe("rejected");
    expect(b.reason).toMatch(/^quantity_exceeded: Det finns bara 20 kvar där/);
    expect(b.suggestion).toMatchObject({ quantity: 20 });
    const issues = await h.q(helper, "q_sync_issues");
    expect(issues.length).toBe(1);
    expect(issues[0].command_type).toBe("MoveObject");
    // Förslaget godkänns direkt: flytta de 20 som finns kvar och markera den avvisade som löst
    const fix = await h.cmd(helper, "MoveObject", { ...issues[0].payload, quantity: 20 }, { idempotencyKey: randomUUID() });
    expect(fix.status).toBe("accepted");
    await h.ok(helper, "ResolveRejectedCommand", { command_id: issues[0].id, replacement_command_id: fix.command_id });
    expect(await h.q(helper, "q_sync_issues")).toEqual([]);
    const obj = await h.q(owner, "q_object", { id: o });
    expect(obj.allocations.reduce((n: number, x: any) => n + Number(x.quantity), 0)).toBe(60);
  });

  test("append-only-kommandon har inga konflikter och dubbletter stoppas av idempotensnyckeln", async () => {
    const { h, helper, ids } = s;
    const key = randomUUID();
    const payload = { id: randomUUID(), description: "Första sädesärlan", place_id: ids.angen };
    const r1 = await h.cmd(helper, "RecordObservation", payload, { idempotencyKey: key, origin: "offline" });
    const r2 = await h.cmd(helper, "RecordObservation", payload, { idempotencyKey: key, origin: "offline" });
    const r3 = await h.cmd(helper, "RecordObservation", payload, { idempotencyKey: randomUUID(), origin: "offline" });
    expect(r1.status).toBe("accepted");
    expect(r2.duplicate).toBe(true);
    expect(r3.status).toBe("accepted");
    const n = await h.sql("select count(*)::int n from life.observation where id = $1", [payload.id]);
    expect(n[0].n).toBe(1);
  });

  test("enkla fält: senaste skrivning vinner per fält", async () => {
    const { h, owner, helper, ids } = s;
    await h.cmd(owner, "UpdateFields", { id: ids.radiator, fields: { description: "Tre sektioner" } }, { origin: "offline" });
    await h.cmd(helper, "UpdateFields", { id: ids.radiator, fields: { material: "Gjutjärn, lackerad" } }, { origin: "offline" });
    await h.cmd(helper, "UpdateFields", { id: ids.radiator, fields: { description: "Tre sektioner, 60 cm hög" } }, { origin: "offline" });
    const o = await h.q(owner, "q_object", { id: ids.radiator });
    expect(o.description).toBe("Tre sektioner, 60 cm hög");
    expect(o.material).toBe("Gjutjärn, lackerad");
    expect((await h.cmd(owner, "UpdateFields", { id: ids.radiator, fields: { status: "sold" } })).reason).toMatch(/^not_simple_field/);
  });

  test("en hämtning kan bockas av och avslutas offline och synkas utan dubbelregistrering (FR-015)", async () => {
    const { h, helper, ids } = s;
    const pk = await h.ok(helper, "PlanPickup", { items: [{ object_id: ids.radiator }], scheduled_on: "2026-10-08", checklist_template: "heavy" });
    const p = await h.q(helper, "q_pickup", { id: pk.pickup_id });
    const keys = p.checklist.map(() => randomUUID());
    for (const [i, item] of p.checklist.entries()) {
      await h.cmd(helper, "CheckChecklistItem", { item_id: item.id, checked: true }, { idempotencyKey: keys[i], origin: "offline" });
    }
    const done = randomUUID();
    await h.cmd(helper, "CompletePickup", { pickup_id: pk.pickup_id }, { idempotencyKey: done, origin: "offline" });
    // Telefonen skickar journalen igen efter ett avbrott
    for (const [i, item] of p.checklist.entries()) {
      expect((await h.cmd(helper, "CheckChecklistItem", { item_id: item.id, checked: true }, { idempotencyKey: keys[i], origin: "offline" })).duplicate).toBe(true);
    }
    expect((await h.cmd(helper, "CompletePickup", { pickup_id: pk.pickup_id }, { idempotencyKey: done, origin: "offline" })).duplicate).toBe(true);
    const after = await h.q(helper, "q_pickup", { id: pk.pickup_id });
    expect(after.status).toBe("completed");
    expect(after.checklist.every((c: any) => c.checked)).toBe(true);
  });
});

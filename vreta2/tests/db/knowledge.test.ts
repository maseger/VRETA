// Fråga Vreta utan AI mot riktiga verktyg och radnivåsäkerhet (AC-13, AC-14, AC-22, AC-25).
import { beforeAll, describe, expect, test } from "vitest";
import { answerLocally, parseWhen } from "@shared/knowledgeLocal.ts";
import { seeded, type Seeded } from "./seeded";
import type { User } from "./harness";

let s: Seeded;
beforeAll(async () => { s = await seeded(); });
const ask = (u: User, q: string, screen?: any) => answerLocally(q, (tool, args) => s.h.q(u, "q_tool", { tool, args }), { screen, now: new Date("2026-10-07T10:00:00Z") });

describe("Fråga Vreta (lokal)", () => {
  test("AC-13: Var är mässingshandtagen?", async () => {
    const a = await ask(s.owner, "Var är mässingshandtagen?");
    expect(a.text).toMatch(/Hylla 3/);
    expect(a.sources[0].id).toBe(s.ids.handtag);
  });
  test("Var är fönstren från Ockelbo? – bestämd form och ursprung (givarens ort)", async () => {
    const a = await ask(s.owner, "Var är fönstren från Ockelbo?");
    expect(a.text).toMatch(/gjutjärnsfönster/i);
    expect(a.text).toMatch(/Södra väggen/);
    const none = await ask(s.owner, "Var är fönstren från Gävle?");
    expect(none.text).toMatch(/hittar inget/);
  });
  test("AC-14: vilka har bidragit och vilka har inte tackats", async () => {
    const a = await ask(s.owner, "Vilka har bidragit till Vreta i år, och vilka har jag inte tackat?");
    expect(a.text).toMatch(/Johan Ek/);
    expect(a.text).toMatch(/Inte tackade än/);
    expect(a.sources.length).toBeGreaterThan(1);
  });
  test("AC-22: \"Lägg tegelpartiet på pall A\" blir ett förslag som kräver godkännande", async () => {
    const a = await ask(s.owner, "Lägg tegelpartiet på pall A");
    expect(a.actions?.[0]).toMatchObject({ command_type: "MoveObject", payload: { to_place_id: s.ids.pall_a } });
    const before = await s.h.q(s.owner, "q_object", { id: a.actions![0].payload.object_id as string });
    expect(before.allocations.some((x: any) => x.place?.id === s.ids.pall_a)).toBe(true);
  });
  test("AC-25: medhjälparen får svar utan privata priser", async () => {
    const o = await ask(s.owner, "Vad har jag i lager från Anders?");
    const h = await ask(s.helper, "Vad har jag i lager från Anders?");
    expect(o.text).toMatch(/kr\)/);
    expect(h.text).not.toMatch(/kr\)/);
    expect(h.sources.length).toBe(o.sources.length);
  });
  test("projekt, behov, nätverk, lager, köpt/sålt och sök", async () => {
    expect((await ask(s.owner, "Hur går det med orangeriet?")).text).toMatch(/1 020 av 1 500 st/);
    expect((await ask(s.owner, "Vem tipsade om Lena?")).text).toMatch(/Anders Lind tipsade oss om Lena Berg/);
    expect((await ask(s.owner, "Vad har legat i lager längst?")).text).toMatch(/mässingshandtag/i);
    expect((await ask(s.owner, "Hur mycket har jag köpt och sålt för i år?")).text).toMatch(/köpt \d+ saker för \d+ kr/);
    expect((await ask(s.helper, "Hur mycket har jag köpt och sålt för i år?")).text).toMatch(/inga priser du kan se|kr/);
    expect((await ask(s.owner, "rhododendron")).sources.length).toBeGreaterThan(0);
    expect((await ask(s.owner, "zxqv blarg")).text).toBe("Jag hittar inget om det.");
  });
  test("uppgifter med datum blir förslag", async () => {
    const a = await ask(s.owner, "Skapa en uppgift att ringa Anders på fredag");
    expect(a.actions?.[0]).toMatchObject({ command_type: "CreateTask", payload: { title: "Ringa Anders", due_at: "2026-10-09" } });
    expect(parseWhen("i morgon", new Date("2026-10-07T10:00:00Z"))?.date).toBe("2026-10-08");
  });
});

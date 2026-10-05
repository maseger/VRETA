import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { LocalRepo } from "../data/localRepo";
import { seedDemo } from "../data/demoSeed";
import { askLocal, executeAction } from "../services/askVreta";
import { buildExport } from "../services/exportArchive";
import { matchScore, parseDue, planQuestion, stem } from "../../supabase/functions/_shared/knowledge";

let repo: LocalRepo;
let n = 0;
const none = { type: null, id: null };

beforeEach(async () => {
  repo = new LocalRepo(`k-${n++}`);
  await seedDemo(repo, false);
});

describe("svensk matchning och tolkning", () => {
  it("böjda former och sammansättningar matchar", () => {
    expect(stem("mässingshandtagen")).toBe("mässingshandtag");
    expect(matchScore("mässingshandtagen", "Mässingshandtag")).toBeGreaterThan(2);
    expect(matchScore("tegelpartiet", "Tegel")).toBeGreaterThanOrEqual(1.5);
    expect(matchScore("kakelugn", "Gjutjärnsfönster")).toBe(0);
  });
  it("tolkar vanliga frågor och kommandon", () => {
    const t = "2026-10-05";
    expect(planQuestion("Var är mässingshandtagen?", none, t)).toEqual({ tool: "find_objects", input: { query: "mässingshandtagen" } });
    expect(planQuestion("Lägg tegelpartiet på pall A", none, t)).toEqual({ tool: "propose_move", input: { object: "tegelpartiet", location: "pall a" } });
    expect(planQuestion("Skapa en uppgift att ringa Anders på fredag", none, t)).toEqual({ tool: "propose_task", input: { title: "Ringa Anders", due: "2026-10-09" } });
    expect(planQuestion("Gör en annons av dörrarna", none, t)).toMatchObject({ tool: "start_listing" });
    expect(planQuestion("Vad har jag i lager från Anders?", none, t)).toMatchObject({ tool: "objects_from_person", input: { name: "anders", in_stock_only: true } });
    expect(planQuestion("Hur renoverar man ett gjutjärnsfönster?", none, t)).toEqual({ general: true });
    expect(planQuestion("Vad har hänt med den här?", { type: "object", id: "o1" }, t)).toEqual({ tool: "object_history", input: { object_id: "o1" } });
    expect(planQuestion("Vad hände på Vreta i september?", none, t)).toEqual({ tool: "period_summary", input: { from: "2026-09-01", to: "2026-09-30" } });
    expect(parseDue("i morgon", t)).toBe("2026-10-06");
  });
});

describe("Fråga Vreta (M5)", () => {
  it("”Var är mässingshandtagen?” svarar med lagerplats och källkort (AC-13)", async () => {
    const a = await askLocal(repo, "owner", "Var är mässingshandtagen?", none);
    expect(a.text).toContain("Låda 7");
    expect(a.text).toContain("Garaget");
    expect(a.cards[0]).toMatchObject({ type: "object", title: "Mässingshandtag" });
    expect(a.cards[0].href).toMatch(/^\/objekt\//);
  });

  it("partiets fördelning syns när man frågar efter tegel", async () => {
    const a = await askLocal(repo, "owner", "Var finns teglet?", none);
    expect(a.text).toMatch(/250 st i bruk i Orangeriet/);
    expect(a.text).toMatch(/120 st i lager på Lagerzonen › Pall A/);
    expect(a.text).toMatch(/30 st såld/);
  });

  it("”Vilka har bidragit i år och vilka har jag inte tackat?” ger rätt lista (AC-14)", async () => {
    let a = await askLocal(repo, "owner", "Vilka har bidragit i år och vilka har jag inte tackat?", none);
    expect(a.text).toMatch(/Erik/);
    expect(a.text).toMatch(/Inte tackade än: .*Erik/);
    expect(a.cards.find((c) => c.title === "Erik")!.href).toMatch(/\/tacka$/);
    const erik = (await repo.persons()).find((p) => p.name === "Erik")!;
    await repo.markThanked((await repo.contributions(erik.id)).map((c) => c.id));
    a = await askLocal(repo, "owner", "Vilka har jag inte tackat?", none);
    expect(a.text.split("Inte tackade än:")[1] ?? "").not.toMatch(/Erik/);
  });

  it("”Vad har jag i lager från Anders?” – medhjälparen får inga priser eller anteckningar (AC-25)", async () => {
    const owner = await askLocal(repo, "owner", "Vad har jag i lager från Anders?", none);
    expect(owner.text).toMatch(/gjutjärnsfönster/i);
    expect(owner.text).toMatch(/mässingshandtag/i);
    expect(owner.text).toMatch(/200 kr/);
    await repo.setDemoRole("contributor");
    const helper = await askLocal(repo, "contributor", "Vad har jag i lager från Anders?", none);
    expect(helper.text).toMatch(/mässingshandtag/i);
    expect(helper.text).not.toMatch(/\d+ kr/);
    expect(helper.text).toMatch(/privata/);
    expect(JSON.stringify(helper)).not.toMatch(/fler fönster|070-/);
    const sold = await askLocal(repo, "contributor", "Vem sålde gjutjärnsradiatorerna och vad betalade jag?", none);
    expect(sold.text).toMatch(/Göran/);
    expect(sold.text).not.toMatch(/800/);
  });

  it("”Lägg tegelpartiet på Hylla 2” flyttar bara lagerdelen och först efter ja (AC-22)", async () => {
    const tegel = (await repo.objects()).find((o) => o.title === "Tegel")!;
    const before = await repo.allocations(tegel.id);
    const a = await askLocal(repo, "owner", "Lägg tegelpartiet på Hylla 2", none);
    expect(a.action).toMatchObject({ kind: "move", object_id: tegel.id });
    expect(a.text).toMatch(/^Flytta 120 st tegel till Garaget › Vänster vägg › Hylla 2 – ja\?$/);
    expect(await repo.allocations(tegel.id)).toEqual(before); // inget har hänt före bekräftelsen
    await executeAction(repo, a.action!);
    const after = await repo.allocations(tegel.id);
    const hylla2 = (await repo.storageLocations()).find((l) => l.name === "Hylla 2")!;
    expect(after.find((x) => x.status === "stored")!.storage_location_id).toBe(hylla2.id);
    expect(after.find((x) => x.status === "in_use")!.quantity).toBe(250);
    expect(after.find((x) => x.status === "sold")!.quantity).toBe(30);
  });

  it("skapar uppgift efter bekräftelse, och läsare kan inte föreslå åtgärder", async () => {
    const a = await askLocal(repo, "owner", "Påminn mig om att ringa Anders i morgon", none);
    expect(a.action).toMatchObject({ kind: "task", title: "Ringa Anders" });
    await executeAction(repo, a.action!);
    expect((await repo.tasks()).some((t) => t.title === "Ringa Anders")).toBe(true);
    await repo.setDemoRole("viewer");
    const v = await askLocal(repo, "viewer", "Lägg tegelpartiet på pall A", none);
    expect(v.action).toBeUndefined();
  });

  it("gör ett förslag att granska av det man berättar", async () => {
    const a = await askLocal(repo, "owner", "Jag fick tre ekstolar av Maja idag", none);
    expect(a.action?.kind).toBe("capture");
    const before = (await repo.proposals()).length;
    await executeAction(repo, a.action!);
    expect((await repo.proposals()).length).toBe(before + 1);
  });

  it("svarar på idag, lager, pengar och innehåll med källor", async () => {
    expect((await askLocal(repo, "owner", "Vad behöver jag följa upp idag?", none)).text).toMatch(/att granska/);
    const old = await askLocal(repo, "owner", "Vad har legat i lager längst?", none);
    expect(old.text).toMatch(/^Längst i lager: Gjutjärnsradiatorer/);
    expect(old.cards[0].subtitle).toMatch(/över ett år/);
    const money = await askLocal(repo, "owner", "Hur mycket har jag köpt och sålt för i år?", none);
    expect(money.text).toMatch(/sålt för 450 kr/);
    await repo.setDemoRole("contributor");
    expect((await askLocal(repo, "contributor", "Hur mycket har jag köpt och sålt för i år?", none)).text).toMatch(/Priser är privata/);
    expect((await askLocal(repo, "contributor", "Hur renoverar man ett gjutjärnsfönster?", none)).general).toBe(true);
    expect((await askLocal(repo, "contributor", "Var är kakelugnsluckan av guld?", none)).text).toMatch(/hittar inget/);
  });

  it("trådar är privata för den som skapat dem", async () => {
    await repo.saveAskThread({ id: "t1", title: "Ägarens fråga", messages: [] });
    await repo.setDemoRole("contributor");
    expect(await repo.askThreads()).toHaveLength(0);
    await repo.saveAskThread({ id: "t2", title: "Min fråga", messages: [] });
    await expect(repo.saveAskThread({ id: "t1", title: "Kapat", messages: [] })).rejects.toThrow(/någon annans/);
    await repo.setDemoRole("owner");
    expect((await repo.askThreads()).map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("härdning (M5)", () => {
  it("statusbyten, samtycke och publiceringar finns i audit-loggen (AC-15)", async () => {
    const anders = (await repo.persons()).find((p) => p.name === "Anders")!;
    await repo.updateConsent(anders.id, { consent_image: "no" });
    const o = (await repo.objects()).find((x) => x.title === "Gjutjärnsfönster")!;
    const item = await repo.saveContent({ goal: "fyndet", source_type: "object", source_id: o.id, status: "draft", variants: [] });
    await repo.saveContent({ ...item, status: "approved" });
    await repo.markShared(item.id, "https://example.com/p/1");
    const actions = new Set((await repo.audit()).map((a) => a.action));
    for (const a of ["status_change", "consent_change", "content_approved", "content_shared", "channel_posted", "disposal"]) expect(actions).toContain(a);
  });

  it("exporterar all data som ZIP med JSON, CSV och originalbilder (AC-16)", async () => {
    const withImages = repo;
    const o = (await repo.objects())[0];
    await repo.saveMedia({ id: crypto.randomUUID(), original: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), clean: new Blob([new Uint8Array([4])], { type: "image/jpeg" }), mime: "image/jpeg", width: 1, height: 1, entity_type: "object", entity_id: o.id });
    const { blob, counts, media } = await buildExport(withImages);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["data/objects.json", "csv/objects.csv", "data/persons.json", "data/person_private.json", "LASMIG.txt"]));
    expect(JSON.parse(strFromU8(files["data/objects.json"])).length).toBe(counts.objects);
    expect(media).toBeGreaterThan(0);
    const mediaFiles = Object.keys(files).filter((f) => f.startsWith("media/"));
    expect(mediaFiles.length).toBe(media);
    expect([...files[mediaFiles[0]]]).toEqual([1, 2, 3]); // originalet, inte den rensade kopian
    expect(Object.keys(files).some((f) => f.startsWith("kartor/"))).toBe(true);
    await withImages.setDemoRole("contributor");
    await expect(buildExport(withImages)).rejects.toThrow(/ägaren/);
  }, 30000);
});

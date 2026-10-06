import { describe, expect, it } from "vitest";
import { localityKey, needProgress, sortProjects, stockForNeed, summarizeProjects } from "../domain/places";
import type { Contribution, Need, NeedFulfillment, Project, UsageEvent, VObject } from "../domain/types";

const project = (o: Partial<Project>): Project => ({ id: "p", site_id: "s", created_at: "", created_by: "", updated_at: "2026-01-01", archived_at: null, name: "", kind: "", status: "active", description: "", zone_id: null, structure_id: null, started_on: null, finished_on: null, ...o });
const usage = (o: Partial<UsageEvent>): UsageEvent => ({ id: "u", site_id: "s", object_id: "o1", allocation_id: null, type: "built_in", occurred_at: "2026-05-01", zone_id: null, structure_id: null, quantity: null, project: "", project_id: null, note: "", geom: null, event_id: null, created_at: "", created_by: "", ...o });
const contribution = (o: Partial<Contribution>): Contribution => ({ id: "c", site_id: "s", person_id: "p1", kind: "tid", description: "", hours: null, object_id: null, zone_id: null, project: "", project_id: null, occurred_at: "2026-05-01", thanked_at: null, visibility: "shareable", event_id: null, created_at: "", created_by: "", ...o });

describe("projekt", () => {
  it("samlar nytt liv och bidrag per projekt-id", () => {
    const [s] = summarizeProjects(
      [project({ id: "p1", name: "Orangeriet" })],
      [usage({ id: "u1", project_id: "p1", occurred_at: "2026-04-01" }), usage({ id: "u2", object_id: "o2", project_id: "p1", occurred_at: "2026-06-01" }), usage({ id: "u3", object_id: "o1", project_id: "p1" }), usage({ id: "x" })],
      [contribution({ id: "c1", project_id: "p1", person_id: "p1" }), contribution({ id: "c2", project_id: "p1", person_id: "p1" })],
    );
    expect(s.object_ids).toEqual(["o1", "o2"]);
    expect(s.person_ids).toEqual(["p1"]);
    expect(s.usage).toHaveLength(3);
    expect(s.last_at).toBe("2026-06-01");
  });
  it("visar pågående först och klara sist, senast aktiva först", () => {
    const list = sortProjects(summarizeProjects([
      project({ id: "a", name: "Klart", status: "done", updated_at: "2026-09-01" }),
      project({ id: "b", name: "Idé", status: "idea" }),
      project({ id: "c", name: "Bastun", status: "active", updated_at: "2026-02-01" }),
      project({ id: "d", name: "Odlingen", status: "active", updated_at: "2026-03-01" }),
    ], [], []));
    expect(list.map((x) => x.project.name)).toEqual(["Odlingen", "Bastun", "Idé", "Klart"]);
  });
  it("jämför orter utan hänsyn till skiftläge och mellanslag", () => {
    expect(localityKey(" Sandviken ")).toBe(localityKey("sandviken"));
    expect(localityKey(undefined)).toBe("");
  });

  it("räknar fram behovets uppfyllelse ur summan", () => {
    const need = { id: "n", quantity: 1500, unit: "st", title: "Tegel" } as Need;
    const f = (q: number) => ({ need_id: "n", quantity: q }) as NeedFulfillment;
    expect(needProgress(need, [f(1000), f(20)])).toMatchObject({ done: 1020, covered: false, label: "1\u00a0020 av 1\u00a0500 st" });
    expect(needProgress(need, [f(1500), f(10)])).toMatchObject({ covered: true, share: 1 });
    expect(needProgress({ ...need, quantity: null }, [])).toMatchObject({ covered: false, label: "Inget ännu" });
    expect(needProgress({ ...need, quantity: null }, [f(3)]).covered).toBe(true);
  });
  it("föreslår saker i lager som passar behovet", () => {
    const o = (title: string, status: VObject["status"]) => ({ id: title, title, category: "", material: "", status, quantity: 1 }) as VObject;
    const hits = stockForNeed({ title: "Tegel till muren", notes: "" } as Need, [o("Handslaget tegel", "stored"), o("Tegelpannor", "sold"), o("Kakelugn", "stored"), o("Tegel i bruk", "in_use")]);
    expect(hits.map((x) => x.title)).toEqual(["Handslaget tegel"]);
  });
});

describe("platstyper för en regenerativ fastighet", async () => {
  const { AREA_TYPES, STRUCTURE_TYPES, findPlaceType } = await import("../domain/placeTypes");
  it("har unika namn och de typer som behövs", () => {
    for (const groups of [AREA_TYPES, STRUCTURE_TYPES]) {
      const names = groups.flatMap((g) => g.types.map((t) => t.name));
      expect(new Set(names).size).toBe(names.length);
    }
    for (const n of ["Hushåll", "Plantering", "Kompost", "Parkering", "Damm", "Skogsträdgård"]) expect(findPlaceType(AREA_TYPES, n)).not.toBeNull();
    expect(findPlaceType(STRUCTURE_TYPES, "Regnvattentank")).not.toBeNull();
  });
});

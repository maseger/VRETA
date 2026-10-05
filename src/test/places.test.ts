import { describe, expect, it } from "vitest";
import { groupProjects, localityKey } from "../domain/places";
import type { Contribution, UsageEvent } from "../domain/types";

const usage = (o: Partial<UsageEvent>): UsageEvent => ({ id: "u", site_id: "s", object_id: "o1", allocation_id: null, type: "built_in", occurred_at: "2026-05-01", zone_id: null, structure_id: null, quantity: null, project: "", note: "", geom: null, event_id: null, created_at: "", created_by: "", ...o });
const contribution = (o: Partial<Contribution>): Contribution => ({ id: "c", site_id: "s", person_id: "p1", kind: "tid", description: "", hours: null, object_id: null, zone_id: null, project: "", occurred_at: "2026-05-01", thanked_at: null, visibility: "shareable", event_id: null, created_at: "", created_by: "", ...o });

describe("projekt som plats", () => {
  it("samlar nytt liv och bidrag med samma projektnamn oavsett skiftläge och mellanslag", () => {
    const [p, ...rest] = groupProjects(
      [usage({ id: "u1", project: "Orangeriet", zone_id: "z1", occurred_at: "2026-04-01" }), usage({ id: "u2", object_id: "o2", project: " orangeriet ", zone_id: "z1", occurred_at: "2026-06-01" })],
      [contribution({ id: "c1", project: "ORANGERIET", person_id: "p1" })],
    );
    expect(rest).toEqual([]);
    expect(p.name).toBe("Orangeriet");
    expect(p.object_ids).toEqual(["o1", "o2"]);
    expect(p.zone_ids).toEqual(["z1"]);
    expect(p.person_ids).toEqual(["p1"]);
    expect([p.first_at, p.last_at]).toEqual(["2026-04-01", "2026-06-01"]);
  });
  it("hoppar över nytt liv utan projekt och sorterar senast aktiva först", () => {
    const list = groupProjects([usage({ project: "" }), usage({ id: "a", project: "Odlingen", occurred_at: "2026-03-01" }), usage({ id: "b", project: "Bastun", occurred_at: "2026-08-01" })], []);
    expect(list.map((p) => p.name)).toEqual(["Bastun", "Odlingen"]);
  });
  it("jämför orter utan hänsyn till skiftläge och mellanslag", () => {
    expect(localityKey(" Sandviken ")).toBe(localityKey("sandviken"));
    expect(localityKey(undefined)).toBe("");
  });
});

import { matchScore } from "../../supabase/functions/_shared/knowledge";
import type { Contribution, Need, NeedFulfillment, Project, UsageEvent, VObject } from "./types";

// Projekt och platser utanför Vreta (M6). Projekt är egna poster; nytt liv och bidrag pekar på dem
// med project_id. Platser utanför Vreta är egna poster, och orterna härleds dessutom från människorna.

export interface ProjectSummary {
  project: Project;
  usage: UsageEvent[];
  contributions: Contribution[];
  object_ids: string[];
  person_ids: string[];
  /** Senaste aktivitet: senaste nytt liv eller bidrag, annars när projektet ändrades. */
  last_at: string;
}

export function summarizeProjects(projects: Project[], usage: UsageEvent[], contributions: Contribution[]): ProjectSummary[] {
  return projects.map((project) => {
    const u = usage.filter((x) => x.project_id === project.id);
    const c = contributions.filter((x) => x.project_id === project.id);
    const dates = [...u.map((x) => x.occurred_at), ...c.map((x) => x.occurred_at)];
    return {
      project,
      usage: u,
      contributions: c,
      object_ids: [...new Set(u.map((x) => x.object_id))],
      person_ids: [...new Set(c.map((x) => x.person_id))],
      last_at: dates.sort().at(-1) ?? project.updated_at,
    };
  });
}

/** Pågående först, sedan planerade och idéer, vilande och sist klara – senast aktiva först inom varje. */
const ORDER: Project["status"][] = ["active", "planned", "idea", "paused", "done"];
export function sortProjects(list: ProjectSummary[]): ProjectSummary[] {
  return [...list].sort((a, b) => ORDER.indexOf(a.project.status) - ORDER.indexOf(b.project.status) || b.last_at.localeCompare(a.last_at));
}

/** Ort som nyckel för platser utanför Vreta: kommunnivå, aldrig adress (INV-12). */
export function localityKey(locality: string | null | undefined): string {
  return (locality ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("sv");
}

// ---------------------------------------------------------------- behov (M7)

export interface NeedProgress {
  done: number;
  /** null = "några": uppfyllt så fort något kommit. */
  of: number | null;
  /** 0–1 */
  share: number;
  covered: boolean;
  label: string;
}

const num = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 2 });

/** "1 020 av 1 500 st" – summan av det som fyllts, aldrig lagrad (6.4). */
export function needProgress(need: Need, fulfillments: NeedFulfillment[]): NeedProgress {
  const done = fulfillments.filter((f) => f.need_id === need.id).reduce((s, f) => s + f.quantity, 0);
  const of = need.quantity;
  const covered = of == null ? done > 0 : done >= of;
  const share = of == null ? (done > 0 ? 1 : 0) : Math.min(1, done / of);
  const label = of == null ? (done ? `${num(done)} ${need.unit}` : "Inget ännu") : `${num(done)} av ${num(of)} ${need.unit}`;
  return { done, of, share, covered, label };
}

const GONE = ["sold", "donated", "exchanged", "discarded", "declined", "lost"];

/** Saker i lager (eller på väg in) som kan fylla ett behov, bäst matchning först. */
export function stockForNeed(need: Need, objects: VObject[]): VObject[] {
  const query = `${need.title} ${need.notes}`;
  return objects
    .filter((o) => !GONE.includes(o.status) && o.status !== "in_use")
    .map((o) => ({ o, s: matchScore(query, `${o.title} ${o.category} ${o.material}`) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.o);
}

import type { Contribution, Project, UsageEvent } from "./types";

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

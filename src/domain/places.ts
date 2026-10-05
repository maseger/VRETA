import type { Contribution, UsageEvent } from "./types";

// Projekt i R1 är ett namn på nytt liv och bidrag (spec 3.2: "objekt kan taggas med ett projektnamn som
// senare blir en riktig Project-entitet"). Här samlas de per namn så att projektet blir en plats i appen.

export interface ProjectGroup {
  key: string;
  name: string;
  usage: UsageEvent[];
  contributions: Contribution[];
  zone_ids: string[];
  structure_ids: string[];
  object_ids: string[];
  person_ids: string[];
  first_at: string;
  last_at: string;
}

export function projectKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv");
}

export function groupProjects(usage: UsageEvent[], contributions: Contribution[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const group = (name: string, at: string) => {
    const key = projectKey(name);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: name.trim().replace(/\s+/g, " "), usage: [], contributions: [], zone_ids: [], structure_ids: [], object_ids: [], person_ids: [], first_at: at, last_at: at };
      groups.set(key, g);
    }
    if (at < g.first_at) g.first_at = at;
    if (at > g.last_at) g.last_at = at;
    return g;
  };
  const add = (list: string[], id: string | null) => {
    if (id && !list.includes(id)) list.push(id);
  };
  for (const u of usage) {
    if (!projectKey(u.project)) continue;
    const g = group(u.project, u.occurred_at);
    g.usage.push(u);
    add(g.zone_ids, u.zone_id);
    add(g.structure_ids, u.structure_id);
    add(g.object_ids, u.object_id);
  }
  for (const c of contributions) {
    if (!projectKey(c.project)) continue;
    const g = group(c.project, c.occurred_at);
    g.contributions.push(c);
    add(g.zone_ids, c.zone_id);
    add(g.object_ids, c.object_id);
    add(g.person_ids, c.person_id);
  }
  return [...groups.values()].sort((a, b) => b.last_at.localeCompare(a.last_at));
}

/** Ort som nyckel för platser utanför Vreta: kommunnivå, aldrig adress (INV-12). */
export function localityKey(locality: string | null | undefined): string {
  return (locality ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("sv");
}

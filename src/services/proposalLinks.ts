// Kopplingar i ett förslag från Fånga: var saken köps (plats utanför Vreta), vilket projekt och behov
// den ska till och vem som tipsade. Namnen matchas mot det som redan finns; vid godkännande kopplas
// platsen till inköpet, saken räknas mot behovet och tipset blir en relation (M6–M8).
import type { Repo } from "../data/repo";
import type { ExternalPlace, Need, Person, Project, ProposalLinks } from "../domain/types";
import { matchScore } from "../../supabase/functions/_shared/knowledge";
import { matchPerson } from "./proposalMapping";

export interface LinkContext {
  people: Person[];
  projects: Project[];
  places: ExternalPlace[];
  needs: Need[];
}

export interface RawLinks {
  place: { name: string; confidence: number } | null;
  project: { name: string; confidence: number } | null;
  introduced_by: { name: string; confidence: number } | null;
}

function bestByName<T extends { name: string }>(items: T[], name: string): T | null {
  const n = name.trim().toLocaleLowerCase("sv");
  return items.find((i) => i.name.toLocaleLowerCase("sv") === n)
    ?? items.map((i) => ({ i, s: matchScore(name, i.name) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s)[0]?.i
    ?? null;
}

/** Det öppna behov i projektet som bäst passar saken, om något. */
export function needFor(projectId: string, title: string, needs: Need[]): Need | null {
  return needs
    .filter((n) => n.project_id === projectId && n.status === "open")
    .map((n) => ({ n, s: matchScore(title, n.title) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)[0]?.n ?? null;
}

export function resolveLinks(raw: RawLinks, title: string, ctx: LinkContext, onlyKnownProjects: boolean): ProposalLinks | undefined {
  const place = raw.place?.name.trim() ? bestByName(ctx.places, raw.place.name) : null;
  const live = ctx.projects.filter((p) => p.status !== "done");
  const project = raw.project?.name.trim() ? bestByName(live, raw.project.name) : null;
  // Den lokala tolkningen gissar på allt efter "till"; då kopplas bara projekt som finns
  const keepProject = raw.project && (project || !onlyKnownProjects);
  const intro = raw.introduced_by?.name.trim() ? matchPerson(raw.introduced_by.name, null, ctx.people) : null;
  const links: ProposalLinks = {
    place: raw.place?.name.trim() ? { name: { value: place?.name ?? raw.place.name.trim(), confidence: raw.place.confidence }, existing_place_id: place?.id ?? null } : null,
    project: keepProject && raw.project ? {
      name: { value: project?.name ?? raw.project.name.trim(), confidence: raw.project.confidence },
      existing_project_id: project?.id ?? null,
      need_id: project ? needFor(project.id, title, ctx.needs)?.id ?? null : null,
    } : null,
    introduced_by: raw.introduced_by?.name.trim() ? { name: { value: intro?.name ?? raw.introduced_by.name.trim(), confidence: raw.introduced_by.confidence }, existing_person_id: intro?.id ?? null } : null,
  };
  return links.place || links.project || links.introduced_by ? links : undefined;
}

export function guessPlaceKind(name: string): string {
  if (/loppis|second|myrorna|erikshjälpen|röda korset/i.test(name)) return "loppis";
  if (/återvinn|återbruk|tipp/i.test(name)) return "atervinning";
  if (/gård/i.test(name)) return "gard";
  if (/bygg|järn|handel|butik/i.test(name)) return "butik";
  return "annat";
}

export interface LinkChoice {
  place: { id: string | null; name: string } | null;
  /** need_id "new" skapar ett behov för saken; null kopplar bara projektet via ett behov utan antal. */
  project: { id: string | null; name: string; need_id: string | "new" | null } | null;
  introduced_by: { id: string | null; name: string } | null;
}

/** Utför kopplingarna efter att förslaget godkänts. Returnerar vad som gjordes, för ett kvitto till användaren. */
export async function applyLinks(repo: Repo, objectId: string, choice: LinkChoice): Promise<string[]> {
  const done: string[] = [];
  const [object, [acq]] = await Promise.all([repo.object(objectId), repo.acquisitionsFor(objectId)]);
  if (!object) return done;

  if (choice.place) {
    const placeId = choice.place.id ?? (await repo.createExternalPlace({ name: choice.place.name, kind: guessPlaceKind(choice.place.name), locality: "", notes: "", address: "" })).id;
    if (acq) {
      await repo.setAcquisitionPlace(acq.id, placeId);
      done.push(`Kom från ${choice.place.name}`);
    }
  }

  if (choice.project) {
    const projectId = choice.project.id ?? (await repo.createProject({ name: choice.project.name, kind: "", status: "planned", description: "", zone_id: null, structure_id: null, started_on: null, finished_on: null })).id;
    let needId = choice.project.need_id === "new" || !choice.project.need_id ? null : choice.project.need_id;
    if (!needId) needId = (await repo.createNeed({ project_id: projectId, title: object.title, quantity: object.quantity, unit: object.unit, notes: "" })).id;
    const need = (await repo.needs(projectId)).find((n) => n.id === needId);
    if (need) {
      const filled = (await repo.needFulfillments([need.id])).reduce((s, f) => s + f.quantity, 0);
      const qty = need.quantity == null ? object.quantity : Math.min(object.quantity, Math.max(0, need.quantity - filled)) || object.quantity;
      await repo.fulfillNeed({ need_id: need.id, quantity: qty, object_id: objectId, contribution_id: null, note: "Från fångst" });
      done.push(`Räknas mot ”${need.title}” i ${choice.project.name}`);
    }
  }

  if (choice.introduced_by && acq?.person_id) {
    let introducer = choice.introduced_by.id;
    if (!introducer) introducer = (await repo.createPerson({ name: choice.introduced_by.name, locality: "", roles: ["Tipsare"], how_we_met: "", organization_id: null, contact: "", notes: "" })).id;
    if (introducer !== acq.person_id) {
      try {
        await repo.addRelation({ person_id: introducer, other_id: acq.person_id, kind: "introduced", note: `Tipsade om ${object.title.toLowerCase()}` });
      } catch {
        // relationen fanns redan
      }
      const p = await repo.person(introducer);
      if (p && !p.roles.includes("Tipsare")) await repo.updatePerson(introducer, { roles: [...p.roles, "Tipsare"] });
      done.push(`${choice.introduced_by.name} tipsade`);
    }
  }
  return done;
}

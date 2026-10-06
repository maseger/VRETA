import { Hammer, Store, UserPlus } from "lucide-react";
import type { ExternalPlace, Need, Person, Project, ProposalLinks } from "../domain/types";
import type { LinkChoice } from "../services/proposalLinks";
import { AiMark } from "./bits";

/** Granska kopplingarna i ett förslag: plats utanför Vreta, projekt och behov, vem som tipsade. */
export function ProposalLinksCard({ links, choice, onChange, places, projects, needs, people, hasSeller }: {
  links: ProposalLinks; choice: LinkChoice; onChange: (c: LinkChoice) => void;
  places: ExternalPlace[]; projects: Project[]; needs: Need[]; people: Person[]; hasSeller: boolean;
}) {
  const live = projects.filter((p) => p.status !== "done");
  const row = "flex items-start gap-3";
  const off = (on: unknown) => (on ? "" : "opacity-50");
  return (
    <section className="card mb-4 space-y-5 p-4">
      <h2>Kopplingar</h2>

      {links.place && (
        <div className={`${row} ${off(choice.place)}`}>
          <Store size={20} className="mt-2 shrink-0 text-falu" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">Köpt eller hämtat på <AiMark confidence={links.place.name.confidence} /></p>
            {choice.place && (
              <select className="input" aria-label="Plats" value={choice.place.id ?? "ny"} onChange={(e) => {
                const p = places.find((x) => x.id === e.target.value);
                onChange({ ...choice, place: p ? { id: p.id, name: p.name } : { id: null, name: links.place!.name.value } });
              }}>
                {!links.place.existing_place_id && <option value="ny">Ny plats: {links.place.name.value}</option>}
                {places.map((p) => <option key={p.id} value={p.id}>{p.name}{p.locality ? `, ${p.locality}` : ""}</option>)}
              </select>
            )}
          </div>
          <Toggle on={!!choice.place} onClick={() => onChange({ ...choice, place: choice.place ? null : { id: links.place!.existing_place_id, name: links.place!.name.value } })} />
        </div>
      )}

      {links.project && (
        <div className={`${row} ${off(choice.project)}`}>
          <Hammer size={20} className="mt-2 shrink-0 text-falu" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">Till projektet <AiMark confidence={links.project.name.confidence} /></p>
            {choice.project && (
              <>
                <select className="input" aria-label="Projekt" value={choice.project.id ?? "ny"} onChange={(e) => {
                  const p = live.find((x) => x.id === e.target.value);
                  onChange({ ...choice, project: p ? { id: p.id, name: p.name, need_id: needs.find((n) => n.project_id === p.id && n.status === "open")?.id ?? "new" } : { id: null, name: links.project!.name.value, need_id: "new" } });
                }}>
                  {!links.project.existing_project_id && <option value="ny">Nytt projekt: {links.project.name.value}</option>}
                  {live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p className="text-[12px] font-semibold text-sot-3">Räknas mot behovet</p>
                <select className="input" aria-label="Behov" value={choice.project.need_id ?? "new"} onChange={(e) => onChange({ ...choice, project: { ...choice.project!, need_id: e.target.value } })}>
                  {needs.filter((n) => n.project_id === choice.project!.id && n.status === "open").map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
                  <option value="new">Nytt behov för saken</option>
                </select>
              </>
            )}
          </div>
          <Toggle on={!!choice.project} onClick={() => onChange({ ...choice, project: choice.project ? null : { id: links.project!.existing_project_id, name: links.project!.name.value, need_id: links.project!.need_id ?? "new" } })} />
        </div>
      )}

      {links.introduced_by && (
        <div className={`${row} ${off(choice.introduced_by && hasSeller)}`}>
          <UserPlus size={20} className="mt-2 shrink-0 text-falu" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">Tipsade om fyndet <AiMark confidence={links.introduced_by.name.confidence} /></p>
            {choice.introduced_by && (
              <select className="input" aria-label="Tipsade" value={choice.introduced_by.id ?? "ny"} onChange={(e) => {
                const p = people.find((x) => x.id === e.target.value);
                onChange({ ...choice, introduced_by: p ? { id: p.id, name: p.name } : { id: null, name: links.introduced_by!.name.value } });
              }}>
                {!links.introduced_by.existing_person_id && <option value="ny">Ny person: {links.introduced_by.name.value}</option>}
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.locality ? `, ${p.locality}` : ""}</option>)}
              </select>
            )}
            {!hasSeller && <p className="text-[12px] text-sot-3">Tipset sparas som en relation till säljaren eller givaren – ta med en person ovan.</p>}
          </div>
          <Toggle on={!!choice.introduced_by} onClick={() => onChange({ ...choice, introduced_by: choice.introduced_by ? null : { id: links.introduced_by!.existing_person_id, name: links.introduced_by!.name.value } })} />
        </div>
      )}
    </section>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="mt-1.5 shrink-0 text-sm font-semibold text-sot-3 underline-offset-2 hover:underline">{on ? "Ta inte med" : "Ta med"}</button>;
}

export function initialChoice(links: ProposalLinks | undefined): LinkChoice {
  return {
    place: links?.place ? { id: links.place.existing_place_id, name: links.place.name.value } : null,
    project: links?.project ? { id: links.project.existing_project_id, name: links.project.name.value, need_id: links.project.need_id ?? "new" } : null,
    introduced_by: links?.introduced_by ? { id: links.introduced_by.existing_person_id, name: links.introduced_by.name.value } : null,
  };
}

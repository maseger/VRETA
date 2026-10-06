import { ChevronRight, Hammer, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { PROJECT_KINDS, PROJECT_STATUS_LABEL } from "../domain/labels";
import { sortProjects, summarizeProjects } from "../domain/places";
import type { ProjectStatus } from "../domain/types";
import { EmptyState, PageHeader } from "../ui/bits";

/** Projekt på Vreta: byggen, planteringar och annat där saker tas i bruk och människor bidrar. */
export function ProjectsPage() {
  const { repo, profile, refresh } = useApp();
  const navigate = useNavigate();
  const canWrite = profile?.role !== "viewer";
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState(PROJECT_KINDS[0]);
  const [status, setStatus] = useState<ProjectStatus>("planned");
  const [zone, setZone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data } = useData(async (r) => {
    const [projects, usage, contributions, zones, structures] = await Promise.all([r.projects(), r.allUsageEvents(), r.contributions(), r.zones(), r.structures()]);
    const names: Record<string, string> = {};
    for (const x of [...zones, ...structures]) names[x.id] = x.name;
    return { list: sortProjects(summarizeProjects(projects, usage, contributions)), zones, names };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/platser" className="text-sm font-semibold text-falu">← Platser</Link>
      <PageHeader kicker="Projekt på Vreta" title="Byggen, planteringar och annat">
        {canWrite && <button className="btn-secondary" onClick={() => setAdding((a) => !a)}><Plus size={18} aria-hidden="true" /> Nytt</button>}
      </PageHeader>
      <p className="-mt-3 mb-6 text-sot-3">Ett projekt är där saker tas i bruk och människor bidrar. Välj projektet när du registrerar nytt liv eller ett bidrag, så samlas allt här.</p>

      {adding && (
        <form className="card mb-6 grid gap-3 p-4 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const p = await repo.createProject({ name, kind, status, description: "", zone_id: zone || null, structure_id: null, started_on: status === "active" ? new Date().toISOString().slice(0, 10) : null, finished_on: null });
            await refresh();
            navigate(`/projekt/${p.id}`);
          } catch (err) {
            setError((err as Error).message);
          }
        }}>
          <input className="input sm:col-span-2" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Namn, t.ex. Jordkällaren" aria-label="Projektets namn" />
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Slag av projekt">
            {PROJECT_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} aria-label="Status">
            {(["idea", "planned", "active"] as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
          </select>
          <select className="input sm:col-span-2" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zon">
            <option value="">Var på Vreta? (valfritt)</option>
            {data?.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          {error && <p className="text-sm text-falu sm:col-span-2">{error}</p>}
          <button className="btn-primary sm:col-span-2">Skapa projekt</button>
        </form>
      )}

      {data && !data.list.length && <EmptyState title="Inga projekt ännu">Skapa ett projekt här, eller skriv ett projektnamn när du tar något i bruk.</EmptyState>}
      <ul className="card divide-y divide-dashed divide-lera-light">
        {data?.list.map(({ project: p, object_ids, person_ids }) => (
          <li key={p.id}>
            <Link to={`/projekt/${p.id}`} className={`flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60 ${p.status === "done" ? "opacity-75" : ""}`}>
              <Hammer size={20} strokeWidth={1.5} className="shrink-0 text-falu" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="text-sm text-sot-3">{[
                  p.kind,
                  data.names[p.zone_id ?? ""] ?? data.names[p.structure_id ?? ""],
                  object_ids.length ? `${object_ids.length} ${object_ids.length === 1 ? "sak" : "saker"}` : "",
                  person_ids.length ? `${person_ids.length} ${person_ids.length === 1 ? "person" : "personer"}` : "",
                ].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={`stamp ${p.status === "active" ? "border-linolja text-linolja" : "border-sot-2 text-sot-2"}`}>{PROJECT_STATUS_LABEL[p.status]}</span>
              <ChevronRight size={16} className="text-sot-3" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

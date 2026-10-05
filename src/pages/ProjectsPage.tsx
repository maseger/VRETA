import { Hammer } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../app/AppContext";
import { CONTRIBUTION_LABEL, USAGE_LABEL } from "../domain/labels";
import { groupProjects } from "../domain/places";
import { EmptyState, PageHeader, formatDate } from "../ui/bits";

/** Projekt på Vreta: byggen, planteringar och annat där saker tas i bruk och människor bidrar. */
export function ProjectsPage() {
  const { data } = useData(async (r) => {
    const [usage, contributions, objects, zones, structures, persons] = await Promise.all([
      r.allUsageEvents(), r.contributions(), r.objects(), r.zones(), r.structures(), r.persons(),
    ]);
    const names: Record<string, string> = {};
    for (const x of [...objects.map((o) => ({ id: o.id, name: o.title })), ...zones, ...structures, ...persons]) names[x.id] = x.name;
    return { projects: groupProjects(usage, contributions), names };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/platser" className="text-sm font-semibold text-falu">← Platser</Link>
      <PageHeader kicker="Projekt på Vreta" title="Byggen, planteringar och annat" />
      <p className="-mt-3 mb-6 text-sot-3">Ett projekt är där saker tas i bruk och människor bidrar. Ange projektets namn när du registrerar nytt liv eller ett bidrag, så samlas allt här.</p>
      {data && !data.projects.length && <EmptyState title="Inga projekt ännu">Skriv till exempel ”Orangeriet” i fältet Projekt när du tar något i bruk.</EmptyState>}
      <ul className="space-y-4">
        {data?.projects.map((p) => {
          const where = [...p.zone_ids, ...p.structure_ids].map((id) => data.names[id]).filter(Boolean);
          return (
            <li key={p.key} className="card p-4">
              <div className="mb-3 flex items-start gap-3">
                <Hammer size={22} strokeWidth={1.5} className="mt-1 shrink-0 text-falu" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-serif text-xl">{p.name}</h2>
                  <p className="text-sm text-sot-3">{[where.join(", ") || "Plats saknas", formatDate(p.first_at) === formatDate(p.last_at) ? formatDate(p.first_at) : `${formatDate(p.first_at)} – ${formatDate(p.last_at)}`].join(" · ")}</p>
                </div>
              </div>
              {p.usage.length > 0 && (
                <>
                  <p className="kicker mb-1">Saker</p>
                  <ul className="mb-3 space-y-1 text-sm">
                    {p.usage.map((u) => (
                      <li key={u.id}>
                        <Link to={`/objekt/${u.object_id}`} className="font-medium text-falu">{data.names[u.object_id] ?? "Objekt"}</Link>
                        <span className="text-sot-3"> · {USAGE_LABEL[u.type]}{u.quantity ? ` · ${u.quantity} st` : ""} · {formatDate(u.occurred_at)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {p.contributions.length > 0 && (
                <>
                  <p className="kicker mb-1">Människor</p>
                  <ul className="space-y-1 text-sm">
                    {p.contributions.map((c) => (
                      <li key={c.id}>
                        <Link to={`/person/${c.person_id}`} className="font-medium text-falu">{data.names[c.person_id] ?? "Person"}</Link>
                        <span className="text-sot-3"> · {CONTRIBUTION_LABEL[c.kind]}{c.description ? `: ${c.description}` : ""}{c.hours ? ` · ${c.hours} h` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

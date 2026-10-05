import { Map as MapIcon, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { CONTRIBUTION_LABEL, PROJECT_KINDS, PROJECT_STATUS_LABEL, USAGE_LABEL } from "../domain/labels";
import type { Project, ProjectStatus } from "../domain/types";
import { EmptyState, MediaImage, PageHeader, Section, StatusStamp, formatDate } from "../ui/bits";
import { areaM2, formatArea } from "../geo/geo";
import { JournalList } from "../ui/JournalList";
import { ProjectNeeds } from "../ui/ProjectNeeds";

const STATUSES: ProjectStatus[] = ["idea", "planned", "active", "paused", "done"];

/** Ett projekt på Vreta: var det sker, vilka saker som tagits i bruk, vilka som bidragit och vad som hänt. */
export function ProjectPage() {
  const { id } = useParams();
  const { repo, profile, refresh, toast } = useApp();
  const canWrite = profile?.role !== "viewer";
  const [editing, setEditing] = useState(false);
  const { data } = useData(async (r) => {
    const project = (await r.projects()).find((p) => p.id === id);
    if (!project) return null;
    const [usageAll, contribsAll, objects, zones, structures, persons, events, needs, listings] = await Promise.all([
      r.allUsageEvents(), r.contributions(), r.objects(), r.zones(), r.structures(), r.persons(), r.eventsFor("project", id!), r.needs(id!), r.listings(),
    ]);
    const fulfillments = await r.needFulfillments(needs.map((n) => n.id));
    const usage = usageAll.filter((u) => u.project_id === id);
    const contributions = contribsAll.filter((c) => c.project_id === id);
    const things = [...new Set(usage.map((u) => u.object_id))].map((oid) => objects.find((o) => o.id === oid)).filter((o): o is NonNullable<typeof o> => !!o);
    const covers = await Promise.all(things.map((o) => r.mediaFor("object", o.id).then((m) => m.find((x) => x.role === "after") ?? m[0])));
    const links = await r.eventLinks(events.map((e) => e.id));
    const names: Record<string, string> = {};
    for (const o of objects) names[o.id] = o.title;
    for (const x of [...zones, ...structures, ...persons]) names[x.id] = x.name;
    return { project, usage, contributions, things: things.map((o, i) => ({ o, cover: covers[i] })), zones, structures, events, links, names, needs, fulfillments, objects, listings };
  }, [id]);

  if (data === null) return <EmptyState title="Projektet finns inte" />;
  if (!data) return null;
  const { project: p, usage, contributions, things, events, links, names } = data;
  const where = names[p.zone_id ?? ""] ?? names[p.structure_id ?? ""];
  const hours = contributions.reduce((s, c) => s + (c.hours ?? 0), 0);

  async function setStatus(status: ProjectStatus) {
    await repo.updateProject(p.id, { status });
    await refresh();
    toast(`${p.name}: ${PROJECT_STATUS_LABEL[status].toLowerCase()}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/platser/projekt" className="text-sm font-semibold text-falu">← Projekt</Link>
      <PageHeader kicker={[p.kind || "Projekt", where].filter(Boolean).join(" · ")} title={p.name}>
        {canWrite && !editing && <button className="btn-secondary" onClick={() => setEditing(true)}><Pencil size={18} aria-hidden="true" /> Ändra</button>}
      </PageHeader>

      {editing ? <ProjectForm project={p} zones={data.zones} structures={data.structures} onDone={() => setEditing(false)} /> : (
        <>
          {p.description && <p className="-mt-3 mb-4 whitespace-pre-line text-sot-2">{p.description}</p>}
          <p className="mb-4 text-sm text-sot-3">{[
            p.started_on ? `Påbörjat ${formatDate(p.started_on)}` : "",
            p.finished_on ? `klart ${formatDate(p.finished_on)}` : "",
            hours ? `${hours} timmar från människor som hjälpt till` : "",
          ].filter(Boolean).join(" · ")}</p>
        </>
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s} disabled={!canWrite} aria-pressed={p.status === s} className={`chip ${p.status === s ? "chip-on" : ""}`} onClick={() => p.status !== s && setStatus(s)}>{PROJECT_STATUS_LABEL[s]}</button>
        ))}
      </div>

      <p className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <MapIcon size={16} className="text-sot-3" aria-hidden="true" />
        {p.geom ? (
          <>
            <span className="text-sot-3">Ytan på kartan: {formatArea(areaM2(p.geom))}</span>
            <Link to={`/platser?visa=project:${p.id}`} className="font-semibold text-falu">Visa på kartan</Link>
          </>
        ) : canWrite ? (
          <Link to={`/platser?rita=project:${p.id}`} className="font-semibold text-falu">Rita projektets yta på Vretakartan</Link>
        ) : <span className="text-sot-3">Ingen yta inritad</span>}
      </p>

      <Section title="Behov">
        <ProjectNeeds projectId={p.id} needs={data.needs} fulfillments={data.fulfillments} objects={data.objects} listings={data.listings} canWrite={canWrite} />
      </Section>

      <Section title="Saker">
        {things.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {things.map(({ o, cover }) => {
              const u = usage.filter((x) => x.object_id === o.id);
              return (
                <li key={o.id}>
                  <Link to={`/objekt/${o.id}`} className="card block overflow-hidden">
                    <MediaImage media={cover} className="aspect-square w-full" alt={o.title} />
                    <div className="space-y-1 p-3">
                      <p className="truncate font-medium">{o.title}</p>
                      <p className="truncate text-[12px] text-sot-3">{u.map((x) => `${USAGE_LABEL[x.type]}${x.quantity ? ` ${x.quantity} ${o.unit}` : ""}`).join(", ")}</p>
                      <StatusStamp status={o.status} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sot-3">Inget har tagits i bruk i projektet ännu. Välj projektet när du registrerar nytt liv på en sak.</p>}
      </Section>

      <Section title="Människor">
        {contributions.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {contributions.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <Link to={`/person/${c.person_id}`} className="font-medium text-falu">{names[c.person_id] ?? "Person"}</Link>
                <p className="text-sm text-sot-3">{[CONTRIBUTION_LABEL[c.kind], c.description, c.hours ? `${c.hours} h` : "", formatDate(c.occurred_at)].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sot-3">Inga bidrag ännu. Registrera bidrag på personens kort och välj projektet.</p>}
      </Section>

      <Section title="Projektjournal">
        <JournalList events={events} links={links} names={names} />
      </Section>
    </div>
  );
}

function ProjectForm({ project: p, zones, structures, onDone }: { project: Project; zones: { id: string; name: string }[]; structures: { id: string; name: string }[]; onDone: () => void }) {
  const { repo, refresh } = useApp();
  const [name, setName] = useState(p.name);
  const [kind, setKind] = useState(p.kind);
  const [place, setPlace] = useState(p.zone_id ? `z:${p.zone_id}` : p.structure_id ? `s:${p.structure_id}` : "");
  const [description, setDescription] = useState(p.description);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="card mb-6 space-y-3 p-4" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      try {
        await repo.updateProject(p.id, { name, kind, description: description.trim(), zone_id: place.startsWith("z:") ? place.slice(2) : null, structure_id: place.startsWith("s:") ? place.slice(2) : null });
        await refresh();
        onDone();
      } catch (err) {
        setError((err as Error).message);
      }
    }}>
      <input className="input" required value={name} onChange={(e) => setName(e.target.value)} aria-label="Namn" />
      <div className="grid gap-3 sm:grid-cols-2">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Slag av projekt">
          <option value="">Slag av projekt</option>
          {PROJECT_KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <select className="input" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Var på Vreta">
          <option value="">Var på Vreta?</option>
          <optgroup label="Zoner">{zones.map((z) => <option key={z.id} value={`z:${z.id}`}>{z.name}</option>)}</optgroup>
          <optgroup label="Byggnader">{structures.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>
        </select>
      </div>
      <textarea className="input min-h-[96px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Vad ska göras, och varför?" aria-label="Beskrivning" />
      {error && <p className="text-sm text-falu">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>Avbryt</button>
        <button className="btn-primary flex-1">Spara</button>
      </div>
    </form>
  );
}

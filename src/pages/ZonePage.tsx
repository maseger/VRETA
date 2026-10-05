import { Eye, Gavel } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { areaM2, formatArea } from "../geo/geo";
import { EmptyState, MediaImage, PageHeader, Section, StatusStamp } from "../ui/bits";
import { DecisionForm, ObservationForm } from "../ui/JournalForms";
import { JournalList } from "../ui/JournalList";

export function ZonePage() {
  const { id } = useParams();
  const { profile } = useApp();
  const canWrite = profile?.role !== "viewer";
  const [form, setForm] = useState<null | "obs" | "beslut">(null);
  const { data } = useData(async (r) => {
    const zones = await r.zones();
    const zone = zones.find((z) => z.id === id);
    if (!zone) return null;
    const [events, objects, usage] = await Promise.all([r.eventsFor("zone", id!), r.objects(), r.allUsageEvents()]);
    const [links, people] = await Promise.all([r.eventLinks(events.map((e) => e.id)), r.persons()]);
    const usedHere = new Set(usage.filter((u) => u.zone_id === id && u.type !== "removed").map((u) => u.object_id));
    const here = objects.filter((o) => usedHere.has(o.id) || (o.zone_id === id && o.status === "in_use"));
    const covers = await Promise.all(here.map((o) => r.mediaFor("object", o.id).then((m) => m.find((x) => x.role === "after") ?? m[0])));
    const names: Record<string, string> = {};
    for (const o of objects) names[o.id] = o.title;
    for (const z of zones) names[z.id] = z.name;
    for (const p of people) names[p.id] = p.name;
    return { zone, zones, events: events.filter((e) => e.event_type !== "object.status_changed"), links, names, here: here.map((o, i) => ({ o, cover: covers[i] })) };
  }, [id]);

  if (data === null) return <EmptyState title="Zonen finns inte" />;
  if (!data) return null;
  const { zone, zones, events, links, names, here } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/platser" className="text-sm font-semibold text-falu">← Platser</Link>
      <PageHeader kicker={`Zon${zone.geom ? ` · ${formatArea(areaM2(zone.geom))}` : ""}`} title={zone.name} />
      {zone.notes && <p className="-mt-3 mb-6 text-sot-3">{zone.notes}</p>}

      {canWrite && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button className={form === "obs" ? "btn-primary" : "btn-secondary"} onClick={() => setForm(form === "obs" ? null : "obs")}><Eye size={18} aria-hidden="true" /> Observation</button>
          <button className={form === "beslut" ? "btn-primary" : "btn-secondary"} onClick={() => setForm(form === "beslut" ? null : "beslut")}><Gavel size={18} aria-hidden="true" /> Beslut</button>
        </div>
      )}
      {form === "obs" && <div className="mb-6"><ObservationForm zones={zones} defaultZone={zone.id} onDone={() => setForm(null)} /></div>}
      {form === "beslut" && <div className="mb-6"><DecisionForm zones={zones} defaultZone={zone.id} onDone={() => setForm(null)} /></div>}

      <Section title="Nytt liv här">
        {here.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {here.map(({ o, cover }) => (
              <li key={o.id}>
                <Link to={`/objekt/${o.id}`} className="card block overflow-hidden">
                  <MediaImage media={cover} className="aspect-square w-full" alt={o.title} />
                  <div className="space-y-1 p-3"><p className="truncate font-medium">{o.title}</p><StatusStamp status={o.status} /></div>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sot-3">Inget återbrukat här ännu.</p>}
      </Section>

      <Section title="Zonjournal">
        <JournalList events={events} links={links} names={names} />
      </Section>
    </div>
  );
}

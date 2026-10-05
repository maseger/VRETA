import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { JOURNAL_FILTERS } from "../domain/labels";
import { PageHeader } from "../ui/bits";
import { JournalList } from "../ui/JournalList";

const PERIODS = [
  { key: "vecka", label: "Veckan", days: 7 },
  { key: "manad", label: "Månaden", days: 31 },
  { key: "ar", label: "Året", days: 366 },
  { key: "allt", label: "Allt", days: 0 },
];

/** Platsjournal (S10, 4.9): allt som hänt på Vreta, filtrerat på typ, zon och period. */
export function JournalPage() {
  const { site } = useApp();
  const [filter, setFilter] = useState("allt");
  const [period, setPeriod] = useState("allt");
  const [zone, setZone] = useState("");
  const { data } = useData(async (r) => {
    const events = await r.eventsFor("site", site!.id);
    const [links, objects, zones, people] = await Promise.all([r.eventLinks(events.map((e) => e.id)), r.objects(), r.zones(), r.persons()]);
    const names: Record<string, string> = {};
    for (const o of objects) names[o.id] = o.title;
    for (const z of zones) names[z.id] = z.name;
    for (const p of people) names[p.id] = p.name;
    return { events, links, names, zones };
  }, [site?.id]);

  const shown = useMemo(() => {
    if (!data) return [];
    const f = JOURNAL_FILTERS.find((x) => x.key === filter)!;
    const days = PERIODS.find((p) => p.key === period)!.days;
    const since = days ? Date.now() - days * 864e5 : 0;
    const inZone = zone ? new Set(data.links.filter((l) => l.entity_type === "zone" && l.entity_id === zone).map((l) => l.event_id)) : null;
    return data.events.filter((e) => f.match(e.event_type) && !e.event_type.startsWith("object.status_changed") && Date.parse(e.occurred_at) >= since && (!inZone || inZone.has(e.id)));
  }, [data, filter, period, zone]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/vreta" className="text-sm font-semibold text-falu">← Vreta</Link>
      <PageHeader kicker="Platsjournal" title={`Det här har hänt på ${site?.name ?? "Vreta"}`} />
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {JOURNAL_FILTERS.map((f) => <button key={f.key} className={`chip shrink-0 ${filter === f.key ? "chip-on" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>)}
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select className="input w-auto" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zon">
          <option value="">Hela platsen</option>
          {data?.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </div>
      {data && <JournalList events={shown} links={data.links} names={data.names} />}
    </div>
  );
}

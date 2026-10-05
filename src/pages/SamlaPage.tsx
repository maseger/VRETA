import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../app/AppContext";
import { STATUS_GROUPS } from "../domain/labels";
import { EmptyState, MediaImage, PageHeader, StatusStamp } from "../ui/bits";

export function SamlaPage() {
  const [group, setGroup] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { data } = useData(async (repo) => {
    const objects = await repo.objects();
    const covers = await Promise.all(objects.map((o) => repo.mediaFor("object", o.id).then((m) => m.find((x) => x.role !== "before") ?? m[0])));
    return objects.map((o, i) => ({ o, cover: covers[i] }));
  });

  const filtered = useMemo(() => {
    const g = STATUS_GROUPS.find((x) => x.key === group);
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(({ o }) => (!g || g.statuses.includes(o.status)) && (!needle || `${o.title} ${o.category} ${o.material}`.toLowerCase().includes(needle)));
  }, [data, group, q]);

  return (
    <div>
      <PageHeader kicker="Samla" title="Allt som kommit in" />
      <div className="relative mb-4">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sot-3" aria-hidden="true" />
        <input className="input pl-10" placeholder="Sök bland objekt" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Sök bland objekt" />
      </div>
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        <button className={`chip shrink-0 ${group === null ? "chip-on" : ""}`} onClick={() => setGroup(null)}>Alla</button>
        {STATUS_GROUPS.map((g) => (
          <button key={g.key} className={`chip shrink-0 ${group === g.key ? "chip-on" : ""}`} onClick={() => setGroup(g.key)}>{g.label}</button>
        ))}
      </div>
      {filtered.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map(({ o, cover }) => (
            <li key={o.id}>
              <Link to={`/objekt/${o.id}`} className="card block overflow-hidden hover:shadow-md">
                <MediaImage media={cover} className="aspect-square w-full" alt={o.title} />
                <div className="space-y-1.5 p-3">
                  <p className="truncate font-serif text-[16px] font-semibold">{o.title}</p>
                  <p className="text-[13px] text-sot-3">{o.quantity} {o.unit}</p>
                  <StatusStamp status={o.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={data?.length ? "Inget matchar" : "Inga objekt ännu"}>{data?.length ? "Prova ett annat filter." : "Tryck på + för att fånga ditt första fynd."}</EmptyState>
      )}
    </div>
  );
}

import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { EmptyState, MediaImage, StatusStamp } from "../ui/bits";
import { descendantIds, locationPath } from "../ui/location";
import { QrCode, locationUrl } from "../ui/QrCode";

export function StorageLocationPage() {
  const { id } = useParams();
  const { repo, profile, refresh, toast } = useApp();
  const canWrite = profile?.role !== "viewer";
  const [pick, setPick] = useState("");
  const { data } = useData(async (r) => {
    const [locations, objects] = await Promise.all([r.storageLocations(), r.objects()]);
    const loc = locations.find((l) => l.id === id);
    if (!loc) return null;
    const subtree = descendantIds(locations, loc.id);
    const here = objects.filter((o) => o.storage_location_id && subtree.has(o.storage_location_id) && o.status === "stored");
    const covers = await Promise.all(here.map((o) => r.mediaFor("object", o.id).then((m) => m[0])));
    const candidates = objects.filter((o) => ["collected", "stored", "processing"].includes(o.status) && o.storage_location_id !== id);
    return { loc, locations, here: here.map((o, i) => ({ o, cover: covers[i] })), candidates, children: locations.filter((l) => l.parent_id === id) };
  }, [id]);

  if (data === null) return <EmptyState title="Lagerplatsen finns inte" />;
  if (!data) return null;
  const { loc, locations, here, candidates, children } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/lager" className="text-sm font-semibold text-falu">← Lager</Link>
      <header className="mb-6 mt-2 flex items-start justify-between gap-4">
        <div>
          <p className="kicker mb-1">{locationPath(locations, loc.parent_id) || "Lagerplats"}</p>
          <h1>{loc.name}</h1>
          {children.length > 0 && <p className="mt-2 flex flex-wrap gap-2">{children.map((c) => <Link key={c.id} to={`/lager/${c.id}`} className="chip">{c.name}</Link>)}</p>}
        </div>
        <QrCode value={locationUrl(loc.id)} className="h-24 w-24 shrink-0 rounded-md border border-lera-light bg-[#FDFBF6] p-2" />
      </header>

      {canWrite && candidates.length > 0 && (
        <form className="card mb-6 flex gap-2 p-3" onSubmit={async (e) => { e.preventDefault(); await repo.storeObject(pick, loc.id); setPick(""); await refresh(); toast(`Lagt i ${loc.name}`); }}>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} required aria-label="Objekt att lägga här">
            <option value="">Lägg ett objekt här …</option>
            {candidates.map((o) => <option key={o.id} value={o.id}>{o.title} ({o.quantity} {o.unit})</option>)}
          </select>
          <button className="btn-primary shrink-0"><Plus size={18} aria-hidden="true" /> Lägg</button>
        </form>
      )}

      {here.length ? (
        <ul className="card divide-y divide-dashed divide-lera-light">
          {here.map(({ o, cover }) => (
            <li key={o.id}>
              <Link to={`/objekt/${o.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-kalk-2/60">
                <MediaImage media={cover} className="h-12 w-12 shrink-0 rounded-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.title}</span>
                  <span className="text-sm text-sot-3">{o.quantity} {o.unit}{o.storage_location_id !== loc.id ? ` · ${locationPath(locations, o.storage_location_id).split(" → ").pop()}` : ""}</span>
                </span>
                <StatusStamp status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="Tomt här">Lägg in objekt med listan ovan eller när du avslutar en hämtning.</EmptyState>}
    </div>
  );
}

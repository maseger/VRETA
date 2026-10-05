import { ChevronRight, Plus, Printer, QrCode as QrIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { PageHeader } from "../ui/bits";
import { LocationSelect, flattenTree } from "../ui/location";

export function StoragePage() {
  const { repo, profile, refresh } = useApp();
  const canWrite = profile?.role !== "viewer";
  const { data } = useData(async (r) => {
    const [locations, objects] = await Promise.all([r.storageLocations(), r.objects()]);
    return { locations, objects };
  });
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");

  const countIn = (id: string): number => {
    if (!data) return 0;
    const direct = data.objects.filter((o) => o.storage_location_id === id && o.status === "stored").length;
    return direct + data.locations.filter((l) => l.parent_id === id).reduce((s, c) => s + countIn(c.id), 0);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/vreta" className="text-sm font-semibold text-falu">← Vreta</Link>
      <PageHeader kicker="Lager" title="Var ligger allt?">
        <Link to="/lager/etiketter" className="btn-secondary"><Printer size={18} aria-hidden="true" /> Etiketter</Link>
      </PageHeader>
      <p className="mb-6 flex items-start gap-2 text-sm text-sot-3"><QrIcon size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> Sätt upp en QR-etikett på varje hylla eller låda. Skanna med telefonens kamera för att se vad som ligger där och lägga in nya saker.</p>

      <ul className="card mb-6 divide-y divide-dashed divide-lera-light">
        {data && flattenTree(data.locations).map(({ loc, depth }) => (
          <li key={loc.id}>
            <Link to={`/lager/${loc.id}`} className="flex min-h-[52px] items-center gap-3 py-2 pr-4 hover:bg-kalk-2/60" style={{ paddingLeft: 16 + depth * 22 }}>
              {depth > 0 && <span className="text-lera" aria-hidden="true">└</span>}
              <span className={`flex-1 ${depth === 0 ? "font-serif text-[17px] font-semibold" : "font-medium"}`}>{loc.name}</span>
              <span className="text-sm text-sot-3">{countIn(loc.id) || ""}</span>
              <ChevronRight size={16} className="text-sot-3" aria-hidden="true" />
            </Link>
          </li>
        ))}
        {data && !data.locations.length && <li className="px-4 py-6 text-center text-sot-3">Inga lagerplatser ännu.</li>}
      </ul>

      {canWrite && data && (
        <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); await repo.createStorageLocation({ name: name.trim(), parent_id: parent || null, structure_id: null, notes: "" }); setName(""); await refresh(); }}>
          <h2 className="sm:col-span-2">Ny lagerplats</h2>
          <input className="input" placeholder="T.ex. Hylla 4 eller Låda 7" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Namn" />
          <LocationSelect locations={data.locations} value={parent} onChange={setParent} label="Placeras i" />
          <p className="text-[12px] text-sot-3 sm:col-span-2">Lämna ”Välj lagerplats” tomt för en ny byggnad eller zon högst upp.</p>
          <button className="btn-primary sm:col-span-2"><Plus size={18} aria-hidden="true" /> Lägg till</button>
        </form>
      )}
    </div>
  );
}

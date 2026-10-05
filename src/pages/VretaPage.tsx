import { Archive, ChevronRight, Map as MapIcon, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useApp, useData } from "../app/AppContext";
import { PageHeader, Section } from "../ui/bits";

export function VretaPage() {
  const { repo, site, profile, refresh } = useApp();
  const canWrite = profile?.role !== "viewer";
  const { data } = useData(async (r) => {
    const [zones, structures, objects] = await Promise.all([r.zones(), r.structures(), r.objects()]);
    return { zones, structures, objects };
  });
  const [zoneName, setZoneName] = useState("");
  const [structName, setStructName] = useState("");

  const count = (key: "zone_id" | "structure_id", id: string) => data?.objects.filter((o) => o[key] === id).length ?? 0;

  return (
    <div>
      <PageHeader kicker="Platsen" title={site?.name ?? "Vreta"} />

      <div className="card mb-8 flex items-center gap-4 border-dashed p-5">
        <MapIcon size={32} strokeWidth={1.5} className="shrink-0 text-linolja" aria-hidden="true" />
        <div>
          <p className="font-serif text-lg font-semibold">Vretakartan kommer i milstolpe M3</p>
          <p className="text-sm text-sot-3">Fastighetskartan byggs på kommunens baskarta med ritningar som lager. Zoner och byggnader nedan placeras på kartan då.</p>
        </div>
      </div>

      <Link to="/lager" className="card mb-8 flex items-center gap-4 p-5 hover:bg-kalk-2/60">
        <Archive size={28} strokeWidth={1.5} className="shrink-0 text-falu" aria-hidden="true" />
        <span className="flex-1"><span className="block font-serif text-lg font-semibold">Lager</span><span className="text-sm text-sot-3">Lagerplatser, QR-etiketter och vad som ligger var</span></span>
        <ChevronRight size={18} className="text-sot-3" aria-hidden="true" />
      </Link>

      <Section title="Zoner">
        <ul className="card divide-y divide-dashed divide-lera-light">
          {data?.zones.map((z) => (
            <li key={z.id} className="flex items-center justify-between px-4 py-3">
              <span><span className="font-medium">{z.name}</span>{z.notes && <span className="block text-sm text-sot-3">{z.notes}</span>}</span>
              <span className="text-sm text-sot-3">{count("zone_id", z.id)} objekt i bruk</span>
            </li>
          ))}
        </ul>
        {canWrite && (
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); await repo.createZone({ name: zoneName.trim(), kind: "", notes: "" }); setZoneName(""); await refresh(); }}>
            <input className="input" placeholder="Ny zon, t.ex. Köksträdgården" value={zoneName} onChange={(e) => setZoneName(e.target.value)} required />
            <button className="btn-secondary shrink-0"><Plus size={18} aria-hidden="true" /> Lägg till</button>
          </form>
        )}
      </Section>

      <Section title="Byggnader och anläggningar">
        <ul className="card divide-y divide-dashed divide-lera-light">
          {data?.structures.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <span><span className="font-medium">{s.name}</span><span className="block text-sm text-sot-3">{[s.kind, s.notes].filter(Boolean).join(" · ")}</span></span>
              <span className="text-sm text-sot-3">{count("structure_id", s.id)} objekt i bruk</span>
            </li>
          ))}
        </ul>
        {canWrite && (
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); await repo.createStructure({ name: structName.trim(), kind: "", notes: "", zone_id: null }); setStructName(""); await refresh(); }}>
            <input className="input" placeholder="Ny byggnad, t.ex. Vedboden" value={structName} onChange={(e) => setStructName(e.target.value)} required />
            <button className="btn-secondary shrink-0"><Plus size={18} aria-hidden="true" /> Lägg till</button>
          </form>
        )}
      </Section>
    </div>
  );
}

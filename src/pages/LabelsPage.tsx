import { Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../app/AppContext";
import { flattenTree, locationPath } from "../ui/location";
import { QrCode, locationUrl } from "../ui/QrCode";

/** Utskrivbara QR-etiketter för lagerplatser (FR-017). */
export function LabelsPage() {
  const { data } = useData((r) => r.storageLocations());
  return (
    <div>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link to="/lager" className="text-sm font-semibold text-falu">← Lager</Link>
        <button className="btn-primary" onClick={() => window.print()}><Printer size={18} aria-hidden="true" /> Skriv ut</button>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {data && flattenTree(data).map(({ loc }) => (
          <div key={loc.id} className="flex break-inside-avoid flex-col items-center gap-2 rounded-md border-2 border-dashed border-sot/40 bg-[#FDFBF6] p-4 text-center">
            <QrCode value={locationUrl(loc.id)} className="h-28 w-28" />
            <p className="font-serif text-lg font-semibold leading-tight">{loc.name}</p>
            <p className="text-[11px] text-sot-3">{locationPath(data, loc.id)}</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-falu">Vreta</p>
          </div>
        ))}
      </div>
    </div>
  );
}

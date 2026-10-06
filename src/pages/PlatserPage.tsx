import { BookOpen, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "../app/AppContext";
import { PageHeader } from "../ui/bits";
import { ExternalPlaces } from "./platser/ExternalPlaces";
import { OnSitePlaces } from "./platser/OnSitePlaces";

/**
 * Platser: där saker händer fysiskt. Två slag – platserna på Vreta (förvaring, projekt, observationer)
 * och orterna utanför där saker hämtas, köps och lämnas.
 */
export function PlatserPage() {
  const { site, profile } = useApp();
  const [params, setParams] = useSearchParams();
  const view = params.get("vy") === "utanfor" ? "utanfor" : "vreta";
  const name = site?.name ?? "Vreta";
  return (
    <div>
      <PageHeader kicker="Platser" title={view === "vreta" ? name : "Utanför Vreta"}>
        {view === "vreta" && <Link to="/journal" className="btn-secondary"><BookOpen size={18} aria-hidden="true" /> Journal</Link>}
        {profile?.role !== "viewer" && <Link to={view === "vreta" ? "/platser/ny" : "/platser/ny?typ=utanfor"} className="btn-primary"><Plus size={18} aria-hidden="true" /> Ny plats</Link>}
      </PageHeader>
      <div role="tablist" className="mb-6 flex gap-1 rounded-md border border-lera-light bg-kalk-2/60 p-1">
        {([["vreta", `På ${name}`], ["utanfor", "Utanför"]] as const).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={view === key} onClick={() => setParams(key === "vreta" ? {} : { vy: key }, { replace: true })} className={`min-h-[40px] flex-1 truncate rounded px-3 text-sm font-semibold ${view === key ? "bg-[#FBF8F1] text-sot shadow-papper" : "text-sot-3"}`}>
            {label}
          </button>
        ))}
      </div>
      {view === "vreta" ? <OnSitePlaces /> : <ExternalPlaces />}
    </div>
  );
}

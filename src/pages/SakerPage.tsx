import { useSearchParams } from "react-router-dom";
import { useApp } from "../app/AppContext";
import { PageHeader } from "../ui/bits";
import { AcquisitionBoard } from "./saker/AcquisitionBoard";
import { ListingsList } from "./saker/ListingsList";
import { ObjectsList } from "./saker/ObjectsList";
import { PickupList } from "./saker/PickupList";

/** Saker: det som hanteras – objekt och partier och deras väg in och ut. Människor och platser har egna delar. */
const VIEWS = [
  { key: "objekt", label: "Objekt", title: "Allt som kommit in" },
  { key: "inkop", label: "Inköp", title: "Inköp och gåvor" },
  { key: "hamtningar", label: "Hämtningar", title: "Hämtningar" },
  { key: "annonser", label: "Annonser", title: "Sälja, skänka, byta" },
] as const;

export function SakerPage() {
  const [params, setParams] = useSearchParams();
  const { profile } = useApp();
  // Gäster ser inte inköp och hämtningar (namn, adresser, affärer)
  const views = profile?.guest ? VIEWS.filter((v) => v.key === "objekt" || v.key === "annonser") : VIEWS;
  const view = views.find((v) => v.key === params.get("vy")) ?? views[0];
  return (
    <div>
      <PageHeader kicker="Saker" title={view.title} />
      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto rounded-md border border-lera-light bg-kalk-2/60 p-1">
        {views.map((v) => (
          <button key={v.key} role="tab" aria-selected={view.key === v.key} onClick={() => setParams({ vy: v.key }, { replace: true })} className={`min-h-[40px] flex-1 whitespace-nowrap rounded px-3 text-sm font-semibold ${view.key === v.key ? "bg-[#FBF8F1] text-sot shadow-papper" : "text-sot-3"}`}>
            {v.label}
          </button>
        ))}
      </div>
      {view.key === "objekt" && <ObjectsList />}
      {view.key === "inkop" && <AcquisitionBoard />}
      {view.key === "hamtningar" && <PickupList />}
      {view.key === "annonser" && <ListingsList />}
    </div>
  );
}

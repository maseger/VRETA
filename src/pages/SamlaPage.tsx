import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../ui/bits";
import { AcquisitionBoard } from "./samla/AcquisitionBoard";
import { ObjectsList } from "./samla/ObjectsList";
import { PeopleList } from "./samla/PeopleList";
import { PickupList } from "./samla/PickupList";

const VIEWS = [
  { key: "objekt", label: "Objekt" },
  { key: "manniskor", label: "Människor" },
  { key: "inkop", label: "Inköp" },
  { key: "hamtningar", label: "Hämtningar" },
] as const;

export function SamlaPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("vy") ?? "objekt";
  return (
    <div>
      <PageHeader kicker="Samla" title={{ objekt: "Allt som kommit in", manniskor: "Människorna kring Vreta", inkop: "Inköp och gåvor", hamtningar: "Hämtningar" }[view] ?? ""} />
      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto rounded-md border border-lera-light bg-kalk-2/60 p-1">
        {VIEWS.map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setParams({ vy: v.key }, { replace: true })} className={`min-h-[40px] flex-1 whitespace-nowrap rounded px-3 text-sm font-semibold ${view === v.key ? "bg-[#FBF8F1] text-sot shadow-papper" : "text-sot-3"}`}>
            {v.label}
          </button>
        ))}
      </div>
      {view === "objekt" && <ObjectsList />}
      {view === "manniskor" && <PeopleList />}
      {view === "inkop" && <AcquisitionBoard />}
      {view === "hamtningar" && <PickupList />}
    </div>
  );
}

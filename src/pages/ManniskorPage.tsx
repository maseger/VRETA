import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../ui/bits";
import { OrganizationsList } from "./manniskor/OrganizationsList";
import { PeopleList } from "./manniskor/PeopleList";

/** Människor: de som hanterar sakerna – ger, hämtar, köper, hjälper till – och deras relationer med varandra och med Vreta. */
export function ManniskorPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("vy") === "organisationer" ? "organisationer" : "personer";
  return (
    <div>
      <PageHeader kicker="Människor" title="Människorna kring Vreta" />
      <p className="-mt-3 mb-6 max-w-xl text-sot-3">Givare, säljare, köpare och medskapare – och sammanhangen de hör till. Varje person har sin historia med Vreta och sina relationer till andra.</p>
      <div role="tablist" className="mb-6 flex gap-1 rounded-md border border-lera-light bg-kalk-2/60 p-1">
        {([["personer", "Personer"], ["organisationer", "Organisationer"]] as const).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={view === key} onClick={() => setParams(key === "personer" ? {} : { vy: key }, { replace: true })} className={`min-h-[40px] flex-1 rounded px-3 text-sm font-semibold ${view === key ? "bg-[#FBF8F1] text-sot shadow-papper" : "text-sot-3"}`}>
            {label}
          </button>
        ))}
      </div>
      {view === "personer" ? <PeopleList /> : <OrganizationsList />}
    </div>
  );
}

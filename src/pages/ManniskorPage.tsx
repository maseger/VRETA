import { PageHeader } from "../ui/bits";
import { PeopleList } from "./manniskor/PeopleList";

/** Människor: de som hanterar sakerna – ger, hämtar, köper, hjälper till – och relationerna mellan dem och Vreta. */
export function ManniskorPage() {
  return (
    <div>
      <PageHeader kicker="Människor" title="Människorna kring Vreta" />
      <p className="-mt-3 mb-6 max-w-xl text-sot-3">Givare, säljare, köpare och medskapare. Varje person har sin historia med Vreta: vad de gett och fått, vad ni pratat om och vad de vill att vi berättar.</p>
      <PeopleList />
    </div>
  );
}

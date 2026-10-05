import { MessageCircle } from "lucide-react";
import { PageHeader } from "../ui/bits";

export function AskPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader kicker="Fråga Vreta" title="Chatboten kommer i M5" />
      <div className="card flex gap-4 p-5">
        <MessageCircle size={32} strokeWidth={1.5} className="shrink-0 text-linolja" aria-hidden="true" />
        <div className="space-y-2 text-sot-2">
          <p>Här kommer du att kunna fråga om allt i appen, med text eller röst, och få svar med källor:</p>
          <ul className="list-disc pl-5 text-sm">
            <li>Var är mässingshandtagen?</li>
            <li>Vad har legat i lager längst?</li>
            <li>Vilka har jag inte tackat?</li>
          </ul>
          <p className="text-sm text-sot-3">Tills dess: använd sökfältet under Samla.</p>
        </div>
      </div>
    </div>
  );
}

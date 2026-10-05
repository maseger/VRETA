import { Star } from "lucide-react";
import { Link } from "react-router-dom";
import { eventLabel, humanizeSummary } from "../domain/labels";
import type { EventLink, EventRec } from "../domain/types";
import { formatDate } from "./bits";

/** Gemensam journalvy – samma händelser visas i plats-, zon-, objekt- och personjournal (INV-01). */
export function JournalList({ events, links, names }: { events: EventRec[]; links: EventLink[]; names: Record<string, string> }) {
  if (!events.length) return <p className="text-sot-3">Inget i journalen för det här urvalet.</p>;
  let lastMonth = "";
  return (
    <ol className="relative ml-2 space-y-5 border-l-2 border-dashed border-lera pl-6">
      {events.map((e) => {
        const month = new Date(e.occurred_at).toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
        const header = month !== lastMonth ? month : null;
        lastMonth = month;
        const related = links.filter((l) => l.event_id === e.id && (l.entity_type === "object" || l.entity_type === "zone" || l.entity_type === "person"));
        return (
          <li key={e.id} className="relative">
            {header && <p className="-ml-6 mb-3 font-serif text-lg font-semibold capitalize text-sot-2">{header}</p>}
            <span className={`absolute -left-[33px] h-4 w-4 rounded-full border-2 border-kalk ${header ? "top-11" : "top-1"} ${e.event_type.startsWith("usage.") ? "bg-linolja" : e.event_type.startsWith("observation.") ? "bg-ockra" : e.event_type === "decision" ? "bg-sot-2" : "bg-falu"}`} aria-hidden="true" />
            <p className="kicker">{formatDate(e.occurred_at)}</p>
            <p className="flex items-center gap-1.5 font-serif text-[17px] font-semibold">
              {eventLabel(e.event_type)} {e.story_worthy && <Star size={14} className="fill-ockra text-ockra" aria-label="Bra att berätta" />}
            </p>
            <p className="text-sot-2">{humanizeSummary(e.summary)}</p>
            {e.notes && <p className="mt-0.5 text-sm italic text-sot-3">{e.notes}</p>}
            {related.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-2">
                {related.map((l) => names[l.entity_id] && (
                  <Link key={l.id} to={l.entity_type === "object" ? `/objekt/${l.entity_id}` : l.entity_type === "zone" ? `/zon/${l.entity_id}` : `/person/${l.entity_id}`} className="chip min-h-[30px] px-2.5 text-[13px]">
                    {names[l.entity_id]}
                  </Link>
                ))}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

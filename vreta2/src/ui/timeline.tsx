// Tidslinjen: allt som hänt en sak, en person eller en plats, ur HistoryEvent (Designdokument 2.0, Historik).
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { d, dt } from "../app/format";
import { useCan, useCommand } from "../app/AppContext";
import { MediaImg, type MediaRef } from "./media";
import { Empty } from "./base";

export type TimelineEvent = {
  id: string; event_type: string; occurred_at: string; summary: string; note?: string | null; story_value?: boolean; visibility?: string;
  role?: string; place?: { title: string; route?: string | null } | null; place_path?: string | null;
  links?: { id: string; type: string; title: string; route?: string | null; role?: string; type_label?: string }[];
  media?: MediaRef[];
};

const DOT: Record<string, string> = {
  object: "bg-lera", acquisition: "bg-ockra", pickup: "bg-ockra", listing: "bg-ockra", lead: "bg-ockra", disposal: "bg-jarn",
  project: "bg-linolja", need: "bg-linolja", moment: "bg-linolja", decision: "bg-linolja", activity: "bg-linolja",
  person: "bg-falu-light", contribution: "bg-falu-light", reciprocity: "bg-falu-light", content: "bg-falu", observation: "bg-linolja-light",
};

export function Timeline({ events, hideLink, empty = "Inget har hänt här ännu.", compact }: { events: TimelineEvent[]; hideLink?: string; empty?: string; compact?: boolean }) {
  const can = useCan();
  const run = useCommand();
  if (!events?.length) return <Empty>{empty}</Empty>;
  return (
    <ol className="relative ml-2 border-l-2 border-dashed border-lera pl-5">
      {events.map((e) => {
        const prefix = e.event_type.split(".")[0];
        const links = (e.links ?? []).filter((l) => l.id !== hideLink && l.type !== "history_event");
        return (
          <li key={e.id} className="relative mb-4">
            <span className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-kalk ${DOT[prefix] ?? "bg-jarn"}`} aria-hidden />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm text-sot-3"><time dateTime={e.occurred_at} title={dt(e.occurred_at)}>{d(e.occurred_at)}</time>
                  {(e.place_path || e.place) && <> · {e.place?.route ? <Link to={e.place.route}>{e.place_path ?? e.place.title}</Link> : e.place_path ?? e.place?.title}</>}
                </div>
                <Link to={`/handelse/${e.id}`} className="font-semibold text-sot">{e.summary}</Link>
                {e.note && !compact && <div className="text-sot-2">{e.note}</div>}
                {!compact && links.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {links.slice(0, 5).map((l) => l.route
                      ? <Link key={l.id + (l.role ?? "")} to={l.route} className="chip min-h-[28px] px-2 text-xs no-underline">{l.title}</Link>
                      : <span key={l.id + (l.role ?? "")} className="chip min-h-[28px] px-2 text-xs">{l.title}</span>)}
                  </div>
                )}
                {!compact && (e.media ?? []).length > 0 && (
                  <div className="mt-2 flex gap-1.5">{(e.media ?? []).slice(0, 4).map((m) => <MediaImg key={m.id} m={m} className="h-16 w-16 rounded-md" />)}</div>
                )}
              </div>
              {can("MarkStoryValue") && (
                <button type="button" className={`rounded-full p-1.5 ${e.story_value ? "text-ockra" : "text-lera hover:text-ockra"}`}
                  aria-pressed={!!e.story_value} aria-label={e.story_value ? "Markerad som berättelsevärd" : "Markera som berättelsevärd"}
                  title="Berättelsevärd" onClick={() => run("MarkStoryValue", { history_event_id: e.id, value: !e.story_value })}>
                  <Star size={18} fill={e.story_value ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

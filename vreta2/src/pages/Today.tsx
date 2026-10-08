// Idag: det som behöver göras nu, vem som väntar på svar, vem som ska tackas och vad som är värt att berätta
// (R1.1 S1, Designdokument 2.0). Läses ur read model rm.today_item som byggs om efter varje ändring.
import { Link, useNavigate } from "react-router-dom";
import { Check, ChevronRight, CloudSun, Gift, Inbox, MessageSquareReply, PenLine, Package, Sparkles, Truck, TriangleAlert } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { ago, d, dt, today } from "../app/format";
import { Card, Empty, ErrorNote, PageHeader, Section, Spinner } from "../ui/base";

type Item = { id: string; kind: string; title: string; subtitle?: string | null; due_at?: string | null; payload: any;
  entity?: { id: string; type: string; route?: string | null; title: string } | null };

const GROUPS: { title: string; kinds: string[] }[] = [
  { title: "Att göra nu", kinds: ["review", "submissions", "pickup", "overdue", "task", "lead_waiting", "acquisition_waiting"] },
  { title: "Människor", kinds: ["thank", "show_result"] },
  { title: "Värt att berätta", kinds: ["story"] },
  { title: "I lagret", kinds: ["long_stored"] },
  { title: "Senaste fynden", kinds: ["recent_find"] },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 10 ? "God morgon" : h < 17 ? "Hej" : "God kväll";
}

export default function Today() {
  const { ctx } = useApp();
  const can = useCan();
  const { data, error, loading } = useQuery<{ items: Item[]; today_events: any[]; sync_issues: number; weather: any }>("q_today");
  const name = ctx?.display_name && !["Ägaren", "Medhjälparen", "Läsaren"].includes(ctx.display_name) ? `, ${ctx.display_name.split(" ")[0]}` : "";
  return (
    <div>
      <PageHeader kicker={today()} title={`${greeting()}${name}`} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && data.sync_issues > 0 && (
        <Link to="/synk" className="mb-4 flex items-center gap-3 rounded-xl bg-falu px-4 py-3 text-kalk no-underline hover:no-underline">
          <TriangleAlert size={20} /> <span className="flex-1">{data.sync_issues} ändringar från telefonen kunde inte sparas – lös dem</span><ChevronRight size={18} />
        </Link>
      )}
      {data?.weather?.now && <WeatherCard w={data.weather} />}
      {data && data.items.length === 0 && <Empty>Inget som väntar just nu. Fånga något nytt med den röda knappen.</Empty>}
      {data && GROUPS.map((g) => {
        // Granskning och inskick visas bara för den som kan avgöra dem
        const items = data.items.filter((i) => g.kinds.includes(i.kind) && (!["review", "submissions"].includes(i.kind) || can("ApproveProposal")));
        if (!items.length) return null;
        return (
          <Section key={g.title} title={g.title}>
            <div className="flex flex-col gap-2">{items.map((i) => <TodayCard key={i.id} item={i} />)}</div>
          </Section>
        );
      })}
      {data && data.today_events.length > 0 && (
        <Section title="Senast på Vreta" action={<Link to="/journal" className="text-sm">Hela journalen</Link>}>
          <ul className="card divide-y divide-dashed divide-lera">
            {data.today_events.map((e) => (
              <li key={e.id}><Link to={`/handelse/${e.id}`} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sot no-underline hover:bg-kalk-2/60">
                <span>{e.summary}</span><span className="shrink-0 text-sm text-sot-3">{ago(e.occurred_at)}</span>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const ICON: Record<string, any> = {
  review: Inbox, submissions: Inbox, pickup: Truck, overdue: TriangleAlert, task: Check, lead_waiting: MessageSquareReply,
  acquisition_waiting: MessageSquareReply, thank: Gift, show_result: Gift, story: PenLine, long_stored: Package, recent_find: Sparkles,
};

function TodayCard({ item }: { item: Item }) {
  const nav = useNavigate();
  const run = useCommand();
  const can = useCan();
  const Icon = ICON[item.kind] ?? Sparkles;
  const target = ((): string | null => {
    switch (item.kind) {
      case "review": case "submissions": return "/granska";
      case "lead_waiting": return item.payload?.listing_id ? `/annons/${item.payload.listing_id}` : null;
      case "acquisition_waiting": return item.entity ? `/inkop/${item.entity.id}` : null;
      case "pickup": return item.entity ? `/hamtning/${item.entity.id}` : null;
      case "show_result": return item.payload?.object_id ? `/objekt/${item.payload.object_id}` : item.entity?.route ?? null;
      default: return item.entity?.route ?? null;
    }
  })();
  const action = ((): { label: string; onClick: () => void } | null => {
    if ((item.kind === "task" || item.kind === "overdue") && item.entity && can("SetTaskStatus"))
      return { label: "Klar", onClick: () => run("SetTaskStatus", { task_id: item.entity!.id, status: "done" }, { success: "Bra jobbat!" }) };
    if (item.kind === "thank" && item.entity) return { label: "Tacka", onClick: () => nav(`/person/${item.entity!.id}?tacka=1`) };
    if (item.kind === "show_result" && item.entity) return { label: "Visa", onClick: () => nav(`/beratta?mal=show_what_happened&kalla=${item.payload?.object_id}&person=${item.entity!.id}&kanal=private_message`) };
    if (item.kind === "story" && item.entity && can("CreateContent")) return { label: "Berätta", onClick: () => nav(`/beratta?handelse=${item.entity!.id}`) };
    if (item.kind === "long_stored" && item.entity && can("CreateListing")) return { label: "Annonsera", onClick: () => nav(`/annons/ny?objekt=${item.entity!.id}`) };
    if (item.kind === "review") return { label: "Granska", onClick: () => nav("/granska") };
    return null;
  })();
  const urgent = item.kind === "overdue" || item.kind === "review";
  return (
    <Card className={`flex items-center gap-3 !py-3 ${urgent ? "border-l-4 border-l-falu" : ""}`}>
      <Icon size={20} className={urgent ? "text-falu" : "text-sot-3"} aria-hidden />
      <div className="min-w-0 flex-1">
        {target ? <Link to={target} className="font-semibold text-sot">{item.title}</Link> : <span className="font-semibold">{item.title}</span>}
        <div className="truncate text-sm text-sot-3">
          {[item.subtitle, item.kind === "overdue" ? `skulle vara klart ${d(item.due_at)}` : item.kind === "task" && item.due_at ? dt(item.due_at) : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      {action && <button type="button" className={item.kind === "task" || item.kind === "overdue" ? "btn-done btn-small" : "btn-secondary btn-small"} onClick={action.onClick}>{action.label}</button>}
    </Card>
  );
}

function WeatherCard({ w }: { w: any }) {
  const n = w.now;
  const data = n.data ?? {};
  return (
    <Card className="mb-4 flex items-center gap-3">
      <CloudSun size={28} className="text-ockra" aria-hidden />
      <div className="flex-1">
        <div className="font-semibold">{data.temp_c !== undefined ? `${Math.round(data.temp_c)}°` : ""} {data.summary ?? ""}</div>
        <div className="text-sm text-sot-3">{n.kind === "observed" ? "Uppmätt" : "Prognos"} · {n.source}{n.issued_at ? ` · utfärdad ${dt(n.issued_at)}` : ""}</div>
        {(w.signals ?? []).slice(0, 3).map((s: any, i: number) => (
          <div key={i} className="text-sm text-falu">{({ frost: "Frost", heavy_rain: "Kraftigt regn", strong_wind: "Hård vind", heat: "Värme", drought: "Torka" } as any)[s.kind] ?? s.kind} {dt(s.at)}</div>
        ))}
      </div>
    </Card>
  );
}

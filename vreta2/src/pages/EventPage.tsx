// En händelse i historiken: vad, när, var och vilka saker, personer och platser den rör.
import { Link, useNavigate, useParams } from "react-router-dom";
import { PenLine, Star } from "lucide-react";
import { useCan, useCommand, useQuery } from "../app/AppContext";
import { dt } from "../app/format";
import { VISIBILITY } from "../app/labels";
import { Card, ErrorNote, PageHeader, Spinner } from "../ui/base";
import { Gallery } from "../ui/media";

export default function EventPage() {
  const { id } = useParams();
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const { data: e, error, loading } = useQuery<any>("q_event", { id });
  if (loading) return <Spinner />;
  if (error || !e) return <ErrorNote>{error ?? "Händelsen finns inte"}</ErrorNote>;
  return (
    <div>
      <PageHeader kicker={<>Händelse · {VISIBILITY[e.visibility]}</>} title={e.summary} sub={<>{dt(e.occurred_at)}{e.place && <> · <Link to={e.place.route}>{e.place_path ?? e.place.title}</Link></>}</>} />
      {e.note && <p className="mb-3">{e.note}</p>}
      <Gallery media={e.media ?? []} />
      <Card className="my-4">
        <div className="kicker mb-2">Gäller</div>
        <div className="flex flex-wrap gap-2">
          {(e.links ?? []).filter((l: any) => l.role !== "place_ancestor").map((l: any) => l.route
            ? <Link key={l.id + l.role} to={l.route} className="chip no-underline">{l.title} <span className="text-xs text-sot-3">{l.type_label}</span></Link>
            : <span key={l.id + l.role} className="chip">{l.title} <span className="text-xs text-sot-3">{l.type_label}</span></span>)}
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        {can("MarkStoryValue") && <button type="button" className="btn-secondary" onClick={() => run("MarkStoryValue", { history_event_id: e.id, value: !e.story_value })}>
          <Star size={18} fill={e.story_value ? "currentColor" : "none"} className="text-ockra" /> {e.story_value ? "Värt att berätta" : "Markera som värt att berätta"}</button>}
        {can("CreateContent") && <button type="button" className="btn-primary" onClick={() => nav(`/beratta?handelse=${e.id}`)}><PenLine size={18} /> Berätta</button>}
      </div>
      <p className="mt-4 text-sm text-sot-3">Registrerad {dt(e.recorded_at)}.</p>
    </div>
  );
}

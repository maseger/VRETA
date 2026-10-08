// Sidor för typer som saknar egen vy i R2.0 (observation, ögonblick, beslut, vision …): rubrik, typ och tidslinje.
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "../app/AppContext";
import { ErrorNote, PageHeader, Section, Spinner } from "../ui/base";
import { Timeline } from "../ui/timeline";
import { Gallery } from "../ui/media";

export default function EntityPage() {
  const { id } = useParams();
  const { data: e, error, loading } = useQuery<any>("q_entity", { id });
  const { data: journal } = useQuery<any[]>(e ? "q_journal" : null, { entity_id: id, limit: 100 });
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!e) return <Navigate to="/" replace />;
  const media = (journal ?? []).flatMap((j) => j.media ?? []);
  return (
    <div>
      <PageHeader kicker={e.type_label} title={e.title} sub={e.archived ? "Arkiverad" : undefined} />
      <Gallery media={media} />
      <Section title="Tidslinje"><Timeline events={journal ?? []} hideLink={e.id} /></Section>
    </div>
  );
}

// En fångst som inte blivit förslag än (t.ex. sparad offline eller tolkning som misslyckades).
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { dt } from "../app/format";
import { interpretCapture } from "../services/ai";
import { Card, ErrorNote, PageHeader, Spinner } from "../ui/base";
import { Gallery } from "../ui/media";
import { BusyButton, ConfirmButton } from "../ui/sheet";

export default function CaptureDetail() {
  const { id } = useParams();
  const { repo } = useApp();
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const { data: c, error, loading } = useQuery<any>("q_capture", { id });
  if (loading) return <Spinner />;
  if (error || !c) return <ErrorNote>{error ?? "Fångsten finns inte"}</ErrorNote>;
  if (c.proposal_id) return <Navigate to={`/granska/${c.proposal_id}`} replace />;
  return (
    <div>
      <PageHeader kicker="Fångst" title={c.text || c.transcript || "Fångst med bild"} sub={dt(c.client_created_at ?? c.created_at)} />
      <Card className="mb-4">
        {c.transcript && <p className="italic text-sot-2">"{c.transcript}"</p>}
        {c.url && <p><a href={c.url} target="_blank" rel="noreferrer">{c.url}</a></p>}
        <Gallery media={c.media ?? []} />
        {c.error && <div className="mt-2"><ErrorNote>{c.error}</ErrorNote></div>}
      </Card>
      {can("CreateProposal") && (
        <div className="flex flex-wrap gap-2">
          <BusyButton className="btn-primary" onClick={async () => {
            const r = await interpretCapture(repo, c, c.context?.here, c.context?.screen);
            if (r?.proposal_id) nav(`/granska/${r.proposal_id}`, { replace: true });
          }}><Sparkles size={18} /> Tolka nu</BusyButton>
          <ConfirmButton question="Fångsten tas bort ur granskningen. Bilderna finns kvar." confirmLabel="Släng"
            onConfirm={async () => { if (await run("SetCaptureStatus", { capture_id: c.id, status: "discarded" })) nav("/granska"); }}>Släng</ConfirmButton>
        </div>
      )}
    </div>
  );
}

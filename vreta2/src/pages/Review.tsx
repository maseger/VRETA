// Granska: förslag som väntar på beslut, fångster som inte tolkats än och inskick via Bidra.
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { ago, d } from "../app/format";
import { interpretCapture } from "../services/ai";
import { Empty, ErrorNote, List, PageHeader, Row, Section, Spinner, Stamp } from "../ui/base";
import { MediaImg } from "../ui/media";
import { BusyButton } from "../ui/sheet";

const SUBMISSION: Record<string, string> = { have: "Har något", can_help: "Kan hjälpa till", know_where: "Vet var det finns", want_to_come: "Vill komma" };

export default function Review() {
  const { repo } = useApp();
  const can = useCan();
  const run = useCommand();
  const { data, error, loading, reload } = useQuery<{ proposals: any[]; captures: any[]; submissions: any[] }>("q_review_queue");
  return (
    <div>
      <PageHeader kicker="Granska" title="Att granska" sub="Förslag blir fakta först när du godkänt dem." />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && !data.proposals.length && !data.captures.length && !data.submissions.length && <Empty>Inget att granska. Allt är avgjort.</Empty>}
      {data && data.proposals.length > 0 && (
        <Section title={`Förslag · ${data.proposals.length}`}>
          <List>
            {data.proposals.map((p) => (
              <Row key={p.id} to={`/granska/${p.id}`} leading={<div className="h-12 w-12 overflow-hidden rounded-lg bg-kalk-2">{p.capture?.cover && <MediaImg m={p.capture.cover} className="h-full w-full" />}</div>}
                right={p.uncertain > 0 ? <Stamp tone="uncertain">{p.uncertain} osäkra</Stamp> : <Stamp tone="ok">Klart att godkänna</Stamp>}>
                <div className="font-semibold">{p.summary}</div>
                <div className="truncate text-sm text-sot-3">"{p.capture?.text ?? p.capture?.transcript ?? "Bild"}" · {ago(p.created_at)}</div>
              </Row>
            ))}
          </List>
        </Section>
      )}
      {data && data.captures.length > 0 && (
        <Section title="Fångster som inte tolkats">
          <List>
            {data.captures.map((c) => (
              <Row key={c.id} to={`/granska/fangst/${c.id}`}
                right={can("CreateProposal") && <BusyButton className="btn-secondary btn-small" onClick={async () => {
                  const r = await interpretCapture(repo, c);
                  if (r) reload();
                }}><Sparkles size={15} /> Tolka</BusyButton>}>
                <div className="font-semibold">{c.text || c.transcript || c.url || "Fångst med bild"}</div>
                <div className="text-sm text-sot-3">{d(c.created_at)}{c.status === "failed" && <> · <span className="text-falu">Tolkningen misslyckades</span></>}</div>
              </Row>
            ))}
          </List>
        </Section>
      )}
      {data && data.submissions.length > 0 && (
        <Section title="Inskick via Bidra">
          <List>
            {data.submissions.map((s) => (
              <Row key={s.id} right={can("ConvertSubmission") && (
                <div className="flex gap-1">
                  <BusyButton className="btn-done btn-small" onClick={() => run("ConvertSubmission", { submission_id: s.id }, { success: "Personen och bidraget är sparade" })}>Ta emot</BusyButton>
                  <BusyButton className="btn-ghost btn-small" onClick={() => run("ConvertSubmission", { submission_id: s.id, reject: true })}>Avböj</BusyButton>
                </div>
              )}>
                <div className="font-semibold">{s.name} · {SUBMISSION[s.kind] ?? s.kind}</div>
                <div className="text-sm text-sot-2">{s.message}</div>
                <div className="text-sm text-sot-3">{[s.listing?.title, s.need?.title, s.contact].filter(Boolean).join(" · ")} · {ago(s.created_at)}</div>
              </Row>
            ))}
          </List>
        </Section>
      )}
      <p className="mt-6 text-center text-sm text-sot-3"><Link to="/fanga">Fånga något nytt</Link></p>
    </div>
  );
}

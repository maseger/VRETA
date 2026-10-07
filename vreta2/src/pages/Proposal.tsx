// Granska ett förslag: varje kort (sak, person, anskaffning, uppgift …) kan godkännas, ändras eller hoppas över.
// Fält under 70 % säkerhet markeras gula; evidensen ("det du sa") visas vid fältet (Designdokument 2.0, AI-fält).
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, Quote, SkipForward, Sparkles } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { CARD_KIND, ACQUISITION_TYPES, CONDITION, fieldLabel } from "../app/labels";
import { d } from "../app/format";
import { AiBadge, Card, ErrorNote, PageHeader, Spinner, Stamp } from "../ui/base";
import { Gallery } from "../ui/media";
import { TextArea, Toggle } from "../ui/fields";
import { BusyButton, ConfirmButton } from "../ui/sheet";

type Field = { id: string; field: string; value: any; confidence: number; evidence: any[]; decision?: string | null; final_value?: any };
type CardT = { key: string; kind: string; fields: Field[]; match_entity?: any; match_candidates?: { entity_id: string; title: string; shared: string[] }[] | null };
type Decision = { decision: "accept" | "reject"; fields: Record<string, any>; match_entity_id: string | null };

export default function Proposal() {
  const { id } = useParams();
  const { data, error, loading } = useQuery<any>("q_proposal", { id });
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <ErrorNote>Förslaget finns inte.</ErrorNote>;
  return <ProposalView p={data} />;
}

function ProposalView({ p }: { p: any }) {
  const { ctx } = useApp();
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const cards: CardT[] = p.cards ?? [];
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [why, setWhy] = useState("");
  const [storyValue, setStoryValue] = useState(false);
  const [result, setResult] = useState<any>(p.status !== "pending" ? p.result : null);

  useEffect(() => {
    const init: Record<string, Decision> = {};
    for (const c of cards) {
      const fields: Record<string, any> = {};
      let rejected = false;
      for (const f of c.fields) {
        fields[f.field] = f.final_value ?? f.value;
        if (f.decision === "rejected") rejected = true;
      }
      // En stark träff (samma namn) väljs i förväg så att ingen dubblett skapas av misstag – går att ändra
      const strong = (c.match_candidates ?? []).find((m) => m.shared.includes("samma namn"));
      init[c.key] = { decision: rejected ? "reject" : "accept", fields, match_entity_id: c.match_entity?.id ?? strong?.entity_id ?? null };
    }
    setDec(init);
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: string, patch: Partial<Decision>) => setDec((x) => ({ ...x, [key]: { ...x[key], ...patch } }));
  const setField = (key: string, field: string, value: any) => setDec((x) => ({ ...x, [key]: { ...x[key], fields: { ...x[key].fields, [field]: value } } }));
  const payloadCards = () => cards.map((c) => ({ key: c.key, kind: c.kind, decision: dec[c.key]?.decision ?? "accept", fields: dec[c.key]?.fields ?? {}, match_entity_id: dec[c.key]?.match_entity_id ?? null }));
  const accepted = Object.values(dec).filter((x) => x.decision === "accept").length;

  async function approve() {
    const r = await run<any>("ApproveProposal", { proposal_id: p.id, cards: payloadCards(), story: { why: why.trim() || null, story_value: storyValue } },
      { success: "Godkänt – sparat i VRETA" });
    if (r && !r.queued) setResult(r);
    else if (r?.queued) nav("/");
  }
  async function saveDraft() {
    const decisions = cards.flatMap((c) => c.fields.map((f) => ({ key: c.key, field: f.field, value: dec[c.key]?.fields[f.field],
      decision: dec[c.key]?.decision === "reject" ? "rejected" : JSON.stringify(dec[c.key]?.fields[f.field]) !== JSON.stringify(f.value) ? "edited" : "accepted",
      match_entity_id: dec[c.key]?.match_entity_id })));
    await run("SaveProposalDraft", { proposal_id: p.id, decisions }, { success: "Utkastet är sparat" });
  }

  if (result) return <Result p={p} result={result} />;

  const cap = p.capture;
  return (
    <div>
      <PageHeader kicker={<>{p.agent === "local_heuristics" ? "Förslag · lokal tolkning" : `Förslag · ${p.model ?? "Claude"}`}</>} title={p.summary}
        sub={<>Fångat {d(cap?.client_created_at ?? cap?.created_at)} · gäller i 30 dagar</>} />

      <Card className="mb-4">
        <div className="kicker mb-1">Det du fångade</div>
        {cap?.text && <p className="mb-2 font-serif text-lg">"{cap.text}"</p>}
        {cap?.transcript && <p className="mb-2 italic text-sot-2">"{cap.transcript}"</p>}
        {cap?.url && <p className="mb-2"><a href={cap.url} target="_blank" rel="noreferrer">{cap.url}</a></p>}
        <Gallery media={cap?.media ?? []} />
      </Card>

      {cards.map((c) => dec[c.key] && (
        <ProposalCard key={c.key} card={c} d={dec[c.key]} categories={ctx?.categories ?? []}
          onDecision={(v) => set(c.key, { decision: v })} onField={(f, v) => setField(c.key, f, v)} onMatch={(m) => set(c.key, { match_entity_id: m })} />
      ))}

      <Card className="mb-4">
        <TextArea label="Varför sparade vi den? (valfritt)" value={why} onChange={setWhy} rows={2} hint="Blir en berättelseanteckning – det här är guldet när historien ska berättas." />
        <Toggle label="Värt att berätta" checked={storyValue} onChange={setStoryValue} hint="Dyker upp under Idag som förslag att berätta." />
      </Card>

      {can("ApproveProposal") ? (
        <div className="sticky bottom-20 z-10 flex flex-wrap gap-2 rounded-xl bg-kalk/95 py-2 backdrop-blur md:bottom-4">
          <BusyButton className="btn-done flex-1" onClick={approve} disabled={accepted === 0}><Check size={18} /> Godkänn {accepted} av {cards.length}</BusyButton>
          <BusyButton className="btn-secondary" onClick={saveDraft}>Spara utkast</BusyButton>
          <ConfirmButton className="btn-ghost" question="Förslaget avvisas. Fångsten finns kvar och kan tolkas igen." confirmLabel="Avvisa"
            onConfirm={async () => { if (await run("RejectProposal", { proposal_id: p.id }, { success: "Avvisat" })) nav("/granska"); }}>Avvisa</ConfirmButton>
        </div>
      ) : <ErrorNote>Bara ägare och medhjälpare kan godkänna förslag.</ErrorNote>}
    </div>
  );
}

function ProposalCard({ card, d: decision, onDecision, onField, onMatch, categories }: {
  card: CardT; d: Decision; onDecision: (v: "accept" | "reject") => void; onField: (f: string, v: any) => void; onMatch: (id: string | null) => void;
  categories: { code: string; name: string }[];
}) {
  const skipped = decision.decision === "reject";
  const isPerson = card.kind === "person";
  const candidates = card.match_candidates ?? [];
  return (
    <section className={`card mb-3 overflow-hidden ${skipped ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2 border-b border-dashed border-lera px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-lg"><Sparkles size={16} className="text-ockra" /> {CARD_KIND[card.kind] ?? card.kind}</h2>
        <div className="flex gap-1">
          <button type="button" className={`chip ${!skipped ? "chip-on" : ""}`} aria-pressed={!skipped} onClick={() => onDecision("accept")}><Check size={14} /> Ta med</button>
          <button type="button" className={`chip ${skipped ? "chip-on" : ""}`} aria-pressed={skipped} onClick={() => onDecision("reject")}><SkipForward size={14} /> Hoppa över</button>
        </div>
      </div>
      {!skipped && (
        <div className="px-4 py-3">
          {isPerson && candidates.length > 0 && (
            <fieldset className="mb-3">
              <legend className="label">Är det någon du redan känner?</legend>
              <div className="flex flex-col gap-1.5">
                {candidates.map((m) => (
                  <label key={m.entity_id} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${decision.match_entity_id === m.entity_id ? "border-linolja bg-linolja-pale/40" : "border-lera"}`}>
                    <input type="radio" name={`match-${card.key}`} className="mt-1 h-5 w-5 accent-linolja" checked={decision.match_entity_id === m.entity_id} onChange={() => onMatch(m.entity_id)} />
                    <span><span className="font-semibold">Samma som {m.title}</span><span className="block text-sm text-sot-3">{m.shared.join(" · ")}</span></span>
                  </label>
                ))}
                <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${!decision.match_entity_id ? "border-linolja bg-linolja-pale/40" : "border-lera"}`}>
                  <input type="radio" name={`match-${card.key}`} className="h-5 w-5 accent-linolja" checked={!decision.match_entity_id} onChange={() => onMatch(null)} />
                  <span className="font-semibold">Ny person</span>
                </label>
              </div>
            </fieldset>
          )}
          {(!isPerson || !decision.match_entity_id) && card.fields.map((f) => (
            <AiField key={f.id} f={f} value={decision.fields[f.field]} onChange={(v) => onField(f.field, v)} categories={categories} />
          ))}
        </div>
      )}
    </section>
  );
}

function AiField({ f, value, onChange, categories }: { f: Field; value: any; onChange: (v: any) => void; categories: { code: string; name: string }[] }) {
  const unsure = f.confidence < 0.7;
  const edited = JSON.stringify(value) !== JSON.stringify(f.value);
  const id = `f-${f.id}`;
  const input = useMemo(() => {
    if (f.field === "category") {
      return <select id={id} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Ingen kategori</option>{categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>;
    }
    if (f.field === "type" && typeof f.value === "string" && ACQUISITION_TYPES[f.value]) {
      return <select id={id} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(ACQUISITION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>;
    }
    if (f.field === "condition") {
      return <select id={id} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Okänt</option>{Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>;
    }
    if (typeof f.value === "boolean") return <input id={id} type="checkbox" className="h-5 w-5 accent-falu" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    if (typeof f.value === "number") return <input id={id} className="input" type="number" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    if (f.field === "due_at" || f.field === "occurred_at") return <input id={id} className="input" type="date" value={String(value ?? "").slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;
    if (Array.isArray(f.value)) return <input id={id} className="input" value={(value ?? []).join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />;
    return <input id={id} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }, [f, value, onChange, categories, id]);
  const excerpts = (f.evidence ?? []).filter((e) => e.excerpt || e.entity);
  return (
    <div className={`mb-3 p-2 ${edited ? "rounded-lg border border-linolja/50" : `ai-field ${unsure ? "ai-uncertain" : ""}`}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-sot-2">{fieldLabel(f.field)}</label>
        {edited ? <Stamp tone="ok">Ändrat av dig</Stamp> : <AiBadge confidence={f.confidence} />}
      </div>
      {input}
      {excerpts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-sot-3">
          {excerpts.map((e, i) => (
            <span key={i} className="inline-flex items-center gap-1"><Quote size={12} aria-hidden />
              {e.excerpt ? <>"{e.excerpt}"</> : e.entity ? <Link to={e.entity.route ?? "#"}>{e.entity.title}</Link> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Result({ p, result }: { p: any; result: any }) {
  const links: { to: string; label: string }[] = [];
  if (result.object_id) links.push({ to: `/objekt/${result.object_id}`, label: "Öppna saken" });
  if (result.acquisition_id) links.push({ to: `/inkop/${result.acquisition_id}`, label: "Anskaffningen" });
  if (result.person_id) links.push({ to: `/person/${result.person_id}`, label: "Personen" });
  if (result.project_id) links.push({ to: `/projekt/${result.project_id}`, label: "Projektet" });
  if (result.history_event_id) links.push({ to: `/handelse/${result.history_event_id}`, label: "Händelsen" });
  for (const o of result.other ?? []) {
    if (o.observation_id) links.push({ to: `/observation/${o.observation_id}`, label: "Observationen" });
    if (o.moment_id) links.push({ to: `/moment/${o.moment_id}`, label: "Ögonblicket" });
  }
  return (
    <div>
      <PageHeader kicker="Klart" title={p.summary} sub={p.status === "rejected" ? "Förslaget avvisades." : "Godkänt och sparat i VRETA."} />
      <div className="flex flex-col gap-2">
        {links.map((l) => <Link key={l.to} to={l.to} className="btn-secondary justify-start">{l.label}</Link>)}
        <Link to="/fanga" className="btn-primary">Fånga något mer</Link>
        <Link to="/granska" className="btn-ghost">Tillbaka till Granska</Link>
      </div>
    </div>
  );
}

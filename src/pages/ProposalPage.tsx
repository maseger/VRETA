import { Check, Loader2, Trash2, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { ACQUISITION_LABEL, CATEGORIES } from "../domain/labels";
import type { AcquisitionType, FieldMeta, Proposal } from "../domain/types";
import { MediaImage, PageHeader } from "../ui/bits";
import { ProposalLinksCard, initialChoice } from "../ui/ProposalLinksCard";
import { SuggestedField } from "../ui/SuggestedField";
import { applyLinks, type LinkChoice } from "../services/proposalLinks";

interface F {
  value: string;
  confidence: number;
  edited: boolean;
  included: boolean;
}

type Fields = Record<string, F>;

const f = (value: unknown, confidence: number): F => ({
  value: value === null || value === undefined ? "" : String(value),
  confidence,
  edited: false,
  included: true,
});

function initialFields(p: Proposal): Fields {
  const c = p.content;
  const o = c.object;
  const out: Fields = {
    title: f(o?.title.value ?? "", o?.title.confidence ?? 0),
    category: f(o?.category.value || "Övrigt", o?.category.confidence ?? 0),
    quantity: f(o?.quantity.value ?? 1, o?.quantity.confidence ?? 0),
    unit: f(o?.unit.value || "st", o?.unit.confidence ?? 0),
    material: f(o?.material.value ?? "", o?.material.confidence ?? 0),
    dimensions: f(o?.dimensions.value ?? "", o?.dimensions.confidence ?? 0),
    condition: f(o?.condition.value ?? "", o?.condition.confidence ?? 0),
    description: f(o?.description.value ?? "", o?.description.confidence ?? 0),
    why: f(c.why.value, c.why.confidence),
  };
  if (c.person) {
    out.person_name = f(c.person.name.value, c.person.name.confidence);
    out.person_locality = f(c.person.locality.value, c.person.locality.confidence);
  }
  if (c.acquisition) {
    out.acq_type = f(c.acquisition.type.value, c.acquisition.type.confidence);
    out.acq_price = f(c.acquisition.price.value, c.acquisition.price.confidence);
    out.acq_deadline = f(c.acquisition.deadline.value, c.acquisition.deadline.confidence);
  }
  if (c.task) {
    out.task_title = f(c.task.title.value, c.task.title.confidence);
    out.task_due = f(c.task.due.value, c.task.due.confidence);
  }
  // Tomma fält utan förslag visas utan AI-markering
  for (const k of Object.keys(out)) if (!out[k].value) out[k].confidence = 0;
  return out;
}

export function ProposalPage() {
  const { id } = useParams();
  const { repo, refresh, profile, toast } = useApp();
  const navigate = useNavigate();
  const { data } = useData(async (r) => {
    const p = await r.proposal(id!);
    if (!p) return null;
    const [capture, media, people, places, projects, needs] = await Promise.all([
      r.capture(p.capture_id), r.mediaFor("capture", p.capture_id), r.persons(), r.externalPlaces(), r.projects(), r.needs(),
    ]);
    return { p, capture, media, people, places, projects, needs };
  }, [id]);

  const [fields, setFields] = useState<Fields | null>(null);
  const [usePerson, setUsePerson] = useState(true);
  const [useAcq, setUseAcq] = useState(true);
  const [useTask, setUseTask] = useState(true);
  const [useExisting, setUseExisting] = useState(true);
  const [links, setLinks] = useState<LinkChoice>(initialChoice(undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.p) {
      setFields(initialFields(data.p));
      setLinks(initialChoice(data.p.content.links));
    }
  }, [data?.p]);

  const existing = useMemo(
    () => data?.people.find((p) => p.id === data.p.content.person?.existing_person_id) ?? null,
    [data],
  );

  if (data === null) return <p>Förslaget finns inte längre.</p>;
  if (!data || !fields) return <Loader2 className="mx-auto mt-20 animate-spin text-sot-3" />;
  const { p, capture, media } = data;

  const set = (k: string, value: string) => setFields((fs) => ({ ...fs!, [k]: { ...fs![k], value, edited: true } }));
  const toggle = (k: string) => setFields((fs) => ({ ...fs!, [k]: { ...fs![k], included: !fs![k].included } }));
  const field = (k: string, label: string, extra: Partial<Parameters<typeof SuggestedField>[0]> = {}) =>
    fields[k] && <SuggestedField label={label} {...fields[k]} onChange={(v) => set(k, v)} onToggle={() => toggle(k)} {...extra} />;
  const val = (k: string) => (fields[k]?.included ? fields[k].value.trim() : "");

  async function approve() {
    if (!fields || !val("title")) {
      setError("Objektet behöver en benämning.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta: Record<string, FieldMeta> = {};
      for (const [k, v] of Object.entries(fields)) if (v.included && v.value) meta[k] = { confidence: v.confidence, verified: true };
      const anyExcluded = Object.values(fields).some((v) => !v.included && v.value) || (!!p.content.person && !usePerson) || (!!p.content.acquisition && !useAcq) || (!!p.content.task && !useTask);
      const objectId = await repo.approveProposal({
        proposal_id: p.id,
        partial: anyExcluded,
        object: {
          title: val("title"), category: val("category") || "Övrigt", description: val("description"), material: val("material"),
          dimensions: val("dimensions"), quantity: Number(val("quantity")) || 1, unit: val("unit") || "st",
          condition: val("condition") ? Math.min(5, Math.max(1, Number(val("condition")))) : null, field_meta: meta,
        },
        person: p.content.person && usePerson && (val("person_name") || existing)
          ? { name: val("person_name"), locality: val("person_locality"), existing_person_id: useExisting ? existing?.id ?? null : null }
          : null,
        acquisition: p.content.acquisition && useAcq
          ? { type: (val("acq_type") || "purchase") as AcquisitionType, price: val("acq_price") ? Number(val("acq_price")) : null, deadline: val("acq_deadline") || null }
          : null,
        task: p.content.task && useTask && val("task_title") ? { title: val("task_title"), due: val("task_due") || null } : null,
        why: val("why"),
        media_ids: media.map((m) => m.id),
      });
      // Saken är sparad; misslyckas en koppling kan den göras för hand på objektsidan
      const done = await applyLinks(repo, objectId, { ...links, introduced_by: usePerson ? links.introduced_by : null }).catch(() => ["Kopplingarna kunde inte göras – lägg till dem på objektsidan"]);
      await refresh();
      if (done.length) toast(done.join(" · "));
      navigate(`/objekt/${objectId}?ny=1`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function reject() {
    await repo.rejectProposal(p.id);
    await refresh();
    navigate("/granska", { replace: true });
  }

  const showPrice = profile?.role === "owner" || p.created_by === profile?.id;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader kicker={p.content.agent === "claude" ? "Förslag från AI" : "Förslag från enkel tolkning"} title="Stämmer det här?" />

      {(media.length > 0 || capture?.input.text) && (
        <div className="card mb-6 overflow-hidden">
          {media.length > 0 && (
            <div className="scroll-snap-x flex gap-1 overflow-x-auto">
              {media.map((m) => <MediaImage key={m.id} media={m} className="aspect-[4/3] w-full min-w-full sm:min-w-[60%]" />)}
            </div>
          )}
          {capture?.input.text && <p className="px-4 py-3 italic text-sot-2">”{capture.input.text}”</p>}
        </div>
      )}
      {p.content.agent === "local" && (
        <p className="mb-6 rounded-md border border-dashed border-ockra px-4 py-3 text-sm text-sot-2">
          AI kunde inte nås, så fälten kommer från en enkel tolkning av texten. Kontrollera dem extra noga.
        </p>
      )}

      <section className="card mb-4 space-y-4 p-4">
        <h2>Objekt</h2>
        {field("title", "Benämning")}
        <div className="grid grid-cols-2 gap-3">
          {field("quantity", "Antal", { type: "number" })}
          {field("unit", "Enhet")}
        </div>
        {field("category", "Kategori", { options: CATEGORIES.map((c) => ({ value: c, label: c })) })}
        <div className="grid grid-cols-2 gap-3">
          {field("material", "Material")}
          {field("condition", "Skick 1–5", { type: "number" })}
        </div>
        {field("dimensions", "Mått")}
        {field("description", "Beskrivning", { multiline: true })}
      </section>

      {p.content.person && (
        <section className={`card mb-4 space-y-4 p-4 ${usePerson ? "" : "opacity-50"}`}>
          <div className="flex items-center justify-between">
            <h2>Person</h2>
            <EntityToggle on={usePerson} onChange={setUsePerson} />
          </div>
          {usePerson && existing && (
            <label className="flex items-center gap-3 rounded-md bg-linolja-pale/60 px-3 py-2.5 text-sm">
              <input type="checkbox" checked={useExisting} onChange={(e) => setUseExisting(e.target.checked)} className="h-5 w-5 accent-[#4F5E3A]" />
              <UserCheck size={18} className="text-linolja" aria-hidden="true" />
              <span>
                Samma som <strong>{existing.name}</strong>
                {existing.locality ? ` (${existing.locality})` : ""} som redan finns?
              </span>
            </label>
          )}
          {usePerson && !(existing && useExisting) && (
            <>
              {field("person_name", "Namn")}
              {field("person_locality", "Ort")}
            </>
          )}
        </section>
      )}

      {p.content.acquisition && (
        <section className={`card mb-4 space-y-4 p-4 ${useAcq ? "" : "opacity-50"}`}>
          <div className="flex items-center justify-between">
            <h2>Anskaffning</h2>
            <EntityToggle on={useAcq} onChange={setUseAcq} />
          </div>
          {useAcq && (
            <>
              {field("acq_type", "Typ", { options: Object.entries(ACQUISITION_LABEL).map(([value, label]) => ({ value, label })) })}
              <div className="grid grid-cols-2 gap-3">
                {showPrice && field("acq_price", "Pris (kr, privat)", { type: "number" })}
                {field("acq_deadline", "Hämtas senast", { type: "date" })}
              </div>
            </>
          )}
        </section>
      )}

      {p.content.task && (
        <section className={`card mb-4 space-y-4 p-4 ${useTask ? "" : "opacity-50"}`}>
          <div className="flex items-center justify-between">
            <h2>Uppgift</h2>
            <EntityToggle on={useTask} onChange={setUseTask} />
          </div>
          {useTask && (
            <>
              {field("task_title", "Att göra")}
              {field("task_due", "Senast", { type: "date" })}
            </>
          )}
        </section>
      )}

      {p.content.links && (
        <ProposalLinksCard links={p.content.links} choice={links} onChange={setLinks} places={data.places} projects={data.projects} needs={data.needs} people={data.people}
          hasSeller={!!p.content.person && usePerson && !!p.content.acquisition && useAcq} />
      )}

      <section className="card mb-8 space-y-4 p-4">
        <h2>Berättelsen</h2>
        {field("why", "Varför är det här intressant?", { multiline: true })}
        <p className="text-[12px] text-sot-3">En mening räcker. Den blir råmaterial när du vill berätta om fyndet.</p>
      </section>

      {error && <p className="mb-4 text-sm text-falu">{error}</p>}
      <div className="sticky bottom-24 z-10 flex gap-3 md:bottom-6">
        <button type="button" onClick={reject} className="btn-secondary bg-kalk" disabled={busy}>
          <Trash2 size={18} aria-hidden="true" /> Släng
        </button>
        <button type="button" onClick={approve} className="btn-moss flex-1 text-base" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" size={18} /> : <Check size={20} aria-hidden="true" />} Godkänn
        </button>
      </div>
    </div>
  );
}

function EntityToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="text-sm font-semibold text-sot-3 underline-offset-2 hover:underline">
      {on ? "Ta inte med" : "Ta med"}
    </button>
  );
}

// En sak eller ett parti: var den finns, var den kommer ifrån, vad den blev och vem som var med.
// Partier visas som fördelning ("250 i bruk · 120 i lager · 30 sålda"); varje del kan flyttas och användas för sig.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRightLeft, Camera, Hammer, Megaphone, MoreHorizontal, PenLine, Pencil, Sprout } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { ACQUISITION_TYPES, CONDITION, DISPOSAL_TYPES, HEALTH, USAGE_TYPES, VISIBILITY } from "../app/labels";
import { d, kr, num } from "../app/format";
import { AllocationBar, Card, Empty, ErrorNote, Kv, PageHeader, RefLink, Section, Spinner, Stamp, VisibilityIcon, statusTone } from "../ui/base";
import { Gallery, PhotoPicker, useUpload } from "../ui/media";
import { NumberField, PersonPicker, PlacePicker, ProjectPicker, Select, TextArea, TextField, numOrNull, strOrNull, type PersonChoice } from "../ui/fields";
import { BusyButton, ConfirmButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";
import { SuggestionNote, type Rejection } from "../ui/suggestion";

type Alloc = { id: string; status: string; status_label: string; quantity: number; place?: any; place_path?: string | null; project?: any; next: { to: string; label: string; note?: string }[] };
type SheetKind = null | { kind: "move" | "use" | "status" | "dispose" | "dismantle" | "edit" | "photo" | "note" | "private" | "task"; alloc?: Alloc | null; to?: string };

export default function ObjectPage() {
  const { id } = useParams();
  const { data: o, error, loading } = useQuery<any>("q_object", { id });
  useScreen(o ? { id: o.id, type: "object", title: o.label } : null);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!o) return <ErrorNote>Saken finns inte eller syns inte för dig.</ErrorNote>;
  return <ObjectView o={o} />;
}

function ObjectView({ o }: { o: any }) {
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const close = () => setSheet(null);
  const isBatch = !!o.batch;
  const allocs: Alloc[] = o.allocations ?? [];
  const parts = useMemo(() => {
    const m = new Map<string, { status: string; label: string; quantity: number }>();
    for (const a of allocs) {
      const x = m.get(a.status) ?? { status: a.status, label: a.status_label, quantity: 0 };
      x.quantity += Number(a.quantity);
      m.set(a.status, x);
    }
    return [...m.values()];
  }, [allocs]);
  const closed = ["sold", "donated", "exchanged", "discarded", "declined", "lost"].includes(o.status);

  return (
    <div>
      <PageHeader kicker={<>{o.category?.name ?? "Sak"} · <VisibilityIcon v={o.visibility} withLabel /></>} title={o.label}
        sub={<span className="flex flex-wrap items-center gap-2"><Stamp tone={statusTone(o.group, o.status)}>{o.status_label}</Stamp>
          {o.place_path && <span>{o.place?.route ? <Link to={o.place.route}>{o.place_path}</Link> : o.place_path}</span>}
          {o.health_status && <Stamp tone={o.health_status === "struggling" ? "warn" : "ok"}>{HEALTH[o.health_status]}</Stamp>}
          {o.source_type === "ai_capture" && <Stamp tone="inspiration">Från fångst</Stamp>}</span>} />

      <Gallery media={o.media ?? []} />

      {!closed && (
        <div className="my-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {can("MoveObject") && <ActionTile icon={ArrowRightLeft} label="Flytta" onClick={() => setSheet({ kind: "move" })} />}
          {can("UseObject") && <ActionTile icon={o.living_material ? Sprout : Hammer} label={o.living_material ? "Plantera" : "Använd"} onClick={() => setSheet({ kind: "use" })} />}
          {can("CreateListing") && <ActionTile icon={Megaphone} label="Annonsera" onClick={() => nav(`/annons/ny?objekt=${o.id}`)} />}
          {can("CreateContent") && <ActionTile icon={PenLine} label="Berätta" onClick={() => nav(`/beratta?kalla=${o.id}`)} />}
          {can("LinkMedia") && <ActionTile icon={Camera} label="Foto" onClick={() => setSheet({ kind: "photo" })} />}
          {can("ChangeObjectStatus") && <ActionTile icon={MoreHorizontal} label="Mer" onClick={() => setSheet({ kind: "status" })} />}
        </div>
      )}

      {isBatch && parts.length > 0 && (
        <Section title={`Partiet · ${num(o.batch.total_quantity)} ${o.batch.unit}`}>
          <Card>
            <AllocationBar parts={parts} />
            <ul className="mt-3 divide-y divide-dashed divide-lera">
              {allocs.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{num(a.quantity)} {o.batch.unit} · {a.status_label.toLowerCase()}</div>
                    <div className="text-sm text-sot-3">{[a.place_path, a.project?.title].filter(Boolean).join(" · ")}</div>
                  </div>
                  {!["sold", "donated", "exchanged", "discarded"].includes(a.status) && (
                    <div className="flex gap-1">
                      {can("MoveObject") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet({ kind: "move", alloc: a })}>Flytta</button>}
                      {can("UseObject") && a.status !== "in_use" && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet({ kind: "use", alloc: a })}>Använd</button>}
                      {can("ChangeObjectStatus") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet({ kind: "status", alloc: a })}>Status</button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      <Section title="Fakta" action={can("UpdateFields") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet({ kind: "edit" })}><Pencil size={15} /> Ändra</button>}>
        <Card>
          {o.description && <p className="mb-2">{o.description}</p>}
          <dl className="divide-y divide-dashed divide-lera">
            <Kv k="Material">{o.material}</Kv>
            <Kv k="Mått">{o.dimensions}</Kv>
            <Kv k="Vikt">{o.weight_kg ? `${num(o.weight_kg)} kg${isBatch ? "/st" : ""}` : null}</Kv>
            <Kv k="Ålder">{o.age_period}</Kv>
            <Kv k="Skick">{o.condition ? CONDITION[String(o.condition)] : null}</Kv>
            <Kv k="Art/sort">{o.species_variety}</Kv>
            <Kv k="Projekt"><RefLink r={o.project} /></Kv>
            <Kv k="Kategori">{o.category?.name}</Kv>
            <Kv k="Synlighet">{VISIBILITY[o.visibility]}</Kv>
            {o.private && <Kv k="Uppskattat värde (privat)">{kr(o.private.estimated_value)}</Kv>}
          </dl>
          {can("SetObjectPrivate") && <button type="button" className="btn-ghost btn-small mt-2" onClick={() => setSheet({ kind: "private" })}>Privat värde och anteckning</button>}
        </Card>
      </Section>

      <Section title="Varför den är här" action={can("AddStoryNote") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet({ kind: "note" })}>+ Anteckning</button>}>
        {(o.story_notes ?? []).length === 0 && !o.story_why ? <Empty>Ingen berättelse än. Varför sparade vi den?</Empty> : (
          <Card>
            {(o.story_notes ?? []).map((n: any) => (
              <blockquote key={n.id} className="mb-2 border-l-4 border-ockra-light pl-3 font-serif text-lg">
                {n.text}{n.person && <span className="block font-sans text-sm text-sot-3">– <RefLink r={{ title: n.person.display_name, route: `/person/${n.person.id}` }} />{n.kind === "quote" && !n.quote_consent && " (citatet får inte delas)"}</span>}
              </blockquote>
            ))}
          </Card>
        )}
      </Section>

      {(o.acquisitions ?? []).length > 0 && (
        <Section title="Ursprung">
          <div className="flex flex-col gap-2">
            {o.acquisitions.map((a: any) => (
              <Card key={a.id} className="!py-3">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/inkop/${a.id}`} className="font-semibold">{ACQUISITION_TYPES[a.type]}{a.counterpart && <> från {a.counterpart.display_name}</>}</Link>
                  <Stamp tone={statusTone(null, a.status)}>{a.status_label}</Stamp>
                </div>
                <div className="text-sm text-sot-3">{[a.counterpart?.locality, a.price ? kr(a.price) : null, a.payment_method, a.received_at ? `mottagen ${d(a.received_at)}` : null,
                  a.tipster ? `tips från ${a.tipster.title ?? a.tipster.display_name}` : null].filter(Boolean).join(" · ")}</div>
              </Card>
            ))}
            {(o.pickups ?? []).map((p: any) => (
              <Link key={p.id} to={`/hamtning/${p.id}`} className="card block px-4 py-3 text-sot no-underline">
                <span className="font-semibold">{p.title}</span> <span className="text-sm text-sot-3">· {d(p.scheduled_on)} · {p.receipt_status === "received" ? "mottagen" : p.receipt_status ?? p.status}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {(o.usage ?? []).length > 0 && (
        <Section title="Nytt liv">
          <Card>
            <ul className="divide-y divide-dashed divide-lera">
              {o.usage.map((u: any) => (
                <li key={u.id} className="py-2">
                  <div className="font-semibold">{USAGE_TYPES[u.type] ?? u.type}{u.quantity ? ` · ${num(u.quantity)} ${o.batch?.unit ?? "st"}` : ""} {u.place_path && <>i <RefLink r={{ title: u.place_path, route: u.place?.route }} /></>}</div>
                  <div className="text-sm text-sot-3">{d(u.occurred_at)}{u.project && <> · <RefLink r={u.project} /></>}{u.note && <> · {u.note}</>}</div>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {((o.listings ?? []).length > 0 || (o.disposals ?? []).length > 0) && (
        <Section title="Vidare">
          <div className="flex flex-col gap-2">
            {(o.listings ?? []).map((l: any) => (
              <Link key={l.id} to={`/annons/${l.id}`} className="card flex items-center justify-between px-4 py-3 text-sot no-underline">
                <span><span className="font-semibold">{l.title}</span><span className="block text-sm text-sot-3">{l.price ? kr(l.price) : ""}{l.leads ? ` · ${l.leads} intresserade` : ""}</span></span>
                <Stamp tone={statusTone(null, l.status)}>{l.status_label}</Stamp>
              </Link>
            ))}
            {(o.disposals ?? []).map((x: any) => (
              <Card key={x.id} className="!py-3"><span className="font-semibold">{DISPOSAL_TYPES[x.type]}</span>
                <span className="text-sm text-sot-3"> · {d(x.occurred_at)}{x.quantity ? ` · ${num(x.quantity)} st` : ""}{x.counterpart ? ` · ${x.counterpart.display_name}` : ""}</span></Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Att göra" action={can("CreateTask") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet({ kind: "task" })}>+ Uppgift</button>}>
        {(o.open_tasks ?? []).length === 0 ? <p className="text-sot-3">Inget att göra.</p> : (
          <ul className="card divide-y divide-dashed divide-lera">
            {o.open_tasks.map((t: any) => <li key={t.id} className="px-4 py-2.5"><Link to={`/uppgift/${t.id}`}>{t.title}</Link>{t.due_at && <span className="text-sm text-sot-3"> · {d(t.due_at)}</span>}</li>)}
          </ul>
        )}
      </Section>

      <Section title="Tidslinje"><Timeline events={o.timeline ?? []} hideLink={o.id} /></Section>

      {can("ArchiveEntity") && (
        <div className="mt-6 flex justify-end">
          <ConfirmButton className="btn-ghost btn-small" question="Saken arkiveras. Historiken finns kvar och den kan återställas." confirmLabel="Arkivera"
            onConfirm={async () => { if (await run("ArchiveEntity", { id: o.id }, { success: "Arkiverad" })) nav("/saker"); }}>Arkivera</ConfirmButton>
        </div>
      )}

      <MoveSheet open={sheet?.kind === "move"} onClose={close} object={o} alloc={sheet?.alloc ?? null} />
      <UseSheet open={sheet?.kind === "use"} onClose={close} object={o} alloc={sheet?.alloc ?? null} />
      <StatusSheet open={sheet?.kind === "status"} onClose={close} object={o} alloc={sheet?.alloc ?? null} onFlow={(k, a) => setSheet({ kind: k, alloc: a })} />
      <DisposeSheet open={sheet?.kind === "dispose"} onClose={close} object={o} alloc={sheet?.alloc ?? null} />
      <DismantleSheet open={sheet?.kind === "dismantle"} onClose={close} object={o} alloc={sheet?.alloc ?? null} />
      <EditSheet open={sheet?.kind === "edit"} onClose={close} object={o} />
      <PhotoSheet open={sheet?.kind === "photo"} onClose={close} entityId={o.id} />
      <NoteSheet open={sheet?.kind === "note"} onClose={close} entityId={o.id} />
      <PrivateSheet open={sheet?.kind === "private"} onClose={close} object={o} />
      <TaskSheet open={sheet?.kind === "task"} onClose={close} subjectId={o.id} />
    </div>
  );
}

function ActionTile({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="card flex min-h-[68px] flex-col items-center justify-center gap-1 px-1 text-sm font-semibold text-sot hover:border-lera">
      <Icon size={22} className="text-falu" aria-hidden />{label}
    </button>
  );
}

function AllocChoice({ object, alloc, onChange, filter }: { object: any; alloc: string; onChange: (v: string) => void; filter?: (a: Alloc) => boolean }) {
  const options = (object.allocations ?? []).filter((a: Alloc) => !["sold", "donated", "exchanged", "discarded"].includes(a.status) && (!filter || filter(a)))
    .map((a: Alloc) => ({ value: a.id, label: `${num(a.quantity)} ${object.batch?.unit ?? "st"} · ${a.status_label.toLowerCase()}${a.place_path ? ` · ${a.place_path}` : ""}` }));
  if (!object.batch || options.length < 2) return null;
  return <Select label="Vilken del av partiet?" value={alloc} onChange={onChange} options={options} empty="Låt VRETA välja" />;
}

export function MoveSheet({ open, onClose, object, alloc }: { open: boolean; onClose: () => void; object: any; alloc: Alloc | null }) {
  const run = useCommand();
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [allocId, setAllocId] = useState(alloc?.id ?? "");
  const [rej, setRej] = useState<Rejection | null>(null);
  const current = (object.allocations ?? []).find((a: Alloc) => a.id === (allocId || alloc?.id));
  const submit = async (patch: Record<string, unknown> = {}) => {
    setRej(null);
    const r = await run("MoveObject", { object_id: object.id, to_place_id: to, allocation_id: allocId || alloc?.id || null, quantity: numOrNull(qty), ...patch },
      { success: "Flyttad", silent: true, onRejected: setRej });
    if (r) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Flytta ${object.title.toLowerCase()}`}
      footer={<BusyButton disabled={!to} onClick={() => submit()}>Flytta</BusyButton>}>
      <AllocChoice object={object} alloc={allocId} onChange={setAllocId} />
      <PlacePicker label="Till" value={to} onChange={setTo} />
      {object.batch && <NumberField label="Hur många?" value={qty} onChange={setQty} unit={object.batch.unit} hint={current ? `Högst ${num(current.quantity)} härifrån. Tomt = alla.` : "Tomt = hela delen."} />}
      {rej && <SuggestionNote r={rej} onRetry={submit} />}
    </Sheet>
  );
}

function UseSheet({ open, onClose, object, alloc }: { open: boolean; onClose: () => void; object: any; alloc: Alloc | null }) {
  const run = useCommand();
  const [type, setType] = useState(object.living_material ? "planted" : "mounted");
  const [place, setPlace] = useState("");
  const [project, setProject] = useState(object.project?.id ?? "");
  const [need, setNeed] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [allocId, setAllocId] = useState(alloc?.id ?? "");
  const [rej, setRej] = useState<Rejection | null>(null);
  const { data: proj } = useQuery<any>(project ? "q_project" : null, { id: project });
  const submit = async (patch: Record<string, unknown> = {}) => {
    setRej(null);
    const r = await run("UseObject", { object_id: object.id, type, place_id: place || null, project_id: project || null, need_id: need || null,
      quantity: numOrNull(qty), note: strOrNull(note), allocation_id: allocId || alloc?.id || null, ...patch },
      { success: "Sparat – saken har fått nytt liv", silent: true, onRejected: setRej });
    if (r) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={object.living_material ? "Plantera" : "Ge den nytt liv"}
      footer={<BusyButton disabled={!place && !project} onClick={() => submit()}>Spara</BusyButton>}>
      <Select label="Hur?" value={type} onChange={setType} options={Object.entries(USAGE_TYPES).filter(([k]) => !["moved", "dismantled"].includes(k)).map(([value, label]) => ({ value, label }))} />
      <AllocChoice object={object} alloc={allocId} onChange={setAllocId} filter={(a) => a.status !== "in_use"} />
      <PlacePicker label="Var?" value={place} onChange={setPlace} storage={false} />
      <ProjectPicker label="I vilket projekt?" value={project} onChange={(v) => { setProject(v); setNeed(""); }} />
      {proj?.needs?.length > 0 && <Select label="Räknas mot behov" value={need} onChange={setNeed} empty="Inget behov"
        options={proj.needs.filter((n: any) => !n.met).map((n: any) => ({ value: n.id, label: `${n.title} (${n.progress})` }))} />}
      {object.batch && <NumberField label="Hur många?" value={qty} onChange={setQty} unit={object.batch.unit} hint="Tomt = hela delen." />}
      <TextField label="Anteckning" value={note} onChange={setNote} />
      {rej && <SuggestionNote r={rej} onRetry={submit} />}
    </Sheet>
  );
}

function StatusSheet({ open, onClose, object, alloc, onFlow }: { open: boolean; onClose: () => void; object: any; alloc: Alloc | null; onFlow: (k: "use" | "dispose" | "dismantle", a: Alloc | null) => void }) {
  const run = useCommand();
  const nav = useNavigate();
  const { ctx } = useApp();
  const [note, setNote] = useState("");
  const next: { to: string; label: string; note?: string }[] = alloc?.next ?? object.next ?? [];
  const current = alloc?.status ?? object.status;
  return (
    <Sheet open={open} onClose={onClose} title="Vad har hänt?">
      <p className="mb-3 text-sot-3">Nu: {alloc?.status_label ?? object.status_label}{alloc ? ` (${num(alloc.quantity)} ${object.batch?.unit ?? "st"})` : ""}</p>
      <div className="flex flex-col gap-2">
        {current === "in_use" && <button type="button" className="btn-secondary justify-start" onClick={() => onFlow("dismantle", alloc)}>Demonterad – tillbaka till lagret</button>}
        {next.filter((n) => n.to !== current || n.note).map((n) => {
          const flow = n.to === "in_use" ? "use" : ["sold", "donated", "exchanged", "lent"].includes(n.to) ? "dispose" : n.to === "listed" ? "listing" : n.to === "collected" ? "pickup" : null;
          return (
            <BusyButton key={n.to + (n.note ?? "")} className="btn-secondary justify-start" onClick={async () => {
              if (flow === "use" || flow === "dispose") return onFlow(flow, alloc);
              if (flow === "listing") { onClose(); return nav(`/annons/ny?objekt=${object.id}`); }
              if (flow === "pickup") { onClose(); const a = object.acquisitions?.[0]; return nav(a ? `/inkop/${a.id}` : `/objekt/${object.id}`); }
              const r = await run("ChangeObjectStatus", { object_id: object.id, status: n.to, allocation_id: alloc?.id ?? null, note: strOrNull(note) }, { success: `Nu: ${n.label.toLowerCase()}` });
              if (r) onClose();
            }}>{n.label}{n.note ? <span className="font-normal text-sot-3"> – {n.note}</span> : null}</BusyButton>
          );
        })}
      </div>
      <div className="mt-3"><TextField label="Anteckning (valfritt)" value={note} onChange={setNote} /></div>
      {ctx?.role === "owner" && <p className="text-sm text-sot-3">Saknas ett steg? Ägaren kan göra undantag – VRETA frågar efter skälet om det behövs.</p>}
    </Sheet>
  );
}

function DisposeSheet({ open, onClose, object, alloc }: { open: boolean; onClose: () => void; object: any; alloc: Alloc | null }) {
  const run = useCommand();
  const [type, setType] = useState("donated");
  const [who, setWho] = useState<PersonChoice | null>(null);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Den lämnar Vreta"
      footer={<BusyButton onClick={async () => {
        const r = await run("CompleteDisposal", { object_id: object.id, type, allocation_id: alloc?.id ?? null, quantity: numOrNull(qty),
          counterpart_person_id: who?.id ?? null, counterpart_name: who && !who.id ? who.name : null, price: type === "sold" ? numOrNull(price) : null },
          { success: "Sparat. Tack för att den fick ett nytt hem!" });
        if (r) onClose();
      }}>Spara</BusyButton>}>
      <Select label="Hur?" value={type} onChange={setType} options={Object.entries(DISPOSAL_TYPES).map(([value, label]) => ({ value, label }))} />
      {type !== "discarded" && <PersonPicker label="Till vem?" value={who} onChange={setWho} />}
      {type === "sold" && <NumberField label="Pris" value={price} onChange={setPrice} unit="kr" hint="Priset är privat." />}
      {object.batch && <NumberField label="Hur många?" value={qty} onChange={setQty} unit={object.batch.unit} />}
    </Sheet>
  );
}

function DismantleSheet({ open, onClose, object, alloc }: { open: boolean; onClose: () => void; object: any; alloc: Alloc | null }) {
  const run = useCommand();
  const [to, setTo] = useState("");
  const [processing, setProcessing] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="Demonterad"
      footer={<BusyButton disabled={!to} onClick={async () => {
        const r = await run("DismantleObject", { object_id: object.id, to_place_id: to, allocation_id: alloc?.id ?? null, to_processing: processing }, { success: "Tillbaka i lagret" });
        if (r) onClose();
      }}>Spara</BusyButton>}>
      <PlacePicker label="Var hamnar den?" value={to} onChange={setTo} places={false} />
      <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-falu" checked={processing} onChange={(e) => setProcessing(e.target.checked)} /> Behöver renoveras</label>
    </Sheet>
  );
}

function EditSheet({ open, onClose, object }: { open: boolean; onClose: () => void; object: any }) {
  const run = useCommand();
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? (object[k] == null ? "" : String(object[k]));
  const set = (k: string) => (x: string) => setF((s) => ({ ...s, [k]: x }));
  return (
    <Sheet open={open} onClose={onClose} title="Ändra uppgifter"
      footer={<BusyButton onClick={async () => {
        const fields: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(f)) fields[k] = ["weight_kg", "condition"].includes(k) ? numOrNull(x) : strOrNull(x);
        if (!Object.keys(fields).length) return onClose();
        const r = await run("UpdateFields", { id: object.id, fields }, { success: "Sparat" });
        if (r) { setF({}); onClose(); }
      }}>Spara</BusyButton>}>
      <TextField label="Namn" value={v("title")} onChange={set("title")} />
      <TextArea label="Beskrivning" value={v("description")} onChange={set("description")} rows={3} />
      <div className="grid grid-cols-2 gap-x-3">
        <TextField label="Material" value={v("material")} onChange={set("material")} />
        <TextField label="Mått" value={v("dimensions")} onChange={set("dimensions")} />
        <NumberField label="Vikt (kg)" value={v("weight_kg")} onChange={set("weight_kg")} />
        <TextField label="Ålder/period" value={v("age_period")} onChange={set("age_period")} />
      </div>
      <Select label="Skick" value={v("condition")} onChange={set("condition")} empty="Okänt" options={Object.entries(CONDITION).map(([value, label]) => ({ value, label }))} />
      {object.living_material && <TextField label="Art/sort" value={v("species_variety")} onChange={set("species_variety")} />}
      <TextArea label="Varför vi sparade den" value={v("story_why")} onChange={set("story_why")} rows={2} />
    </Sheet>
  );
}

export function PhotoSheet({ open, onClose, entityId, role = "photo" }: { open: boolean; onClose: () => void; entityId: string; role?: string }) {
  const run = useCommand();
  const upload = useUpload();
  const [files, setFiles] = useState<File[]>([]);
  const [people, setPeople] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="Lägg till bild"
      footer={<BusyButton disabled={!files.length} onClick={async () => {
        const ids = await upload(files, { hasPeople: people });
        for (const [i, m] of ids.entries()) await run("LinkMedia", { media_id: m, entity_id: entityId, role, sort: i });
        setFiles([]);
        onClose();
      }}>Spara</BusyButton>}>
      <PhotoPicker files={files} onChange={setFiles} />
      <label className="mt-3 flex items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-falu" checked={people} onChange={(e) => setPeople(e.target.checked)} /> Det syns personer på bilden</label>
      <p className="mt-2 text-sm text-sot-3">Platsdata tas bort ur bilderna innan de sparas för delning. Originalet är privat.</p>
    </Sheet>
  );
}

export function NoteSheet({ open, onClose, entityId }: { open: boolean; onClose: () => void; entityId: string }) {
  const run = useCommand();
  const [kind, setKind] = useState("why");
  const [text, setText] = useState("");
  const [who, setWho] = useState<PersonChoice | null>(null);
  const [consent, setConsent] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="Berättelseanteckning"
      footer={<BusyButton disabled={!text.trim()} onClick={async () => {
        const r = await run("AddStoryNote", { entity_id: entityId, kind, text: text.trim(), person_id: who?.id ?? null, quote_consent: kind === "quote" ? consent : false }, { success: "Sparat" });
        if (r) { setText(""); onClose(); }
      }}>Spara</BusyButton>}>
      <Select label="Slag" value={kind} onChange={setKind} options={[{ value: "why", label: "Varför den är här" }, { value: "quote", label: "Citat" }, { value: "moment", label: "Ett ögonblick" }]} />
      <TextArea label={kind === "quote" ? "Vad sa hen?" : "Berätta"} value={text} onChange={setText} rows={3} />
      {kind === "quote" && <>
        <PersonPicker label="Vem sa det?" value={who} onChange={setWho} allowNew={false} />
        <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-falu" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Hen har sagt ja till att citatet delas</label>
      </>}
    </Sheet>
  );
}

function PrivateSheet({ open, onClose, object }: { open: boolean; onClose: () => void; object: any }) {
  const run = useCommand();
  const [value, setValue] = useState(object.private?.estimated_value ? String(object.private.estimated_value) : "");
  const [note, setNote] = useState(object.private?.note ?? "");
  return (
    <Sheet open={open} onClose={onClose} title="Privat (bara ägaren)"
      footer={<BusyButton onClick={async () => { if (await run("SetObjectPrivate", { object_id: object.id, estimated_value: numOrNull(value), note: strOrNull(note) }, { success: "Sparat" })) onClose(); }}>Spara</BusyButton>}>
      <NumberField label="Uppskattat värde" value={value} onChange={setValue} unit="kr" />
      <TextArea label="Anteckning" value={note} onChange={setNote} rows={2} />
    </Sheet>
  );
}

export function TaskSheet({ open, onClose, subjectId, defaultTitle = "" }: { open: boolean; onClose: () => void; subjectId?: string | null; defaultTitle?: string }) {
  const run = useCommand();
  const [title, setTitle] = useState(defaultTitle);
  const [due, setDue] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Ny uppgift"
      footer={<BusyButton disabled={!title.trim()} onClick={async () => {
        const r = await run("CreateTask", { title: title.trim(), due_at: due ? new Date(due).toISOString() : null, subject_entity_id: subjectId ?? null }, { success: "Uppgiften är sparad" });
        if (r) { setTitle(""); setDue(""); onClose(); }
      }}>Spara</BusyButton>}>
      <TextField label="Vad ska göras?" value={title} onChange={setTitle} autoFocus />
      <TextField label="Senast" type="date" value={due} onChange={setDue} />
    </Sheet>
  );
}


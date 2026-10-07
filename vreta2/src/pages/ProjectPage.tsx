// Ett projekt: behoven ("1 020 av 1 500 st"), sakerna som blev en del av det, människorna som bidrog,
// besluten, uppgifterna och ögonblicken (R1.1 S5, Designdokument 2.0 Projektduken).
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Camera, Check, Lightbulb, ListPlus, Megaphone, PenLine, Plus, Sparkles } from "lucide-react";
import { useCan, useCommand, useLabels, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { USAGE_TYPES } from "../app/labels";
import { d, num } from "../app/format";
import { Avatar, Card, Empty, ErrorNote, PageHeader, Progress, Section, Spinner, Stamp, statusTone } from "../ui/base";
import { Gallery, PhotoPicker, Thumb, useUpload } from "../ui/media";
import { NumberField, Select, TextArea, TextField, Toggle, numOrNull, strOrNull } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";
import { VretaMap } from "../ui/VretaMap";
import { PhotoSheet, TaskSheet } from "./ObjectPage";

export default function ProjectPage() {
  const { id } = useParams();
  const { data: p, error, loading } = useQuery<any>("q_project", { id });
  useScreen(p ? { id: p.id, type: "project", title: p.name } : null);
  if (loading) return <Spinner />;
  if (error || !p) return <ErrorNote>{error ?? "Projektet finns inte"}</ErrorNote>;
  return <ProjectView p={p} />;
}

function ProjectView({ p }: { p: any }) {
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const { code, state, next } = useLabels();
  const [sheet, setSheet] = useState<null | "need" | "moment" | "decision" | "task" | "photo">(null);
  const [fulfill, setFulfill] = useState<any>(null);
  const close = () => setSheet(null);
  return (
    <div>
      <PageHeader kicker={<>{code("project_kind", p.kind_code) || "Projekt"}{p.parent && <> · del av <Link to={`/projekt/${p.parent.id}`}>{p.parent.title}</Link></>}</>} title={p.name}
        sub={<span className="flex flex-wrap items-center gap-2"><Stamp tone={statusTone(null, p.status)}>{p.status_label}</Stamp>
          {p.place && <Link to={p.place.route}>{p.place_path}</Link>}{p.started_on && <span>sedan {d(p.started_on)}</span>}</span>} />
      {p.description && <p className="mb-3">{p.description}</p>}
      <Gallery media={p.media ?? []} />
      {p.geometry && <div className="my-3"><VretaMap features={[{ id: p.id, layer: "projects", entity_id: p.id, entity_type: "project", label: p.name, reality_mode: "now", status: p.status, props: {}, geometry: p.geometry }]} height={200} fitTo={p.geometry} /></div>}

      <div className="my-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {can("RecordMoment") && <Tile icon={Sparkles} label="Ögonblick" onClick={() => setSheet("moment")} />}
        {can("AddNeed") && <Tile icon={ListPlus} label="Behov" onClick={() => setSheet("need")} />}
        {can("RecordDecision") && <Tile icon={Lightbulb} label="Beslut" onClick={() => setSheet("decision")} />}
        {can("CreateTask") && <Tile icon={Check} label="Uppgift" onClick={() => setSheet("task")} />}
        {can("LinkMedia") && <Tile icon={Camera} label="Foto" onClick={() => setSheet("photo")} />}
        {can("CreateContent") && <Tile icon={PenLine} label="Berätta" onClick={() => nav(`/beratta?kalla=${p.id}`)} />}
      </div>
      {can("SetProjectStatus") && next("project", p.status).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {next("project", p.status).map((s) => <BusyButton key={s} className="btn-secondary btn-small" onClick={() => run("SetProjectStatus", { project_id: p.id, status: s }, { success: state("project", s) })}>{state("project", s)}</BusyButton>)}
        </div>
      )}

      <Section title="Behov">
        {(p.needs ?? []).length === 0 ? <Empty>Inga behov än. Vad behöver projektet – material, hjälp, kunskap?</Empty> : (
          <div className="flex flex-col gap-2">
            {p.needs.map((n: any) => (
              <Card key={n.id} className={`!py-3 ${n.status === "dropped" ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-semibold">{n.title}</div><div className="text-sm text-sot-3">{code("need_kind", n.kind_code)}</div></div>
                  {n.met ? <Stamp tone="ok">Uppfyllt</Stamp> : n.status === "dropped" ? <Stamp>Släppt</Stamp> : null}
                </div>
                {n.quantity ? <div className="mt-2"><Progress value={Number(n.fulfilled)} max={Number(n.quantity)} /><div className="mt-1 text-sm text-sot-2">{n.progress}</div></div> : null}
                {(n.fulfillments ?? []).length > 0 && (
                  <ul className="mt-2 text-sm text-sot-3">{n.fulfillments.map((f: any) => (
                    <li key={f.id}>+{num(f.quantity)} {f.object ? <Link to={f.object.route ?? `/objekt/${f.object.id}`}>{f.object.title}</Link> : f.contribution?.title ?? f.note ?? f.source_kind} · {d(f.occurred_at)}</li>
                  ))}</ul>
                )}
                {!n.met && n.status === "open" && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {can("FulfillNeed") && <button type="button" className="btn-secondary btn-small" onClick={() => setFulfill(n)}><Plus size={14} /> Räkna in</button>}
                    {can("CreateListing") && <Link className="btn-ghost btn-small" to={`/annons/ny?behov=${n.id}`}><Megaphone size={14} /> Efterlys</Link>}
                    {(n.listings ?? []).map((l: any) => <Link key={l.id} className="chip min-h-[32px] text-xs no-underline" to={`/annons/${l.id}`}>Efterlyst</Link>)}
                    {can("SetNeedStatus") && <BusyButton className="btn-ghost btn-small" onClick={() => run("SetNeedStatus", { need_id: n.id, status: "dropped" }, { success: "Behovet är släppt" })}>Släpp</BusyButton>}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Section>

      {(p.objects_used ?? []).length > 0 && (
        <Section title="Återbruk i projektet">
          <ul className="card divide-y divide-dashed divide-lera">
            {p.objects_used.map((o: any, i: number) => (
              <li key={i}><Link to={`/objekt/${o.object_id}`} className="flex items-center gap-3 px-4 py-2.5 text-sot no-underline">
                <Thumb m={o.cover} size={40} /><span className="flex-1"><span className="font-semibold">{o.label}</span><span className="block text-sm text-sot-3">{USAGE_TYPES[o.type] ?? o.type} · {d(o.occurred_at)}</span></span>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}

      {(p.contributors ?? []).length > 0 && (
        <Section title="Människorna">
          <ul className="card divide-y divide-dashed divide-lera">
            {p.contributors.map((c: any) => (
              <li key={c.person.id}><Link to={`/person/${c.person.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sot no-underline">
                <Avatar name={c.person.display_name} size={36} />
                <span className="flex-1"><span className="font-semibold">{c.person.display_name}</span>
                  <span className="block text-sm text-sot-3">{(c.types ?? []).map((t: string) => code("contribution_type", t)).join(", ")}{c.hours ? ` · ${num(c.hours)} tim` : ""}</span></span>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}

      {(p.decisions ?? []).length > 0 && (
        <Section title="Beslut">
          <div className="flex flex-col gap-2">{p.decisions.map((x: any) => (
            <Link key={x.id} to={`/beslut/${x.id}`} className="card block px-4 py-3 text-sot no-underline"><div className="font-semibold">{x.question}</div><div className="text-sot-2">→ {x.choice ?? "Inte avgjort"}</div><div className="text-sm text-sot-3">{d(x.decided_at)}</div></Link>
          ))}</div>
        </Section>
      )}

      <Section title="Uppgifter">
        {(p.tasks ?? []).filter((t: any) => !["done", "cancelled"].includes(t.status)).length === 0 ? <p className="text-sot-3">Inget att göra just nu.</p> : (
          <ul className="card divide-y divide-dashed divide-lera">
            {p.tasks.filter((t: any) => !["done", "cancelled"].includes(t.status)).map((t: any) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span><Link to={`/uppgift/${t.id}`}>{t.title}</Link>{t.due_at && <span className="text-sm text-sot-3"> · {d(t.due_at)}</span>}</span>
                {can("SetTaskStatus") && <BusyButton className="btn-done btn-small" onClick={() => run("SetTaskStatus", { task_id: t.id, status: "done" }, { success: "Klart!" })}>Klar</BusyButton>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(p.subprojects ?? []).length > 0 && (
        <Section title="Delprojekt"><ul className="card divide-y divide-dashed divide-lera">{p.subprojects.map((s: any) => <li key={s.id} className="px-4 py-2.5"><Link to={`/projekt/${s.id}`}>{s.name}</Link></li>)}</ul></Section>
      )}

      <Section title="Tidslinje"><Timeline events={p.timeline ?? []} hideLink={p.id} /></Section>

      <NeedSheet open={sheet === "need"} onClose={close} projectId={p.id} />
      <MomentSheet open={sheet === "moment"} onClose={close} projectId={p.id} />
      <DecisionSheet open={sheet === "decision"} onClose={close} projectId={p.id} />
      <TaskSheet open={sheet === "task"} onClose={close} subjectId={p.id} />
      <PhotoSheet open={sheet === "photo"} onClose={close} entityId={p.id} />
      {fulfill && <FulfillSheet need={fulfill} onClose={() => setFulfill(null)} />}
    </div>
  );
}

function Tile({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="card flex min-h-[64px] flex-col items-center justify-center gap-1 px-1 text-sm font-semibold"><Icon size={21} className="text-falu" aria-hidden />{label}</button>;
}

function NeedSheet({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const run = useCommand();
  const { codes } = useLabels();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("material");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("st");
  const [note, setNote] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Nytt behov"
      footer={<BusyButton disabled={!title.trim()} onClick={async () => {
        if (await run("AddNeed", { project_id: projectId, title: title.trim(), kind_code: kind, quantity: numOrNull(qty), unit: qty ? unit : null, note: strOrNull(note) }, { success: "Behovet är tillagt" })) { setTitle(""); setQty(""); onClose(); }
      }}>Spara</BusyButton>}>
      <TextField label="Vad behövs?" value={title} onChange={setTitle} placeholder="Tegel till muren" />
      <Select label="Slag" value={kind} onChange={setKind} options={codes("need_kind").map((c) => ({ value: c.code, label: c.label }))} />
      <div className="grid grid-cols-2 gap-x-3">
        <NumberField label="Hur mycket?" value={qty} onChange={setQty} />
        <TextField label="Enhet" value={unit} onChange={setUnit} mic={false} />
      </div>
      <TextArea label="Anteckning" value={note} onChange={setNote} rows={2} />
    </Sheet>
  );
}

function FulfillSheet({ need, onClose }: { need: any; onClose: () => void }) {
  const run = useCommand();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  return (
    <Sheet open onClose={onClose} title={`Räkna in: ${need.title}`}
      footer={<BusyButton disabled={!qty} onClick={async () => { if (await run("FulfillNeed", { need_id: need.id, quantity: numOrNull(qty), note: strOrNull(note), source_kind: "none" }, { success: "Inräknat" })) onClose(); }}>Spara</BusyButton>}>
      <p className="mb-3 text-sot-3">Nu: {need.progress}. Saker som används i projektet räknas in automatiskt.</p>
      <NumberField label="Hur mycket kom in?" value={qty} onChange={setQty} unit={need.unit ?? undefined} />
      <TextField label="Varifrån?" value={note} onChange={setNote} placeholder="Grannens gamla mur" />
    </Sheet>
  );
}

export function MomentSheet({ open, onClose, projectId, placeId }: { open: boolean; onClose: () => void; projectId?: string; placeId?: string }) {
  const run = useCommand();
  const upload = useUpload();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [story, setStory] = useState(true);
  return (
    <Sheet open={open} onClose={onClose} title="Ett ögonblick"
      footer={<BusyButton disabled={!title.trim() && !files.length} onClick={async () => {
        const media = await upload(files);
        if (await run("RecordMoment", { title: strOrNull(title), note: strOrNull(note), media_ids: media, project_id: projectId ?? null, place_id: placeId ?? null, story_value: story }, { success: "Ögonblicket är sparat" })) {
          setTitle(""); setNote(""); setFiles([]); onClose();
        }
      }}>Spara</BusyButton>}>
      <PhotoPicker files={files} onChange={setFiles} />
      <div className="mt-3"><TextField label="Vad hände?" value={title} onChange={setTitle} placeholder="Första tegelraden på plats" /></div>
      <TextArea label="Berätta mer" value={note} onChange={setNote} rows={2} />
      <Toggle label="Värt att berätta" checked={story} onChange={setStory} />
    </Sheet>
  );
}

export function DecisionSheet({ open, onClose, projectId, placeId }: { open: boolean; onClose: () => void; projectId?: string; placeId?: string }) {
  const run = useCommand();
  const [q, setQ] = useState("");
  const [alts, setAlts] = useState("");
  const [choice, setChoice] = useState("");
  const [why, setWhy] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Beslut"
      footer={<BusyButton disabled={!q.trim()} onClick={async () => {
        const alternatives = alts.split("\n").map((x) => x.trim()).filter(Boolean).map((title) => ({ title }));
        if (await run("RecordDecision", { question: q.trim(), alternatives, choice: strOrNull(choice), rationale: strOrNull(why), project_id: projectId ?? null, place_id: placeId ?? null }, { success: "Beslutet är sparat" })) {
          setQ(""); setAlts(""); setChoice(""); setWhy(""); onClose();
        }
      }}>Spara</BusyButton>}>
      <TextField label="Frågan" value={q} onChange={setQ} placeholder="Var ska växthuset ligga?" />
      <TextArea label="Alternativ (ett per rad)" value={alts} onChange={setAlts} rows={3} />
      <TextField label="Vi valde" value={choice} onChange={setChoice} />
      <TextArea label="Varför" value={why} onChange={setWhy} rows={2} />
    </Sheet>
  );
}

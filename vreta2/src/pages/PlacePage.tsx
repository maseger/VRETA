// En plats: område, byggnad, rum, plats utanför Vreta eller ort. Visar vad som finns och används här,
// projekt, observationer och allt som hänt – inklusive det som hänt i underliggande platser.
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Camera, Flag, Lightbulb, Pencil, PenLine, Plus, Shapes, Sparkles } from "lucide-react";
import { useCan, useCommand, useLabels, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { d, num } from "../app/format";
import { Card, Empty, ErrorNote, Kv, List, PageHeader, Row, Section, Spinner, Stamp, statusTone } from "../ui/base";
import { Gallery, Thumb } from "../ui/media";
import { Select, TextArea, TextField, strOrNull } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";
import { VretaMap, type MapFeature } from "../ui/VretaMap";
import { PhotoSheet } from "./ObjectPage";
import { DecisionSheet, MomentSheet } from "./ProjectPage";

export default function PlacePage() {
  const { id } = useParams();
  const { data: p, error, loading } = useQuery<any>("q_place", { id });
  useScreen(p ? { id: p.id, type: p.type, title: p.name } : null);
  if (loading) return <Spinner />;
  if (error || !p) return <ErrorNote>{error ?? "Platsen finns inte"}</ErrorNote>;
  if (p.type === "storage_location") return <Navigate to={`/lager/${p.id}`} replace />;
  return <PlaceView p={p} />;
}

function PlaceView({ p }: { p: any }) {
  const can = useCan();
  const nav = useNavigate();
  const { code } = useLabels();
  const [sheet, setSheet] = useState<null | "photo" | "edit" | "child" | "moment" | "decision" | "address">(null);
  const close = () => setSheet(null);
  const { data: map } = useQuery<{ features: MapFeature[] }>(p.geometry ? "q_map" : null);
  const onVreta = ["zone", "structure", "space"].includes(p.type);
  const typeLabel = p.type === "zone" ? code("zone_type", p.type_code) : p.type === "structure" ? code("structure_type", p.type_code)
    : p.type === "space" ? code("space_type", p.type_code) : p.type === "external_place" ? code("external_place_kind", p.kind_code) || "Plats utanför Vreta" : "Ort";

  return (
    <div>
      <PageHeader kicker={<>{p.parent ? <Link to={p.parent.route}>{p.parent.title}</Link> : typeLabel}{p.parent && typeLabel ? ` · ${typeLabel}` : ""}</>} title={p.name}
        sub={<span className="flex flex-wrap items-center gap-2">
          {p.reality_mode && p.reality_mode !== "now" && <Stamp tone={p.reality_mode === "vision" ? "vision" : "plan"}>{p.reality_mode === "vision" ? "Vision" : "Plan"}</Stamp>}
          {p.pz != null && <span>Permakulturzon {p.pz}</span>}
          {p.area_m2 ? <span>{num(p.area_m2)} m²</span> : null}
          {p.municipality && <span>{p.municipality}{p.county ? `, ${p.county}` : ""}</span>}
        </span>} />

      {p.geometry && map && (
        <div className="mb-4"><VretaMap features={map.features} height={260} fitTo={p.geometry} highlight={p.id}
          onSelect={(f) => { if (f.entity_id && f.entity_id !== p.id) { const t = f.entity_type; nav(t === "zone" ? `/zon/${f.entity_id}` : t === "structure" ? `/byggnad/${f.entity_id}` : t === "object" ? `/objekt/${f.entity_id}` : t === "project" ? `/projekt/${f.entity_id}` : t === "storage_location" ? `/lager/${f.entity_id}` : `/observation/${f.entity_id}`); } }} /></div>
      )}
      <Gallery media={p.media ?? []} />
      {p.description && <p className="my-3">{p.description}</p>}

      {onVreta && (
        <div className="my-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {can("LinkMedia") && <Tile icon={Camera} label="Foto" onClick={() => setSheet("photo")} />}
          {can("RecordMoment") && <Tile icon={Sparkles} label="Ögonblick" onClick={() => setSheet("moment")} />}
          {can("RecordDecision") && <Tile icon={Lightbulb} label="Beslut" onClick={() => setSheet("decision")} />}
          {can("CreateProject") && <Tile icon={Flag} label="Projekt" onClick={() => nav(`/projekt/ny?plats=${p.id}`)} />}
          {can("CreateContent") && <Tile icon={PenLine} label="Berätta" onClick={() => nav(`/beratta?kalla=${p.id}`)} />}
          {can("UpdateFields") && <Tile icon={Pencil} label="Ändra" onClick={() => setSheet("edit")} />}
        </div>
      )}
      {onVreta && can("SetGeometry") && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link to={`/platser/ny?rita=${p.id}&typ=${p.type}`} className="btn-ghost btn-small"><Shapes size={15} /> {p.geometry ? "Rita om på kartan" : "Rita in på kartan"}</Link>
          {can("CreatePlace") && p.type !== "space" && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet("child")}><Plus size={15} /> {p.type === "zone" ? "Byggnad eller del här" : "Rum eller platsdel"}</button>}
        </div>
      )}

      {p.type === "external_place" && (
        <Section title="Adress (privat)" action={can("SetExternalPlaceAddress") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet("address")}>Ändra</button>}>
          <Card>{p.private?.address ? <><div>{p.private.address}</div>{p.private.note && <div className="text-sm text-sot-3">{p.private.note}</div>}</> : <span className="text-sot-3">Ingen adress sparad.</span>}</Card>
        </Section>
      )}

      {p.type === "locality" && (
        <>
          <Section title={`Människor härifrån · ${p.people.length}`}>
            {p.people.length === 0 ? <Empty>Ingen.</Empty> : <List>{p.people.map((x: any) => <Row key={x.id} to={`/person/${x.id}`}>{x.display_name}</Row>)}</List>}
          </Section>
          <Card className="mb-4"><dl className="divide-y divide-dashed divide-lera"><Kv k="Saker härifrån">{p.flows_in}</Kv><Kv k="Saker hit">{p.flows_out}</Kv></dl></Card>
          {p.external_places.length > 0 && <Section title="Platser"><List>{p.external_places.map((x: any) => <Row key={x.id} to={x.route}>{x.title}</Row>)}</List></Section>}
        </>
      )}

      {(p.acquisitions ?? []).length > 0 && (
        <Section title="Saker härifrån"><List>{p.acquisitions.map((a: any) => <Row key={a.id} to={`/inkop/${a.id}`}>{a.label} <span className="text-sm text-sot-3">· {d(a.created_at)}</span></Row>)}</List></Section>
      )}
      {(p.pickups ?? []).length > 0 && (
        <Section title="Hämtningar"><List>{p.pickups.map((x: any) => <Row key={x.id} to={`/hamtning/${x.id}`} right={<Stamp tone={statusTone(null, x.status)}>{x.status}</Stamp>}>{x.title}</Row>)}</List></Section>
      )}

      {(p.children ?? []).length > 0 && (
        <Section title="Här finns"><List>{p.children.map((c: any) => <Row key={c.id} to={c.route} right={<span className="text-sm text-sot-3">{c.type_label}</span>}>{c.title}</Row>)}</List></Section>
      )}
      {(p.in_use ?? []).length > 0 && (
        <Section title="Återbruk i bruk här">
          <List>{p.in_use.map((o: any, i: number) => <Row key={o.id + i} to={`/objekt/${o.id}`} leading={<Thumb m={o.cover} size={40} />}>
            <div className="font-semibold">{o.label}</div><div className="text-sm text-sot-3">{[o.place_path, o.project?.title].filter(Boolean).join(" · ")}</div></Row>)}</List>
        </Section>
      )}
      {(p.stored ?? []).length > 0 && (
        <Section title="I lager här">
          <List>{p.stored.map((o: any, i: number) => <Row key={o.id + i} to={`/objekt/${o.id}`} leading={<Thumb m={o.cover} size={40} />}>
            <div className="font-semibold">{o.label}</div><div className="text-sm text-sot-3">{o.place_path}</div></Row>)}</List>
        </Section>
      )}
      {(p.projects ?? []).length > 0 && (
        <Section title="Projekt"><List>{p.projects.map((x: any) => <Row key={x.id} to={`/projekt/${x.id}`} right={<Stamp tone={statusTone(null, x.status)}>{x.status_label}</Stamp>}>{x.name}</Row>)}</List></Section>
      )}
      {(p.visions ?? []).length > 0 && (
        <Section title="Visioner"><List>{p.visions.map((v: any) => <Row key={v.id} to={`/vision/${v.id}`} right={<Stamp tone="vision">Vision</Stamp>}><div className="font-semibold">{v.title}</div><div className="text-sm text-sot-3">{v.statement}</div></Row>)}</List></Section>
      )}
      {(p.observations ?? []).length > 0 && (
        <Section title="Observationer">
          <List>{p.observations.map((o: any) => <Row key={o.id} to={`/observation/${o.id}`} right={!o.verified && <Stamp tone="uncertain">Obekräftad</Stamp>}>
            <div>{o.taxon ? <span className="font-semibold">{o.taxon}: </span> : null}{o.description}</div><div className="text-sm text-sot-3">{d(o.occurred_at)}</div></Row>)}</List>
        </Section>
      )}
      <Section title="Tidslinje"><Timeline events={p.timeline ?? []} hideLink={p.id} /></Section>

      <PhotoSheet open={sheet === "photo"} onClose={close} entityId={p.id} />
      <EditPlaceSheet open={sheet === "edit"} onClose={close} p={p} />
      <ChildSheet open={sheet === "child"} onClose={close} p={p} />
      <MomentSheet open={sheet === "moment"} onClose={close} placeId={p.id} />
      <DecisionSheet open={sheet === "decision"} onClose={close} placeId={p.id} />
      <AddressSheet open={sheet === "address"} onClose={close} p={p} />
    </div>
  );
}

function Tile({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="card flex min-h-[64px] flex-col items-center justify-center gap-1 px-1 text-sm font-semibold"><Icon size={21} className="text-falu" aria-hidden />{label}</button>;
}

function EditPlaceSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const { codes } = useLabels();
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description ?? "");
  const [type, setType] = useState(p.type_code ?? "");
  const [pz, setPz] = useState(p.pz != null ? String(p.pz) : "");
  const list = p.type === "zone" ? "zone_type" : p.type === "structure" ? "structure_type" : "space_type";
  return (
    <Sheet open={open} onClose={onClose} title="Ändra platsen"
      footer={<BusyButton onClick={async () => {
        const fields: Record<string, unknown> = { name: name.trim(), description: strOrNull(desc), type_code: type || null };
        if (p.type !== "space") fields.permaculture_zone = pz === "" ? null : Number(pz);
        if (await run("UpdateFields", { id: p.id, fields }, { success: "Sparat" })) onClose();
      }}>Spara</BusyButton>}>
      <TextField label="Namn" value={name} onChange={setName} />
      <Select label="Typ" value={type} onChange={setType} empty="Välj" options={codes(list).map((c) => ({ value: c.code, label: c.label }))} />
      {p.type !== "space" && <Select label="Permakulturzon" value={pz} onChange={setPz} empty="Ingen" options={[0, 1, 2, 3, 4, 5].map((z) => ({ value: String(z), label: `Zon ${z}` }))} />}
      <TextArea label="Beskrivning" value={desc} onChange={setDesc} rows={3} />
    </Sheet>
  );
}

function ChildSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const nav = useNavigate();
  const { codes } = useLabels();
  const kinds = p.type === "zone" ? [{ value: "structure", label: "Byggnad eller anläggning" }, { value: "space", label: "Platsdel" }, { value: "storage_location", label: "Lagerplats" }]
    : [{ value: "space", label: "Rum eller platsdel" }, { value: "storage_location", label: "Lagerplats" }];
  const [kind, setKind] = useState(kinds[0].value);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const list = kind === "structure" ? "structure_type" : "space_type";
  return (
    <Sheet open={open} onClose={onClose} title={`Ny del i ${p.name}`}
      footer={<BusyButton disabled={!name.trim()} onClick={async () => {
        const r = await run<{ id: string }>("CreatePlace", { kind, name: name.trim(), parent_id: p.id, type_code: kind === "storage_location" ? null : type || null }, { success: "Skapad" });
        if (r?.id) { onClose(); nav(kind === "structure" ? `/byggnad/${r.id}` : kind === "space" ? `/space/${r.id}` : `/lager/${r.id}`); }
      }}>Skapa</BusyButton>}>
      <Select label="Vad?" value={kind} onChange={setKind} options={kinds} />
      <TextField label="Namn" value={name} onChange={setName} />
      {kind !== "storage_location" && <Select label="Typ" value={type} onChange={setType} empty="Välj" options={codes(list).map((c) => ({ value: c.code, label: c.label }))} />}
    </Sheet>
  );
}

function AddressSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const [address, setAddress] = useState(p.private?.address ?? "");
  const [note, setNote] = useState(p.private?.note ?? "");
  return (
    <Sheet open={open} onClose={onClose} title="Adress (privat)"
      footer={<BusyButton onClick={async () => { if (await run("SetExternalPlaceAddress", { external_place_id: p.id, address: strOrNull(address), note: strOrNull(note) }, { success: "Sparat" })) onClose(); }}>Spara</BusyButton>}>
      <TextField label="Adress" value={address} onChange={setAddress} />
      <TextField label="Anteckning" value={note} onChange={setNote} placeholder="Grind på baksidan, ring först …" />
    </Sheet>
  );
}

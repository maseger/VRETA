// Ny plats – eller rita om en befintlig. Områden och byggnader ritas som ytor direkt på Vretakartan.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Crosshair } from "lucide-react";
import { useCommand, useLabels, useQuery } from "../app/AppContext";
import { areaM2, here } from "../services/geo";
import { num } from "../app/format";
import { Card, Chip, ErrorNote, PageHeader, Spinner } from "../ui/base";
import { PlacePicker, Select, TextArea, TextField, strOrNull } from "../ui/fields";
import { BusyButton } from "../ui/sheet";
import { VretaMap, type MapFeature } from "../ui/VretaMap";
import { useToast } from "../app/toast";

const KINDS = [
  { value: "zone", label: "Område" }, { value: "structure", label: "Byggnad eller anläggning" }, { value: "space", label: "Rum eller platsdel" },
  { value: "storage_location", label: "Lagerplats" }, { value: "external_place", label: "Plats utanför Vreta" },
];
const ROUTE: Record<string, string> = { zone: "/zon/", structure: "/byggnad/", space: "/space/", storage_location: "/lager/", external_place: "/plats/" };

export default function NewPlace() {
  const [sp] = useSearchParams();
  const redrawId = sp.get("rita");
  const { data: existing, loading } = useQuery<any>(redrawId ? "q_place" : null, { id: redrawId });
  if (redrawId && loading) return <Spinner />;
  return <Form existing={existing} />;
}

function Form({ existing }: { existing: any | null }) {
  const run = useCommand();
  const nav = useNavigate();
  const toast = useToast();
  const { codes } = useLabels();
  const { data: map } = useQuery<{ features: MapFeature[] }>("q_map");
  const [kind, setKind] = useState(existing?.type ?? "zone");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [mode, setMode] = useState("now");
  const [pz, setPz] = useState("");
  const [parent, setParent] = useState("");
  const [desc, setDesc] = useState("");
  const [locality, setLocality] = useState("");
  const [address, setAddress] = useState("");
  const [geom, setGeom] = useState<GeoJSON.Geometry | null>(null);
  const [seed, setSeed] = useState<[number, number] | null>(null);
  const [shape, setShape] = useState<"polygon" | "point">(kind === "structure" || kind === "zone" ? "polygon" : "point");
  const list = kind === "zone" ? "zone_type" : kind === "structure" ? "structure_type" : kind === "space" ? "space_type" : kind === "external_place" ? "external_place_kind" : null;
  const onMap = ["zone", "structure", "space"].includes(kind);
  const others = useMemo(() => (map?.features ?? []).filter((f) => f.entity_id !== existing?.id), [map, existing]);
  const area = geom?.type === "Polygon" ? areaM2((geom.coordinates[0] as [number, number][]).slice(0, -1)) : 0;

  async function save() {
    if (existing) {
      if (!geom) return;
      if (await run("SetGeometry", { id: existing.id, geometry: geom }, { success: "Sparat på kartan" })) nav(ROUTE[existing.type] + existing.id, { replace: true });
      return;
    }
    const r = await run<{ id: string }>("CreatePlace", {
      kind, name: name.trim(), type_code: kind === "external_place" ? null : type || null, kind_code: kind === "external_place" ? type || null : null,
      reality_mode: onMap ? mode : null, status: mode === "now" ? "existing" : "planned", permaculture_zone: pz === "" ? null : Number(pz),
      parent_id: parent || null, description: strOrNull(desc), geometry: onMap ? geom : null, locality: strOrNull(locality), address: strOrNull(address),
    }, { success: "Platsen är skapad" });
    if (r?.id) nav(ROUTE[kind] + r.id, { replace: true });
  }

  return (
    <div>
      <PageHeader kicker="Platser" title={existing ? `Rita ${existing.name}` : "Ny plats"} />
      {!existing && (
        <Card className="mb-4">
          <div className="mb-3 flex flex-wrap gap-2">{KINDS.map((k) => <Chip key={k.value} on={kind === k.value} onClick={() => { setKind(k.value); setType(""); setShape(k.value === "zone" || k.value === "structure" ? "polygon" : "point"); }}>{k.label}</Chip>)}</div>
          <TextField label="Namn" value={name} onChange={setName} />
          {list && <Select label="Typ" value={type} onChange={setType} empty="Välj" options={codes(list).map((c) => ({ value: c.code, label: c.label }))} />}
          {onMap && (
            <div className="mb-3 flex flex-wrap gap-2">
              {[["now", "Finns nu"], ["plan", "Planerad"], ["vision", "Vision"]].map(([v, l]) => <Chip key={v} on={mode === v} onClick={() => setMode(v)}>{l}</Chip>)}
            </div>
          )}
          {(kind === "zone" || kind === "structure") && <Select label="Permakulturzon" value={pz} onChange={setPz} empty="Ingen" options={[0, 1, 2, 3, 4, 5].map((z) => ({ value: String(z), label: `Zon ${z}` }))} />}
          {(kind === "structure" || kind === "space" || kind === "storage_location") && (
            <PlacePicker label="Ligger i" value={parent} onChange={setParent} storage={kind === "storage_location"} empty="Direkt på Vreta" />
          )}
          {kind === "external_place" && <>
            <TextField label="Ort" value={locality} onChange={setLocality} />
            <TextField label="Adress (privat)" value={address} onChange={setAddress} />
          </>}
          <TextArea label="Beskrivning" value={desc} onChange={setDesc} rows={2} />
        </Card>
      )}
      {(onMap || existing) && (
        <Card className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip on={shape === "polygon"} onClick={() => setShape("polygon")}>Rita yta</Chip>
            <Chip on={shape === "point"} onClick={() => setShape("point")}>Sätt en punkt</Chip>
            <button type="button" className="btn-ghost btn-small ml-auto" onClick={async () => {
              try { const h = await here(); setShape("point"); setSeed([h.lon, h.lat]); toast(`Position med ±${Math.round(h.accuracy)} m`, "info"); }
              catch (e) { toast((e as Error).message, "error"); }
            }}><Crosshair size={15} /> Här står jag</button>
          </div>
          <VretaMap features={others} draw={shape} onDraw={setGeom} height={380} fitTo={existing?.geometry ?? null} seed={seed} />
          <div className="mt-2 text-sm text-sot-3">{geom ? geom.type === "Polygon" ? `Yta: ca ${num(Math.round(area))} m²` : "Punkt satt" : "Inget ritat än"}</div>
        </Card>
      )}
      {!existing && !name.trim() && <ErrorNote>Ge platsen ett namn.</ErrorNote>}
      <BusyButton className="btn-primary mt-3 w-full" disabled={existing ? !geom : !name.trim()} onClick={save}>{existing ? "Spara på kartan" : "Skapa"}</BusyButton>
    </div>
  );
}

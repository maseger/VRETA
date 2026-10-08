// Platser: Vretakartan, områden och byggnader, platser utanför Vreta (orter dit saker kommer ifrån), projekt och journal.
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useApp, useCan, useCommand, useLabels, useQuery } from "../app/AppContext";
import { Chip, Empty, ErrorNote, List, PageHeader, Progress, Row, Spinner, Stamp, Tabs, statusTone } from "../ui/base";
import { Thumb } from "../ui/media";
import { VretaMap, type MapFeature } from "../ui/VretaMap";
import { useMapImages, type MapLayerRow } from "../ui/mapImages";
import { LayerChips } from "./MapLayers";

type Tab = "karta" | "omraden" | "utanfor" | "projekt";
const LAYERS = [
  { code: "zones", label: "Zoner" }, { code: "structures", label: "Byggnader" }, { code: "projects", label: "Projekt" },
  { code: "reuse_in_use", label: "Återbruk" }, { code: "storage", label: "Lager" }, { code: "observations", label: "Observationer" },
];

export default function Places() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("flik") as Tab) || "karta";
  const can = useCan();
  return (
    <div>
      <PageHeader title="Platser" kicker="Vreta och världen runt omkring">
        {can("CreateProject") && <Link to="/projekt/ny" className="btn-secondary btn-small"><Plus size={16} /> Projekt</Link>}
        {can("CreatePlace") && <Link to="/platser/ny" className="btn-primary btn-small"><Plus size={16} /> Plats</Link>}
      </PageHeader>
      <Tabs<Tab> label="Visa" value={tab} onChange={(v) => setSp({ flik: v }, { replace: true })}
        tabs={[{ value: "karta", label: "Karta" }, { value: "omraden", label: "På Vreta" }, { value: "projekt", label: "Projekt" }, { value: "utanfor", label: "Utanför" }]} />
      {tab === "karta" && <MapTab />}
      {tab === "omraden" && <Areas />}
      {tab === "projekt" && <Projects />}
      {tab === "utanfor" && <Outside />}
    </div>
  );
}

function MapTab() {
  const nav = useNavigate();
  const can = useCan();
  const run = useCommand();
  const { refreshContext } = useApp();
  const { route } = useLabels();
  const { data, error, loading } = useQuery<{ features: MapFeature[]; basemaps: MapLayerRow[]; overlays: MapLayerRow[] }>("q_map");
  const [layers, setLayers] = useState(["zones", "structures", "projects", "reuse_in_use", "observations"]);
  const [mode, setMode] = useState<"now" | "all">("all");
  const [shown, setShown] = useState<string[] | null>(null);
  const features = useMemo(() => (data?.features ?? []).filter((f) => mode === "all" || f.reality_mode === "now"), [data, mode]);
  // Standardgrundbilden visas från början; övriga underlag slås på med chips
  const imageIds = shown ?? (data?.basemaps ?? []).filter((b) => b.is_default).map((b) => b.id);
  const images = useMapImages([...(data?.basemaps ?? []), ...(data?.overlays ?? [])].filter((l) => imageIds.includes(l.id)));
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  return (
    <div>
      <LayerChips basemaps={data?.basemaps ?? []} overlays={data?.overlays ?? []} value={imageIds} onChange={setShown} />
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {LAYERS.map((l) => <Chip key={l.code} on={layers.includes(l.code)} onClick={() => setLayers((x) => x.includes(l.code) ? x.filter((y) => y !== l.code) : [...x, l.code])}>{l.label}</Chip>)}
      </div>
      <div className="mb-2 flex gap-2">
        <Chip on={mode === "now"} onClick={() => setMode("now")}>Som det är nu</Chip>
        <Chip on={mode === "all"} onClick={() => setMode("all")}>Med planer och visioner</Chip>
      </div>
      <VretaMap features={features} layers={layers} height="62vh" images={images}
        onSaveCenter={can("SetSiteSetting") ? async (c) => {
          if (await run("SetSiteSetting", { key: "map_center", value: c }, { success: "Kartan öppnas här från och med nu" })) await refreshContext();
        } : undefined}
        onSelect={(f) => { const r = f.entity_type === "storage_location" ? `/lager/${f.entity_id}` : route(f.entity_type, f.entity_id); if (r) nav(r); }} />
      <p className="mt-2 text-sm text-sot-3">Heldraget = som det är nu · streckat = plan · ockra = vision. Tryck på något för att öppna det.
        {can("AddMapLayer") && <> · <Link to="/platser/kartlager">Kartunderlag</Link></>}</p>
    </div>
  );
}

function Areas() {
  const { code } = useLabels();
  const { data, error, loading } = useQuery<any>("q_places");
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const zones = data?.zones ?? [];
  const structures = data?.structures ?? [];
  const spaces = data?.spaces ?? [];
  return (
    <div>
      <h2 className="kicker mb-2">Områden</h2>
      {zones.length === 0 ? <Empty>Inga områden än.</Empty> : (
        <List className="mb-5">
          {zones.map((z: any) => (
            <Row key={z.id} to={`/zon/${z.id}`} leading={<Thumb m={z.cover} size={44} />}
              right={z.reality_mode !== "now" ? <Stamp tone={z.reality_mode === "vision" ? "vision" : "plan"}>{z.reality_mode === "vision" ? "Vision" : "Plan"}</Stamp> : z.pz != null ? <span className="text-sm text-sot-3">Zon {z.pz}</span> : null}>
              <div className="font-semibold">{z.name}</div>
              <div className="text-sm text-sot-3">{code("zone_type", z.type_code)}</div>
            </Row>
          ))}
        </List>
      )}
      <h2 className="kicker mb-2">Byggnader och anläggningar</h2>
      {structures.length === 0 ? <Empty>Inga byggnader än.</Empty> : (
        <List className="mb-5">
          {structures.map((s: any) => (
            <Row key={s.id} to={`/byggnad/${s.id}`} leading={<Thumb m={s.cover} size={44} />}
              right={s.reality_mode !== "now" ? <Stamp tone={s.reality_mode === "vision" ? "vision" : "plan"}>{s.reality_mode === "vision" ? "Vision" : "Plan"}</Stamp> : null}>
              <div className="font-semibold">{s.name}</div>
              <div className="text-sm text-sot-3">{[code("structure_type", s.type_code), spaces.filter((x: any) => x.structure_id === s.id).map((x: any) => x.name).join(", ")].filter(Boolean).join(" · ")}</div>
            </Row>
          ))}
        </List>
      )}
      <p className="text-sm text-sot-3"><Link to="/lager">Lagret</Link> har {data?.storage_count ?? 0} lagerplatser.</p>
    </div>
  );
}

function Outside() {
  const { code } = useLabels();
  const { data, error, loading } = useQuery<any>("q_places");
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const loc = data?.localities ?? [];
  if (!loc.length && !(data?.external_without_locality ?? []).length) return <Empty>Inga platser utanför Vreta än. De skapas när saker hämtas någonstans.</Empty>;
  return (
    <div>
      <p className="mb-3 text-sot-3">Orterna dit saker kommer ifrån och dit de går. Hemorter nämns aldrig i det som delas.</p>
      <List>
        {loc.map((l: any) => (
          <Row key={l.id} to={`/ort/${l.id}`} right={<span className="text-sm text-sot-3">{l.people} personer</span>}>
            <div className="font-semibold">{l.name}</div>
            <div className="text-sm text-sot-3">{[l.municipality, l.places.map((p: any) => p.name).join(", ")].filter(Boolean).join(" · ")}</div>
          </Row>
        ))}
        {(data?.external_without_locality ?? []).map((p: any) => (
          <Row key={p.id} to={`/plats/${p.id}`}><div className="font-semibold">{p.name}</div><div className="text-sm text-sot-3">{code("external_place_kind", p.kind_code)}</div></Row>
        ))}
      </List>
    </div>
  );
}

function Projects() {
  const { data, error, loading } = useQuery<any[]>("q_projects");
  const [done, setDone] = useState(false);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const shown = (data ?? []).filter((p) => done || p.status !== "done");
  return (
    <div>
      <div className="mb-3 flex gap-2"><Chip on={!done} onClick={() => setDone(false)}>Pågående och planerade</Chip><Chip on={done} onClick={() => setDone(true)}>Alla</Chip></div>
      {shown.length === 0 ? <Empty>Inga projekt.</Empty> : (
        <div className="flex flex-col gap-2">
          {shown.map((p) => (
            <Link key={p.id} to={`/projekt/${p.id}`} className="card block px-4 py-3 text-sot no-underline hover:no-underline">
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-lg font-semibold text-forest">{p.name}</div><div className="text-sm text-sot-3">{p.place}</div></div>
                <Stamp tone={statusTone(null, p.status)}>{p.status_label}</Stamp>
              </div>
              {p.needs_total > 0 && <div className="mt-2"><Progress value={p.needs_met} max={p.needs_total} /><div className="mt-1 text-sm text-sot-3">{p.needs_met} av {p.needs_total} behov uppfyllda</div></div>}
              {(p.canvas?.needs ?? []).filter((n: any) => !n.met).slice(0, 2).map((n: any) => <div key={n.id} className="text-sm text-sot-2">{n.title}: {n.progress}</div>)}
              {p.canvas?.last_event && <div className="mt-1 text-sm text-sot-3">Senast: {p.canvas.last_event.summary}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

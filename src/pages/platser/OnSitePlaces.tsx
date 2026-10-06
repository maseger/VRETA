import { Archive, ChevronRight, Crosshair, Eye, Hammer, Layers, Pencil, Plus, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, useData } from "../../app/AppContext";
import type { MapLayer } from "../../domain/types";
import { areaM2, centroid, closeRing, formatArea, zoneAt, type LngLat, type PolygonGeom } from "../../geo/geo";
import { VretaMap, type MapPin, type MapPolygon } from "../../geo/VretaMap";
import { Section } from "../../ui/bits";

type Mode = { kind: "view" } | { kind: "draw" } | { kind: "edit"; target: MapPolygon; vertices: LngLat[] };

/** Platser på Vreta: kartan, zoner och byggnader – och det som sker där: förvaring, projekt och observationer. */
export function OnSitePlaces() {
  const { repo, profile, refresh, toast } = useApp();
  const navigate = useNavigate();
  const canWrite = profile?.role !== "viewer";
  const { data } = useData(async (r) => {
    const [zones, structures, layers, usage, observations, objects, projects] = await Promise.all([
      r.zones(), r.structures(), r.mapLayers(), r.allUsageEvents(), r.observations(), r.objects(), r.projects(),
    ]);
    return { zones, structures, layers, usage, observations, objects, projects };
  });

  // Bildlager som blob-URL:er (fungerar offline när bilden är cachad)
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    let alive = true;
    const created: string[] = [];
    (async () => {
      const out: Record<string, string> = {};
      for (const l of data.layers) {
        const blob = await repo.mapImage(l).catch(() => null);
        if (blob) {
          out[l.id] = URL.createObjectURL(blob);
          created.push(out[l.id]);
        }
      }
      if (alive) setUrls(out);
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [data, repo]);

  const bases = data?.layers.filter((l) => l.kind === "base") ?? [];
  const overlays = data?.layers.filter((l) => l.kind === "overlay") ?? [];
  const [baseId, setBaseId] = useState<string | null>(null);
  const [shownOverlays, setShownOverlays] = useState<Record<string, number>>({});
  const [show, setShow] = useState({ zoner: true, byggnader: true, projekt: true, liv: true, obs: true });
  const [panel, setPanel] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [here, setHere] = useState<LngLat | null>(null);
  const [selected, setSelected] = useState<MapPolygon | null>(null);
  const [pin, setPin] = useState<MapPin | null>(null);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");

  const base: MapLayer | undefined = bases.find((b) => b.id === baseId) ?? bases[bases.length - 1];

  const images = useMemo(() => {
    const list = [];
    if (base && urls[base.id]) list.push({ id: base.id, url: urls[base.id], corners: base.corners as LngLat[], opacity: 1 });
    for (const o of overlays) if (shownOverlays[o.id] && urls[o.id]) list.push({ id: o.id, url: urls[o.id], corners: o.corners as LngLat[], opacity: shownOverlays[o.id] });
    return list;
  }, [base, overlays, shownOverlays, urls]);

  const polygons: MapPolygon[] = useMemo(() => {
    if (!data) return [];
    const out: MapPolygon[] = [];
    if (show.zoner) for (const z of data.zones) if (z.geom) out.push({ id: z.id, kind: "zone", name: z.name, geom: z.geom, highlight: selected?.id === z.id });
    if (show.byggnader) for (const s of data.structures) if (s.geom) out.push({ id: s.id, kind: "structure", name: s.name, geom: s.geom, highlight: selected?.id === s.id });
    if (show.projekt) for (const p of data.projects) if (p.geom && p.status !== "done") out.push({ id: p.id, kind: "project", name: p.name, geom: p.geom, highlight: selected?.id === p.id });
    if (mode.kind === "edit") return out.map((p) => (p.id === mode.target.id ? { ...p, geom: closeRing(mode.vertices), highlight: true } : p));
    return out;
  }, [data, show, selected, mode]);

  const pins: MapPin[] = useMemo(() => {
    if (!data) return [];
    const placeOf = (zone: string | null, structure: string | null): LngLat | null => {
      const g = data.zones.find((z) => z.id === zone)?.geom ?? data.structures.find((s) => s.id === structure)?.geom;
      return g ? centroid(g) : null;
    };
    const out: MapPin[] = [];
    if (show.liv) for (const u of data.usage) {
      const at = u.geom?.coordinates ?? placeOf(u.zone_id, u.structure_id);
      const o = data.objects.find((x) => x.id === u.object_id);
      if (at && o && u.type !== "removed") out.push({ id: `u:${u.object_id}`, at, kind: "usage", label: o.title });
    }
    if (show.obs) for (const ob of data.observations) {
      const at = ob.geom?.coordinates ?? placeOf(ob.zone_id, ob.structure_id);
      if (at) out.push({ id: `o:${ob.id}`, at, kind: "observation", label: ob.text });
    }
    if (here) out.push({ id: "here", at: here, kind: "here", label: "Du är här" });
    return out;
  }, [data, show, here]);

  const fitTo = base ? (base.corners as LngLat[]) : null;

  function locate() {
    if (!navigator.geolocation) return toast("Platstjänster stöds inte i den här webbläsaren");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setHere(p);
        const z = zoneAt(p, data?.zones ?? []);
        toast(z ? `Du står i ${z.name}` : "Du står utanför de inritade zonerna");
      },
      () => toast("Kunde inte hämta din position"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function saveDraft() {
    if (draft.length < 3 || !data) return;
    const geom: PolygonGeom = closeRing(draft);
    const [kind, id] = target.split(":");
    if (kind === "zone") await repo.setZoneGeom(id, geom);
    else if (kind === "structure") await repo.setStructureGeom(id, geom);
    else if (kind === "project") await repo.setProjectGeom(id, geom);
    else if (kind === "new-zone") await repo.setZoneGeom((await repo.createZone({ name: newName.trim(), kind: "", notes: "" })).id, geom);
    else if (kind === "new-structure") await repo.setStructureGeom((await repo.createStructure({ name: newName.trim(), kind: "", notes: "", zone_id: null })).id, geom);
    setDraft([]);
    setMode({ kind: "view" });
    setTarget("");
    setNewName("");
    await refresh();
    toast(`Sparat – ${formatArea(areaM2(geom))}`);
  }

  async function saveEdit() {
    if (mode.kind !== "edit") return;
    const geom = closeRing(mode.vertices);
    if (mode.target.kind === "zone") await repo.setZoneGeom(mode.target.id, geom);
    else if (mode.target.kind === "project") await repo.setProjectGeom(mode.target.id, geom);
    else await repo.setStructureGeom(mode.target.id, geom);
    setMode({ kind: "view" });
    setSelected(null);
    await refresh();
    toast("Hörnen är flyttade");
  }

  const count = (key: "zone_id" | "structure_id", id: string) => data?.objects.filter((o) => o[key] === id && o.status === "in_use").length ?? 0;
  const inProject = (id: string) => new Set(data?.usage.filter((u) => u.project_id === id).map((u) => u.object_id)).size;
  const unmapped = [...(data?.zones.filter((z) => !z.geom).map((z) => ({ v: `zone:${z.id}`, l: `Zon: ${z.name}` })) ?? []), ...(data?.structures.filter((s) => !s.geom).map((s) => ({ v: `structure:${s.id}`, l: `Byggnad: ${s.name}` })) ?? []), ...(data?.projects.filter((p) => !p.geom && p.status !== "done").map((p) => ({ v: `project:${p.id}`, l: `Projekt: ${p.name}` })) ?? [])];

  // Från projektsidan: ?rita=project:<id> börjar rita ytan, ?visa=project:<id> markerar den
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!data) return;
    const rita = params.get("rita");
    const visa = params.get("visa");
    if (!rita && !visa) return;
    if (rita && canWrite) {
      setMode({ kind: "draw" });
      setDraft([]);
      setTarget(rita);
    }
    if (visa) {
      const [, id] = visa.split(":");
      const p = data.projects.find((x) => x.id === id);
      if (p?.geom) setSelected({ id: p.id, kind: "project", name: p.name, geom: p.geom });
    }
    setParams({}, { replace: true });
  }, [data, params, setParams, canWrite]);

  return (
    <div>
      {/* Det som sker på platserna: saker förvaras, projekt genomförs, observationer görs */}
      <ul className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { to: "/lager", icon: Archive, title: "Förvaring", text: "Lagerplatser, QR-etiketter och vad som ligger var", n: `${data?.objects.filter((o) => o.status === "stored").length ?? 0} saker i lager` },
          { to: "/platser/projekt", icon: Hammer, title: "Projekt", text: "Byggen, planteringar och annat som tar saker i bruk", n: `${data?.projects.filter((p) => p.status === "active").length ?? 0} pågår` },
          { to: "/journal?filter=obs", icon: Eye, title: "Obser\u00ADvationer", text: "Djur, växter, väder och annat som syns på platsen", n: `${data?.observations.length ?? 0} observationer` },
        ].map(({ to, icon: Icon, title, text, n }) => (
          <li key={to}>
            <Link to={to} className="card flex h-full flex-col gap-1 p-3 hover:bg-kalk-2/60 sm:gap-2 sm:p-4">
              <Icon size={24} strokeWidth={1.5} className="text-falu" aria-hidden="true" />
              <span className="font-serif text-[15px] font-semibold leading-tight sm:text-lg">{title}</span>
              <span className="hidden flex-1 text-sm text-sot-3 sm:block">{text}</span>
              <span className="mt-auto text-[12px] font-semibold text-sot-2">{n}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="card relative mb-3 overflow-hidden">
        {bases.length === 0 && data && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-kalk-2/90 p-6 text-center">
            <p className="font-serif text-lg font-semibold">Vretakartan saknar grundbild</p>
            <p className="max-w-sm text-sm text-sot-3">Lägg in fastighetskartan eller en baskarta som grundbild. Den sparas i appen och fungerar utan nät.</p>
            {canWrite && <Link to="/platser/kartlager/ny" className="btn-primary"><Plus size={18} aria-hidden="true" /> Lägg till grundbild</Link>}
          </div>
        )}
        <VretaMap
          className="h-[62vh] min-h-[360px] w-full md:h-[560px]"
          images={images}
          polygons={polygons}
          pins={pins}
          draft={mode.kind === "draw" ? draft : null}
          editVertices={mode.kind === "edit" ? mode.vertices : null}
          fitTo={fitTo}
          onMapClick={mode.kind === "draw" ? (p) => setDraft((d) => [...d, p]) : undefined}
          onPolygonClick={(p) => { setSelected(p); setPin(null); }}
          onPinClick={(p) => { setPin(p); setSelected(null); }}
          onVertexMove={(i, p) => mode.kind === "edit" && setMode({ ...mode, vertices: mode.vertices.map((v, j) => (j === i ? p : v)) })}
        />
        <div className="absolute left-3 top-3 z-[5] flex flex-col gap-2">
          <button className="btn-secondary min-h-[40px] bg-[#FBF8F1] px-3 shadow-papper" onClick={() => setPanel((x) => !x)} aria-expanded={panel}><Layers size={18} aria-hidden="true" /> Lager</button>
          <button className="btn-secondary min-h-[40px] bg-[#FBF8F1] px-3 shadow-papper" onClick={locate}><Crosshair size={18} aria-hidden="true" /> Här</button>
          {canWrite && mode.kind === "view" && <button className="btn-secondary min-h-[40px] bg-[#FBF8F1] px-3 shadow-papper" onClick={() => { setMode({ kind: "draw" }); setDraft([]); setSelected(null); }}><Pencil size={18} aria-hidden="true" /> Rita</button>}
        </div>
      </div>

      {panel && (
        <div className="card mb-4 grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <p className="kicker mb-2">Grundbild</p>
            {bases.map((b) => (
              <label key={b.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="radio" name="base" className="accent-[#8C2F1D]" checked={base?.id === b.id} onChange={() => setBaseId(b.id)} />
                {b.name}{b.taken_on ? ` (${b.taken_on.slice(0, 4)})` : ""}
              </label>
            ))}
            {overlays.length > 0 && <p className="kicker mb-2 mt-3">Överlägg</p>}
            {overlays.map((o) => (
              <div key={o.id} className="py-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-[#8C2F1D]" checked={!!shownOverlays[o.id]} onChange={(e) => setShownOverlays((s) => ({ ...s, [o.id]: e.target.checked ? 0.7 : 0 }))} />
                  {o.name}
                </label>
                {!!shownOverlays[o.id] && <input type="range" min={0.1} max={1} step={0.05} value={shownOverlays[o.id]} onChange={(e) => setShownOverlays((s) => ({ ...s, [o.id]: Number(e.target.value) }))} className="ml-6 w-40 accent-[#8C2F1D]" aria-label={`Genomskinlighet för ${o.name}`} />}
              </div>
            ))}
            {canWrite && <Link to="/platser/kartlager/ny" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-falu"><Plus size={16} aria-hidden="true" /> Lägg till kartlager</Link>}
          </div>
          <div>
            <p className="kicker mb-2">Visa</p>
            {([["zoner", "Zoner"], ["byggnader", "Byggnader och anläggningar"], ["projekt", "Projekt"], ["liv", "Nytt liv"], ["obs", "Observationer"]] as [keyof typeof show, string][]).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" className="accent-[#4F5E3A]" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} /> {l}
              </label>
            ))}
          </div>
        </div>
      )}

      {mode.kind === "draw" && (
        <div className="card mb-4 space-y-3 border-ockra p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Rita en yta – tryck på kartan för varje hörn</p>
            <span className="text-sm text-sot-3">{draft.length} hörn{draft.length >= 3 ? ` · ${formatArea(areaM2(closeRing(draft)))}` : ""}</span>
          </div>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Vad ritar du?">
            <option value="">Vad ritar du?</option>
            {unmapped.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
            <option value="new-zone:">Ny zon …</option>
            <option value="new-structure:">Ny byggnad eller anläggning …</option>
          </select>
          {target.startsWith("new") && <input className="input" placeholder="Namn" value={newName} onChange={(e) => setNewName(e.target.value)} />}
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => { setMode({ kind: "view" }); setDraft([]); }}><X size={18} aria-hidden="true" /> Avbryt</button>
            <button className="btn-secondary" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}><Undo2 size={18} aria-hidden="true" /> Ångra hörn</button>
            <button className="btn-primary flex-1" disabled={draft.length < 3 || !target || (target.startsWith("new") && !newName.trim())} onClick={saveDraft}>Spara ytan</button>
          </div>
        </div>
      )}

      {mode.kind === "edit" && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 border-ockra p-4">
          <p className="flex-1 font-semibold">Dra hörnen på {mode.target.name} · {formatArea(areaM2(closeRing(mode.vertices)))}</p>
          <button className="btn-secondary" onClick={() => setMode({ kind: "view" })}>Avbryt</button>
          <button className="btn-primary" onClick={saveEdit}>Spara</button>
        </div>
      )}

      {selected && mode.kind === "view" && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
          <div className="flex-1">
            <p className="kicker">{{ zone: "Zon", structure: "Byggnad", project: "Projekt" }[selected.kind]} · {formatArea(areaM2(selected.geom))}</p>
            <p className="font-serif text-lg font-semibold">{selected.name}</p>
            <p className="text-sm text-sot-3">{selected.kind === "project" ? inProject(selected.id) : count(selected.kind === "zone" ? "zone_id" : "structure_id", selected.id)} objekt i bruk</p>
          </div>
          {canWrite && <button className="btn-secondary" onClick={() => setMode({ kind: "edit", target: selected, vertices: selected.geom.coordinates[0].slice(0, -1) as LngLat[] })}>Flytta hörn</button>}
          {selected.kind !== "structure" && <button className="btn-primary" onClick={() => navigate(selected.kind === "zone" ? `/zon/${selected.id}` : `/projekt/${selected.id}`)}>Öppna <ChevronRight size={18} aria-hidden="true" /></button>}
          <button className="btn-ghost" onClick={() => setSelected(null)} aria-label="Stäng"><X size={18} /></button>
        </div>
      )}

      {pin && (
        <div className="card mb-4 flex items-center gap-3 p-4">
          <p className="flex-1">{pin.kind === "usage" ? "Nytt liv: " : pin.kind === "observation" ? "Observation: " : ""}<strong>{pin.label}</strong></p>
          {pin.kind === "usage" && <Link className="btn-primary" to={`/objekt/${pin.id.slice(2)}`}>Öppna</Link>}
          <button className="btn-ghost" onClick={() => setPin(null)} aria-label="Stäng"><X size={18} /></button>
        </div>
      )}

      <div className="h-4" />
      <Section title="Områden" action={canWrite ? <Link to="/platser/ny?typ=zon" className="inline-flex items-center gap-1 text-sm font-semibold text-falu"><Plus size={16} aria-hidden="true" /> Nytt område</Link> : undefined}>
        <ul className="card divide-y divide-dashed divide-lera-light">
          {data?.zones.map((z) => (
            <li key={z.id}>
              <Link to={`/zon/${z.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-kalk-2/60">
                <span><span className="font-medium">{z.name}</span><span className="block text-sm text-sot-3">{[z.geom ? formatArea(areaM2(z.geom)) : "Inte inritad", z.notes].filter(Boolean).join(" · ")}</span></span>
                <span className="text-sm text-sot-3">{count("zone_id", z.id)} i bruk</span>
              </Link>
            </li>
          ))}
          {data && !data.zones.length && <li className="px-4 py-4 text-sm text-sot-3">Inga områden ännu. Lägg till trädgården, odlingen eller ängen – kartan kan ritas in senare.</li>}
        </ul>
      </Section>

      <Section title="Byggnader och anläggningar" action={canWrite ? <Link to="/platser/ny?typ=byggnad" className="inline-flex items-center gap-1 text-sm font-semibold text-falu"><Plus size={16} aria-hidden="true" /> Ny byggnad</Link> : undefined}>
        <ul className="card divide-y divide-dashed divide-lera-light">
          {data?.structures.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <span><span className="font-medium">{s.name}</span><span className="block text-sm text-sot-3">{[s.kind, s.geom ? formatArea(areaM2(s.geom)) : "Inte inritad"].filter(Boolean).join(" · ")}</span></span>
              <span className="flex items-center gap-3 text-sm text-sot-3">
                {canWrite && !s.geom && bases.length > 0 && <Link to={`/platser?rita=structure:${s.id}`} className="font-semibold text-falu">Rita in</Link>}
                {count("structure_id", s.id)} i bruk
              </span>
            </li>
          ))}
          {data && !data.structures.length && <li className="px-4 py-4 text-sm text-sot-3">Inga byggnader ännu. Lägg till huset, ladugården eller växthuset.</li>}
        </ul>
      </Section>
    </div>
  );
}

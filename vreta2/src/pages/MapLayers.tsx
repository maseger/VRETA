// Kartunderlag: platsens egna flygbilder, ritningar och gamla kartor läses in och läggs på Vretakartan.
// Bilden placeras med tre stödpunkter – samma ställe på bilden och på kartan – så att den hamnar rätt
// utan att någon karttjänst behövs. Underlagen är interna och visas aldrig publikt (INV-12).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ImagePlus, Trash2 } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { cornersFromControlPoints, type LonLat } from "../services/geo";
import { d } from "../app/format";
import { Card, Chip, Empty, ErrorNote, PageHeader, Section, Spinner, Stamp } from "../ui/base";
import { TextField, Select } from "../ui/fields";
import { BusyButton, ConfirmButton } from "../ui/sheet";
import { VretaMap, type MapFeature } from "../ui/VretaMap";
import type { MapLayerRow } from "../ui/mapImages";
import { useUpload } from "../ui/media";

export default function MapLayers() {
  const can = useCan();
  const run = useCommand();
  const { data, error, loading } = useQuery<{ features: MapFeature[]; basemaps: MapLayerRow[]; overlays: MapLayerRow[] }>("q_map");
  const [adding, setAdding] = useState(false);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  const layers = [...(data?.basemaps ?? []).map((b) => ({ ...b, kind: "basemap" })), ...(data?.overlays ?? []).map((o) => ({ ...o, kind: "overlay" }))];
  return (
    <div>
      <PageHeader kicker={<Link to="/platser">Platser</Link>} title="Kartunderlag" sub="Flygbilder, ritningar och gamla kartor som läggs under Vretakartan. De är interna och visas aldrig utåt.">
        {can("AddMapLayer") && !adding && <button type="button" className="btn-primary btn-small" onClick={() => setAdding(true)}><ImagePlus size={16} /> Läs in</button>}
      </PageHeader>
      {adding && <AddLayer features={data?.features ?? []} onDone={() => setAdding(false)} />}
      {!adding && (layers.length === 0 ? <Empty>Inga kartunderlag än. Läs in en flygbild eller ritning som JPG eller PNG.</Empty> : (
        <div className="flex flex-col gap-3">
          {layers.map((l) => (
            <Card key={l.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{l.name}</div>
                  <div className="text-sm text-sot-3">{l.kind === "basemap" ? "Grundbild" : "Överlägg"}{l.captured_on ? ` · ${d(l.captured_on)}` : ""}</div>
                </div>
                {l.is_default && <Stamp tone="ok">Standard</Stamp>}
              </div>
              {can("UpdateMapLayer") && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex flex-1 items-center gap-2 text-sm">Genomskinlighet
                    <input type="range" min={0.2} max={1} step={0.1} defaultValue={l.opacity} className="flex-1 accent-falu"
                      onChange={(e) => run("UpdateMapLayer", { id: l.id, opacity: Number(e.target.value) }, { silent: true })} />
                  </label>
                  {l.kind === "basemap" && !l.is_default && <BusyButton className="btn-ghost btn-small" onClick={() => run("UpdateMapLayer", { id: l.id, is_default: true }, { success: "Standard" })}>Gör till standard</BusyButton>}
                  {can("ArchiveEntity") && <ConfirmButton className="btn-ghost btn-small" question={`${l.name} tas bort från kartan.`} confirmLabel="Ta bort"
                    onConfirm={() => run("ArchiveEntity", { id: l.id }, { success: "Borttaget" })}><Trash2 size={15} /></ConfirmButton>}
                </div>
              )}
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

type Pt = { px: [number, number]; geo: LonLat | null };

function AddLayer({ features, onDone }: { features: MapFeature[]; onDone: () => void }) {
  const { repo } = useApp();
  const run = useCommand();
  const upload = useUpload();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [geo, setGeo] = useState<LonLat | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("basemap");
  const [captured, setCaptured] = useState("");
  const [opacity, setOpacity] = useState(0.85);
  const img = useRef<HTMLImageElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!file) return; const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);

  // Varje stödpunkt: först på bilden, sedan samma ställe på kartan
  const last = pts[pts.length - 1];
  const step = last && !last.geo ? "map" : pts.length < 3 ? "image" : "done";
  const corners = useMemo(() => {
    if (!size || pts.length < 3 || pts.some((p) => !p.geo)) return null;
    try { return cornersFromControlPoints(size, pts.map((p) => ({ px: p.px, geo: p.geo! }))); } catch { return null; }
  }, [pts, size]);
  const preview = useMemo(() => (corners && url ? [{ id: "preview", name, corners, opacity, url }] : []), [corners, url, opacity, name]);

  return (
    <Card className="mb-4">
      {!file ? (
        <div>
          <p className="mb-3 text-sot-2">Välj en flygbild, ritning eller karta (JPG eller PNG). Konvertera TIFF och PDF till JPG först.</p>
          <button type="button" className="btn-primary" onClick={() => pick.current?.click()}><ImagePlus size={18} /> Välj bild</button>
          <button type="button" className="btn-ghost ml-2" onClick={onDone}>Avbryt</button>
          <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setName(f.name.replace(/\.[^.]+$/, "")); } }} />
        </div>
      ) : (
        <>
          <Section title={step === "done" ? "Placerad" : `Stödpunkt ${step === "map" ? pts.length : pts.length + 1} av 3`}>
            <p className="mb-2 text-sot-2">
              {step === "image" && "Tryck på ett ställe du känner igen på bilden – ett husknut, en grind eller ett vägskäl."}
              {step === "map" && "Tryck på samma ställe på kartan och välj Nästa."}
              {step === "done" && (corners ? "Kontrollera att bilden ligger rätt. Ändra genomskinligheten eller börja om." : "Punkterna ligger på en linje – börja om och välj punkter som bildar en triangel.")}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="relative overflow-hidden rounded-xl border border-lera-light bg-kalk-2">
                {url && <img ref={img} src={url} alt="Kartunderlaget" className={`w-full ${step === "image" ? "cursor-crosshair" : ""}`}
                  onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  onClick={(e) => {
                    if (step !== "image" || !img.current || !size) return;
                    const r = img.current.getBoundingClientRect();
                    const px: [number, number] = [((e.clientX - r.left) / r.width) * size.w, ((e.clientY - r.top) / r.height) * size.h];
                    setPts((x) => [...x, { px, geo: null }]);
                    setGeo(null);
                  }} />}
                {size && pts.map((p, i) => (
                  <span key={i} className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-falu text-xs font-bold text-kalk ring-2 ring-kalk"
                    style={{ left: `${(p.px[0] / size.w) * 100}%`, top: `${(p.px[1] / size.h) * 100}%` }}>{i + 1}</span>
                ))}
              </div>
              <div>
                <VretaMap key={`m-${pts.length}-${step}`} features={features} height={320} images={preview}
                  draw={step === "map" ? "point" : null} onDraw={(g) => setGeo(g?.type === "Point" ? (g.coordinates as LonLat) : null)} />
                {step === "map" && (
                  <button type="button" className="btn-secondary btn-small mt-2" disabled={!geo}
                    onClick={() => { setPts((x) => x.map((p, i) => (i === x.length - 1 ? { ...p, geo } : p))); setGeo(null); }}>Nästa</button>
                )}
              </div>
            </div>
            {pts.length > 0 && <button type="button" className="btn-ghost btn-small mt-2" onClick={() => { setPts([]); setGeo(null); }}>Börja om</button>}
          </Section>
          <div className="grid gap-x-3 md:grid-cols-2">
            <TextField label="Namn" value={name} onChange={setName} />
            <Select label="Slag" value={kind} onChange={setKind} options={[{ value: "basemap", label: "Grundbild (flygbild, karta)" }, { value: "overlay", label: "Överlägg (ritning, plan)" }]} />
            <TextField label="Från (datum)" type="date" value={captured} onChange={setCaptured} />
            <label className="mb-3 block"><span className="label">Genomskinlighet</span>
              <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full accent-falu" /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <BusyButton className="btn-primary" disabled={!corners || !name.trim()} onClick={async () => {
              const [mediaId] = await upload([file]);
              const r = await run("AddMapLayer", { kind, name: name.trim(), media_id: mediaId, corners, captured_on: captured || null, opacity }, { success: "Kartunderlaget är inläst" });
              if (r) onDone();
            }}>Spara</BusyButton>
            <button type="button" className="btn-ghost" onClick={onDone}>Avbryt</button>
            {repo.mode === "demo" && <span className="self-center text-sm text-sot-3">I demoläget sparas bilden bara i den här webbläsaren.</span>}
          </div>
        </>
      )}
    </Card>
  );
}

export function LayerChips({ basemaps, overlays, value, onChange }: { basemaps: MapLayerRow[]; overlays: MapLayerRow[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!basemaps.length && !overlays.length) return null;
  return (
    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
      {[...basemaps, ...overlays].map((l) => (
        <Chip key={l.id} on={value.includes(l.id)} onClick={() => onChange(value.includes(l.id) ? value.filter((x) => x !== l.id) : [...value, l.id])}>{l.name}</Chip>
      ))}
    </div>
  );
}

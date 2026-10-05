import { Check, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { cornersFromControlPoints, type ControlPoint, type LngLat } from "../geo/geo";
import { VretaMap } from "../geo/VretaMap";
import { rasterizeIfSvg } from "../services/images";
import { PageHeader } from "../ui/bits";

/**
 * Lägg till grundbild eller överlägg i Vretakartan (FR-074).
 * A) Bild + hörnfil från scripts/prepare-basemap.py (GeoPDF/GeoTIFF med inbäddad georeferens).
 * B) Bild som placeras med tre stödpunkter mot en befintlig grundbild (t.ex. ritningar).
 */
export function MapLayerPage() {
  const { repo, refresh, toast } = useApp();
  const navigate = useNavigate();
  const { data } = useData((r) => r.mapLayers());
  const base = data?.filter((l) => l.kind === "base").at(-1);

  const [kind, setKind] = useState<"base" | "overlay">("overlay");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [method, setMethod] = useState<"fil" | "punkter">("punkter");
  const [cornersJson, setCornersJson] = useState<LngLat[] | null>(null);
  const [srcCrs, setSrcCrs] = useState("");
  const [imgPts, setImgPts] = useState<[number, number][]>([]);
  const [mapPts, setMapPts] = useState<LngLat[]>([]);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (data && !base) {
      setKind("base");
      setMethod("fil");
    }
  }, [data, base]);

  useEffect(() => {
    if (!base) return;
    let url: string | null = null;
    repo.mapImage(base).then((b) => b && setBaseUrl((url = URL.createObjectURL(b))));
    return () => void (url && URL.revokeObjectURL(url));
  }, [base, repo]);

  function pickImage(f: File | null) {
    setFile(f);
    setImgPts([]);
    setMapPts([]);
    setSize(null);
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    if (!f) return setImgUrl(null);
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    const u = URL.createObjectURL(f);
    setImgUrl(u);
    const im = new Image();
    im.onload = () => setSize({ w: im.naturalWidth, h: im.naturalHeight });
    im.src = u;
  }

  async function pickCorners(f: File | null) {
    setError(null);
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()) as { corners: LngLat[]; source_crs?: string };
      if (!Array.isArray(j.corners) || j.corners.length !== 4) throw new Error();
      setCornersJson(j.corners);
      setSrcCrs(j.source_crs ?? "");
    } catch {
      setError("Hörnfilen ska vara JSON med fyra hörn: { \"corners\": [[lon,lat] × 4] }");
    }
  }

  const corners: LngLat[] | null = useMemo(() => {
    if (method === "fil") return cornersJson;
    if (!size || imgPts.length < 3 || mapPts.length < 3) return null;
    try {
      return cornersFromControlPoints(imgPts.slice(0, 3).map((p, i): ControlPoint => ({ pixel: p, lngLat: mapPts[i] })), size.w, size.h);
    } catch {
      return null;
    }
  }, [method, cornersJson, size, imgPts, mapPts]);

  async function save() {
    if (!file || !corners) return;
    setBusy(true);
    setError(null);
    try {
      await repo.addMapLayer({ kind, name: name.trim() || file.name, taken_on: date || null, image: await rasterizeIfSvg(file), corners, source_crs: method === "fil" ? srcCrs : "stödpunkter", opacity: kind === "base" ? 1 : 0.7 });
      await refresh();
      toast(kind === "base" ? "Grundbilden är tillagd" : "Överlägget är tillagt");
      navigate("/platser");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const images = useMemo(() => {
    const list = [];
    if (baseUrl && base) list.push({ id: base.id, url: baseUrl, corners: base.corners as LngLat[], opacity: 1 });
    if (imgUrl && corners) list.push({ id: "forhandsvisning", url: imgUrl, corners, opacity: 0.65 });
    return list;
  }, [baseUrl, base, imgUrl, corners]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/platser" className="text-sm font-semibold text-falu">← Vretakartan</Link>
      <PageHeader kicker="Vretakartan" title="Lägg till kartlager" />

      <div className="card mb-5 grid gap-4 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button className={`chip ${kind === "base" ? "chip-on" : ""}`} onClick={() => setKind("base")}>Grundbild (karta, ortofoto)</button>
          <button className={`chip ${kind === "overlay" ? "chip-on" : ""}`} onClick={() => setKind("overlay")} disabled={!base}>Överlägg (ritning, plan)</button>
        </div>
        <div><label className="field-label" htmlFor="n">Namn</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Situationsplan brunn och avlopp" /></div>
        <div><label className="field-label" htmlFor="d">Datum för underlaget</label><input id="d" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="f">Bild (PNG, JPG eller SVG)</label>
          <input id="f" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="input" onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />
          <p className="mt-1 text-[12px] text-sot-3">PDF och GeoTIFF konverteras först med <code>scripts/prepare-basemap.py</code>, som också skapar hörnfilen. Underlaget sparas privat och visas aldrig publikt.</p>
        </div>
      </div>

      {file && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button className={`chip ${method === "fil" ? "chip-on" : ""}`} onClick={() => setMethod("fil")}>Jag har en hörnfil</button>
          <button className={`chip ${method === "punkter" ? "chip-on" : ""}`} onClick={() => setMethod("punkter")} disabled={!base}>Placera med tre stödpunkter</button>
        </div>
      )}

      {file && method === "fil" && (
        <div className="card mb-5 p-4">
          <label className="field-label" htmlFor="c">Hörnfil (.json)</label>
          <input id="c" type="file" accept="application/json,.json" className="input" onChange={(e) => pickCorners(e.target.files?.[0] ?? null)} />
          {cornersJson && <p className="mt-2 flex items-center gap-1.5 text-sm text-linolja"><Check size={16} aria-hidden="true" /> Fyra hörn inlästa{srcCrs ? ` (källa ${srcCrs})` : ""}</p>}
        </div>
      )}

      {file && method === "punkter" && imgUrl && (
        <div className="mb-5 grid gap-4 md:grid-cols-2">
          <div className="card p-3">
            <p className="mb-2 text-sm font-semibold">1. Klicka tre tydliga punkter på bilden <span className="text-sot-3">({imgPts.length}/3)</span></p>
            <div className="relative">
              <img
                ref={imgRef}
                src={imgUrl}
                alt="Kartlager att placera"
                className="w-full cursor-crosshair rounded-sm"
                onClick={(e) => {
                  if (imgPts.length >= 3 || !size) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setImgPts((p) => [...p, [((e.clientX - r.left) / r.width) * size.w, ((e.clientY - r.top) / r.height) * size.h]]);
                }}
              />
              {size && imgPts.map(([x, y], i) => (
                <span key={i} className="vreta-vertex absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(x / size.w) * 100}%`, top: `${(y / size.h) * 100}%` }}>{i + 1}</span>
              ))}
            </div>
          </div>
          <div className="card overflow-hidden">
            <p className="p-3 text-sm font-semibold">2. Klicka samma punkter på kartan <span className="text-sot-3">({mapPts.length}/3)</span></p>
            <VretaMap
              className="h-80 w-full"
              images={images}
              polygons={[]}
              pins={mapPts.map((p, i) => ({ id: `p${i}`, at: p, kind: "draft", label: `Punkt ${i + 1}` }))}
              draft={null}
              editVertices={null}
              fitTo={base ? (base.corners as LngLat[]) : null}
              onMapClick={(p) => setMapPts((m) => (m.length >= 3 ? m : [...m, p]))}
            />
          </div>
          <button className="btn-ghost -ml-3 text-sm" onClick={() => { setImgPts([]); setMapPts([]); }}><RotateCcw size={16} aria-hidden="true" /> Börja om med punkterna</button>
        </div>
      )}

      {corners && (
        <p className="mb-4 flex items-center gap-1.5 text-sm text-linolja"><Check size={16} aria-hidden="true" /> Placeringen är beräknad – kontrollera förhandsvisningen ovan.</p>
      )}
      {error && <p className="mb-4 text-sm text-falu">{error}</p>}
      <button className="btn-primary w-full" disabled={!file || !corners || busy} onClick={save}>
        {busy && <Loader2 className="animate-spin" size={18} />} Spara kartlagret
      </button>
    </div>
  );
}

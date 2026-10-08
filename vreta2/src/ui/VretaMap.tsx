// Vretakartan: platsens egen karta på papper – zoner, byggnader, projekt, återbruk i bruk, lager och observationer.
// Nu ritas heldraget, plan streckat och vision skrafferat i ockra (Designdokument 2.0, Kartlägen). Ingen extern
// karttjänst behövs; bakgrundskarta från OpenStreetMap och egna flygbilder/ritningar kan läggas under.
import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MLMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type ImageSource, type StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";

// Kartans worker följer med i bygget som egen fil (annars letar MapLibre bredvid den sammanslagna koden)
setWorkerUrl(new URL(workerUrl, location.href).href);
import { useApp } from "../app/AppContext";

export type MapFeature = {
  id: string; layer: string; entity_id: string | null; entity_type: string | null; label: string | null; reality_mode: string; status: string | null;
  props: Record<string, any>; geometry: GeoJSON.Geometry;
};
export type MapImageLayer = { id: string; name: string; corners: [number, number][]; opacity: number; url: string };

const WATER = new Set(["pond", "stream", "wetland", "rain_garden", "swale", "water"]);

function toFC(features: MapFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature", id: f.id, geometry: f.geometry,
      properties: { id: f.id, layer: f.layer, entity_id: f.entity_id, entity_type: f.entity_type, label: f.label ?? "", mode: f.reality_mode,
        status: f.status ?? "", water: WATER.has(f.props?.type_code) ? 1 : 0 },
    })),
  };
}

const STYLE = (osm: boolean): StyleSpecification => ({
  version: 8,
  sources: osm ? { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap-bidragsgivare", maxzoom: 19 } } : {},
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#F4EFE4" } },
    ...(osm ? [{ id: "osm", type: "raster" as const, source: "osm", paint: { "raster-opacity": 0.55, "raster-saturation": -0.6 } }] : []),
  ],
});

export function VretaMap({ features, layers, onSelect, height = 420, draw, onDraw, center, images = [], highlight, fitTo, seed, onSaveCenter }: {
  features: MapFeature[]; layers?: string[]; onSelect?: (f: { entity_id: string | null; entity_type: string | null; label: string }) => void; height?: number | string;
  draw?: "point" | "line" | "polygon" | null; onDraw?: (g: GeoJSON.Geometry | null) => void; center?: [number, number]; images?: MapImageLayer[];
  highlight?: string | null; fitTo?: GeoJSON.Geometry | null; seed?: [number, number] | null;
  onSaveCenter?: (c: [number, number]) => Promise<unknown> | void;
}) {
  const { ctx } = useApp();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [osm, setOsm] = useState(() => localStorage.getItem("vreta2-osm") === "1");
  const pts = useRef<[number, number][]>([]);
  const [drawn, setDrawn] = useState(0);
  const cb = useRef({ onSelect, onDraw, draw });
  cb.current = { onSelect, onDraw, draw };

  // Kartan skapas en gång (och om bakgrunden byts)
  useEffect(() => {
    if (!el.current) return;
    // Kartans mitt: inställningen map_center (exakt, sätts av ägaren) före platsens ungefärliga läge
    const mc = ctx?.settings?.map_center;
    const saved: [number, number] | null = Array.isArray(mc) && mc.length === 2 && mc.every((x: unknown) => Number.isFinite(Number(x))) ? [Number(mc[0]), Number(mc[1])] : null;
    const c: [number, number] = center ?? saved ?? [ctx?.site?.approx_lon ?? 17.585, ctx?.site?.approx_lat ?? 59.842];
    const m = new MLMap({ container: el.current, style: STYLE(osm), center: c, zoom: 17, attributionControl: osm ? {} : false, maxZoom: 21 });
    m.addControl(new NavigationControl({ showCompass: true }), "top-right");
    m.on("load", () => {
      m.addSource("vreta", { type: "geojson", data: toFC([]) });
      m.addSource("draft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      const poly = ["==", ["geometry-type"], "Polygon"] as any;
      const line = ["==", ["geometry-type"], "LineString"] as any;
      const point = ["==", ["geometry-type"], "Point"] as any;
      m.addLayer({ id: "zones-fill", type: "fill", source: "vreta", filter: ["all", poly, ["==", ["get", "layer"], "zones"]],
        paint: { "fill-color": ["case", ["==", ["get", "water"], 1], "#8FA9B3", ["==", ["get", "mode"], "vision"], "#E3C27E", "#A9B48A"], "fill-opacity": ["case", ["==", ["get", "mode"], "now"], 0.35, 0.18] } });
      m.addLayer({ id: "zones-line", type: "line", source: "vreta", filter: ["all", poly, ["==", ["get", "layer"], "zones"]],
        paint: { "line-color": ["case", ["==", ["get", "mode"], "vision"], "#B9852B", "#4F5E3A"], "line-width": 1.5,
          "line-dasharray": ["case", ["==", ["get", "mode"], "now"], ["literal", [1, 0]], ["literal", [2, 2]]] } });
      m.addLayer({ id: "structures-fill", type: "fill", source: "vreta", filter: ["all", poly, ["==", ["get", "layer"], "structures"]],
        paint: { "fill-color": ["case", ["==", ["get", "mode"], "now"], "#B49E7E", "#E3C27E"], "fill-opacity": ["case", ["==", ["get", "mode"], "now"], 0.75, 0.3] } });
      m.addLayer({ id: "structures-line", type: "line", source: "vreta", filter: ["all", poly, ["==", ["get", "layer"], "structures"]],
        paint: { "line-color": ["case", ["==", ["get", "mode"], "now"], "#4A463F", "#B9852B"], "line-width": 1.5,
          "line-dasharray": ["case", ["==", ["get", "mode"], "now"], ["literal", [1, 0]], ["literal", [3, 2]]] } });
      m.addLayer({ id: "projects-line", type: "line", source: "vreta", filter: ["all", poly, ["==", ["get", "layer"], "projects"]],
        paint: { "line-color": "#8C2F1D", "line-width": 2, "line-dasharray": [2, 1.5], "line-offset": -2 } });
      m.addLayer({ id: "lines", type: "line", source: "vreta", filter: line, paint: { "line-color": "#6E685E", "line-width": 2.5, "line-dasharray": [1, 1] } });
      m.addLayer({ id: "points", type: "circle", source: "vreta", filter: point,
        paint: { "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#FBF8F1",
          "circle-color": ["match", ["get", "layer"], "observations", "#7C8A5C", "reuse_in_use", "#B9852B", "storage", "#4A463F", "#8C2F1D"] } });
      m.addLayer({ id: "highlight", type: "line", source: "vreta", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#8C2F1D", "line-width": 4 } });
      m.addLayer({ id: "draft-fill", type: "fill", source: "draft", filter: poly, paint: { "fill-color": "#8C2F1D", "fill-opacity": 0.15 } });
      m.addLayer({ id: "draft-line", type: "line", source: "draft", filter: ["any", poly, line], paint: { "line-color": "#8C2F1D", "line-width": 2.5 } });
      m.addLayer({ id: "draft-pts", type: "circle", source: "draft", filter: point, paint: { "circle-radius": 6, "circle-color": "#8C2F1D", "circle-stroke-color": "#FBF8F1", "circle-stroke-width": 2 } });
      for (const id of ["zones-fill", "structures-fill", "points", "projects-line", "lines"]) {
        m.on("click", id, (e) => {
          if (cb.current.draw) return;
          const p = e.features?.[0]?.properties as any;
          if (p) cb.current.onSelect?.({ entity_id: p.entity_id || null, entity_type: p.entity_type || null, label: p.label });
        });
        m.on("mouseenter", id, () => { if (!cb.current.draw) m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
      }
      m.on("click", (e) => {
        if (!cb.current.draw) return;
        const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        pts.current = cb.current.draw === "point" ? [p] : [...pts.current, p];
        setDrawn((n) => n + 1);
      });
      setReady(true);
    });
    map.current = m;
    return () => { markers.current.forEach((x) => x.remove()); m.remove(); map.current = null; setReady(false); };
  }, [osm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data, synliga lager och etiketter
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const shown = layers ? features.filter((f) => layers.includes(f.layer)) : features;
    (m.getSource("vreta") as GeoJSONSource).setData(toFC(shown));
    markers.current.forEach((x) => x.remove());
    markers.current = shown.filter((f) => (f.layer === "zones" || f.layer === "structures") && f.label).map((f) => {
      const div = document.createElement("div");
      div.className = `pointer-events-none select-none whitespace-nowrap rounded px-1 text-[11px] font-semibold ${f.reality_mode === "now" ? "text-sot-2" : "italic text-ockra"}`;
      div.style.textShadow = "0 0 3px #F4EFE4, 0 0 3px #F4EFE4";
      div.textContent = f.label + (f.reality_mode === "vision" ? " (vision)" : f.reality_mode === "plan" ? " (plan)" : "");
      return new Marker({ element: div }).setLngLat(centroid(f.geometry)).addTo(m);
    });
    m.setFilter("highlight", ["==", ["get", "entity_id"], highlight ?? ""]);
  }, [features, layers, ready, highlight]);

  // Bildlager (egen flygbild eller ritning, georefererad med fyra hörn): läggs under zonerna
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const want = new Set(images.map((i) => `img-${i.id}`));
    for (const l of m.getStyle().layers ?? []) {
      if (l.id.startsWith("img-") && !want.has(l.id)) { m.removeLayer(l.id); m.removeSource(l.id); }
    }
    for (const img of images) {
      const sid = `img-${img.id}`;
      const src = m.getSource(sid) as ImageSource | undefined;
      if (!src) {
        m.addSource(sid, { type: "image", url: img.url, coordinates: img.corners as any });
        m.addLayer({ id: sid, type: "raster", source: sid, paint: { "raster-opacity": img.opacity ?? 0.8 } }, "zones-fill");
      } else {
        src.setCoordinates(img.corners as any);
        m.setPaintProperty(sid, "raster-opacity", img.opacity ?? 0.8);
      }
    }
  }, [images, ready]);

  // Anpassa vyn efter innehållet
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const geoms = fitTo ? [fitTo] : features.map((f) => f.geometry);
    const b = new LngLatBounds();
    let n = 0;
    for (const g of geoms) for (const c of coords(g)) { b.extend(c); n++; }
    if (n > 0) m.fitBounds(b, { padding: 40, maxZoom: 19, duration: 0 });
  }, [ready, fitTo, features.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // En punkt från GPS ("Här står jag") blir första punkten i ritningen
  useEffect(() => {
    if (!seed) return;
    pts.current = [seed];
    setDrawn((n) => n + 1);
    map.current?.easeTo({ center: seed, zoom: Math.max(map.current.getZoom(), 18) });
  }, [seed]);

  // Ritning
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (!draw) { pts.current = []; }
    const p = pts.current;
    const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: p.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} })) };
    let geom: GeoJSON.Geometry | null = null;
    if (draw === "point" && p.length) geom = { type: "Point", coordinates: p[0] };
    if (draw === "line" && p.length >= 2) geom = { type: "LineString", coordinates: p };
    if (draw === "polygon" && p.length >= 3) geom = { type: "Polygon", coordinates: [[...p, p[0]]] };
    if (draw === "polygon" && p.length === 2) fc.features.push({ type: "Feature", geometry: { type: "LineString", coordinates: p }, properties: {} });
    if (geom && geom.type !== "Point") fc.features.push({ type: "Feature", geometry: geom, properties: {} });
    (m.getSource("draft") as GeoJSONSource).setData(fc);
    m.getCanvas().style.cursor = draw ? "crosshair" : "";
    cb.current.onDraw?.(geom);
  }, [drawn, draw, ready]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-lera-light shadow-papper" style={{ height }}>
      <div ref={el} className="h-full w-full" aria-label="Karta över Vreta" role="region" />
      <div className="absolute bottom-2 left-2 flex gap-1">
        <button type="button" className="rounded-md bg-papper/90 px-2 py-1 text-xs shadow-papper" onClick={() => { const v = !osm; setOsm(v); localStorage.setItem("vreta2-osm", v ? "1" : "0"); }}>
          {osm ? "Bara Vretakartan" : "Visa bakgrundskarta"}
        </button>
        {onSaveCenter && !draw && (
          <button type="button" className="rounded-md bg-papper/90 px-2 py-1 text-xs shadow-papper" onClick={() => {
            const m = map.current;
            if (m) { const c = m.getCenter(); void onSaveCenter([Math.round(c.lng * 1e6) / 1e6, Math.round(c.lat * 1e6) / 1e6]); }
          }}>Gör detta till kartans mitt</button>
        )}
        {draw && draw !== "point" && pts.current.length > 0 && (
          <button type="button" className="rounded-md bg-papper/90 px-2 py-1 text-xs shadow-papper" onClick={() => { pts.current = pts.current.slice(0, -1); setDrawn((n) => n + 1); }}>Ångra punkt</button>
        )}
      </div>
      {draw && <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-sot/80 px-2 py-1 text-xs text-kalk">
        {draw === "point" ? "Tryck där det är" : draw === "line" ? "Tryck längs linjen" : "Tryck runt ytan, hörn för hörn"}</div>}
    </div>
  );
}

function coords(g: GeoJSON.Geometry): [number, number][] {
  switch (g.type) {
    case "Point": return [g.coordinates as [number, number]];
    case "LineString": case "MultiPoint": return g.coordinates as [number, number][];
    case "Polygon": case "MultiLineString": return (g.coordinates as [number, number][][]).flat();
    case "MultiPolygon": return (g.coordinates as [number, number][][][]).flat(2);
    default: return [];
  }
}

export function centroid(g: GeoJSON.Geometry): [number, number] {
  const c = g.type === "Polygon" ? (g.coordinates[0] as [number, number][]).slice(0, -1) : coords(g);
  if (!c.length) return [0, 0];
  return [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
}

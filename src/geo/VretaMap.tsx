// Vretakartan: MapLibre utan externa kartplattor eller typsnitt, så att den fungerar offline.
// Grundbilder och överlägg är egna bilder med fyra hörnkoordinater; zoner och byggnader är
// GeoJSON-ytor; etiketter och nålar är HTML-markörer.
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef } from "react";
import { boundsOf, centroid, type LngLat, type PolygonGeom } from "./geo";

export interface MapImageLayer {
  id: string;
  url: string;
  corners: LngLat[];
  opacity: number;
}

export interface MapPolygon {
  id: string;
  kind: "zone" | "structure" | "project";
  name: string;
  geom: PolygonGeom;
  highlight?: boolean;
}

export interface MapPin {
  id: string;
  at: LngLat;
  kind: "usage" | "observation" | "here" | "draft";
  label: string;
}

interface Props {
  images: MapImageLayer[];
  polygons: MapPolygon[];
  pins: MapPin[];
  draft: LngLat[] | null;
  editVertices: LngLat[] | null;
  fitTo: LngLat[] | null;
  onMapClick?: (p: LngLat) => void;
  onPolygonClick?: (p: MapPolygon) => void;
  onPinClick?: (p: MapPin) => void;
  onVertexMove?: (index: number, p: LngLat) => void;
  className?: string;
}

// Vite bygger MapLibres worker som egen fil; utan detta letar MapLibre bredvid huvudpaketet.
maplibregl.setWorkerUrl(workerUrl);

const PALETTE = {
  zone: "#4F5E3A",
  structure: "#8C2F1D",
  project: "#3F5F78",
  draft: "#B9852B",
};

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export function VretaMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const vertexMarkers = useRef<maplibregl.Marker[]>([]);
  const imageIds = useRef<string[]>([]);
  const cb = useRef(props);
  cb.current = props;

  // Skapa kartan en gång
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: { version: 8, sources: {}, layers: [{ id: "bakgrund", type: "background", paint: { "background-color": "#E6DCC7" } }] },
      center: [15, 60],
      zoom: 16,
      attributionControl: false,
      maxZoom: 23,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("load", () => {
      map.addSource("polygons", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "poly-fill", type: "fill", source: "polygons", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "highlight"], 0.35, 0.16] } });
      map.addLayer({ id: "poly-line", type: "line", source: "polygons", paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "highlight"], 3, 1.6] } });
      map.addSource("draft", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "draft-fill", type: "fill", source: "draft", filter: ["==", "$type", "Polygon"], paint: { "fill-color": PALETTE.draft, "fill-opacity": 0.2 } });
      map.addLayer({ id: "draft-line", type: "line", source: "draft", paint: { "line-color": PALETTE.draft, "line-width": 2.5, "line-dasharray": [2, 1.5] } });
      ready.current = true;
      sync();
    });
    map.on("click", (e: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["poly-fill"] })[0];
      const p = cb.current;
      if (p.onMapClick) {
        p.onMapClick([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (hit && p.onPolygonClick) {
        const poly = p.polygons.find((x) => x.id === hit.properties?.id);
        if (poly) p.onPolygonClick(poly);
      }
    });
    map.on("mousemove", (e: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["poly-fill"] }).length > 0;
      map.getCanvas().style.cursor = cb.current.onMapClick ? "crosshair" : hit ? "pointer" : "";
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const p = cb.current;

    // Bildlager (grundbild underst, sedan överlägg) – byggs om när listan ändras
    const wanted = p.images.map((i) => `img-${i.id}-${i.url.slice(-8)}`);
    if (wanted.join() !== imageIds.current.join()) {
      for (const id of imageIds.current) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      p.images.forEach((img, i) => {
        const id = wanted[i];
        map.addSource(id, { type: "image", url: img.url, coordinates: img.corners as [LngLat, LngLat, LngLat, LngLat] });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": img.opacity, "raster-fade-duration": 0 } }, "poly-fill");
      });
      imageIds.current = wanted;
    } else {
      p.images.forEach((img, i) => map.getLayer(wanted[i]) && map.setPaintProperty(wanted[i], "raster-opacity", img.opacity));
    }

    (map.getSource("polygons") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p.polygons.map((poly) => ({
        type: "Feature",
        geometry: poly.geom,
        properties: { id: poly.id, color: PALETTE[poly.kind], highlight: !!poly.highlight },
      })),
    });

    const d = p.draft ?? [];
    (map.getSource("draft") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: d.length >= 3
        ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[...d, d[0]]] }, properties: {} }]
        : d.length === 2 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: d }, properties: {} }] : [],
    });

    // Etiketter och nålar som HTML (inga typsnitt behövs offline)
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    for (const poly of p.polygons) {
      const el = document.createElement("div");
      el.className = `vreta-label vreta-label-${poly.kind}`;
      el.textContent = poly.name;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(centroid(poly.geom)).addTo(map));
    }
    for (const pin of p.pins) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `vreta-pin vreta-pin-${pin.kind}`;
      el.title = pin.label;
      el.setAttribute("aria-label", pin.label);
      el.onclick = (ev) => {
        ev.stopPropagation();
        cb.current.onPinClick?.(pin);
      };
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(pin.at).addTo(map));
    }
    for (const [i, v] of d.entries()) {
      const el = document.createElement("div");
      el.className = "vreta-vertex";
      el.textContent = String(i + 1);
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(v).addTo(map));
    }

    // Flyttbara hörn vid redigering (FR-075)
    vertexMarkers.current.forEach((m) => m.remove());
    vertexMarkers.current = [];
    (p.editVertices ?? []).forEach((v, i) => {
      const el = document.createElement("div");
      el.className = "vreta-vertex vreta-vertex-edit";
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(v).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLngLat();
        cb.current.onVertexMove?.(i, [ll.lng, ll.lat]);
      });
      vertexMarkers.current.push(m);
    });
  }

  useEffect(sync);

  // Zooma till fastigheten när underlaget ändras
  const fitKey = props.fitTo?.map((p) => p.join(",")).join(";") ?? "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.fitTo?.length) return;
    const go = () => map.fitBounds(boundsOf(props.fitTo!), { padding: 30, duration: 0, maxZoom: 20 });
    if (ready.current) go();
    else map.once("load", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={container} className={props.className} />;
}

// Kartunderlagen (flygbilder, ritningar, gamla kartor) som bildlager på Vretakartan.
import { useEffect, useState } from "react";
import { useApp } from "../app/AppContext";
import type { MapImageLayer } from "./VretaMap";

export type MapLayerRow = { id: string; name: string; corners: [number, number][]; opacity: number; is_default?: boolean; layer_code?: string | null; captured_on?: string | null;
  media?: { share_path?: string | null; thumb_path?: string | null; width?: number; height?: number } | null };

export function useMapImages(rows: MapLayerRow[]): MapImageLayer[] {
  const { repo } = useApp();
  const [out, setOut] = useState<MapImageLayer[]>([]);
  const key = rows.map((r) => `${r.id}:${r.opacity}:${JSON.stringify(r.corners)}`).join("|");
  useEffect(() => {
    let alive = true;
    Promise.all(rows.filter((r) => r.media?.share_path && r.corners?.length === 4).map(async (r) => {
      const url = await repo.mediaUrl(r.media!.share_path);
      return url ? { id: r.id, name: r.name, corners: r.corners, opacity: Number(r.opacity ?? 0.8), url } : null;
    })).then((x) => alive && setOut(x.filter(Boolean) as MapImageLayer[]));
    return () => { alive = false; };
  }, [key, repo]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}

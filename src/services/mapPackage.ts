// Kartpaket från scripts/kartpaket.py: flera kartlager (bild + hörn) i en enda fil,
// så att grundbild och överlägg kan läsas in med ett tryck även från mobilen.
import type { NewMapLayer } from "../data/repo";

interface PackageLayer {
  name: string;
  kind: "base" | "overlay";
  taken_on: string | null;
  corners: [number, number][];
  source_crs?: string;
  image: string; // data-URL
}

const isLngLat = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

function dataUrlToBlob(url: string): Blob {
  const m = /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/.exec(url);
  if (!m) throw new Error("Bilden i kartpaketet har ett okänt format.");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/** Läser ett kartpaket och ger lagren i den ordning de ska läggas till: grundbilder först. */
export function parseMapPackage(text: string): NewMapLayer[] {
  let json: { format?: string; layers?: PackageLayer[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Filen är inte ett kartpaket.");
  }
  if (json.format !== "vreta-kartpaket" || !Array.isArray(json.layers) || json.layers.length === 0) {
    throw new Error("Filen är inte ett kartpaket.");
  }
  return json.layers
    .map((l): NewMapLayer => {
      if (l.kind !== "base" && l.kind !== "overlay") throw new Error(`Okänd lagertyp i ${l.name}.`);
      if (!Array.isArray(l.corners) || l.corners.length !== 4 || !l.corners.every(isLngLat)) {
        throw new Error(`${l.name || "Ett lager"} saknar fyra giltiga hörn.`);
      }
      return {
        kind: l.kind,
        name: l.name || "Kartlager",
        taken_on: l.taken_on ?? null,
        corners: l.corners,
        source_crs: l.source_crs ?? "",
        opacity: l.kind === "base" ? 1 : 0.7,
        image: dataUrlToBlob(l.image),
      };
    })
    .sort((a, b) => Number(a.kind !== "base") - Number(b.kind !== "base"));
}

// Geometri i WGS 84 för Vretakartan. Små ytor (en fastighet), så platta approximationer räcker.
export type LngLat = [number, number];
export interface PolygonGeom { type: "Polygon"; coordinates: LngLat[][] }
export interface PointGeom { type: "Point"; coordinates: LngLat }

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Punkt i polygon (ray casting) – används för "Här"-knappen (AC-23). */
export function pointInPolygon(p: LngLat, poly: PolygonGeom): boolean {
  const ring = poly.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Lokal meterprojektion kring en referenspunkt. */
function toMeters(p: LngLat, ref: LngLat): [number, number] {
  return [rad(p[0] - ref[0]) * R * Math.cos(rad(ref[1])), rad(p[1] - ref[1]) * R];
}

export function areaM2(poly: PolygonGeom): number {
  const ring = poly.coordinates[0];
  if (ring.length < 4) return 0;
  const ref = ring[0];
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = toMeters(ring[i], ref);
    const [x2, y2] = toMeters(ring[i + 1], ref);
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function lengthM(line: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const [x, y] = toMeters(line[i], line[i - 1]);
    total += Math.hypot(x, y);
  }
  return total;
}

export function centroid(poly: PolygonGeom): LngLat {
  const ring = poly.coordinates[0].slice(0, -1);
  const n = ring.length || 1;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

export function closeRing(points: LngLat[]): PolygonGeom {
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}

export function formatArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} ha` : `${Math.round(m2).toLocaleString("sv-SE")} m²`;
}

/** Den minsta zon som innehåller punkten. */
export function zoneAt<T extends { geom: PolygonGeom | null }>(p: LngLat, zones: T[]): T | null {
  const hits = zones.filter((z) => z.geom && pointInPolygon(p, z.geom));
  return hits.sort((a, b) => areaM2(a.geom!) - areaM2(b.geom!))[0] ?? null;
}

// ---- georeferering med tre stödpunkter (FR-074)
// Affin avbildning från bildens pixlar till Web Mercator (meter), där MapLibre ritar bilder linjärt.

const mercX = (lng: number) => (R * rad(lng));
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const invX = (x: number) => (x / R) * (180 / Math.PI);
const invY = (y: number) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

export interface ControlPoint {
  pixel: [number, number];
  lngLat: LngLat;
}

/** Löser affin transformation x = a·u + b·v + c, y = d·u + e·v + f från tre punkter. */
export function solveAffine(points: ControlPoint[]): (u: number, v: number) => LngLat {
  if (points.length < 3) throw new Error("Minst tre stödpunkter behövs");
  const [p1, p2, p3] = points;
  const U = [p1.pixel, p2.pixel, p3.pixel];
  const X = [p1, p2, p3].map((p) => mercX(p.lngLat[0]));
  const Y = [p1, p2, p3].map((p) => mercY(p.lngLat[1]));
  const det = U[0][0] * (U[1][1] - U[2][1]) - U[0][1] * (U[1][0] - U[2][0]) + (U[1][0] * U[2][1] - U[2][0] * U[1][1]);
  if (Math.abs(det) < 1e-9) throw new Error("Stödpunkterna får inte ligga på en linje");
  const solve = (t: number[]) => {
    const a = (t[0] * (U[1][1] - U[2][1]) - U[0][1] * (t[1] - t[2]) + (t[1] * U[2][1] - t[2] * U[1][1])) / det;
    const b = (U[0][0] * (t[1] - t[2]) - t[0] * (U[1][0] - U[2][0]) + (U[1][0] * t[2] - U[2][0] * t[1])) / det;
    const c = (U[0][0] * (U[1][1] * t[2] - U[2][1] * t[1]) - U[0][1] * (U[1][0] * t[2] - U[2][0] * t[1]) + t[0] * (U[1][0] * U[2][1] - U[2][0] * U[1][1])) / det;
    return [a, b, c];
  };
  const [a, b, c] = solve(X);
  const [d, e, f] = solve(Y);
  return (u, v) => [invX(a * u + b * v + c), invY(d * u + e * v + f)];
}

/** Bildens fyra hörn i den ordning MapLibre vill ha: övre vänster, övre höger, nedre höger, nedre vänster. */
export function cornersFromControlPoints(points: ControlPoint[], width: number, height: number): [LngLat, LngLat, LngLat, LngLat] {
  const f = solveAffine(points);
  return [f(0, 0), f(width, 0), f(width, height), f(0, height)];
}

export function boundsOf(points: LngLat[]): [LngLat, LngLat] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

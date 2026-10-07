// Position ("Här", FR-066), mått på ritade ytor och georeferering av kartlager med tre stödpunkter.
export type LonLat = [number, number];

export function here(timeout = 10000): Promise<{ lon: number; lat: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Positionen är inte tillgänglig"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? "Appen fick inte använda positionen" : "Kunde inte hitta positionen")),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

const R = 6371008.8;
const rad = (x: number) => (x * Math.PI) / 180;

export function lengthM(coords: LonLat[]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]];
    const dLat = rad(b[1] - a[1]);
    const dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    s += 2 * R * Math.asin(Math.sqrt(h));
  }
  return s;
}

export function areaM2(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = rad(ring.reduce((n, p) => n + p[1], 0) / ring.length);
  const pts = ring.map(([lon, lat]) => [R * rad(lon) * Math.cos(lat0), R * rad(lat)]);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

// Affin transformation från bildpixlar till lon/lat utifrån tre stödpunkter → kartlagrets fyra hörn.
export function cornersFromControlPoints(imageSize: { w: number; h: number }, pts: { px: [number, number]; geo: LonLat }[]): LonLat[] {
  if (pts.length < 3) throw new Error("Tre stödpunkter behövs");
  const [p1, p2, p3] = pts;
  const solve = (k: 0 | 1) => {
    const A = [[p1.px[0], p1.px[1], 1], [p2.px[0], p2.px[1], 1], [p3.px[0], p3.px[1], 1]];
    const b = [p1.geo[k], p2.geo[k], p3.geo[k]];
    const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-9) throw new Error("Stödpunkterna ligger på en linje – välj punkter som bildar en triangel");
    const col = (i: number) => A.map((row, r) => row.map((v, c) => (c === i ? b[r] : v)));
    return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
  };
  const [ax, bx, cx] = solve(0);
  const [ay, by, cy] = solve(1);
  const at = (x: number, y: number): LonLat => [ax * x + bx * y + cx, ay * x + by * y + cy];
  return [at(0, 0), at(imageSize.w, 0), at(imageSize.w, imageSize.h), at(0, imageSize.h)];
}

export function navigateUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
export function searchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

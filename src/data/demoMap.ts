// Påhittad fastighetskarta för demoläget (inte Vreta). Koordinaterna är fiktiva.
import type { LngLat, PolygonGeom } from "../geo/geo";
import { closeRing } from "../geo/geo";

export const DEMO_W = 1200;
export const DEMO_H = 800;
// Övre vänster, övre höger, nedre höger, nedre vänster
export const DEMO_CORNERS: LngLat[] = [[15.0, 60.0012], [15.0036, 60.0012], [15.0036, 60.0], [15.0, 60.0]];

/** Pixel i demokartan → koordinat. */
export function px(x: number, y: number): LngLat {
  return [15.0 + (x / DEMO_W) * 0.0036, 60.0012 - (y / DEMO_H) * 0.0012];
}
const poly = (pts: [number, number][]): PolygonGeom => closeRing(pts.map(([x, y]) => px(x, y)));

export const DEMO_GEOM = {
  tomt: poly([[90, 70], [1110, 40], [1150, 740], [60, 760]]),
  tradgarden: poly([[110, 380], [560, 360], [580, 730], [90, 740]]),
  odlingen: poly([[620, 470], [1080, 450], [1110, 720], [640, 730]]),
  lagerzonen: poly([[880, 90], [1090, 80], [1100, 260], [890, 270]]),
  orangerietZon: poly([[620, 300], [860, 290], [870, 420], [630, 430]]),
  villan: poly([[250, 120], [520, 110], [530, 300], [260, 310]]),
  garaget: poly([[880, 290], [1060, 285], [1065, 420], [885, 425]]),
  orangeriet: poly([[650, 320], [840, 312], [845, 405], [655, 412]]),
  orangerietBygge: poly([[630, 398], [868, 390], [872, 452], [634, 460]]),
};

export const DEMO_BASEMAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DEMO_W} ${DEMO_H}" width="${DEMO_W}" height="${DEMO_H}">
<rect width="${DEMO_W}" height="${DEMO_H}" fill="#F3EEE2"/>
<g fill="none" stroke="#C9B58F" stroke-width="1.2">${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${120 + i * 80} C 300 ${90 + i * 82}, 700 ${160 + i * 76}, 1200 ${110 + i * 84}"/>`).join("")}</g>
<path d="M0 790 L1200 770" stroke="#B9AE98" stroke-width="34"/>
<text x="560" y="792" font-family="sans-serif" font-size="16" fill="#6E685E" font-style="italic">Byvägen</text>
<polygon points="90,70 1110,40 1150,740 60,760" fill="none" stroke="#2A2824" stroke-width="3" stroke-dasharray="18 6 3 6"/>
${[[90, 70], [1110, 40], [1150, 740], [60, 760]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#F3EEE2" stroke="#2A2824" stroke-width="2.5"/>`).join("")}
<g fill="#E2D6BF" stroke="#2A2824" stroke-width="2.5">
<polygon points="250,120 520,110 530,300 260,310"/><polygon points="880,290 1060,285 1065,420 885,425"/>
</g>
<g stroke="#2A2824" stroke-width="1.5"><path d="M250 120 L530 300 M520 110 L260 310"/><path d="M880 290 L1065 420 M1060 285 L885 425"/></g>
<polygon points="650,320 840,312 845,405 655,412" fill="none" stroke="#2A2824" stroke-width="2" stroke-dasharray="10 6"/>
<path d="M560 300 C 600 420, 600 600, 620 790" fill="none" stroke="#B9AE98" stroke-width="10" stroke-dasharray="2 10" stroke-linecap="round"/>
<ellipse cx="330" cy="520" rx="70" ry="44" fill="#CFE0E6" stroke="#6A93A3" stroke-width="2"/>
<g fill="#A8B38A" stroke="#5E6B45" stroke-width="1.5">${[[160, 420], [470, 640], [200, 690], [990, 560], [700, 690], [1050, 180], [150, 200]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="20"/><circle cx="${x}" cy="${y}" r="3" fill="#5E6B45"/>`).join("")}</g>
<g font-family="sans-serif" font-size="13" fill="#4A463F">
<text x="300" y="215">Bostadshus</text><text x="905" y="360">Garage</text><text x="680" y="370" font-style="italic">Orangeri (planerat)</text><text x="300" y="525">Damm</text>
<text x="1020" y="70">8:35</text><text x="40" y="40" font-size="15" font-weight="bold">DEMO – påhittad fastighetskarta</text>
</g>
<g font-family="sans-serif" font-size="11" fill="#8a7f6c">${[[200, 330, "20,4"], [700, 520, "19,8"], [450, 470, "19,6"], [950, 640, "19,3"], [380, 680, "19,5"]].map(([x, y, t]) => `<text x="${x}" y="${y}">+${t}</text>`).join("")}</g>
</svg>`;

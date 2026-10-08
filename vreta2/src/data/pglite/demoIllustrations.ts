// Ritade exempelbilder för demoläget (inga riktiga foton, inga platsdata).
const PAPER = "#F4EFE4";

function frame(inner: string, title: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
<rect width="800" height="600" fill="${PAPER}"/>
<rect x="24" y="24" width="752" height="552" fill="none" stroke="#D6C7AE" stroke-width="3" stroke-dasharray="10 8"/>
<g stroke="${color}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
<text x="400" y="545" font-family="Georgia, serif" font-size="34" fill="#4A463F" text-anchor="middle">${title}</text>
</svg>`;
}

const DRAWINGS: Record<string, (c: string) => string> = {
  window: (_c) => `<rect x="250" y="90" width="300" height="380" rx="8"/><line x1="400" y1="90" x2="400" y2="470"/><line x1="250" y1="280" x2="550" y2="280"/>
    <path d="M250 90 Q400 40 550 90" stroke-width="8"/><g stroke-width="4" stroke="#B9852B"><line x1="300" y1="140" x2="350" y2="190"/><line x1="450" y1="330" x2="500" y2="380"/></g>`,
  door: (c) => `<rect x="300" y="70" width="200" height="420" rx="6"/><rect x="330" y="110" width="140" height="140" rx="4" stroke-width="6"/>
    <rect x="330" y="290" width="140" height="160" rx="4" stroke-width="6"/><circle cx="470" cy="270" r="10" fill="${c}"/>`,
  plant: (_c) => `<path d="M400 470 V250"/><path d="M400 330 C330 300 300 250 310 200 C360 210 400 250 400 300"/><path d="M400 290 C470 260 500 210 490 160 C440 170 400 210 400 260"/>
    <circle cx="350" cy="170" r="34" stroke="#B4553F" stroke-width="8"/><circle cx="460" cy="130" r="30" stroke="#B4553F" stroke-width="8"/><path d="M330 470 H470 L450 520 H350 Z" stroke="#B49E7E"/>`,
  orangery: (_c) => `<path d="M170 460 V250 L400 120 L630 250 V460 Z"/><line x1="170" y1="460" x2="630" y2="460"/>
    <g stroke-width="6"><line x1="250" y1="250" x2="250" y2="460"/><line x1="330" y1="200" x2="330" y2="460"/><line x1="400" y1="160" x2="400" y2="460"/><line x1="470" y1="200" x2="470" y2="460"/><line x1="550" y1="250" x2="550" y2="460"/><line x1="170" y1="330" x2="630" y2="330"/></g>
    <g stroke="#4F5E3A" stroke-width="7"><path d="M210 460 q20 -60 0 -110"/><path d="M590 460 q-20 -60 0 -110"/></g>`,
  person: (_c) => `<circle cx="400" cy="210" r="90" fill="#DCE0C9"/><path d="M230 470 C240 360 560 360 570 470" fill="#DCE0C9"/>`,
  brick: (_c) => [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3].map((i) => `<rect x="${180 + i * 110 + (r % 2) * 55}" y="${120 + r * 70}" width="100" height="56" rx="4"/>`).join("")).join(""),
  pond: (_c) => `<ellipse cx="400" cy="320" rx="260" ry="120" stroke="#7D8079"/><path d="M220 320 q40 -20 80 0 t80 0" stroke="#7C8A5C" stroke-width="6"/><path d="M420 350 q40 -20 80 0 t80 0" stroke="#7C8A5C" stroke-width="6"/>`,
};

export function illustration(kind: string, title: string, color: string): Blob {
  const draw = DRAWINGS[kind] ?? DRAWINGS.window;
  return new Blob([frame(draw(color), title, color)], { type: "image/svg+xml" });
}

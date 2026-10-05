// Enkla illustrationer som ersätter foton i demoläget.
const wrap = (body: string, bg: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="${bg}"/>${body}</svg>`;

export const DEMO_ILLUSTRATIONS = {
  fonster: wrap(
    `<g fill="#9a4a35">${Array.from({ length: 12 }, (_, r) => Array.from({ length: 9 }, (_, c) => `<rect x="${c * 92 + (r % 2) * 46 - 40}" y="${r * 52}" width="88" height="48" rx="3"/>`).join("")).join("")}</g>
     <path d="M250 560V230a150 150 0 0 1 300 0v330z" fill="#d9d6cc" stroke="#2e2e2c" stroke-width="18"/>
     <g stroke="#2e2e2c" stroke-width="10" fill="none"><path d="M400 82v478M250 300h300M250 430h300M325 230v330M475 230v330"/><path d="M262 230a138 138 0 0 1 276 0"/></g>
     <rect x="230" y="555" width="340" height="24" fill="#c9bfa8"/>`,
    "#b9573f",
  ),
  tegel: wrap(
    `<rect y="430" width="800" height="170" fill="#8d8a76"/>
     <g stroke="#6d2f20" stroke-width="3">${Array.from({ length: 6 }, (_, r) => Array.from({ length: 5 - (r % 2) }, (_, c) => `<rect x="${170 + c * 96 + (r % 2) * 48}" y="${410 - r * 46}" width="92" height="42" fill="${["#a5492f", "#b5563a", "#9c4129", "#b0603f"][(r + c) % 4]}"/>`).join("")).join("")}</g>
     <rect x="150" y="452" width="500" height="22" fill="#a08a64"/>`,
    "#d8cfbd",
  ),
  rhododendron: wrap(
    `<rect y="420" width="800" height="180" fill="#6f7d4a"/>
     <ellipse cx="400" cy="330" rx="250" ry="170" fill="#3f5233"/><ellipse cx="300" cy="300" rx="120" ry="90" fill="#4c6239"/><ellipse cx="510" cy="290" rx="130" ry="95" fill="#4a5f37"/>
     <g fill="#c4577a">${[[280, 250], [380, 210], [480, 240], [560, 300], [330, 330], [440, 320], [230, 330], [520, 380], [360, 400]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="34"/><circle cx="${x + 18}" cy="${y - 10}" r="20" fill="#e08aa6"/>`).join("")}</g>`,
    "#e6e2d2",
  ),
  handtag: wrap(
    `<rect x="60" y="80" width="680" height="440" rx="10" fill="#7a5a3c"/>
     <g fill="none" stroke="#c9a14a" stroke-width="26" stroke-linecap="round">${[160, 300, 440, 580].map((x) => `<path d="M${x} 190v40c0 60 40 70 40 120v60"/>`).join("")}</g>
     <g fill="#e1c06e">${[160, 300, 440, 580].map((x) => `<rect x="${x - 26}" y="160" width="52" height="40" rx="10"/>`).join("")}</g>`,
    "#cdb99a",
  ),
} as const;

export async function svgToJpeg(svg: string): Promise<{ blob: Blob; width: number; height: number }> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("svg"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.85));
  return { blob, width: 800, height: 600 };
}

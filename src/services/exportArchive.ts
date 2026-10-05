// Export av all data (AC-16, FR-051, NFR-009): JSON och CSV per tabell, originalbilder och
// kartunderlag i en ZIP-fil. Öppna format, ingen inlåsning. Bara ägaren kan exportera.
import { strToU8, zipSync, type Zippable } from "fflate";
import type { Repo } from "../data/repo";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3" };

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

export interface ExportProgress { step: string; done: number; total: number }

export async function buildExport(repo: Repo, onProgress?: (p: ExportProgress) => void): Promise<{ blob: Blob; counts: Record<string, number>; media: number; missing: number }> {
  const files: Zippable = {};
  onProgress?.({ step: "Tabeller", done: 0, total: 1 });
  const tables = await repo.exportAll();
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(tables)) {
    counts[name] = rows.length;
    files[`data/${name}.json`] = strToU8(JSON.stringify(rows, null, 2));
    if (rows.length) files[`csv/${name}.csv`] = strToU8(`﻿${toCsv(rows as Record<string, unknown>[])}`);
  }

  const media = await repo.allMedia();
  let missing = 0;
  for (const [i, m] of media.entries()) {
    onProgress?.({ step: "Originalbilder", done: i, total: media.length });
    const blob = (await repo.mediaOriginal(m)) ?? (await repo.mediaBlob(m));
    if (!blob) { missing++; continue; }
    files[`media/${m.entity_type}/${m.id}.${EXT[m.mime] ?? "bin"}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }

  const layers = await repo.mapLayers();
  for (const l of layers) {
    const blob = await repo.mapImage(l);
    if (blob) files[`kartor/${l.id}.png`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }

  files["LASMIG.txt"] = strToU8([
    `VRETA – export ${new Date().toISOString()}`,
    "",
    "data/<tabell>.json   Alla rader per tabell (samma fält som i databasen).",
    "csv/<tabell>.csv     Samma data som CSV (UTF-8, komma), för kalkylprogram.",
    "media/<typ>/<id>.*   Originalbilder och ljud, kopplade via data/media.json (id, entity_type, entity_id).",
    "kartor/<id>.png      Grundbilder och överlägg; hörnkoordinater finns i data/map_layers.json.",
    "",
    "Exporten innehåller privata uppgifter (kontakter, priser, adresser och kartor). Förvara den säkert.",
  ].join("\n"));

  onProgress?.({ step: "Packar", done: 1, total: 1 });
  const zipped = zipSync(files, { level: 6 });
  return { blob: new Blob([zipped], { type: "application/zip" }), counts, media: media.length - missing, missing };
}

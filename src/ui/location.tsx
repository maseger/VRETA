import type { StorageLocation } from "../domain/types";

export function locationPath(all: StorageLocation[], id: string | null | undefined): string {
  const parts: string[] = [];
  let cur = all.find((l) => l.id === id);
  let guard = 0;
  while (cur && guard++ < 20) {
    parts.unshift(cur.name);
    cur = all.find((l) => l.id === cur!.parent_id);
  }
  return parts.join(" → ");
}

/** En lagerplats och alla platser under den. */
export function descendantIds(all: StorageLocation[], id: string): Set<string> {
  const out = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const l of all) if (l.parent_id && out.has(l.parent_id) && !out.has(l.id)) { out.add(l.id); added = true; }
  }
  return out;
}

/** Lagerplatser i trädordning med djup, för listor och väljare. */
export function flattenTree(all: StorageLocation[]): { loc: StorageLocation; depth: number }[] {
  const out: { loc: StorageLocation; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const l of all.filter((x) => x.parent_id === parent)) {
      out.push({ loc: l, depth });
      walk(l.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function LocationSelect({ locations, value, onChange, id }: { locations: StorageLocation[]; value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Välj lagerplats</option>
      {flattenTree(locations).map(({ loc, depth }) => (
        <option key={loc.id} value={loc.id}>
          {"  ".repeat(depth)}
          {depth ? "└ " : ""}
          {loc.name}
        </option>
      ))}
    </select>
  );
}

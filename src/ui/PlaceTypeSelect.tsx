import { useState } from "react";
import { PERMACULTURE_ZONE, findPlaceType, type PlaceTypeGroup } from "../domain/placeTypes";

const OWN = "__egen";

/** Typ av plats ur katalogen, grupperad – eller en egen typ. Visar förklaring och permakulturzon. */
export function PlaceTypeSelect({ id, groups, value, onChange }: { id?: string; groups: PlaceTypeGroup[]; value: string; onChange: (v: string) => void }) {
  const known = !value || !!findPlaceType(groups, value);
  const [own, setOwn] = useState(!known);
  const type = findPlaceType(groups, value);
  return (
    <div className="space-y-2">
      <select id={id} className="input" value={own ? OWN : value} onChange={(e) => {
        if (e.target.value === OWN) { setOwn(true); onChange(""); } else { setOwn(false); onChange(e.target.value); }
      }}>
        <option value="">Välj typ</option>
        {groups.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </optgroup>
        ))}
        <option value={OWN}>Annat – skriv själv …</option>
      </select>
      {own && <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Typ av plats" aria-label="Egen typ" autoFocus />}
      {type && (type.hint || type.pzone != null) && (
        <p className="text-[12px] text-sot-3">{[type.hint, type.pzone != null ? `Permakultur: ${PERMACULTURE_ZONE[type.pzone]}` : ""].filter(Boolean).join(" · ")}</p>
      )}
    </div>
  );
}

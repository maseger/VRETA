import { useState } from "react";
import { useApp, useData } from "../app/AppContext";
import { PLACE_KINDS } from "../domain/labels";

/** Välj plats utanför Vreta – eller lägg till en ny direkt. */
export function ExternalPlaceSelect({ value, onChange, label = "Plats utanför Vreta", disabled }: {
  value: string | null; onChange: (id: string | null) => void | Promise<void>; label?: string; disabled?: boolean;
}) {
  const { repo, refresh } = useApp();
  const { data } = useData((r) => r.externalPlaces());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("loppis");
  const [locality, setLocality] = useState("");

  if (adding) {
    return (
      <div className="space-y-2 rounded-md bg-kalk-2/70 p-3">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Namn, t.ex. Kyrkans loppis" aria-label="Platsens namn" autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Slag av plats">
            {PLACE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <input className="input" value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Ort" aria-label="Ort" />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Avbryt</button>
          <button type="button" className="btn-primary flex-1" disabled={!name.trim()} onClick={async () => {
            const p = await repo.createExternalPlace({ name: name.trim(), kind, locality: locality.trim(), notes: "", address: "" });
            setAdding(false);
            setName("");
            setLocality("");
            await onChange(p.id);
            await refresh();
          }}>Lägg till plats</button>
        </div>
      </div>
    );
  }
  return (
    <select className="input" value={value ?? ""} disabled={disabled} aria-label={label} onChange={(e) => (e.target.value === "+" ? setAdding(true) : onChange(e.target.value || null))}>
      <option value="">{label}: ingen vald</option>
      {data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.locality ? `, ${p.locality}` : ""}</option>)}
      {!disabled && <option value="+">+ Ny plats …</option>}
    </select>
  );
}

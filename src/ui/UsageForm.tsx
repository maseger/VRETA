import { Camera, Crosshair, Leaf } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { USAGE_LABEL } from "../domain/labels";
import type { Structure, UsageType, VObject, Zone } from "../domain/types";
import { zoneAt, type LngLat } from "../geo/geo";
import { prepareImage, type PreparedImage } from "../services/images";

const TYPES: UsageType[] = ["installed", "planted", "built_in", "renovated", "reused", "moved", "replanted"];

/** Nytt liv (4.5, FR-019): typ, plats eller "Här", antal för partier, datum, efter-bild. */
export function UsageForm({ object, zones, structures, maxQty, fromAllocation, onDone, onCancel }: {
  object: VObject; zones: Zone[]; structures: Structure[]; maxQty: number | null; fromAllocation: string | null; onDone: () => void; onCancel: () => void;
}) {
  const { repo, refresh, toast } = useApp();
  const living = object.category === "Växter";
  const [type, setType] = useState<UsageType>(object.status === "in_use" ? "moved" : living ? "planted" : "installed");
  const [place, setPlace] = useState(object.zone_id ? `z:${object.zone_id}` : "");
  const [qty, setQty] = useState(maxQty != null ? String(maxQty) : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [project, setProject] = useState("");
  const [note, setNote] = useState("");
  const [point, setPoint] = useState<LngLat | null>(null);
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function here() {
    navigator.geolocation?.getCurrentPosition((pos) => {
      const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
      setPoint(p);
      const z = zoneAt(p, zones);
      if (z) setPlace(`z:${z.id}`);
      toast(z ? `Du står i ${z.name}` : "Position sparad – välj zon själv");
    }, () => toast("Kunde inte hämta din position"), { enableHighAccuracy: true, timeout: 10000 });
  }

  async function save() {
    setError(null);
    const [k, pid] = place.split(":");
    const n = qty ? Number(qty) : null;
    if (maxQty != null && (!n || n <= 0 || n > maxQty)) return setError(`Ange ett antal mellan 1 och ${maxQty}`);
    setBusy(true);
    try {
      await repo.recordUsage(object.id, {
        type, zone_id: k === "z" ? pid : null, structure_id: k === "s" ? pid : null,
        quantity: object.is_batch ? n : null, project: project.trim(), note: note.trim(),
        occurred_at: date ? new Date(`${date}T12:00:00`).toISOString() : null,
        geom: point ? { type: "Point", coordinates: point } : null, from_allocation_id: fromAllocation,
      });
      if (photo) {
        await repo.saveMedia({ id: crypto.randomUUID(), original: photo.original, clean: photo.clean, mime: photo.original.type || "image/jpeg", width: photo.width, height: photo.height, entity_type: "object", entity_id: object.id, role: "after" });
      }
      await refresh();
      toast(`${USAGE_LABEL[type]} – syns nu i objekt-, zon- och platsjournalen`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4 border-linolja/40 p-4">
      <p className="flex items-center gap-2 font-serif text-lg font-semibold"><Leaf size={20} className="text-linolja" aria-hidden="true" /> Nytt liv</p>
      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => <button key={t} type="button" className={`chip ${type === t ? "chip-on" : ""}`} onClick={() => setType(t)}>{USAGE_LABEL[t]}</button>)}
      </div>
      <div>
        <label className="field-label" htmlFor="u-place">Var?</label>
        <div className="flex gap-2">
          <select id="u-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">Välj zon eller byggnad</option>
            <optgroup label="Zoner">{zones.map((z) => <option key={z.id} value={`z:${z.id}`}>{z.name}</option>)}</optgroup>
            <optgroup label="Byggnader">{structures.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>
          </select>
          <button type="button" className="btn-secondary shrink-0" onClick={here}><Crosshair size={18} aria-hidden="true" /> Här</button>
        </div>
        {point && <p className="mt-1 text-[12px] text-sot-3">Exakt position sparas och visas på Vretakartan.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {object.is_batch && (
          <div>
            <label className="field-label" htmlFor="u-qty">Antal ({object.unit}){maxQty != null ? ` – högst ${maxQty}` : ""}</label>
            <input id="u-qty" type="number" min={1} max={maxQty ?? undefined} className="input" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        )}
        <div><label className="field-label" htmlFor="u-date">Datum</label><input id="u-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <input className="input" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Projekt (valfritt), t.ex. Orangeriet" aria-label="Projekt" />
      <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anteckning (valfritt)" aria-label="Anteckning" />
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => e.target.files?.[0] && setPhoto(await prepareImage(e.target.files[0]))} />
      <div className="flex items-center gap-3">
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}><Camera size={18} aria-hidden="true" /> {photo ? "Byt efter-bild" : "Efter-bild"}</button>
        {photo && <img src={photo.previewUrl} alt="" className="h-11 w-14 rounded-sm object-cover" />}
      </div>
      {error && <p className="text-sm text-falu">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Avbryt</button>
        <button type="button" className="btn-moss flex-1" disabled={!place || busy} onClick={save}>Spara nytt liv</button>
      </div>
    </div>
  );
}

import { Camera, Crosshair, Mic, MicOff } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { OBSERVATION_KINDS } from "../domain/labels";
import type { Visibility, Zone } from "../domain/types";
import { zoneAt, type LngLat } from "../geo/geo";
import { prepareImage, type PreparedImage } from "../services/images";
import { useDictation } from "./useDictation";

/** Ny observation (4.9): typ, zon (eller "Här"), text med diktering och valfritt foto. */
export function ObservationForm({ zones, defaultZone, objectId, onDone }: { zones: Zone[]; defaultZone?: string; objectId?: string; onDone: () => void }) {
  const { repo, refresh, toast } = useApp();
  const [kind, setKind] = useState("vatten");
  const [zone, setZone] = useState(defaultZone ?? "");
  const [text, setText] = useState("");
  const [point, setPoint] = useState<LngLat | null>(null);
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const append = useCallback((t: string) => setText((s) => (s ? `${s} ${t}` : t)), []);
  const dictation = useDictation(append);

  function here() {
    navigator.geolocation?.getCurrentPosition((pos) => {
      const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
      setPoint(p);
      const z = zoneAt(p, zones);
      if (z) setZone(z.id);
      toast(z ? `Position sparad – ${z.name}` : "Position sparad (utanför inritade zoner)");
    }, () => toast("Kunde inte hämta din position"), { enableHighAccuracy: true, timeout: 10000 });
  }

  return (
    <form className="card space-y-3 p-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const o = await repo.createObservation({ kind, text: text.trim(), zone_id: zone || null, structure_id: null, object_id: objectId ?? null, geom: point ? { type: "Point", coordinates: point } : null, follow_up: null, visibility: "shareable" as Visibility });
      if (photo) await repo.saveMedia({ id: crypto.randomUUID(), original: photo.original, clean: photo.clean, mime: photo.original.type || "image/jpeg", width: photo.width, height: photo.height, entity_type: "observation", entity_id: o.id });
      await refresh();
      toast("Observationen finns nu i journalen");
      onDone();
    }}>
      <p className="font-serif text-lg font-semibold">Ny observation</p>
      <div className="flex flex-wrap gap-2">{OBSERVATION_KINDS.map((k) => <button type="button" key={k.key} className={`chip ${kind === k.key ? "chip-on" : ""}`} onClick={() => setKind(k.key)}>{k.label}</button>)}</div>
      <div className="flex gap-2">
        <select className="input" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zon">
          <option value="">Hela platsen</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <button type="button" className="btn-secondary shrink-0" onClick={here}><Crosshair size={18} aria-hidden="true" /> Här</button>
      </div>
      <div className="relative">
        <textarea className="input pr-12" rows={3} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Vad ser du?" aria-label="Observation" />
        {dictation.supported && (
          <button type="button" onClick={dictation.toggle} className={`absolute right-2 top-2 rounded-md p-2 ${dictation.listening ? "bg-falu text-kalk" : "text-sot-3 hover:bg-kalk-2"}`} aria-label={dictation.listening ? "Sluta diktera" : "Diktera"}>
            {dictation.listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => e.target.files?.[0] && setPhoto(await prepareImage(e.target.files[0]))} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}><Camera size={18} aria-hidden="true" /> {photo ? "Byt foto" : "Foto"}</button>
        {photo && <img src={photo.previewUrl} alt="" className="h-11 w-14 rounded-sm object-cover" />}
        <button className="btn-primary ml-auto" disabled={busy || !text.trim()}>Spara</button>
      </div>
    </form>
  );
}

/** Beslut med bakgrund, alternativ och motiv (FR-024). */
export function DecisionForm({ zones, defaultZone, onDone }: { zones: Zone[]; defaultZone?: string; onDone: () => void }) {
  const { repo, refresh, toast } = useApp();
  const [q, setQ] = useState("");
  const [options, setOptions] = useState("");
  const [choice, setChoice] = useState("");
  const [why, setWhy] = useState("");
  const [zone, setZone] = useState(defaultZone ?? "");
  return (
    <form className="card space-y-3 p-4" onSubmit={async (e) => {
      e.preventDefault();
      await repo.createDecision({ question: q.trim(), options: options.trim(), choice: choice.trim(), rationale: why.trim(), zone_id: zone || null, object_id: null, visibility: "internal" });
      await refresh();
      toast("Beslutet är journalfört");
      onDone();
    }}>
      <p className="font-serif text-lg font-semibold">Journalför ett beslut</p>
      <input className="input" required value={q} onChange={(e) => setQ(e.target.value)} placeholder="Frågan, t.ex. Var ska kakelugnen stå?" aria-label="Fråga" />
      <input className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Alternativ som fanns" aria-label="Alternativ" />
      <input className="input" required value={choice} onChange={(e) => setChoice(e.target.value)} placeholder="Det här valde vi" aria-label="Beslut" />
      <textarea className="input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Varför?" aria-label="Motiv" />
      <div className="flex gap-2">
        <select className="input" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zon">
          <option value="">Hela platsen</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <button className="btn-primary shrink-0">Spara</button>
      </div>
      <p className="text-[12px] text-sot-3">Beslut är interna som standard.</p>
    </form>
  );
}

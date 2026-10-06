import { Megaphone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../app/AppContext";
import { LISTING_STATUS_LABEL } from "../domain/labels";
import { needProgress, stockForNeed } from "../domain/places";
import type { Listing, Need, NeedFulfillment, VObject } from "../domain/types";
import { formatDate } from "./bits";

/** Projektets behov (6.4): vad som behövs, hur långt det kommit och vad som fyllt det. */
export function ProjectNeeds({ projectId, needs, fulfillments, objects, listings, canWrite }: {
  projectId: string; needs: Need[]; fulfillments: NeedFulfillment[]; objects: VObject[]; listings: Listing[]; canWrite: boolean;
}) {
  const { repo, refresh, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("st");
  const [error, setError] = useState<string | null>(null);
  const open = needs.filter((n) => n.status === "open");
  const dropped = needs.filter((n) => n.status === "dropped");

  return (
    <div>
      {!needs.length && !adding && <p className="mb-3 text-sot-3">Inga behov ännu. Skriv vad projektet behöver, t.ex. ”1 500 tegel” – sedan syns hur långt ni kommit.</p>}
      <ul className="space-y-3">
        {[...open, ...dropped].map((n) => <NeedRow key={n.id} need={n} fulfillments={fulfillments.filter((f) => f.need_id === n.id)} objects={objects} listing={listings.find((l) => l.id === n.listing_id)} canWrite={canWrite} />)}
      </ul>
      {canWrite && (adding ? (
        <form className="card mt-3 grid grid-cols-[1fr_6rem_5rem] gap-2 p-3" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await repo.createNeed({ project_id: projectId, title, quantity: qty ? Number(qty) : null, unit, notes: "" });
            setTitle(""); setQty(""); setUnit("st"); setAdding(false);
            await refresh();
            toast("Behovet är tillagt");
          } catch (err) {
            setError((err as Error).message);
          }
        }}>
          <input className="input col-span-3" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vad behövs? T.ex. Tegel till södra muren" aria-label="Behov" />
          <span className="self-center text-sm text-sot-3">Hur många? (valfritt)</span>
          <input className="input" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Antal" />
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Enhet" />
          {error && <p className="col-span-3 text-sm text-falu">{error}</p>}
          <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Avbryt</button>
          <button className="btn-primary col-span-2">Lägg till behov</button>
        </form>
      ) : (
        <button className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-falu" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Nytt behov</button>
      ))}
    </div>
  );
}

function NeedRow({ need: n, fulfillments, objects, listing, canWrite }: { need: Need; fulfillments: NeedFulfillment[]; objects: VObject[]; listing?: Listing; canWrite: boolean }) {
  const { repo, refresh, toast } = useApp();
  const [filling, setFilling] = useState(false);
  const [objectId, setObjectId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const p = needProgress(n, fulfillments);
  const suggested = stockForNeed(n, objects);
  const others = objects.filter((o) => !suggested.includes(o) && !["sold", "donated", "exchanged", "discarded", "declined", "lost"].includes(o.status));
  const remaining = p.of != null ? Math.max(0, p.of - p.done) : null;

  return (
    <li className={`card p-4 ${n.status === "dropped" ? "opacity-60" : ""}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="font-medium">{n.title}</p>
        <span className={`shrink-0 text-sm font-semibold ${p.covered ? "text-linolja" : "text-sot-2"}`}>{n.status === "dropped" ? "Struket" : p.covered ? `✓ ${p.label}` : p.label}</span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-kalk-3" role="progressbar" aria-label={`${n.title}: ${p.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.share * 100)}>
        <span className={`block h-full ${p.covered ? "bg-linolja" : "bg-ockra"}`} style={{ width: `${p.share * 100}%` }} />
      </div>
      {fulfillments.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {fulfillments.map((f) => {
            const o = objects.find((x) => x.id === f.object_id);
            return (
              <li key={f.id} className="flex items-center gap-2">
                <span className="text-sot-3">{formatDate(f.occurred_at)} ·</span>
                <span className="font-semibold">{f.quantity} {n.unit}</span>
                {o ? <Link to={`/objekt/${o.id}`} className="truncate text-falu">{o.title}</Link> : <span className="truncate text-sot-3">{f.note || "Utan sak"}</span>}
                {canWrite && <button className="ml-auto text-sot-3 hover:text-falu" aria-label="Ta bort" onClick={async () => { await repo.removeFulfillment(f.id); await refresh(); }}><Trash2 size={14} /></button>}
              </li>
            );
          })}
        </ul>
      )}
      {listing && (
        <Link to={`/annons/${listing.id}`} className="mb-3 flex items-center gap-2 text-sm text-falu"><Megaphone size={14} aria-hidden="true" /> Efterlyst: {listing.title} · {LISTING_STATUS_LABEL[listing.status]}</Link>
      )}
      {!filling && !p.covered && n.status === "open" && suggested.length > 0 && (
        <p className="mb-3 text-sm text-sot-3">I lager som kan passa: {suggested.slice(0, 3).map((o, i) => <span key={o.id}>{i > 0 && ", "}<button className="font-semibold text-falu" disabled={!canWrite} onClick={() => { setFilling(true); setObjectId(o.id); setQty(String(Math.min(o.quantity, remaining ?? o.quantity))); }}>{o.title}</button></span>)}</p>
      )}
      {canWrite && filling && (
        <form className="mb-1 grid gap-2 rounded-md bg-kalk-2/70 p-3 sm:grid-cols-[2fr_1fr]" onSubmit={async (e) => {
          e.preventDefault();
          await repo.fulfillNeed({ need_id: n.id, quantity: Number(qty), object_id: objectId || null, contribution_id: null, note: note.trim() });
          setFilling(false); setObjectId(""); setQty(""); setNote("");
          await refresh();
          toast(`${n.title}: ${qty} ${n.unit} registrerat`);
        }}>
          <select className="input" value={objectId} onChange={(e) => setObjectId(e.target.value)} aria-label="Vilken sak?">
            <option value="">Utan sak (t.ex. från stenröset)</option>
            {suggested.length > 0 && <optgroup label="Passar troligen">{suggested.map((o) => <option key={o.id} value={o.id}>{o.title} ({o.quantity} {o.unit})</option>)}</optgroup>}
            <optgroup label="Allt annat">{others.map((o) => <option key={o.id} value={o.id}>{o.title} ({o.quantity} {o.unit})</option>)}</optgroup>
          </select>
          <input className="input" type="number" min={0} step="any" required value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`Antal ${n.unit}`} aria-label="Antal" />
          <input className="input sm:col-span-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anteckning (valfritt)" aria-label="Anteckning" />
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setFilling(false)}>Avbryt</button>
            <button className="btn-primary flex-1" disabled={!(Number(qty) > 0)}>Registrera</button>
          </div>
        </form>
      )}
      {canWrite && !filling && (
        <div className="flex flex-wrap gap-2">
          {n.status === "open" && !p.covered && <button className="btn-secondary min-h-[36px] text-sm" onClick={() => { setFilling(true); setQty(remaining ? String(remaining) : ""); }}>Fyll på</button>}
          {n.status === "open" && !p.covered && !listing && <Link className="btn-ghost min-h-[36px] text-sm" to={`/annons/ny?behov=${n.id}`}><Megaphone size={16} aria-hidden="true" /> Efterlys</Link>}
          <button className="btn-ghost min-h-[36px] text-sm text-sot-3" onClick={async () => { await repo.updateNeed(n.id, { status: n.status === "open" ? "dropped" : "open" }); await refresh(); }}>{n.status === "open" ? "Stryk" : "Ta upp igen"}</button>
        </div>
      )}
    </li>
  );
}

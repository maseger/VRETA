import { Camera, Check, Navigation, Phone, Truck } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { PICKUP_STATUS_LABEL, RECEIPT_LABEL } from "../domain/labels";
import type { Media, ReceiptStatus } from "../domain/types";
import { prepareImage } from "../services/images";
import { EmptyState, MediaImage, formatDate } from "../ui/bits";
import { LocationSelect } from "../ui/location";

/** Hämtning ute på plats (S6): checklista, foton, kvittering per objekt och avslut. Fungerar offline. */
export function PickupPage() {
  const { id } = useParams();
  const { repo, profile, refresh, toast, online } = useApp();
  const canWrite = profile?.role !== "viewer";
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoRole, setPhotoRole] = useState<Media["role"]>("before");
  const [receipts, setReceipts] = useState<Record<string, ReceiptStatus>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [location, setLocation] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError } = useData(async (r) => {
    const pickup = await r.pickup(id!);
    if (!pickup) return null;
    const [items, checklist, objects, locations, people] = await Promise.all([r.pickupItems(id!), r.checklist(id!), r.objects(), r.storageLocations(), r.persons().catch(() => [])]);
    const media = online ? await r.mediaFor("pickup", id!).catch(() => []) : [];
    return { pickup, items: items.map((i) => ({ i, o: objects.find((o) => o.id === i.object_id) })), checklist, locations, person: people.find((p) => p.id === pickup.person_id), media };
  }, [id]);

  if (loadError) return <EmptyState title="Hämtningen går inte att visa">{loadError}</EmptyState>;
  if (data === null) return <EmptyState title="Hämtningen finns inte" />;
  if (!data) return null;
  const { pickup, items, checklist, locations, person, media } = data;
  const done = pickup.status === "completed";
  const allReceipted = items.every(({ i }) => receipts[i.object_id] ?? i.receipt);
  const mapsUrl = pickup.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickup.address)}` : null;

  async function addPhoto(files: FileList | null) {
    if (!files?.[0]) return;
    const p = await prepareImage(files[0]);
    await repo.saveMedia({ id: crypto.randomUUID(), original: p.original, clean: p.clean, mime: p.original.type || "image/jpeg", width: p.width, height: p.height, entity_type: "pickup", entity_id: pickup.id, role: photoRole });
    toast(online ? "Foto sparat" : "Foto sparat – synkas när du har nät");
    await refresh();
  }

  async function finish() {
    setError(null);
    try {
      await repo.completePickup(pickup.id, items.map(({ i }) => ({ object_id: i.object_id, receipt: receipts[i.object_id] ?? i.receipt!, note: "" })), location || null);
      await refresh();
      setFinishing(false);
      toast(online ? "Hämtningen är klar" : "Klar – synkas när du har nät");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link to="/samla?vy=hamtningar" className="text-sm font-semibold text-falu">← Hämtningar</Link>
      <header className="mb-5 mt-2">
        <div className="mb-2 flex items-center gap-2"><Truck size={18} className="text-falu" aria-hidden="true" /><span className="stamp border-sot-2 text-sot-2">{PICKUP_STATUS_LABEL[pickup.status]}</span></div>
        <h1>{pickup.title}</h1>
        <p className="mt-1 text-sot-3">
          {[pickup.scheduled_date ? formatDate(pickup.scheduled_date) : "Inget datum", pickup.window_from ? `kl. ${pickup.window_from.slice(0, 5)}–${pickup.window_to?.slice(0, 5) ?? ""}` : ""].filter(Boolean).join(" · ")}
        </p>
      </header>

      <div className="card mb-6 space-y-3 p-4">
        {pickup.address !== undefined && <p className="font-medium">{pickup.address || <span className="text-sot-3">Ingen adress angiven</span>}</p>}
        {person && <p className="text-sm text-sot-2">Kontakt: <Link to={`/person/${person.id}`} className="font-semibold underline-offset-2 hover:underline">{person.name}</Link></p>}
        {pickup.resources.length > 0 && <p className="text-sm text-sot-2">Med: {pickup.resources.join(", ")}</p>}
        {pickup.safety_note && <p className="rounded-md bg-ockra-light/30 px-3 py-2 text-sm">{pickup.safety_note}</p>}
        <div className="flex flex-wrap gap-2">
          {mapsUrl && <a className="btn-moss" href={mapsUrl} target="_blank" rel="noreferrer"><Navigation size={18} aria-hidden="true" /> Navigera</a>}
          {person?.contact && /\d/.test(person.contact) && <a className="btn-secondary" href={`tel:${person.contact.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden="true" /> Ring</a>}
        </div>
      </div>

      {checklist.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2">Checklista</h2>
          <ul className="card divide-y divide-dashed divide-lera-light">
            {checklist.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-[52px] items-center gap-4 px-4">
                  <input type="checkbox" className="h-6 w-6 accent-[#4F5E3A]" disabled={!canWrite || done} checked={checks[c.id] ?? c.done} onChange={async (e) => {
                    const v = e.target.checked;
                    setChecks((x) => ({ ...x, [c.id]: v }));
                    await repo.toggleChecklistItem(c, v);
                    await refresh();
                  }} />
                  <span className={`text-[16px] ${(checks[c.id] ?? c.done) ? "text-sot-3 line-through" : ""}`}>{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canWrite && (
        <section className="mb-6">
          <h2 className="mb-2">Foton</h2>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addPhoto(e.target.files)} />
          <div className="grid grid-cols-3 gap-2">
            {(["before", "during", "after"] as const).map((r) => (
              <button key={r} className="btn-secondary flex-col gap-1 py-3" onClick={() => { setPhotoRole(r); photoRef.current?.click(); }}>
                <Camera size={20} aria-hidden="true" /> {r === "before" ? "Före" : r === "during" ? "Under" : "Efter"}
              </button>
            ))}
          </div>
          {media.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto">{media.map((m) => <MediaImage key={m.id} media={m} className="h-20 w-28 shrink-0 rounded-sm" />)}</div>}
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2">Objekt</h2>
        <ul className="space-y-3">
          {items.map(({ i, o }) => (
            <li key={i.id} className="card p-4">
              <p className="mb-2 font-medium">{o ? <Link to={`/objekt/${o.id}`} className="hover:underline">{o.title}</Link> : "Objekt"} <span className="text-sot-3">· {o?.quantity} {o?.unit}</span></p>
              {done ? (
                <p className="flex items-center gap-1.5 text-sm text-linolja"><Check size={16} aria-hidden="true" /> {i.receipt ? RECEIPT_LABEL[i.receipt] : ""}</p>
              ) : canWrite && (
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(RECEIPT_LABEL) as ReceiptStatus[]).map((r) => (
                    <button key={r} onClick={() => setReceipts((x) => ({ ...x, [i.object_id]: r }))} className={`chip ${(receipts[i.object_id] ?? i.receipt) === r ? "chip-on" : ""}`}>{RECEIPT_LABEL[r]}</button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canWrite && !done && (
        finishing ? (
          <div className="card space-y-3 p-4">
            <label className="field-label" htmlFor="loc">Var lägger du det? (valfritt)</label>
            <LocationSelect id="loc" locations={locations} value={location} onChange={setLocation} />
            {error && <p className="text-sm text-falu">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setFinishing(false)}>Tillbaka</button>
              <button className="btn-moss flex-1" onClick={finish}><Check size={18} aria-hidden="true" /> Avsluta hämtningen</button>
            </div>
          </div>
        ) : (
          <button className="btn-primary w-full text-base" disabled={!allReceipted} onClick={() => setFinishing(true)}>
            {allReceipted ? "Allt kvitterat – avsluta" : "Kvittera varje objekt för att avsluta"}
          </button>
        )
      )}
      {done && <p className="card p-4 text-center font-semibold text-linolja">Hämtningen är klar och objekten är uppdaterade.</p>}
    </div>
  );
}

// Hämtning: när, var, vad och checklistan – med röstläge så att man kan bocka av med händerna fulla.
// Adress och telefon är privata och visas bara för ägaren och föraren.
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Mic, Navigation, Phone, Square } from "lucide-react";
import { useCan, useCommand, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { d, dt, num, time } from "../app/format";
import { navigateUrl } from "../services/geo";
import { NO, YES, listenOnce, speak, stopSpeaking } from "../services/speech";
import { Card, ErrorNote, Kv, PageHeader, Progress, Section, Spinner, Stamp, statusTone } from "../ui/base";
import { Thumb } from "../ui/media";
import { NumberField, PlacePicker, Select, TextField, Toggle, numOrNull, strOrNull } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";

export default function PickupPage() {
  const { id } = useParams();
  const { data: p, error, loading } = useQuery<any>("q_pickup", { id });
  useScreen(p ? { id: p.id, type: "pickup", title: p.title } : null);
  if (loading) return <Spinner />;
  if (error || !p) return <ErrorNote>{error ?? "Hämtningen finns inte"}</ErrorNote>;
  return <PickupView p={p} />;
}

function PickupView({ p }: { p: any }) {
  const can = useCan();
  const run = useCommand();
  const [complete, setComplete] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [voice, setVoice] = useState(false);
  const stopRef = useRef(false);
  const done = p.checklist.filter((c: any) => c.checked).length;
  const open = !["completed", "cancelled"].includes(p.status);
  const address = p.private?.from_address;
  const phone = p.private?.contact_phone ?? p.contact_phone;

  async function voiceMode() {
    setVoice(true);
    stopRef.current = false;
    const items = p.checklist.filter((c: any) => !c.checked);
    if (!items.length) await speak("Allt i checklistan är avbockat.");
    for (const item of items) {
      if (stopRef.current) break;
      await speak(item.text);
      const ans = await listenOnce(8000);
      if (stopRef.current || /^(stopp|sluta|avbryt)/.test(ans)) break;
      if (YES.test(ans) || /bocka|klar|check|fixat/.test(ans)) {
        await run("CheckChecklistItem", { item_id: item.id, checked: true });
        await speak("Bockat.");
      } else if (NO.test(ans) || /nästa|hoppa/.test(ans)) {
        continue;
      }
    }
    setVoice(false);
  }

  return (
    <div>
      <PageHeader kicker="Hämtning" title={p.title}
        sub={<span className="flex flex-wrap items-center gap-2"><Stamp tone={statusTone(null, p.status)}>{p.status_label}</Stamp>
          {(p.window_start || p.scheduled_on) && <span>{p.window_start ? dt(p.window_start) : d(p.scheduled_on)}{p.window_end ? `–${time(p.window_end)}` : ""}</span>}
          {p.locality && <span>· {p.locality}</span>}</span>} />

      <div className="mb-4 flex flex-wrap gap-2">
        {address && <a className="btn-secondary" href={navigateUrl(address)} target="_blank" rel="noreferrer"><Navigation size={18} /> Navigera</a>}
        {phone && <a className="btn-secondary" href={`tel:${phone.replace(/\s/g, "")}`}><Phone size={18} /> Ring</a>}
        {open && can("CompletePickup") && <button type="button" className="btn-done" onClick={() => setComplete(true)}><Check size={18} /> Hämtat</button>}
        {open && can("SetPickupStatus") && (p.next ?? []).filter((n: any) => n.to !== "completed").map((n: any) => (
          <BusyButton key={n.to} className={n.to === "cancelled" ? "btn-ghost" : "btn-secondary"} onClick={() => run("SetPickupStatus", { pickup_id: p.id, status: n.to }, { success: n.label })}>{n.label}</BusyButton>
        ))}
      </div>

      <Section title="Det som ska hämtas">
        <ul className="card divide-y divide-dashed divide-lera">
          {p.items.map((i: any) => (
            <li key={i.id}><Link to={`/objekt/${i.object_id}`} className="flex items-center gap-3 px-4 py-2.5 text-sot no-underline">
              <Thumb m={i.cover} size={40} /><span className="flex-1">{i.label}</span>
              {i.receipt_status && <Stamp tone={i.receipt_status === "received" ? "ok" : "warn"}>{({ received: "Mottagen", partial: "Delvis", deviation: "Avvikelse" } as any)[i.receipt_status]}</Stamp>}
            </Link></li>
          ))}
        </ul>
      </Section>

      <Section title={p.checklist_name ? `Checklista · ${p.checklist_name}` : "Checklista"}
        action={p.checklist.length > 0 && open && (voice
          ? <button type="button" className="btn-primary btn-small" onClick={() => { stopRef.current = true; stopSpeaking(); setVoice(false); }}><Square size={14} /> Stoppa röstläget</button>
          : <button type="button" className="btn-secondary btn-small" onClick={voiceMode}><Mic size={15} /> Röstläge</button>)}>
        <Card>
          {p.checklist.length > 0 && <div className="mb-3"><Progress value={done} max={p.checklist.length} /><div className="mt-1 text-sm text-sot-3">{done} av {p.checklist.length}</div></div>}
          <ul>
            {p.checklist.map((c: any) => (
              <li key={c.id}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                  <input type="checkbox" className="h-6 w-6 accent-linolja" checked={c.checked} disabled={!can("CheckChecklistItem")}
                    onChange={(e) => run("CheckChecklistItem", { item_id: c.id, checked: e.target.checked })} />
                  <span className={c.checked ? "text-sot-3 line-through" : ""}>{c.text}</span>
                </label>
              </li>
            ))}
          </ul>
          {open && can("AddChecklistItem") && (
            <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; if (await run("AddChecklistItem", { pickup_id: p.id, text: newItem.trim() })) setNewItem(""); }}>
              <input className="input" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Lägg till i checklistan" aria-label="Ny rad i checklistan" />
              <button type="submit" className="btn-secondary">Lägg till</button>
            </form>
          )}
        </Card>
      </Section>

      <Section title="Uppgifter">
        <Card>
          <dl className="divide-y divide-dashed divide-lera">
            <Kv k="Kontakt">{p.contact ? <Link to={`/person/${p.contact.id}`}>{p.contact.display_name}</Link> : null}</Kv>
            <Kv k="Adress (privat)">{address}</Kv>
            <Kv k="Telefon (privat)">{phone}</Kv>
            <Kv k="Plats">{p.external_place ? <Link to={p.external_place.route}>{p.external_place.title}</Link> : null}</Kv>
            <Kv k="Förare">{p.driver?.title}</Kv>
            <Kv k="Fordon och verktyg">{(p.resources ?? []).map((r: any) => r.label).join(", ")}</Kv>
            <Kv k="Anskaffning">{p.acquisition ? <Link to={`/inkop/${p.acquisition.id}`}>{p.acquisition.title}</Link> : null}</Kv>
          </dl>
          {p.note && <p className="mt-2 text-sot-2">{p.note}</p>}
        </Card>
      </Section>

      <Section title="Tidslinje"><Timeline events={p.timeline ?? []} hideLink={p.id} /></Section>
      <CompleteSheet open={complete} onClose={() => setComplete(false)} p={p} />
    </div>
  );
}

function CompleteSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const [store, setStore] = useState("");
  const [story, setStory] = useState(false);
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<Record<string, { receipt_status: string; quantity: string; note: string }>>({});
  const r = (id: string) => receipts[id] ?? { receipt_status: "received", quantity: "", note: "" };
  const setR = (id: string, patch: Partial<{ receipt_status: string; quantity: string; note: string }>) => setReceipts((x) => ({ ...x, [id]: { ...r(id), ...patch } }));
  return (
    <Sheet open={open} onClose={onClose} title="Hämtat!"
      footer={<BusyButton className="btn-done" onClick={async () => {
        const res = await run("CompletePickup", { pickup_id: p.id, storage_location_id: store || null, story_value: story, note: strOrNull(note),
          receipts: p.items.map((i: any) => ({ pickup_item_id: i.id, receipt_status: r(i.id).receipt_status, quantity: numOrNull(r(i.id).quantity), note: strOrNull(r(i.id).note) })) },
          { success: "Hämtningen är klar" });
        if (res) onClose();
      }}>Klart</BusyButton>}>
      {p.items.map((i: any) => (
        <div key={i.id} className="mb-3 rounded-lg border border-lera p-3">
          <div className="mb-2 font-semibold">{i.label}</div>
          <Select label="Fick vi med allt?" value={r(i.id).receipt_status} onChange={(v) => setR(i.id, { receipt_status: v })}
            options={[{ value: "received", label: "Ja, allt" }, { value: "partial", label: "Delvis" }, { value: "deviation", label: "Nej – avvikelse" }]} />
          {r(i.id).receipt_status === "partial" && <NumberField label="Hur många fick vi?" value={r(i.id).quantity} onChange={(v) => setR(i.id, { quantity: v })} hint={i.quantity ? `Planerat: ${num(i.quantity)}` : undefined} />}
          {r(i.id).receipt_status !== "received" && <TextField label="Vad hände?" value={r(i.id).note} onChange={(v) => setR(i.id, { note: v })} />}
        </div>
      ))}
      <PlacePicker label="Var ställer vi det?" value={store} onChange={setStore} places={false} empty="Bestäm senare" />
      <TextField label="Anteckning" value={note} onChange={setNote} />
      <Toggle label="Värt att berätta" checked={story} onChange={setStory} />
    </Sheet>
  );
}

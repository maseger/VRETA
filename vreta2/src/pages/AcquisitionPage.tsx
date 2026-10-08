// En anskaffning: köp, gåva, byte eller lån – från fynd till kontakt, överenskommelse, hämtning och klart.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Truck } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { ACQUISITION_TYPES } from "../app/labels";
import { d, dt, kr, localDateTimeInput } from "../app/format";
import { Avatar, Card, ErrorNote, Kv, PageHeader, Section, Spinner, Stamp, statusTone } from "../ui/base";
import { Gallery } from "../ui/media";
import { NumberField, Select, TextArea, TextField, numOrNull, strOrNull } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";
import { LogInteractionSheet } from "./PersonPage";

export default function AcquisitionPage() {
  const { id } = useParams();
  const { data: a, error, loading } = useQuery<any>("q_acquisition", { id });
  useScreen(a ? { id: a.id, type: "acquisition", title: a.object?.label } : null);
  if (loading) return <Spinner />;
  if (error || !a) return <ErrorNote>{error ?? "Anskaffningen finns inte"}</ErrorNote>;
  return <AcquisitionView a={a} />;
}

function AcquisitionView({ a }: { a: any }) {
  const can = useCan();
  const run = useCommand();
  const [advance, setAdvance] = useState<{ to: string; label: string } | null>(null);
  const [plan, setPlan] = useState(false);
  const [talk, setTalk] = useState(false);
  const o = a.object;
  const open = !["settled", "declined", "lost"].includes(a.status);
  return (
    <div>
      <PageHeader kicker={`${ACQUISITION_TYPES[a.type]} · anskaffning`} title={<Link to={`/objekt/${o.id}`} className="text-sot">{o.label}</Link>}
        sub={<span className="flex items-center gap-2"><Stamp tone={statusTone(null, a.status)}>{a.status_label}</Stamp>{a.counterpart && <>från <Link to={`/person/${a.counterpart.id}`}>{a.counterpart.display_name}</Link></>}</span>} />
      <Gallery media={o.media ?? []} />

      {open && can("AdvanceAcquisition") && (
        <Section title="Nästa steg">
          <div className="flex flex-wrap gap-2">
            {(a.next ?? []).map((n: any) => (
              <button key={n.to} type="button" className={["declined", "lost"].includes(n.to) ? "btn-ghost" : "btn-secondary"} onClick={() => setAdvance({ to: n.to, label: n.label })}>{n.label}</button>
            ))}
            {can("PlanPickup") && ["agreed", "negotiating", "contacted", "lead"].includes(a.status) && (
              <button type="button" className="btn-primary" onClick={() => setPlan(true)}><Truck size={18} /> Planera hämtning</button>
            )}
          </div>
        </Section>
      )}

      <Section title="Uppgifter">
        <Card>
          <dl className="divide-y divide-dashed divide-lera">
            <Kv k="Typ">{ACQUISITION_TYPES[a.type]}</Kv>
            <Kv k="Antal">{a.quantity}</Kv>
            <Kv k="Pris (privat)">{a.private?.price ? kr(a.private.price) : null}</Kv>
            <Kv k="Betalning">{a.private?.payment_method}</Kv>
            <Kv k="Hämtas mellan">{a.pickup_window_start || a.pickup_window_end ? `${d(a.pickup_window_start)} – ${d(a.pickup_window_end)}` : null}</Kv>
            <Kv k="Plats">{a.external_place ? <Link to={a.external_place.route}>{a.external_place.title}</Link> : null}</Kv>
            <Kv k="Tipsare">{a.tipster ? <Link to={`/person/${a.tipster.id}`}>{a.tipster.title ?? a.tipster.display_name}</Link> : null}</Kv>
            <Kv k="Organisation">{a.organization ? <Link to={a.organization.route}>{a.organization.title}</Link> : null}</Kv>
            <Kv k="Annons">{a.source_url ? <a href={a.source_url} target="_blank" rel="noreferrer">Öppna</a> : null}</Kv>
            <Kv k="Överenskommet">{a.agreed_at ? d(a.agreed_at) : null}</Kv>
            <Kv k="Mottaget">{a.received_at ? d(a.received_at) : null}</Kv>
          </dl>
          {a.note && <p className="mt-2 text-sot-2">{a.note}</p>}
        </Card>
      </Section>

      {a.counterpart && (
        <Section title="Kontakt" action={can("LogInteraction") && <button type="button" className="btn-ghost btn-small" onClick={() => setTalk(true)}>+ Logga kontakt</button>}>
          <Link to={`/person/${a.counterpart.id}`} className="card mb-2 flex items-center gap-3 px-4 py-3 text-sot no-underline">
            <Avatar name={a.counterpart.display_name} />
            <span><span className="font-semibold">{a.counterpart.display_name}</span><span className="block text-sm text-sot-3">{a.counterpart.locality}</span></span>
          </Link>
          {(a.interactions ?? []).map((i: any) => (
            <Card key={i.id} className="mb-2 !py-3"><div className="text-sm text-sot-3">{dt(i.occurred_at)}</div><div className="font-semibold">{i.summary}</div>{i.body && <p className="text-sot-2">{i.body}</p>}</Card>
          ))}
        </Section>
      )}

      {(a.pickups ?? []).length > 0 && (
        <Section title="Hämtningar">
          {a.pickups.map((p: any) => (
            <Link key={p.id} to={`/hamtning/${p.id}`} className="card mb-2 flex items-center justify-between px-4 py-3 text-sot no-underline">
              <span><span className="font-semibold">{p.title}</span><span className="block text-sm text-sot-3">{d(p.scheduled_on)}</span></span>
              <Stamp tone={statusTone(null, p.status)}>{p.status_label ?? p.status}</Stamp>
            </Link>
          ))}
        </Section>
      )}

      <Section title="Tidslinje"><Timeline events={a.timeline ?? []} hideLink={a.id} /></Section>

      <AdvanceSheet a={a} target={advance} onClose={() => setAdvance(null)} run={run} />
      <PlanPickupSheet open={plan} onClose={() => setPlan(false)} acquisition={a} />
      {a.counterpart && <LogInteractionSheet open={talk} onClose={() => setTalk(false)} personId={a.counterpart.id} />}
    </div>
  );
}

function AdvanceSheet({ a, target, onClose, run }: { a: any; target: { to: string; label: string } | null; onClose: () => void; run: ReturnType<typeof useCommand> }) {
  const [price, setPrice] = useState(a.private?.price ? String(a.private.price) : "");
  const [pay, setPay] = useState(a.private?.payment_method ?? "");
  const [ws, setWs] = useState("");
  const [we, setWe] = useState("");
  const [note, setNote] = useState("");
  if (!target) return null;
  const money = ["agreed", "settled", "received"].includes(target.to) && a.type === "purchase";
  return (
    <Sheet open onClose={onClose} title={target.label}
      footer={<BusyButton onClick={async () => {
        const r = await run("AdvanceAcquisition", { acquisition_id: a.id, status: target.to, price: money ? numOrNull(price) : undefined, payment_method: money ? strOrNull(pay) : undefined,
          pickup_window_start: ws ? new Date(ws).toISOString() : undefined, pickup_window_end: we ? new Date(we).toISOString() : undefined, note: strOrNull(note) },
          { success: `Nu: ${target.label.toLowerCase()}` });
        if (r) onClose();
      }}>Spara</BusyButton>}>
      {money && <>
        <NumberField label="Pris" value={price} onChange={setPrice} unit="kr" hint="Privat – syns bara för ägaren." />
        <TextField label="Betalning" value={pay} onChange={setPay} placeholder="Swish, kontant …" />
      </>}
      {target.to === "agreed" && <div className="grid grid-cols-2 gap-x-3">
        <TextField label="Hämtas tidigast" type="date" value={ws} onChange={setWs} />
        <TextField label="Hämtas senast" type="date" value={we} onChange={setWe} />
      </div>}
      <TextArea label="Anteckning" value={note} onChange={setNote} rows={2} />
    </Sheet>
  );
}

export function PlanPickupSheet({ open, onClose, acquisition }: { open: boolean; onClose: () => void; acquisition: any }) {
  const { ctx } = useApp();
  const run = useCommand();
  const nav = useNavigate();
  const templates = ctx?.codes.checklist_template ?? [];
  const [date, setDate] = useState(acquisition.pickup_window_end?.slice(0, 10) ?? "");
  const [start, setStart] = useState(localDateTimeInput(new Date(Date.now() + 86400000)).slice(0, 14) + "00");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [template, setTemplate] = useState(templates[0]?.code ?? "");
  const [resources, setResources] = useState("");
  const [note, setNote] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Planera hämtning"
      footer={<BusyButton onClick={async () => {
        const r = await run<{ pickup_id: string }>("PlanPickup", {
          acquisition_id: acquisition.id, title: `Hämta ${acquisition.object.title.toLowerCase()}`, scheduled_on: date || (start ? start.slice(0, 10) : null),
          window_start: start ? new Date(start).toISOString() : null, from_address: strOrNull(address), contact_phone: strOrNull(phone),
          checklist_template: template || null, resources: resources.split(",").map((x) => x.trim()).filter(Boolean).map((label) => ({ label })), note: strOrNull(note),
        }, { success: "Hämtningen är planerad" });
        if (r?.pickup_id) { onClose(); nav(`/hamtning/${r.pickup_id}`); }
      }}>Planera</BusyButton>}>
      <TextField label="När?" type="datetime-local" value={start} onChange={setStart} />
      <TextField label="Senast (datum)" type="date" value={date} onChange={setDate} />
      <TextField label="Adress (privat)" value={address} onChange={setAddress} hint="Syns bara för ägaren och den som kör." />
      <TextField label="Telefon (privat)" type="tel" value={phone} onChange={setPhone} inputMode="tel" />
      <Select label="Checklista" value={template} onChange={setTemplate} empty="Ingen checklista" options={templates.map((t) => ({ value: t.code, label: t.label }))} />
      <TextField label="Fordon och verktyg" value={resources} onChange={setResources} placeholder="Släp, spännband, filtar" hint="Separera med komma." />
      <TextArea label="Anteckning" value={note} onChange={setNote} rows={2} />
    </Sheet>
  );
}

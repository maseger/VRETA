import { ArrowDownLeft, ArrowUpRight, Lock, Navigation, Pencil, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { ACQUISITION_LABEL, DISPOSAL_LABEL, PICKUP_STATUS_LABEL, PLACE_KINDS, placeKindLabel } from "../domain/labels";
import type { ExternalPlace } from "../domain/types";
import { EmptyState, PageHeader, Section, formatDate } from "../ui/bits";

/** En plats utanför Vreta: vad som kommit därifrån, vad som lämnats där, hämtningar och människor. */
export function ExternalPlacePage() {
  const { id } = useParams();
  const { profile } = useApp();
  const canWrite = profile?.role !== "viewer";
  const [editing, setEditing] = useState(false);
  const { data } = useData(async (r) => {
    const place = (await r.externalPlaces()).find((p) => p.id === id);
    if (!place) return null;
    const [acquisitions, disposals, pickups, objects, persons] = await Promise.all([r.allAcquisitions(), r.disposals(), r.pickups(), r.objects(), r.persons()]);
    const title = (oid: string) => objects.find((o) => o.id === oid)?.title ?? "Objekt";
    const person = (pid: string | null | undefined) => persons.find((p) => p.id === pid) ?? null;
    const incoming = acquisitions.filter((a) => a.place_id === id).map((a) => ({ a, title: title(a.object_id), person: person(a.person_id) }));
    const outgoing = disposals.filter((d) => d.place_id === id).map((d) => ({ d, title: title(d.object_id), person: person(d.person_id) }));
    const visits = pickups.filter((k) => k.place_id === id);
    const people = [...new Map([...incoming, ...outgoing].map((x) => x.person).filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.id, p])).values()];
    return { place, incoming, outgoing, visits, people };
  }, [id]);

  if (data === null) return <EmptyState title="Platsen finns inte" />;
  if (!data) return null;
  const { place: p, incoming, outgoing, visits, people } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/platser?vy=utanfor" className="text-sm font-semibold text-falu">← Utanför Vreta</Link>
      <PageHeader kicker={[placeKindLabel(p.kind), p.locality].filter(Boolean).join(" · ") || "Plats utanför Vreta"} title={p.name}>
        {canWrite && !editing && <button className="btn-secondary" onClick={() => setEditing(true)}><Pencil size={18} aria-hidden="true" /> Ändra</button>}
      </PageHeader>

      {editing ? <PlaceForm place={p} onDone={() => setEditing(false)} /> : (
        <div className="-mt-3 mb-8 space-y-2">
          {p.notes && <p className="whitespace-pre-line text-sot-2">{p.notes}</p>}
          {p.address && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-sot-3">
              <Lock size={14} aria-label="Privat" /> {p.address}
              <a className="inline-flex items-center gap-1 font-semibold text-falu" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.address)}`} target="_blank" rel="noreferrer"><Navigation size={14} aria-hidden="true" /> Vägbeskrivning</a>
            </p>
          )}
        </div>
      )}

      <Section title="Kom härifrån">
        {incoming.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {incoming.map(({ a, title, person }) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <ArrowDownLeft size={18} className="shrink-0 text-linolja" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <Link to={`/objekt/${a.object_id}`} className="font-medium text-falu">{title}</Link>
                  <span className="block text-sm text-sot-3">{[ACQUISITION_LABEL[a.type], person?.name, formatDate(a.created_at)].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sot-3">Inget ännu. Välj platsen under fliken Platser på en sak som köpts eller hämtats här.</p>}
      </Section>

      <Section title="Lämnades här">
        {outgoing.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {outgoing.map(({ d, title, person }) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <ArrowUpRight size={18} className="shrink-0 text-falu" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <Link to={`/objekt/${d.object_id}`} className="font-medium text-falu">{title}</Link>
                  <span className="block text-sm text-sot-3">{[DISPOSAL_LABEL[d.type], person?.name, formatDate(d.occurred_at)].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sot-3">Inget har lämnats här ännu.</p>}
      </Section>

      {visits.length > 0 && (
        <Section title="Hämtningar">
          <ul className="card divide-y divide-dashed divide-lera-light">
            {visits.map((k) => (
              <li key={k.id}>
                <Link to={`/hamtning/${k.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <Truck size={18} className="shrink-0 text-sot-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 font-medium">{k.title}</span>
                  <span className="text-sm text-sot-3">{[k.scheduled_date ? formatDate(k.scheduled_date) : "", PICKUP_STATUS_LABEL[k.status]].filter(Boolean).join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {people.length > 0 && (
        <Section title="Människor här">
          <p className="text-sm">
            {people.map((x, i) => <span key={x.id}>{i > 0 && <span className="text-sot-3">, </span>}<Link to={`/person/${x.id}`} className="font-medium text-falu">{x.name}</Link></span>)}
          </p>
        </Section>
      )}
    </div>
  );
}

function PlaceForm({ place: p, onDone }: { place: ExternalPlace; onDone: () => void }) {
  const { repo, refresh } = useApp();
  const [form, setForm] = useState({ name: p.name, kind: p.kind, locality: p.locality, notes: p.notes, address: p.address ?? "" });
  return (
    <form className="card mb-6 space-y-3 p-4" onSubmit={async (e) => {
      e.preventDefault();
      await repo.updateExternalPlace(p.id, { name: form.name.trim(), kind: form.kind, locality: form.locality.trim(), notes: form.notes.trim(), address: form.address.trim() });
      await refresh();
      onDone();
    }}>
      <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Namn" />
      <div className="grid grid-cols-2 gap-3">
        <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Slag av plats">
          {PLACE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <input className="input" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="Ort" aria-label="Ort" />
      </div>
      <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Adress (privat)" aria-label="Adress" />
      <textarea className="input min-h-[80px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Öppettider, vad de brukar ha …" aria-label="Anteckningar" />
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>Avbryt</button>
        <button className="btn-primary flex-1">Spara</button>
      </div>
    </form>
  );
}

import { ArrowDownLeft, ArrowUpRight, ChevronRight, MapPin, Plus, Store, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../../app/AppContext";
import { PLACE_KINDS, placeKindLabel } from "../../domain/labels";
import { localityKey } from "../../domain/places";
import { EmptyState, Section, formatDate } from "../../ui/bits";

interface Locality {
  key: string;
  name: string;
  people: { id: string; name: string }[];
  places: { id: string; name: string }[];
  incoming: { id: string; title: string }[];
  outgoing: { id: string; title: string }[];
  pickups: { id: string; title: string; date: string | null }[];
}

/**
 * Platser utanför Vreta: registrerade platser (loppisar, hämtställen, återvinningscentraler …) och orterna
 * där saker hämtas, köps och lämnas. Orten är på kommunnivå; adresser är privata (INV-12, INV-13).
 */
export function ExternalPlaces() {
  const { repo, profile, refresh } = useApp();
  const navigate = useNavigate();
  const canWrite = profile?.role !== "viewer";
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "loppis", locality: "", address: "" });
  const { data } = useData(async (r) => {
    const [places, persons, organizations, acquisitions, disposals, pickups, objects] = await Promise.all([
      r.externalPlaces(), r.persons(), r.organizations(), r.allAcquisitions(), r.disposals(), r.pickups(), r.objects(),
    ]);
    const title = (id: string) => objects.find((o) => o.id === id)?.title ?? "Objekt";
    const localities = new Map<string, Locality>();
    const locality = (name: string): Locality | null => {
      const key = localityKey(name);
      if (!key) return null;
      let l = localities.get(key);
      if (!l) localities.set(key, (l = { key, name: name.trim(), people: [], places: [], incoming: [], outgoing: [], pickups: [] }));
      return l;
    };
    const byPlace = new Map<string, Locality>();
    const byOrg = new Map<string, Locality>();
    const byPerson = new Map<string, Locality>();
    for (const p of places) {
      const l = locality(p.locality);
      if (l) { l.places.push({ id: p.id, name: p.name }); byPlace.set(p.id, l); }
    }
    for (const o of organizations) {
      const l = locality(o.locality);
      if (l) byOrg.set(o.id, l);
    }
    for (const x of persons) {
      const l = locality(x.locality) ?? (x.organization_id ? byOrg.get(x.organization_id) ?? null : null);
      if (l) { l.people.push({ id: x.id, name: x.name }); byPerson.set(x.id, l); }
    }
    // Platsen väger tyngst: köpt på loppisen i Gävle räknas till Gävle även om säljaren bor någon annanstans
    const where = (placeId: string | null | undefined, personId: string | null | undefined, orgId?: string | null) =>
      (placeId && byPlace.get(placeId)) || (personId && byPerson.get(personId)) || (orgId && byOrg.get(orgId)) || null;
    const add = (list: { id: string; title: string }[], id: string) => list.some((x) => x.id === id) || list.push({ id, title: title(id) });
    for (const a of acquisitions) { const l = where(a.place_id, a.person_id, a.organization_id); if (l) add(l.incoming, a.object_id); }
    for (const d of disposals) { const l = where(d.place_id, d.person_id); if (l) add(l.outgoing, d.object_id); }
    let unplaced = 0;
    for (const k of pickups) {
      const l = where(k.place_id, k.person_id);
      if (l) l.pickups.push({ id: k.id, title: k.title, date: k.scheduled_date });
      else unplaced++;
    }
    const placeStats = places.map((p) => ({
      p,
      in: new Set(acquisitions.filter((a) => a.place_id === p.id).map((a) => a.object_id)).size,
      out: new Set(disposals.filter((d) => d.place_id === p.id).map((d) => d.object_id)).size,
      pickups: pickups.filter((k) => k.place_id === p.id).length,
    }));
    const size = (l: Locality) => l.incoming.length + l.outgoing.length + l.pickups.length;
    return { placeStats, list: [...localities.values()].sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name, "sv")), unplaced };
  });

  if (!data) return null;
  return (
    <>
      <p className="mb-6 max-w-xl text-sot-3">Där saker kommer ifrån och dit de går: loppisar, hämtställen, återvinningscentraler – och orterna där människorna finns.</p>

      <Section title="Platser" action={canWrite ? <button className="inline-flex items-center gap-1 text-sm font-semibold text-falu" onClick={() => setAdding((a) => !a)}><Plus size={16} aria-hidden="true" /> Ny plats</button> : undefined}>
        {adding && (
          <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            const p = await repo.createExternalPlace({ name: form.name.trim(), kind: form.kind, locality: form.locality.trim(), notes: "", address: form.address.trim() });
            await refresh();
            navigate(`/plats/${p.id}`);
          }}>
            <input className="input sm:col-span-2" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Namn, t.ex. Kyrkans loppis" aria-label="Namn" />
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Slag av plats">
              {PLACE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <input className="input" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="Ort" aria-label="Ort" />
            <input className="input sm:col-span-2" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Adress (privat, valfritt)" aria-label="Adress" />
            <button className="btn-primary sm:col-span-2">Lägg till</button>
          </form>
        )}
        {data.placeStats.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.placeStats.map(({ p, in: n, out, pickups }) => (
              <li key={p.id}>
                <Link to={`/plats/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <Store size={20} strokeWidth={1.5} className="shrink-0 text-falu" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.name}</span>
                    <span className="text-sm text-sot-3">{[placeKindLabel(p.kind), p.locality, n ? `${n} in` : "", out ? `${out} ut` : "", pickups ? `${pickups} hämtning${pickups === 1 ? "" : "ar"}` : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                  <ChevronRight size={16} className="text-sot-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="Inga platser ännu">Lägg till loppisar, hämtställen och återvinningscentraler ni brukar besöka, eller välj plats direkt på ett inköp eller en hämtning.</EmptyState>}
      </Section>

      <Section title="Orter">
        {!data.list.length && <EmptyState title="Inga orter ännu">Ange ort på personer och platser så samlas hämtningar, inköp och avslut per ort.</EmptyState>}
        <ul className="space-y-4">
          {data.list.map((l) => (
            <li key={l.key} className="card p-4">
              <div className="mb-3 flex items-start gap-3">
                <MapPin size={22} strokeWidth={1.5} className="mt-1 shrink-0 text-falu" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-xl">{l.name}</h3>
                  <p className="text-sm text-sot-3">{[
                    l.people.length ? `${l.people.length} ${l.people.length === 1 ? "person" : "personer"}` : "",
                    l.places.length ? `${l.places.length} ${l.places.length === 1 ? "plats" : "platser"}` : "",
                    l.incoming.length ? `${l.incoming.length} in` : "",
                    l.outgoing.length ? `${l.outgoing.length} ut` : "",
                  ].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              {(l.people.length > 0 || l.places.length > 0) && (
                <p className="mb-2 text-sm">
                  {[...l.places.map((x) => <Link key={x.id} to={`/plats/${x.id}`} className="font-medium text-falu">{x.name}</Link>), ...l.people.map((x) => <Link key={x.id} to={`/person/${x.id}`} className="font-medium text-falu">{x.name}</Link>)]
                    .flatMap((el, i) => (i ? [<span key={`s${i}`} className="text-sot-3">, </span>, el] : [el]))}
                </p>
              )}
              <ul className="space-y-1 text-sm">
                {l.incoming.map((o) => <li key={`in${o.id}`} className="flex items-center gap-2"><ArrowDownLeft size={14} className="text-linolja" aria-label="Kom in" /><Link to={`/objekt/${o.id}`} className="text-falu">{o.title}</Link></li>)}
                {l.outgoing.map((o) => <li key={`ut${o.id}`} className="flex items-center gap-2"><ArrowUpRight size={14} className="text-falu" aria-label="Gick ut" /><Link to={`/objekt/${o.id}`} className="text-falu">{o.title}</Link></li>)}
                {l.pickups.map((k) => (
                  <li key={k.id} className="flex items-center gap-2">
                    <Truck size={14} className="text-sot-3" aria-label="Hämtning" />
                    <Link to={`/hamtning/${k.id}`} className="text-falu">{k.title}</Link>
                    {k.date && <span className="text-sot-3">{formatDate(k.date)}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {data.unplaced > 0 && <p className="mt-4 text-sm text-sot-3">{data.unplaced} hämtning{data.unplaced === 1 ? "" : "ar"} saknar ort – välj plats på hämtningen eller ange ort på personen.</p>}
      </Section>
    </>
  );
}

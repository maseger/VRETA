import { ArrowDownLeft, ArrowUpRight, MapPin, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../../app/AppContext";
import { localityKey } from "../../domain/places";
import { EmptyState, formatDate } from "../../ui/bits";

interface Place {
  key: string;
  name: string;
  people: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  incoming: { id: string; title: string }[];
  outgoing: { id: string; title: string }[];
  pickups: { id: string; title: string; date: string | null; address?: string }[];
}

/**
 * Platser utanför Vreta: orterna där saker hämtas, köps och lämnas. Härleds från människornas och
 * organisationernas ort – på kommunnivå. Hämtadresser visas bara för den som får se dem (INV-13).
 */
export function ExternalPlaces() {
  const { data } = useData(async (r) => {
    const [persons, organizations, acquisitions, disposals, pickups, objects] = await Promise.all([
      r.persons(), r.organizations(), r.allAcquisitions(), r.disposals(), r.pickups(), r.objects(),
    ]);
    const places = new Map<string, Place>();
    const place = (locality: string): Place | null => {
      const key = localityKey(locality);
      if (!key) return null;
      let p = places.get(key);
      if (!p) places.set(key, (p = { key, name: locality.trim(), people: [], organizations: [], incoming: [], outgoing: [], pickups: [] }));
      return p;
    };
    const personPlace = new Map<string, Place>();
    const orgPlace = new Map<string, Place>();
    for (const o of organizations) {
      const p = place(o.locality);
      if (p) { p.organizations.push({ id: o.id, name: o.name }); orgPlace.set(o.id, p); }
    }
    for (const x of persons) {
      const p = place(x.locality) ?? (x.organization_id ? orgPlace.get(x.organization_id) ?? null : null);
      if (p) { p.people.push({ id: x.id, name: x.name }); personPlace.set(x.id, p); }
    }
    const title = (id: string) => objects.find((o) => o.id === id)?.title ?? "Objekt";
    const placeOf = (personId: string | null | undefined, orgId?: string | null) => (personId && personPlace.get(personId)) || (orgId && orgPlace.get(orgId)) || null;
    for (const a of acquisitions) {
      const p = placeOf(a.person_id, a.organization_id);
      if (p && !p.incoming.some((i) => i.id === a.object_id)) p.incoming.push({ id: a.object_id, title: title(a.object_id) });
    }
    for (const d of disposals) {
      const p = placeOf(d.person_id);
      if (p && !p.outgoing.some((i) => i.id === d.object_id)) p.outgoing.push({ id: d.object_id, title: title(d.object_id) });
    }
    let unplaced = 0;
    for (const k of pickups) {
      const p = placeOf(k.person_id);
      if (p) p.pickups.push({ id: k.id, title: k.title, date: k.scheduled_date, address: k.address });
      else unplaced++;
    }
    const list = [...places.values()].sort((a, b) => (b.incoming.length + b.outgoing.length + b.pickups.length) - (a.incoming.length + a.outgoing.length + a.pickups.length) || a.name.localeCompare(b.name, "sv"));
    return { list, unplaced };
  });

  if (!data) return null;
  return (
    <>
      <p className="mb-6 max-w-xl text-sot-3">Orterna där saker kommer ifrån och dit de går – där människorna och organisationerna finns. Orten hämtas från deras kort, så fyll i ort på personen för att platsen ska synas här.</p>
      {!data.list.length && <EmptyState title="Inga orter ännu">Ange ort på personer och organisationer så samlas hämtningar, inköp och avslut per ort.</EmptyState>}
      <ul className="space-y-4">
        {data.list.map((p) => (
          <li key={p.key} className="card p-4">
            <div className="mb-3 flex items-start gap-3">
              <MapPin size={22} strokeWidth={1.5} className="mt-1 shrink-0 text-falu" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-xl">{p.name}</h2>
                <p className="text-sm text-sot-3">{[
                  p.people.length ? `${p.people.length} ${p.people.length === 1 ? "person" : "personer"}` : "",
                  p.organizations.length ? `${p.organizations.length} organisation${p.organizations.length === 1 ? "" : "er"}` : "",
                  p.incoming.length ? `${p.incoming.length} in` : "",
                  p.outgoing.length ? `${p.outgoing.length} ut` : "",
                ].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            {(p.people.length > 0 || p.organizations.length > 0) && (
              <p className="mb-2 text-sm">
                {[...p.people.map((x) => <Link key={x.id} to={`/person/${x.id}`} className="font-medium text-falu">{x.name}</Link>), ...p.organizations.map((o) => <span key={o.id} className="font-medium">{o.name}</span>)]
                  .flatMap((el, i) => (i ? [<span key={`s${i}`} className="text-sot-3">, </span>, el] : [el]))}
              </p>
            )}
            <ul className="space-y-1 text-sm">
              {p.incoming.map((o) => <li key={`in${o.id}`} className="flex items-center gap-2"><ArrowDownLeft size={14} className="text-linolja" aria-label="Kom in" /><Link to={`/objekt/${o.id}`} className="text-falu">{o.title}</Link></li>)}
              {p.outgoing.map((o) => <li key={`ut${o.id}`} className="flex items-center gap-2"><ArrowUpRight size={14} className="text-falu" aria-label="Gick ut" /><Link to={`/objekt/${o.id}`} className="text-falu">{o.title}</Link></li>)}
              {p.pickups.map((k) => (
                <li key={k.id} className="flex items-center gap-2">
                  <Truck size={14} className="text-sot-3" aria-label="Hämtning" />
                  <Link to={`/hamtning/${k.id}`} className="text-falu">{k.title}</Link>
                  <span className="text-sot-3">{[k.date ? formatDate(k.date) : "", k.address].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {data.unplaced > 0 && <p className="mt-4 text-sm text-sot-3">{data.unplaced} hämtning{data.unplaced === 1 ? "" : "ar"} saknar ort – personen har ingen ort angiven.</p>}
    </>
  );
}

import { Building2, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { RELATION_KINDS, relationLabel } from "../domain/labels";
import type { Person, RelationKind } from "../domain/types";
import { Section } from "./bits";

/** Människorna runt en person: organisation, familj, grannar och vem som tipsade om vem (M8). */
export function PersonNetwork({ person }: { person: Person }) {
  const { repo, profile, refresh, toast } = useApp();
  const canWrite = profile?.role !== "viewer";
  const [adding, setAdding] = useState(false);
  const [other, setOther] = useState("");
  const [kind, setKind] = useState<RelationKind>("granne");
  const [direction, setDirection] = useState<"om" | "via">("om");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data } = useData(async (r) => {
    const [relations, persons, orgs] = await Promise.all([r.relations(person.id), r.persons(), r.organizations()]);
    return { relations, persons, orgs };
  }, [person.id]);
  if (!data || !canWrite) return null; // läsare ser inga relationer
  const name = (id: string) => data.persons.find((p) => p.id === id)?.name ?? "Okänd";
  const first = person.name.split(" ")[0];

  return (
    <Section title="Nätverk" action={!adding ? <button className="text-sm font-semibold text-falu" onClick={() => setAdding(true)}>+ Relation</button> : undefined}>
      <div className="card divide-y divide-dashed divide-lera-light">
        <label className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Building2 size={18} className="shrink-0 text-sot-3" aria-hidden="true" />
          <span className="text-sm text-sot-3">Hör till</span>
          <select className="input w-auto flex-1 py-1.5 text-sm" value={person.organization_id ?? ""} aria-label="Organisation" onChange={async (e) => { await repo.updatePerson(person.id, { organization_id: e.target.value || null }); await refresh(); }}>
            <option value="">Ingen organisation</option>
            {data.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {person.organization_id && <Link to={`/organisation/${person.organization_id}`} className="text-sm font-semibold text-falu">Öppna</Link>}
        </label>
        {data.relations.map((r) => {
          const otherId = r.person_id === person.id ? r.other_id : r.person_id;
          return (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <Users size={18} className="shrink-0 text-sot-3" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="text-sm text-sot-3">{relationLabel(r, person.id)} </span>
                <Link to={`/person/${otherId}`} className="font-medium text-falu">{name(otherId)}</Link>
                {r.note && <span className="block text-sm text-sot-3">{r.note}</span>}
              </span>
              <button className="text-sot-3 hover:text-falu" aria-label={`Ta bort relationen till ${name(otherId)}`} onClick={async () => { await repo.removeRelation(r.id); await refresh(); }}><Trash2 size={16} /></button>
            </div>
          );
        })}
        {!data.relations.length && !adding && <p className="px-4 py-3 text-sm text-sot-3">Inga relationer ännu. Vem känner {first}? Vem tipsade om {first}, eller vem tipsade {first} om?</p>}
      </div>
      {adding && (
        <form className="card mt-3 grid gap-2 p-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            // "Kom till oss via X" sparas som att X tipsade oss om personen
            const back = kind === "introduced" && direction === "via";
            await repo.addRelation({ person_id: back ? other : person.id, other_id: back ? person.id : other, kind, note: note.trim() });
            setAdding(false); setOther(""); setNote("");
            await refresh();
            toast("Relationen är sparad");
          } catch (err) {
            setError((err as Error).message);
          }
        }}>
          <select className="input" value={kindValue(kind, direction)} onChange={(e) => { const [k, d] = e.target.value.split(":"); setKind(k as RelationKind); setDirection((d as "om" | "via") ?? "om"); }} aria-label="Slag av relation">
            {RELATION_KINDS.filter((k) => k.key !== "introduced").map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            <option value="introduced:om">{first} tipsade oss om …</option>
            <option value="introduced:via">{first} kom till oss via …</option>
          </select>
          <select className="input" required value={other} onChange={(e) => setOther(e.target.value)} aria-label="Person">
            <option value="">Välj person</option>
            {data.persons.filter((p) => p.id !== person.id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.locality ? `, ${p.locality}` : ""}</option>)}
          </select>
          <input className="input sm:col-span-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anteckning (valfritt)" aria-label="Anteckning" />
          {error && <p className="text-sm text-falu sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Avbryt</button>
            <button className="btn-primary flex-1">Spara relationen</button>
          </div>
        </form>
      )}
    </Section>
  );
}

const kindValue = (k: RelationKind, d: "om" | "via") => (k === "introduced" ? `introduced:${d}` : k);

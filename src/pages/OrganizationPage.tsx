import { Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { ACQUISITION_LABEL, ORG_KINDS } from "../domain/labels";
import { EmptyState, PageHeader, Section, formatDate } from "../ui/bits";

/** En organisation: vilka som hör dit och vad som kommit därifrån. */
export function OrganizationPage() {
  const { id } = useParams();
  const { repo, profile, refresh } = useApp();
  const canWrite = profile?.role !== "viewer";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "", locality: "" });
  const [adding, setAdding] = useState("");
  const { data } = useData(async (r) => {
    const org = (await r.organizations()).find((o) => o.id === id);
    if (!org) return null;
    const [persons, acqs, objects] = await Promise.all([r.persons(), r.allAcquisitions(), r.objects()]);
    const memberIds = new Set(persons.filter((p) => p.organization_id === id).map((p) => p.id));
    const deals = acqs.filter((a) => a.organization_id === id || (a.person_id && memberIds.has(a.person_id)))
      .map((a) => ({ a, o: objects.find((o) => o.id === a.object_id), p: persons.find((p) => p.id === a.person_id) }))
      .filter((x) => x.o);
    return { org, persons, members: persons.filter((p) => memberIds.has(p.id)), deals };
  }, [id]);

  if (data === null) return <EmptyState title="Organisationen finns inte" />;
  if (!data) return null;
  const { org, persons, members, deals } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/manniskor?vy=organisationer" className="text-sm font-semibold text-falu">← Organisationer</Link>
      <PageHeader kicker={[org.kind || "Organisation", org.locality].filter(Boolean).join(" · ")} title={org.name}>
        {canWrite && !editing && <button className="btn-secondary" onClick={() => { setForm({ name: org.name, kind: org.kind, locality: org.locality }); setEditing(true); }}><Pencil size={18} aria-hidden="true" /> Ändra</button>}
      </PageHeader>

      {editing && (
        <form className="card mb-6 grid gap-3 p-4 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          await repo.updateOrganization(org.id, { name: form.name.trim(), kind: form.kind, locality: form.locality.trim() });
          setEditing(false);
          await refresh();
        }}>
          <input className="input sm:col-span-2" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Namn" />
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Slag">
            <option value="">Slag</option>
            {ORG_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <input className="input" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="Ort" aria-label="Ort" />
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Avbryt</button>
            <button className="btn-primary flex-1">Spara</button>
          </div>
        </form>
      )}

      <Section title="Människor">
        {members.length ? (
          <ul className="card mb-3 divide-y divide-dashed divide-lera-light">
            {members.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/person/${p.id}`} className="flex-1 font-medium text-falu">{p.name}</Link>
                <span className="text-sm text-sot-3">{p.roles.join(", ")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mb-3 text-sot-3">Ingen kopplad ännu.</p>}
        {canWrite && (
          <div className="flex gap-2">
            <select className="input" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Lägg till person">
              <option value="">Lägg till person …</option>
              {persons.filter((p) => p.organization_id !== org.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn-secondary" disabled={!adding} onClick={async () => { await repo.updatePerson(adding, { organization_id: org.id }); setAdding(""); await refresh(); }}>Lägg till</button>
          </div>
        )}
      </Section>

      <Section title="Saker härifrån">
        {deals.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {deals.map(({ a, o, p }) => (
              <li key={a.id} className="px-4 py-3">
                <Link to={`/objekt/${o!.id}`} className="font-medium text-falu">{o!.title}</Link>
                <span className="block text-sm text-sot-3">{[ACQUISITION_LABEL[a.type], p?.name, formatDate(a.created_at)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sot-3">Inget har kommit härifrån ännu.</p>}
      </Section>
    </div>
  );
}

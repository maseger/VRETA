import { Building2, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../../app/AppContext";
import { ORG_KINDS } from "../../domain/labels";
import { EmptyState } from "../../ui/bits";

/** Föreningar, företag, kommunen, församlingen – sammanhangen människorna hör till. */
export function OrganizationsList() {
  const { repo, profile, refresh } = useApp();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", kind: ORG_KINDS[0], locality: "" });
  const { data } = useData(async (r) => {
    const [orgs, persons, acqs] = await Promise.all([r.organizations(), r.persons(), r.allAcquisitions()]);
    return orgs.map((o) => ({ o, members: persons.filter((p) => p.organization_id === o.id).length, deals: acqs.filter((a) => a.organization_id === o.id).length }));
  });
  return (
    <>
      {profile?.role !== "viewer" && (
        adding ? (
          <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={async (e) => {
            e.preventDefault();
            const o = await repo.createOrganization({ name: form.name.trim(), kind: form.kind, locality: form.locality.trim() });
            await refresh();
            navigate(`/organisation/${o.id}`);
          }}>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Namn, t.ex. Storviks hembygdsförening" aria-label="Namn" />
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Slag">
              {ORG_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
            <input className="input" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} placeholder="Ort" aria-label="Ort" />
            <button className="btn-primary">Lägg till</button>
          </form>
        ) : <button className="btn-secondary mb-4" onClick={() => setAdding(true)}><Plus size={18} aria-hidden="true" /> Ny organisation</button>
      )}
      {data && !data.length && <EmptyState title="Inga organisationer ännu">Lägg till föreningar, företag och andra sammanhang som människorna kring Vreta hör till.</EmptyState>}
      {!!data?.length && (
        <ul className="card divide-y divide-dashed divide-lera-light">
          {data.map(({ o, members, deals }) => (
            <li key={o.id}>
              <Link to={`/organisation/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                <Building2 size={20} strokeWidth={1.5} className="shrink-0 text-linolja" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{o.name}</span>
                  <span className="text-sm text-sot-3">{[o.kind, o.locality, members ? `${members} ${members === 1 ? "person" : "personer"}` : "", deals ? `${deals} affär${deals === 1 ? "" : "er"}` : ""].filter(Boolean).join(" · ")}</span>
                </span>
                <ChevronRight size={16} className="text-sot-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

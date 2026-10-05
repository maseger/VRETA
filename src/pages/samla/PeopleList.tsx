import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../../app/AppContext";
import { PERSON_ROLES } from "../../domain/labels";
import { EmptyState } from "../../ui/bits";

export function PeopleList() {
  const { repo, profile, refresh } = useApp();
  const navigate = useNavigate();
  const [role, setRole] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [locality, setLocality] = useState("");
  const { data } = useData(async (r) => {
    const [people, acqs] = await Promise.all([r.persons(), r.allAcquisitions()]);
    return people.map((p) => ({ p, deals: acqs.filter((a) => a.person_id === p.id).length })).sort((a, b) => a.p.name.localeCompare(b.p.name, "sv"));
  });
  const list = useMemo(() => (data ?? []).filter(({ p }) => (!role || p.roles.includes(role)) && (!q || `${p.name} ${p.locality}`.toLowerCase().includes(q.toLowerCase()))), [data, role, q]);

  return (
    <>
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sot-3" aria-hidden="true" />
          <input className="input pl-10" placeholder="Sök person eller ort" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Sök person" />
        </div>
        {profile?.role !== "viewer" && <button className="btn-secondary shrink-0" onClick={() => setAdding((a) => !a)}><Plus size={18} aria-hidden="true" /> Ny</button>}
      </div>
      {adding && (
        <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]" onSubmit={async (e) => {
          e.preventDefault();
          const p = await repo.createPerson({ name: name.trim(), locality: locality.trim(), roles: [], how_we_met: "", organization_id: null, contact: "", notes: "" });
          await refresh();
          navigate(`/person/${p.id}`);
        }}>
          <input className="input" placeholder="Namn" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Namn" />
          <input className="input" placeholder="Ort (valfritt)" value={locality} onChange={(e) => setLocality(e.target.value)} aria-label="Ort" />
          <button className="btn-primary">Lägg till</button>
        </form>
      )}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        <button className={`chip shrink-0 ${role === null ? "chip-on" : ""}`} onClick={() => setRole(null)}>Alla</button>
        {PERSON_ROLES.map((r) => <button key={r} className={`chip shrink-0 ${role === r ? "chip-on" : ""}`} onClick={() => setRole(r)}>{r}</button>)}
      </div>
      {list.length ? (
        <ul className="card divide-y divide-dashed divide-lera-light">
          {list.map(({ p, deals }) => (
            <li key={p.id}>
              <Link to={`/person/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linolja-pale font-serif text-lg font-semibold text-linolja">{p.name.charAt(0)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.name}</span>
                  <span className="text-sm text-sot-3">{[p.locality, deals ? `${deals} affär${deals > 1 ? "er" : ""}` : ""].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="hidden flex-wrap justify-end gap-1 sm:flex">{p.roles.map((r) => <span key={r} className="stamp border-linolja text-linolja">{r}</span>)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="Inga personer här ännu">Personer läggs till när du godkänner fynd eller registrerar dem här.</EmptyState>}
    </>
  );
}

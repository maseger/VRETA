import { Camera, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../../app/AppContext";
import { PERSON_ROLES } from "../../domain/labels";
import { EmptyState } from "../../ui/bits";
import { PersonAvatar, savePersonPhoto } from "../../ui/PersonAvatar";

export function PeopleList() {
  const { repo, profile, refresh, toast } = useApp();
  const navigate = useNavigate();
  const [role, setRole] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [locality, setLocality] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pickPhoto = (f: File | null) => { setPhoto(f); setPreview(f ? URL.createObjectURL(f) : null); };
  const { data } = useData(async (r) => {
    const [people, acqs] = await Promise.all([r.persons(), r.allAcquisitions()]);
    const photos = await Promise.all(people.map((p) => r.mediaFor("person", p.id).then((m) => m.at(-1) ?? null)));
    return people.map((p, i) => ({ p, photo: photos[i], deals: acqs.filter((a) => a.person_id === p.id).length })).sort((a, b) => a.p.name.localeCompare(b.p.name, "sv"));
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
        <form className="card mb-4 flex flex-wrap items-start gap-3 p-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const p = await repo.createPerson({ name: name.trim(), locality: locality.trim(), roles: [], how_we_met: "", organization_id: null, contact: "", notes: "" });
            if (photo) await savePersonPhoto(repo, p, photo).catch((err) => toast(`Personen sparades men inte fotot: ${(err as Error).message}`));
            await refresh();
            navigate(`/person/${p.id}`);
          } finally {
            setBusy(false);
          }
        }}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
          {preview ? (
            <span className="relative shrink-0">
              <img src={preview} alt="Valt foto" className="h-12 w-12 rounded-full object-cover" />
              <button type="button" onClick={() => { pickPhoto(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="Ta bort valt foto"
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-lera-light bg-[#FBF8F1] text-sot-3"><X size={12} aria-hidden="true" /></button>
            </span>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Lägg till foto" title="Lägg till foto (valfritt)"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-lera bg-kalk-2/60 text-sot-3 hover:text-falu"><Camera size={20} aria-hidden="true" /></button>
          )}
          <input className="input min-w-[10rem] flex-1" placeholder="För- och efternamn" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Namn" />
          <input className="input min-w-[8rem] flex-1" placeholder="Ort, t.ex. Ockelbo (valfritt)" value={locality} onChange={(e) => setLocality(e.target.value)} aria-label="Ort" />
          <button className="btn-primary" disabled={busy}>Lägg till</button>
          {photo && <p className="w-full text-[12px] text-sot-3">Fotot syns bara för dig och ägaren tills personen sagt ja till bild.</p>}
        </form>
      )}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        <button className={`chip shrink-0 ${role === null ? "chip-on" : ""}`} onClick={() => setRole(null)}>Alla</button>
        {PERSON_ROLES.map((r) => <button key={r} className={`chip shrink-0 ${role === r ? "chip-on" : ""}`} onClick={() => setRole(r)}>{r}</button>)}
      </div>
      {list.length ? (
        <ul className="card divide-y divide-dashed divide-lera-light">
          {list.map(({ p, photo: pic, deals }) => (
            <li key={p.id}>
              <Link to={`/person/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                <PersonAvatar name={p.name} photo={pic} />
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

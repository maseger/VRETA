// Sök i allt – saker, människor, platser, projekt och historik. Bara det du har rätt att se.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { useQuery } from "../app/AppContext";
import { Empty, ErrorNote, PageHeader, Spinner } from "../ui/base";

export default function Search() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading } = useQuery<any[]>(query.length >= 2 ? "q_search" : null, { q: query, limit: 40 });
  return (
    <div>
      <PageHeader title="Sök" />
      <form className="relative mb-4" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <SearchIcon size={18} className="pointer-events-none absolute left-3 top-3.5 text-sot-3" aria-hidden />
        <input className="input pl-10 text-lg" type="search" autoFocus value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length >= 3) setQuery(e.target.value.trim()); }}
          placeholder="Tegel, Anders, orangeriet …" aria-label="Sök" />
      </form>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && data.length === 0 && <Empty>Inget hittades för "{query}".</Empty>}
      {data && data.length > 0 && (
        <ul className="card divide-y divide-dashed divide-lera">
          {data.map((r) => (
            <li key={r.id}>
              {r.route ? (
                <Link to={r.route} className="block px-4 py-2.5 text-sot no-underline hover:bg-kalk-2/60">
                  <span className="font-semibold">{r.title}</span> <span className="text-sm text-sot-3">{r.type_label}{r.archived ? " · arkiverad" : ""}</span>
                  {r.snippet && <span className="block truncate text-sm text-sot-3">{r.snippet}</span>}
                </Link>
              ) : <div className="px-4 py-2.5"><span className="font-semibold">{r.title}</span> <span className="text-sm text-sot-3">{r.type_label}</span></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Journalen: allt som hänt på Vreta, filtrerbart på slag och berättelsevärde.
import { useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { useQuery } from "../app/AppContext";
import { Chip, ErrorNote, PageHeader, Spinner } from "../ui/base";
import { Timeline } from "../ui/timeline";

const TYPES = [
  { value: "", label: "Allt" }, { value: "object", label: "Saker" }, { value: "acquisition", label: "Inköp" }, { value: "project", label: "Projekt" },
  { value: "moment", label: "Ögonblick" }, { value: "person", label: "Människor" }, { value: "observation", label: "Livet" }, { value: "content", label: "Berättat" },
];

export default function Journal() {
  const [type, setType] = useState("");
  const [story, setStory] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const params = useMemo(() => ({ limit: 200, ...(type ? { type } : {}), ...(story ? { story_only: true } : {}), ...(query ? { q: query } : {}) }), [type, story, query]);
  const { data, error, loading } = useQuery<any[]>("q_journal", params);
  return (
    <div>
      <PageHeader kicker="Historik" title="Journal" sub="Allt som hänt – det digitala minnet." />
      <form className="relative mb-3" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-sot-3" aria-hidden />
        <input className="input pl-9" type="search" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setQuery(""); }} placeholder="Sök i journalen" aria-label="Sök i journalen" />
      </form>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TYPES.map((t) => <Chip key={t.value} on={type === t.value} onClick={() => setType(t.value)}>{t.label}</Chip>)}
        <Chip on={story} onClick={() => setStory((s) => !s)}><Star size={14} aria-hidden /> Värt att berätta</Chip>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? <Spinner /> : <Timeline events={data ?? []} empty="Inget hittades." />}
    </div>
  );
}

// Saker: allt material – på väg in, hemma, i bruk och på väg ut – samt inköp, hämtningar och annonser.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, QrCode, Search } from "lucide-react";
import { useCan, useQuery } from "../app/AppContext";
import { ACQUISITION_TYPES, LISTING_TYPES } from "../app/labels";
import { d, kr } from "../app/format";
import { Chip, Empty, ErrorNote, List, PageHeader, Row, Spinner, Stamp, Tabs, statusTone } from "../ui/base";
import { Thumb } from "../ui/media";

type Tab = "objekt" | "inkop" | "hamtningar" | "annonser";
const GROUPS = [
  { value: "", label: "Alla" }, { value: "incoming", label: "På väg in" }, { value: "home", label: "Hemma" },
  { value: "in_use", label: "I bruk" }, { value: "outgoing", label: "På väg ut" }, { value: "closed", label: "Avslutade" },
];

export default function Things() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("flik") as Tab) || "objekt";
  const can = useCan();
  return (
    <div>
      <PageHeader title="Saker" kicker="Material och återbruk">
        <Link to="/lager" className="btn-secondary btn-small"><QrCode size={16} /> Lager</Link>
        {can("CreateObject") && <Link to="/saker/ny" className="btn-primary btn-small"><Plus size={16} /> Ny sak</Link>}
      </PageHeader>
      <Tabs<Tab> label="Visa" value={tab} onChange={(v) => setSp({ flik: v }, { replace: true })}
        tabs={[{ value: "objekt", label: "Saker" }, { value: "inkop", label: "Inköp" }, { value: "hamtningar", label: "Hämtningar" }, { value: "annonser", label: "Annonser" }]} />
      {tab === "objekt" && <Objects />}
      {tab === "inkop" && <Acquisitions />}
      {tab === "hamtningar" && <Pickups />}
      {tab === "annonser" && <Listings />}
    </div>
  );
}

function Objects() {
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const params = useMemo(() => ({ ...(group ? { group } : {}), ...(query ? { q: query } : {}) }), [group, query]);
  const { data, error, loading } = useQuery<any[]>("q_objects", params);
  return (
    <>
      <form className="relative mb-3" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-sot-3" aria-hidden />
        <input className="input pl-9" type="search" value={q} placeholder="Sök bland sakerna" aria-label="Sök bland sakerna"
          onChange={(e) => { setQ(e.target.value); if (!e.target.value) setQuery(""); }} />
      </form>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{GROUPS.map((g) => <Chip key={g.value} on={group === g.value} onClick={() => setGroup(g.value)}>{g.label}</Chip>)}</div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && !data.length && <Empty>Inga saker här.</Empty>}
      {data && data.length > 0 && (
        <List>
          {data.map((o) => (
            <Row key={o.id} to={`/objekt/${o.id}`} leading={<Thumb m={o.cover} />}
              right={<Stamp tone={statusTone(o.group, o.status)}>{o.status_label}</Stamp>}>
              <div className="font-semibold">{o.label}</div>
              <div className="truncate text-sm text-sot-3">
                {o.allocations?.length > 1 ? o.allocations.map((a: any) => `${a.quantity} ${a.label.toLowerCase()}`).join(" · ") : [o.place, o.project?.title].filter(Boolean).join(" · ") || o.category}
              </div>
            </Row>
          ))}
        </List>
      )}
    </>
  );
}

function Acquisitions() {
  const [closed, setClosed] = useState(false);
  const { data, error, loading } = useQuery<any[]>("q_acquisitions", closed ? { include_closed: true } : {});
  return (
    <>
      <div className="mb-3 flex gap-2"><Chip on={!closed} onClick={() => setClosed(false)}>Pågående</Chip><Chip on={closed} onClick={() => setClosed(true)}>Alla</Chip></div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && !data.length && <Empty>Inga pågående inköp eller gåvor.</Empty>}
      {data && data.length > 0 && (
        <List>
          {data.map((a) => (
            <Row key={a.id} to={`/inkop/${a.id}`} leading={<Thumb m={a.object?.cover} />} right={<Stamp tone={statusTone(null, a.status)}>{a.status_label}</Stamp>}>
              <div className="font-semibold">{a.object?.label}</div>
              <div className="truncate text-sm text-sot-3">{[ACQUISITION_TYPES[a.type], a.counterpart?.display_name, a.price ? kr(a.price) : null,
                a.pickup_window_end ? `hämtas senast ${d(a.pickup_window_end)}` : null].filter(Boolean).join(" · ")}</div>
            </Row>
          ))}
        </List>
      )}
    </>
  );
}

function Pickups() {
  const [scope, setScope] = useState("upcoming");
  const { data, error, loading } = useQuery<any[]>("q_pickups", { scope });
  return (
    <>
      <div className="mb-3 flex gap-2"><Chip on={scope === "upcoming"} onClick={() => setScope("upcoming")}>Kommande</Chip><Chip on={scope === "done"} onClick={() => setScope("done")}>Klara</Chip></div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && !data.length && <Empty>{scope === "upcoming" ? "Inga hämtningar planerade. Planera en från ett inköp." : "Inga klara hämtningar än."}</Empty>}
      {data && data.length > 0 && (
        <List>
          {data.map((p) => (
            <Row key={p.id} to={`/hamtning/${p.id}`} right={<Stamp tone={statusTone(null, p.status)}>{p.status_label}</Stamp>}>
              <div className="font-semibold">{p.title}</div>
              <div className="truncate text-sm text-sot-3">{[d(p.window_start ?? p.scheduled_on), p.locality, p.items.map((i: any) => i.label).join(", "),
                p.checklist.total ? `${p.checklist.done}/${p.checklist.total} i checklistan` : null].filter(Boolean).join(" · ")}</div>
            </Row>
          ))}
        </List>
      )}
    </>
  );
}

function Listings() {
  const [closed, setClosed] = useState(false);
  const can = useCan();
  const { data, error, loading } = useQuery<any[]>("q_listings", closed ? { include_closed: true } : {});
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip on={!closed} onClick={() => setClosed(false)}>Aktiva</Chip><Chip on={closed} onClick={() => setClosed(true)}>Alla</Chip>
        {can("CreateListing") && <Link to="/annons/ny" className="btn-ghost btn-small ml-auto"><Plus size={15} /> Efterlys något</Link>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && !data.length && <Empty>Inga annonser. Annonsera från en saks sida.</Empty>}
      {data && data.length > 0 && (
        <List>
          {data.map((l) => (
            <Row key={l.id} to={`/annons/${l.id}`} leading={<Thumb m={l.cover} />} right={<Stamp tone={statusTone(null, l.status)}>{l.status_label}</Stamp>}>
              <div className="font-semibold">{l.title}</div>
              <div className="truncate text-sm text-sot-3">{[LISTING_TYPES[l.type], l.price ? kr(l.price) : null,
                l.channels.filter((c: any) => c.status === "posted").length ? `ute på ${l.channels.filter((c: any) => c.status === "posted").length} kanaler` : "inte ute än",
                l.waiting ? `${l.waiting} väntar på svar` : null].filter(Boolean).join(" · ")}</div>
            </Row>
          ))}
        </List>
      )}
    </>
  );
}

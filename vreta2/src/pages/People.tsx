// Människor: alla som gett, sålt, hjälpt, tipsat eller köpt – och vilka som väntar på ett tack.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useCan, useLabels, useQuery } from "../app/AppContext";
import { ago } from "../app/format";
import { Avatar, Chip, Empty, ErrorNote, List, PageHeader, Row, Spinner, Stamp, Tabs } from "../ui/base";
import { MediaImg } from "../ui/media";

type Tab = "personer" | "organisationer" | "tacka";

export default function People() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("flik") as Tab) || "personer";
  const can = useCan();
  const { data, error, loading } = useQuery<any[]>("q_people");
  const unthanked = (data ?? []).filter((p) => p.relationship?.unthanked > 0);
  return (
    <div>
      <PageHeader title="Människor" kicker="Givare, hantverkare, grannar och vänner">
        {can("CreatePerson") && <Link to="/manniskor/ny" className="btn-primary btn-small"><Plus size={16} /> Ny person</Link>}
      </PageHeader>
      <Tabs<Tab> label="Visa" value={tab} onChange={(v) => setSp({ flik: v }, { replace: true })}
        tabs={[{ value: "personer", label: "Personer" }, { value: "tacka", label: "Att tacka", count: unthanked.length }, { value: "organisationer", label: "Organisationer" }]} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <Spinner />}
      {data && tab === "personer" && <PersonList people={data} />}
      {data && tab === "tacka" && (unthanked.length ? <PersonList people={unthanked} thanks /> : <Empty>Alla har fått sitt tack. Fint!</Empty>)}
      {tab === "organisationer" && <Organizations />}
    </div>
  );
}

function PersonList({ people, thanks }: { people: any[]; thanks?: boolean }) {
  const { code } = useLabels();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const roles = useMemo(() => [...new Set(people.flatMap((p) => p.roles ?? []))], [people]);
  const shown = people.filter((p) => (!role || p.roles?.includes(role)) && (!q.trim() || `${p.display_name} ${p.locality ?? ""}`.toLocaleLowerCase("sv").includes(q.trim().toLocaleLowerCase("sv"))));
  return (
    <>
      {!thanks && (
        <>
          <div className="relative mb-3">
            <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-sot-3" aria-hidden />
            <input className="input pl-9" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök namn eller ort" aria-label="Sök person" />
          </div>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            <Chip on={!role} onClick={() => setRole("")}>Alla</Chip>
            {roles.map((r) => <Chip key={r} on={role === r} onClick={() => setRole(r)}>{code("person_role", r)}</Chip>)}
          </div>
        </>
      )}
      {shown.length === 0 ? <Empty>Ingen hittades.</Empty> : (
        <List>
          {shown.map((p) => (
            <Row key={p.id} to={thanks ? `/person/${p.id}?tacka=1` : `/person/${p.id}`}
              leading={p.avatar ? <div className="h-10 w-10 overflow-hidden rounded-full"><MediaImg m={p.avatar} className="h-full w-full" /></div> : <Avatar name={p.display_name} />}
              right={thanks ? <span className="btn-secondary btn-small">Tacka</span> : p.relationship?.unthanked > 0 ? <Stamp tone="warn">Tacka</Stamp> : null}>
              <div className="font-semibold">{p.display_name}{p.erased && <span className="ml-2 text-sm text-sot-3">(raderad)</span>}</div>
              <div className="truncate text-sm text-sot-3">{[p.locality, (p.roles ?? []).slice(0, 3).map((r: string) => code("person_role", r)).join(", "),
                p.relationship?.last_event ? `senast ${ago(p.relationship.last_event)}` : null].filter(Boolean).join(" · ")}</div>
            </Row>
          ))}
        </List>
      )}
    </>
  );
}

function Organizations() {
  const { code } = useLabels();
  const { data, error, loading } = useQuery<any[]>("q_organizations");
  if (loading) return <Spinner />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data?.length) return <Empty>Inga organisationer än.</Empty>;
  return (
    <List>
      {data.map((o) => (
        <Row key={o.id} to={`/organisation/${o.id}`} right={<span className="text-sm text-sot-3">{o.members} personer</span>}>
          <div className="font-semibold">{o.name}</div>
          <div className="text-sm text-sot-3">{[code("organization_kind", o.kind_code), o.locality].filter(Boolean).join(" · ")}</div>
        </Row>
      ))}
    </List>
  );
}

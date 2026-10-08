// En organisation: företag, förening eller kommun – med de personer som hör dit och det vi gjort ihop.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCan, useCommand, useLabels, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { Card, Empty, ErrorNote, Kv, PageHeader, Section, Spinner } from "../ui/base";
import { PersonPicker, TextField, strOrNull, type PersonChoice } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";

export default function OrganizationPage() {
  const { id } = useParams();
  const { code } = useLabels();
  const can = useCan();
  const run = useCommand();
  const { data: o, error, loading } = useQuery<any>("q_organization", { id });
  const [link, setLink] = useState(false);
  const [who, setWho] = useState<PersonChoice | null>(null);
  const [title, setTitle] = useState("");
  useScreen(o ? { id: o.id, type: "organization", title: o.name } : null);
  if (loading) return <Spinner />;
  if (error || !o) return <ErrorNote>{error ?? "Organisationen finns inte"}</ErrorNote>;
  return (
    <div>
      <PageHeader kicker={code("organization_kind", o.kind_code) || "Organisation"} title={o.name} sub={o.locality?.title} />
      {o.description && <p className="mb-4">{o.description}</p>}
      <Section title="Personer" action={can("LinkPersonOrganization") && <button type="button" className="btn-ghost btn-small" onClick={() => setLink(true)}>+ Person</button>}>
        {o.members.length === 0 ? <Empty>Ingen kopplad än.</Empty> : (
          <ul className="card divide-y divide-dashed divide-lera">
            {o.members.map((m: any) => <li key={m.id} className="px-4 py-2.5"><Link to={`/person/${m.id}`}>{m.display_name}</Link>{m.role_title && <span className="text-sm text-sot-3"> · {m.role_title}</span>}</li>)}
          </ul>
        )}
      </Section>
      {o.private && (
        <Section title="Kontakt (privat)">
          <Card><dl className="divide-y divide-dashed divide-lera"><Kv k="Telefon">{o.private.phone}</Kv><Kv k="Mejl">{o.private.email}</Kv><Kv k="Adress">{o.private.address}</Kv></dl></Card>
        </Section>
      )}
      {(o.objects_from ?? []).length > 0 && (
        <Section title="Saker från dem">
          <ul className="card divide-y divide-dashed divide-lera">{o.objects_from.map((x: any, i: number) => <li key={i} className="px-4 py-2.5"><Link to={`/objekt/${x.object_id}`}>{x.label}</Link></li>)}</ul>
        </Section>
      )}
      <Section title="Tidslinje"><Timeline events={o.timeline ?? []} hideLink={o.id} /></Section>
      <Sheet open={link} onClose={() => setLink(false)} title="Koppla en person"
        footer={<BusyButton disabled={!who?.id} onClick={async () => { if (await run("LinkPersonOrganization", { person_id: who!.id, organization_id: o.id, role_title: strOrNull(title) }, { success: "Kopplad" })) setLink(false); }}>Spara</BusyButton>}>
        <PersonPicker label="Vem?" value={who} onChange={setWho} allowNew={false} />
        <TextField label="Roll" value={title} onChange={setTitle} placeholder="Ägare, ordförande …" />
      </Sheet>
    </div>
  );
}

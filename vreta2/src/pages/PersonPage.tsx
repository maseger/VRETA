// En person: relationen över tid – vad hen gett, sålt, hjälpt till med och fått tillbaka, samtycke och tack.
// Kontaktuppgifter och kontaktlogg är privata (bara ägaren); samtycke ändras bara av ägaren.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Camera, Copy, Gift, HandHeart, Mail, MessageSquarePlus, Pencil, Phone } from "lucide-react";
import { useApp, useCan, useCommand, useLabels, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { ACQUISITION_TYPES, CONSENT } from "../app/labels";
import { d, dt, kr, num } from "../app/format";
import { thanksMessage } from "@shared/storyTemplates.ts";
import { copyText } from "../services/share";
import { Avatar, Card, Empty, ErrorNote, Kv, PageHeader, Section, Spinner, Stamp } from "../ui/base";
import { MediaImg, PhotoPicker, useUpload } from "../ui/media";
import { NumberField, PersonPicker, ProjectPicker, Select, TextArea, TextField, numOrNull, strOrNull, type PersonChoice } from "../ui/fields";
import { BusyButton, ConfirmButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";
import { useToast } from "../app/toast";

type SheetKind = null | "thanks" | "talk" | "contribution" | "consent" | "private" | "edit" | "photo" | "relation" | "roles";

export default function PersonPage() {
  const { id } = useParams();
  const { data: p, error, loading } = useQuery<any>("q_person", { id });
  useScreen(p ? { id: p.id, type: "person", title: p.display_name } : null);
  if (loading) return <Spinner />;
  if (error || !p) return <ErrorNote>{error ?? "Personen finns inte"}</ErrorNote>;
  return <PersonView p={p} />;
}

function PersonView({ p }: { p: any }) {
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const { code } = useLabels();
  const [sp, setSp] = useSearchParams();
  const [sheet, setSheet] = useState<SheetKind>(sp.get("tacka") ? "thanks" : null);
  const close = () => { setSheet(null); if (sp.get("tacka")) setSp({}, { replace: true }); };
  const r = p.relationship ?? {};
  const unthanked = (p.contributions ?? []).filter((c: any) => !c.thanked_at);
  const avatar = (p.media ?? []).find((m: any) => m.role === "avatar") ?? p.avatar;

  if (p.erased) {
    return <div><PageHeader kicker="Människor" title={p.display_name} /><Empty>Personens uppgifter är raderade. Det hen bidragit med finns kvar utan namn.</Empty></div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        {avatar ? <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full"><MediaImg m={avatar} className="h-full w-full" /></div> : <Avatar name={p.display_name} size={80} />}
        <div className="min-w-0">
          <div className="kicker">{p.locality ?? "Människor"}</div>
          <h1 className="text-[28px] leading-tight">{p.display_name}{p.nickname && <span className="text-sot-3"> ”{p.nickname}”</span>}</h1>
          <div className="mt-1 flex flex-wrap gap-1">{(p.roles ?? []).map((x: string) => <Stamp key={x}>{code("person_role", x)}</Stamp>)}</div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {can("MarkThanked") && <Tile icon={Gift} label={unthanked.length ? `Tacka (${unthanked.length})` : "Tacka"} onClick={() => setSheet("thanks")} hot={unthanked.length > 0} />}
        {can("LogInteraction") && <Tile icon={MessageSquarePlus} label="Logga kontakt" onClick={() => setSheet("talk")} />}
        {can("RecordContribution") && <Tile icon={HandHeart} label="Bidrag" onClick={() => setSheet("contribution")} />}
        {can("SetPersonPhoto") && <Tile icon={Camera} label="Foto" onClick={() => setSheet("photo")} />}
        {can("UpdatePerson") && <Tile icon={Pencil} label="Ändra" onClick={() => setSheet("edit")} />}
      </div>

      <Section title="Relationen">
        <Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat n={r.gave} label="gåvor till oss" /><Stat n={r.sold_to_us} label="köp från hen" /><Stat n={r.bought} label="köpt av oss" />
            <Stat n={r.contributed} label="bidrag" /><Stat n={r.worked_hours} label="timmar" /><Stat n={r.received} label="fått från oss" />
          </div>
          <div className="mt-3 text-sm text-sot-3">{p.how_we_met && <>Träffades: {p.how_we_met} · </>}{r.first_event && <>första gången {d(r.first_event)}</>}</div>
        </Card>
      </Section>

      <Section title="Samtycke" action={can("ChangeConsent") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet("consent")}>Ändra</button>}>
        <Card>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {[["name", "Namn"], ["image", "Bild"], ["contribution", "Bidrag"]].map(([a, l]) => {
              const v = p.consent?.[a] ?? "ask";
              return <span key={a}>{l}: <Stamp tone={v === "yes" ? "ok" : v === "no" ? "falu" : "warn"}>{CONSENT[v]}</Stamp></span>;
            })}
          </div>
          {p.consent_detail?.given_at && <div className="mt-1 text-sm text-sot-3">Lämnat {d(p.consent_detail.given_at)}{p.consent_detail.given_how ? ` · ${p.consent_detail.given_how}` : ""}{p.consent_detail.note ? ` · ${p.consent_detail.note}` : ""}</div>}
        </Card>
      </Section>

      {p.private && (
        <Section title="Kontakt (privat)" action={can("SetPersonPrivate") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet("private")}>Ändra</button>}>
          <Card>
            <div className="mb-2 flex flex-wrap gap-2">
              {p.private.phone && <a className="btn-secondary btn-small" href={`tel:${p.private.phone.replace(/\s/g, "")}`}><Phone size={15} /> {p.private.phone}</a>}
              {p.private.email && <a className="btn-secondary btn-small" href={`mailto:${p.private.email}`}><Mail size={15} /> Mejla</a>}
            </div>
            <dl className="divide-y divide-dashed divide-lera"><Kv k="Adress">{p.private.address}</Kv><Kv k="Anteckning">{p.private.notes}</Kv><Kv k="Pålitlighet">{p.private.reliability_note}</Kv></dl>
          </Card>
        </Section>
      )}

      {(p.objects_from ?? []).length > 0 && (
        <Section title="Saker från hen">
          <ul className="card divide-y divide-dashed divide-lera">
            {p.objects_from.map((o: any) => (
              <li key={o.acquisition_id}><Link to={`/objekt/${o.object_id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sot no-underline">
                <span><span className="font-semibold">{o.label}</span><span className="block text-sm text-sot-3">{ACQUISITION_TYPES[o.type]}{o.price ? ` · ${kr(o.price)}` : ""} · {o.place_path ?? o.object_status_label}</span></span>
                <Stamp tone={o.object_status === "in_use" ? "ok" : "neutral"}>{o.object_status_label}</Stamp>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}
      {(p.objects_to ?? []).length > 0 && (
        <Section title="Saker till hen">
          <ul className="card divide-y divide-dashed divide-lera">
            {p.objects_to.map((o: any, i: number) => <li key={i} className="px-4 py-2.5"><Link to={`/objekt/${o.object_id}`}>{o.label}</Link> <span className="text-sm text-sot-3">· {d(o.occurred_at)}</span></li>)}
          </ul>
        </Section>
      )}

      <Section title="Bidrag">
        {(p.contributions ?? []).length === 0 ? <Empty>Inga bidrag registrerade.</Empty> : (
          <ul className="card divide-y divide-dashed divide-lera">
            {p.contributions.map((c: any) => (
              <li key={c.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                <span><span className="font-semibold">{code("contribution_type", c.type_code)}</span>{c.description && <> – {c.description}</>}
                  <span className="block text-sm text-sot-3">{d(c.occurred_at)}{c.hours ? ` · ${num(c.hours)} tim` : ""}{c.project ? ` · ${c.project.title}` : ""}</span></span>
                {c.thanked_at ? <Stamp tone="ok">Tackad</Stamp> : <Stamp tone="warn">Inte tackad</Stamp>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(p.interactions ?? []).length > 0 && (
        <Section title="Kontaktlogg (privat)">
          <div className="flex flex-col gap-2">
            {p.interactions.map((i: any) => (
              <Card key={i.id} className="!py-3"><div className="text-sm text-sot-3">{dt(i.occurred_at)}{i.channel_code ? ` · ${code("interaction_channel", i.channel_code)}` : ""}</div>
                <div className="font-semibold">{i.summary}</div>{i.body && <p className="whitespace-pre-wrap text-sot-2">{i.body}</p>}</Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Kopplingar" action={can("SetPersonRelation") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet("relation")}>+ Koppling</button>}>
        {(p.relations ?? []).length === 0 && (p.organizations ?? []).length === 0 && (p.tipped ?? []).length === 0 ? <p className="text-sot-3">Inga kopplingar än.</p> : (
          <Card>
            {(p.relations ?? []).map((x: any) => (
              <div key={x.id} className="py-1">{x.direction === "out" ? "" : "← "}{code("relation_kind", x.kind_code)} <Link to={`/person/${x.other.id}`}>{x.other.display_name}</Link>{x.note && <span className="text-sot-3"> · {x.note}</span>}</div>
            ))}
            {(p.organizations ?? []).map((o: any) => <div key={o.id} className="py-1">{o.role_title ?? "Hör till"} <Link to={`/organisation/${o.id}`}>{o.name}</Link></div>)}
            {(p.tipped ?? []).length > 0 && <div className="py-1">Tipsade om {p.tipped.map((t: any, i: number) => <span key={t.id}>{i > 0 && ", "}<Link to={t.route}>{t.title}</Link></span>)}</div>}
          </Card>
        )}
      </Section>

      {(p.stories ?? []).length > 0 && (
        <Section title="Berättat om">
          <ul className="card divide-y divide-dashed divide-lera">{p.stories.map((s: any) => <li key={s.id} className="px-4 py-2.5"><Link to={`/berattelse/${s.id}`}>{s.title}</Link> <span className="text-sm text-sot-3">· {s.shared_at ? `delad ${d(s.shared_at)}` : s.status}</span></li>)}</ul>
        </Section>
      )}

      <Section title="Tidslinje"><Timeline events={p.timeline ?? []} hideLink={p.id} /></Section>

      {can("SetPersonRole") && <button type="button" className="btn-ghost btn-small" onClick={() => setSheet("roles")}>Ändra roller</button>}
      {can("ErasePerson") && (
        <div className="mt-6 flex justify-end">
          <ConfirmButton className="btn-ghost btn-small" confirmLabel="Radera uppgifterna"
            question={<>Namn, kontaktuppgifter, kontaktlogg och bilder på {p.display_name} raderas för alltid. Det hen bidragit med finns kvar, men utan namn. Det går inte att ångra.</>}
            onConfirm={async () => { if (await run("ErasePerson", { person_id: p.id }, { success: "Uppgifterna är raderade" })) nav("/manniskor"); }}>Radera personens uppgifter</ConfirmButton>
        </div>
      )}

      <ThanksSheet open={sheet === "thanks"} onClose={close} p={p} />
      <LogInteractionSheet open={sheet === "talk"} onClose={close} personId={p.id} />
      <ContributionSheet open={sheet === "contribution"} onClose={close} personId={p.id} />
      <ConsentSheet open={sheet === "consent"} onClose={close} p={p} />
      <PrivateSheet open={sheet === "private"} onClose={close} p={p} />
      <EditSheet open={sheet === "edit"} onClose={close} p={p} />
      <PhotoSheet open={sheet === "photo"} onClose={close} personId={p.id} />
      <RelationSheet open={sheet === "relation"} onClose={close} personId={p.id} />
      <RolesSheet open={sheet === "roles"} onClose={close} p={p} />
    </div>
  );
}

function Tile({ icon: Icon, label, onClick, hot }: { icon: any; label: string; onClick: () => void; hot?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`card flex min-h-[68px] flex-col items-center justify-center gap-1 px-1 text-sm font-semibold ${hot ? "border-ockra" : ""}`}>
      <Icon size={22} className={hot ? "text-ockra" : "text-falu"} aria-hidden />{label}
    </button>
  );
}

function Stat({ n, label }: { n?: number | null; label: string }) {
  return <div><div className="font-serif text-2xl">{num(n ?? 0)}</div><div className="text-sm text-sot-3">{label}</div></div>;
}

function ThanksSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const toast = useToast();
  const used = (p.objects_from ?? []).find((o: any) => o.object_status === "in_use");
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(thanksMessage(p.display_name, used?.label, used?.place_path)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose} title={`Tacka ${p.display_name.split(" ")[0]}`}
      footer={<>
        <button type="button" className="btn-secondary" onClick={async () => { await copyText(text); toast("Tacket är kopierat – skicka det i ert vanliga sätt att höras"); }}><Copy size={16} /> Kopiera</button>
        <BusyButton className="btn-done" onClick={async () => {
          await run("LogInteraction", { person_id: p.id, channel_code: "message", summary: "Tackade", body: text });
          if (await run("MarkThanked", { person_id: p.id }, { success: "Tackad!" })) onClose();
        }}>Jag har tackat</BusyButton>
      </>}>
      <TextArea label="Meddelande" value={text} onChange={setText} rows={5} />
      {used && <p className="text-sm text-sot-3">Visa gärna en bild på var {used.label.toLowerCase()} hamnade – det är det bästa tacket.</p>}
    </Sheet>
  );
}

export function LogInteractionSheet({ open, onClose, personId }: { open: boolean; onClose: () => void; personId: string }) {
  const { ctx } = useApp();
  const run = useCommand();
  const [channel, setChannel] = useState("message");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [follow, setFollow] = useState("");
  const [followTitle, setFollowTitle] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Logga kontakt"
      footer={<BusyButton disabled={!summary.trim()} onClick={async () => {
        const r = await run("LogInteraction", { person_id: personId, channel_code: channel, summary: summary.trim(), body: strOrNull(body),
          follow_up_at: follow ? new Date(follow).toISOString() : null, follow_up_title: strOrNull(followTitle) }, { success: "Sparat i kontaktloggen" });
        if (r) { setSummary(""); setBody(""); setFollow(""); onClose(); }
      }}>Spara</BusyButton>}>
      <Select label="Hur?" value={channel} onChange={setChannel} options={(ctx?.codes.interaction_channel ?? []).map((c) => ({ value: c.code, label: c.label }))} />
      <TextField label="Kort sammanfattning" value={summary} onChange={setSummary} placeholder="Fönstren finns kvar, hämtas före november" />
      <TextArea label="Det som sades (klistra in chatten om du vill)" value={body} onChange={setBody} rows={4} hint="Kontaktloggen är privat." />
      <div className="grid grid-cols-2 gap-x-3">
        <TextField label="Följ upp" type="date" value={follow} onChange={setFollow} />
        <TextField label="Vad då?" value={followTitle} onChange={setFollowTitle} />
      </div>
    </Sheet>
  );
}

function ContributionSheet({ open, onClose, personId }: { open: boolean; onClose: () => void; personId: string }) {
  const { ctx } = useApp();
  const run = useCommand();
  const [type, setType] = useState("time");
  const [desc, setDesc] = useState("");
  const [hours, setHours] = useState("");
  const [project, setProject] = useState("");
  const [date, setDate] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Bidrag"
      footer={<BusyButton onClick={async () => {
        const r = await run("RecordContribution", { person_id: personId, type_code: type, description: strOrNull(desc), hours: numOrNull(hours), project_id: project || null,
          occurred_at: date ? new Date(date).toISOString() : null }, { success: "Bidraget är sparat" });
        if (r) { setDesc(""); setHours(""); onClose(); }
      }}>Spara</BusyButton>}>
      <Select label="Vad bidrog hen med?" value={type} onChange={setType} options={(ctx?.codes.contribution_type ?? []).map((c) => ({ value: c.code, label: c.label }))} />
      <TextField label="Beskrivning" value={desc} onChange={setDesc} placeholder="Murade södra väggen" />
      {type === "time" && <NumberField label="Timmar" value={hours} onChange={setHours} />}
      <ProjectPicker label="Projekt" value={project} onChange={setProject} />
      <TextField label="När" type="date" value={date} onChange={setDate} />
    </Sheet>
  );
}

function ConsentSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const [c, setC] = useState({ name: p.consent?.name ?? "ask", image: p.consent?.image ?? "ask", contribution: p.consent?.contribution ?? "ask" });
  const [how, setHow] = useState("");
  const [note, setNote] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Samtycke"
      footer={<BusyButton onClick={async () => { if (await run("ChangeConsent", { person_id: p.id, ...c, given_how: strOrNull(how), note: strOrNull(note) }, { success: "Samtycket är sparat" })) onClose(); }}>Spara</BusyButton>}>
      {(["name", "image", "contribution"] as const).map((a) => (
        <Select key={a} label={{ name: "Nämna vid namn", image: "Visa bild", contribution: "Berätta vad hen bidragit med" }[a]} value={c[a]}
          onChange={(v) => setC((x) => ({ ...x, [a]: v }))} options={Object.entries(CONSENT).map(([value, label]) => ({ value, label }))} />
      ))}
      <TextField label="Hur fick du svaret?" value={how} onChange={setHow} placeholder="Muntligt, sms …" />
      <TextField label="Anteckning" value={note} onChange={setNote} />
      <p className="text-sm text-sot-3">Om hen drar tillbaka samtycket skapas uppgifter för att ta ner det som redan delats.</p>
    </Sheet>
  );
}

function PrivateSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const [f, setF] = useState({ phone: p.private?.phone ?? "", email: p.private?.email ?? "", address: p.private?.address ?? "", notes: p.private?.notes ?? "", reliability_note: p.private?.reliability_note ?? "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Sheet open={open} onClose={onClose} title="Kontakt (privat)"
      footer={<BusyButton onClick={async () => { if (await run("SetPersonPrivate", { person_id: p.id, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, strOrNull(v)])) }, { success: "Sparat" })) onClose(); }}>Spara</BusyButton>}>
      <TextField label="Telefon" type="tel" value={f.phone} onChange={set("phone")} />
      <TextField label="Mejl" type="email" value={f.email} onChange={set("email")} />
      <TextField label="Adress" value={f.address} onChange={set("address")} />
      <TextArea label="Anteckning" value={f.notes} onChange={set("notes")} rows={2} />
      <TextField label="Pålitlighet" value={f.reliability_note} onChange={set("reliability_note")} />
    </Sheet>
  );
}

function EditSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const run = useCommand();
  const [name, setName] = useState(p.display_name);
  const [nick, setNick] = useState(p.nickname ?? "");
  const [how, setHow] = useState(p.how_we_met ?? "");
  const [loc, setLoc] = useState(p.locality ?? "");
  return (
    <Sheet open={open} onClose={onClose} title="Ändra"
      footer={<BusyButton onClick={async () => { if (await run("UpdatePerson", { person_id: p.id, display_name: name.trim(), nickname: strOrNull(nick), how_we_met: strOrNull(how), locality: strOrNull(loc) }, { success: "Sparat" })) onClose(); }}>Spara</BusyButton>}>
      <TextField label="Namn" value={name} onChange={setName} />
      <TextField label="Smeknamn" value={nick} onChange={setNick} />
      <TextField label="Ort" value={loc} onChange={setLoc} />
      <TextField label="Hur vi träffades" value={how} onChange={setHow} />
    </Sheet>
  );
}

function PhotoSheet({ open, onClose, personId }: { open: boolean; onClose: () => void; personId: string }) {
  const run = useCommand();
  const upload = useUpload();
  const [files, setFiles] = useState<File[]>([]);
  return (
    <Sheet open={open} onClose={onClose} title="Profilbild"
      footer={<BusyButton disabled={!files.length} onClick={async () => {
        const [id] = await upload(files.slice(0, 1), { hasPeople: true });
        if (await run("SetPersonPhoto", { person_id: personId, media_id: id }, { success: "Bilden är sparad" })) { setFiles([]); onClose(); }
      }}>Spara</BusyButton>}>
      <PhotoPicker files={files} onChange={(f) => setFiles(f.slice(-1))} multiple={false} />
      <p className="mt-2 text-sm text-sot-3">Bilden visas bara internt. Den delas aldrig utan bildsamtycke.</p>
    </Sheet>
  );
}

function RelationSheet({ open, onClose, personId }: { open: boolean; onClose: () => void; personId: string }) {
  const { ctx } = useApp();
  const run = useCommand();
  const [other, setOther] = useState<PersonChoice | null>(null);
  const [kind, setKind] = useState("introduced");
  const [note, setNote] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Koppling till en annan person"
      footer={<BusyButton disabled={!other?.id} onClick={async () => { if (await run("SetPersonRelation", { person_id: personId, other_person_id: other!.id, kind_code: kind, note: strOrNull(note) }, { success: "Sparat" })) onClose(); }}>Spara</BusyButton>}>
      <Select label="Hur?" value={kind} onChange={setKind} options={(ctx?.codes.relation_kind ?? []).map((c) => ({ value: c.code, label: c.label }))} />
      <PersonPicker label="Vem?" value={other} onChange={setOther} allowNew={false} />
      <TextField label="Anteckning" value={note} onChange={setNote} />
    </Sheet>
  );
}

function RolesSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: any }) {
  const { ctx } = useApp();
  const run = useCommand();
  return (
    <Sheet open={open} onClose={onClose} title="Roller">
      <div className="flex flex-col">
        {(ctx?.codes.person_role ?? []).map((r) => {
          const on = (p.roles ?? []).includes(r.code);
          return (
            <label key={r.code} className="flex min-h-[44px] items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-falu" checked={on} onChange={() => run("SetPersonRole", { person_id: p.id, role_code: r.code, remove: on })} />
              {r.label}
            </label>
          );
        })}
      </div>
    </Sheet>
  );
}

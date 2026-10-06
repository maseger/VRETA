import { CalendarClock, Gift, Heart, Lock, Mic, MicOff, Phone, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { ACQ_STATUS_LABEL, ACQUISITION_LABEL, CHANNEL_INTERACTION_LABEL, CONTRIBUTION_LABEL, DISPOSAL_LABEL, PERSON_ROLES, eventLabel } from "../domain/labels";
import type { Consent, ContributionKind, InteractionChannel, Visibility } from "../domain/types";
import { EmptyState, MediaImage, Section, StatusStamp, formatDate } from "../ui/bits";
import { EditablePersonAvatar } from "../ui/PersonAvatar";
import { PersonNetwork } from "../ui/PersonNetwork";
import { ProjectInput } from "../ui/ProjectInput";
import { useDictation } from "../ui/useDictation";

type ConsentKey = "consent_name" | "consent_image" | "consent_contribution";

export function PersonPage() {
  const { id } = useParams();
  const { repo, profile, refresh, toast } = useApp();
  const canWrite = profile?.role !== "viewer";
  const isOwner = profile?.role === "owner";
  const { data } = useData(async (r) => {
    const person = await r.person(id!);
    if (!person) return null;
    const [acqs, objects, events, orgs, contributions, reciprocity, disposals, photos] = await Promise.all([
      r.allAcquisitions(), r.objects(), r.eventsFor("person", id!), r.organizations(), r.contributions(id!), r.reciprocity(id!), r.disposals(), r.mediaFor("person", id!),
    ]);
    const outgoing = disposals.filter((d) => d.person_id === id).map((d) => ({ d, o: objects.find((o) => o.id === d.object_id) })).filter((x) => x.o);
    const deals = acqs.filter((a) => a.person_id === id).map((a) => ({ a, o: objects.find((o) => o.id === a.object_id) })).filter((x) => x.o);
    const covers = await Promise.all(deals.map((d) => r.mediaFor("object", d.o!.id).then((m) => m[0])));
    const interactions = person.notes !== undefined ? await r.interactions(id!) : [];
    return {
      person, deals: deals.map((d, i) => ({ ...d, cover: covers[i] })), events, interactions, org: orgs.find((o) => o.id === person.organization_id),
      contributions, reciprocity, outgoing, objects, photo: photos.at(-1) ?? null,
    };
  }, [id]);

  const [channel, setChannel] = useState<InteractionChannel>("samtal");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [editPrivate, setEditPrivate] = useState(false);
  const [editRoles, setEditRoles] = useState(false);
  const [editName, setEditName] = useState<{ name: string; locality: string } | null>(null);
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const append = useCallback((t: string) => setSummary((s) => (s ? `${s} ${t}` : t)), []);
  const dictation = useDictation(append);

  if (data === null) return <EmptyState title="Personen finns inte" />;
  if (!data) return null;
  const { person, deals, events, interactions, org, contributions, reciprocity, outgoing, objects, photo } = data;
  const unthanked = contributions.filter((c) => !c.thanked_at).length;
  const newLife = deals.filter((d) => d.o!.status === "in_use");
  const seesPrivate = person.notes !== undefined;

  const consent = (k: ConsentKey, label: string) => (
    <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      <select className="input w-auto py-1.5 text-sm" disabled={!isOwner} value={person[k]} onChange={async (e) => { await repo.updateConsent(person.id, { [k]: e.target.value as Consent }); await refresh(); }}>
        <option value="yes">Ja</option>
        <option value="no">Nej</option>
        <option value="ask">Fråga varje gång</option>
      </select>
    </label>
  );

  const timeline = [
    ...events.map((e) => ({ at: e.occurred_at, title: eventLabel(e.event_type), text: e.summary, kind: "event" as const })),
    ...interactions.map((i) => ({ at: i.occurred_at, title: CHANNEL_INTERACTION_LABEL[i.channel], text: i.summary, kind: "interaction" as const, follow: i.follow_up })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/manniskor" className="text-sm font-semibold text-falu">← Människor</Link>
      <header className="mb-6 mt-2 flex items-start gap-4">
        <EditablePersonAvatar person={person} photo={photo} canWrite={canWrite} />
        <div className="min-w-0 flex-1">
          {editName ? (
            <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={async (e) => {
              e.preventDefault();
              await repo.updatePerson(person.id, { name: editName.name.trim() || person.name, locality: editName.locality.trim() });
              setEditName(null);
              await refresh();
            }}>
              <input className="input" aria-label="Namn" value={editName.name} onChange={(e) => setEditName({ ...editName, name: e.target.value })} required autoFocus />
              <input className="input" aria-label="Ort" placeholder="Ort (kommun eller tätort)" value={editName.locality} onChange={(e) => setEditName({ ...editName, locality: e.target.value })} />
              <span className="flex gap-2">
                <button className="btn-primary">Spara</button>
                <button type="button" className="btn-secondary" onClick={() => setEditName(null)}>Avbryt</button>
              </span>
            </form>
          ) : (
            <>
              <h1>{person.name}</h1>
              <p className="text-sot-3">
                {person.locality}{person.locality && org ? " · " : ""}{org && <Link to={`/organisation/${org.id}`} className="text-falu">{org.name}</Link>}
                {canWrite && (
                  <button onClick={() => setEditName({ name: person.name, locality: person.locality })} className={`${person.locality || org ? "ml-2 " : ""}text-[12px] font-semibold text-falu underline-offset-2 hover:underline`}>
                    {person.locality ? "Ändra namn eller ort" : "Ändra namn · lägg till ort"}
                  </button>
                )}
              </p>
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PERSON_ROLES.filter((r) => person.roles.includes(r) || editRoles).map((r) => {
              const on = person.roles.includes(r);
              return canWrite ? (
                <button key={r} onClick={async () => { await repo.updatePerson(person.id, { roles: on ? person.roles.filter((x) => x !== r) : [...person.roles, r] }); await refresh(); }} className={`stamp ${on ? "border-linolja text-linolja" : "border-dashed border-lera text-sot-3/70"}`} aria-pressed={on}>
                  {r}
                </button>
              ) : <span key={r} className="stamp border-linolja text-linolja">{r}</span>;
            })}
            {canWrite && (
              <button onClick={() => setEditRoles((e) => !e)} className="text-[12px] font-semibold text-falu underline-offset-2 hover:underline">
                {editRoles ? "Klar" : "+ Roll"}
              </button>
            )}
          </div>
        </div>
      </header>

      {seesPrivate && (
        <div className="mb-8 flex flex-wrap gap-2">
          {person.contact && /\d/.test(person.contact) && (
            <a className="btn-secondary" href={`tel:${person.contact.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden="true" /> Ring</a>
          )}
          <a className="btn-secondary" href="#logga"><Plus size={18} aria-hidden="true" /> Logga kontakt</a>
          {canWrite && <a className="btn-secondary" href="#bidrag"><Gift size={18} aria-hidden="true" /> Registrera bidrag</a>}
          {canWrite && <Link className="btn-secondary" to={`/person/${person.id}/tacka`}><Heart size={18} aria-hidden="true" /> Tacka</Link>}
        </div>
      )}

      {canWrite && (unthanked > 0 || newLife.length > 0) && (
        <Link to={`/person/${person.id}/tacka`} className="card mb-8 flex items-center gap-3 border-ockra/50 p-4 hover:bg-kalk-2/60">
          <Heart size={22} className="shrink-0 text-falu" aria-hidden="true" />
          <span className="text-sot-2">
            {newLife.length > 0
              ? <>Visa {person.name.split(" ")[0]} var det hamnade: <b>{newLife.map((d) => d.o!.title.toLowerCase()).join(", ")}</b> har fått nytt liv.</>
              : <>{person.name.split(" ")[0]} har {unthanked} {unthanked === 1 ? "bidrag" : "bidrag"} som inte tackats än.</>}
          </span>
        </Link>
      )}

      <Section title="Samtycke för berättelser">
        <div className="card divide-y divide-dashed divide-lera-light px-4 py-1">
          {consent("consent_name", "Namn får nämnas")}
          {consent("consent_image", "Bild får visas")}
          {consent("consent_contribution", "Bidrag får beskrivas")}
        </div>
        {isOwner ? (
          <p className="mt-2 text-[13px] text-sot-3">
            Fråga gärna vid första kontakten: <em>”Jag berättar gärna om Vreta på Facebook och Instagram. Okej om jag nämner dig vid namn, visar bild på dig eller berättar vad du bidragit med?”</em>
          </p>
        ) : <p className="mt-2 text-[13px] text-sot-3">Bara ägaren kan ändra samtycke.</p>}
      </Section>

      <Section title="Privat" action={seesPrivate && canWrite && !editPrivate ? <button className="text-sm font-semibold text-falu" onClick={() => { setContact(person.contact ?? ""); setNotes(person.notes ?? ""); setEditPrivate(true); }}>Ändra</button> : undefined}>
        {!seesPrivate ? (
          <p className="flex items-center gap-2 text-sot-3"><Lock size={16} aria-hidden="true" /> Kontaktuppgifter och anteckningar syns bara för ägaren.</p>
        ) : editPrivate ? (
          <form className="card space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); await repo.updatePersonPrivate(person.id, { contact, notes }); setEditPrivate(false); await refresh(); }}>
            <div><label className="field-label" htmlFor="contact">Kontakt</label><input id="contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Telefon, e-post eller profil" /></div>
            <div><label className="field-label" htmlFor="notes">Anteckningar</label><textarea id="notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => setEditPrivate(false)}>Avbryt</button><button className="btn-primary">Spara</button></div>
          </form>
        ) : (
          <dl className="card grid gap-3 p-4 sm:grid-cols-2">
            <div><dt className="kicker flex items-center gap-1"><Lock size={11} aria-hidden="true" /> Kontakt</dt><dd>{person.contact || <span className="text-sot-3">–</span>}</dd></div>
            <div><dt className="kicker flex items-center gap-1"><Lock size={11} aria-hidden="true" /> Anteckningar</dt><dd>{person.notes || <span className="text-sot-3">–</span>}</dd></div>
          </dl>
        )}
      </Section>

      <PersonNetwork person={person} />

      <Section title="Objekt">
        {deals.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {deals.map(({ a, o, cover }) => (
              <li key={a.id}>
                <Link to={`/objekt/${o!.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-kalk-2/60">
                  <MediaImage media={cover} className="h-12 w-12 shrink-0 rounded-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o!.title}</span>
                    <span className="text-sm text-sot-3">{ACQUISITION_LABEL[a.type]} · {ACQ_STATUS_LABEL[a.status]}{a.price != null ? ` · ${a.price.toLocaleString("sv-SE")} kr` : ""}</span>
                  </span>
                  <StatusStamp status={o!.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sot-3">Inga objekt kopplade ännu.</p>}
        {outgoing.length > 0 && (
          <>
            <p className="kicker mb-2 mt-4">Från Vreta till {person.name.split(" ")[0]}</p>
            <ul className="card divide-y divide-dashed divide-lera-light">
              {outgoing.map(({ d, o }) => (
                <li key={d.id}>
                  <Link to={`/objekt/${o!.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-kalk-2/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.quantity != null ? `${d.quantity} ${o!.unit} ` : ""}{o!.title.toLowerCase()}</span>
                      <span className="text-sm text-sot-3">{DISPOSAL_LABEL[d.type]} · {formatDate(d.occurred_at)}{d.price != null ? ` · ${d.price.toLocaleString("sv-SE")} kr` : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Contributions personId={person.id} firstName={person.name.split(" ")[0]} contributions={contributions} reciprocity={reciprocity} objects={objects} canWrite={canWrite} />

      <Section title="Kontakt med Vreta">
        {seesPrivate && canWrite && (
          <form id="logga" className="card mb-5 space-y-3 p-4" onSubmit={async (e) => {
            e.preventDefault();
            await repo.addInteraction({ person_id: person.id, organization_id: null, channel, summary: summary.trim(), follow_up: followUp || null });
            setSummary(""); setFollowUp("");
            await refresh();
            toast("Kontakten är loggad");
          }}>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CHANNEL_INTERACTION_LABEL) as InteractionChannel[]).map((c) => (
                <button type="button" key={c} onClick={() => setChannel(c)} className={`chip ${channel === c ? "chip-on" : ""}`}>{CHANNEL_INTERACTION_LABEL[c]}</button>
              ))}
            </div>
            <div className="relative">
              <textarea className="input pr-12" rows={3} required value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Vad pratade ni om? Klistra in eller diktera." aria-label="Sammanfattning" />
              {dictation.supported && (
                <button type="button" onClick={dictation.toggle} className={`absolute right-2 top-2 rounded-md p-2 ${dictation.listening ? "bg-falu text-kalk" : "text-sot-3 hover:bg-kalk-2"}`} aria-label={dictation.listening ? "Sluta diktera" : "Diktera"}>
                  {dictation.listening ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="field-label" htmlFor="fu">Följ upp (valfritt)</label><input id="fu" type="date" className="input" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></div>
              <button className="btn-primary ml-auto">Logga</button>
            </div>
            <p className="flex items-center gap-1.5 text-[12px] text-sot-3"><Lock size={12} aria-hidden="true" /> Kontakthistorik är alltid privat.</p>
          </form>
        )}
        {timeline.length ? (
          <ol className="relative ml-2 space-y-5 border-l-2 border-dashed border-lera pl-6">
            {timeline.map((t, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[33px] top-1 h-4 w-4 rounded-full border-2 border-kalk ${t.kind === "interaction" ? "bg-linolja" : "bg-falu"}`} aria-hidden="true" />
                <p className="kicker">{formatDate(t.at)}</p>
                <p className="font-serif text-[17px] font-semibold">{t.title}</p>
                <p className="text-sot-2">{t.text}</p>
                {"follow" in t && t.follow && <p className="mt-1 flex items-center gap-1 text-sm text-falu"><CalendarClock size={14} aria-hidden="true" /> Följ upp {formatDate(t.follow)}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="text-sot-3">Ingen historik ännu.</p>}
      </Section>
    </div>
  );
}

function Contributions({ personId, firstName, contributions, reciprocity, objects, canWrite }: {
  personId: string; firstName: string; canWrite: boolean;
  contributions: Awaited<ReturnType<import("../data/repo").Repo["contributions"]>>;
  reciprocity: Awaited<ReturnType<import("../data/repo").Repo["reciprocity"]>>;
  objects: Awaited<ReturnType<import("../data/repo").Repo["objects"]>>;
}) {
  const { repo, refresh, toast } = useApp();
  const [kind, setKind] = useState<ContributionKind>("tid");
  const [description, setDescription] = useState("");
  const [hours, setHours] = useState("");
  const [objectId, setObjectId] = useState("");
  const [project, setProject] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("shareable");
  const [back, setBack] = useState("");
  return (
    <Section title="Bidrag och ömsesidighet">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="kicker mb-2">{firstName} har bidragit med</p>
          {contributions.length ? (
            <ul className="card mb-3 divide-y divide-dashed divide-lera-light">
              {contributions.map((c) => (
                <li key={c.id} className="px-3 py-2.5">
                  <p className="font-medium">{c.description}</p>
                  <p className="text-sm text-sot-3">
                    {[CONTRIBUTION_LABEL[c.kind], c.project, c.hours ? `${c.hours} h` : "", formatDate(c.occurred_at)].filter(Boolean).join(" · ")}
                    {c.thanked_at ? <span className="ml-2 text-linolja">Tackad</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : <p className="mb-3 text-sm text-sot-3">Inga bidrag registrerade ännu.</p>}
          {canWrite && (
            <form id="bidrag" className="card space-y-3 p-4" onSubmit={async (e) => {
              e.preventDefault();
              await repo.addContribution({ person_id: personId, kind, description: description.trim(), hours: hours ? Number(hours) : null, object_id: objectId || null, zone_id: null, project: project.trim(), visibility });
              setDescription(""); setHours(""); setObjectId(""); setProject("");
              await refresh();
              toast("Bidraget är registrerat");
            }}>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(CONTRIBUTION_LABEL) as ContributionKind[]).map((k) => (
                  <button type="button" key={k} onClick={() => setKind(k)} className={`chip ${kind === k ? "chip-on" : ""}`}>{CONTRIBUTION_LABEL[k]}</button>
                ))}
              </div>
              <input className="input" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Vad bidrog de med?" aria-label="Beskrivning" />
              <div className="grid gap-3 sm:grid-cols-2">
                {kind === "tid" && <input type="number" min={0} step={0.5} className="input" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Timmar" aria-label="Timmar" />}
                <select className="input" value={objectId} onChange={(e) => setObjectId(e.target.value)} aria-label="Objekt">
                  <option value="">Inget objekt</option>
                  {objects.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
                <ProjectInput value={project} onChange={setProject} />
                <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} aria-label="Synlighet">
                  <option value="shareable">Får berättas</option>
                  <option value="internal">Bara internt</option>
                  <option value="private">Privat</option>
                </select>
              </div>
              <button className="btn-primary w-full">Registrera bidrag</button>
            </form>
          )}
        </div>
        <div>
          <p className="kicker mb-2">Vreta har gett tillbaka</p>
          {reciprocity.length ? (
            <ul className="card mb-3 divide-y divide-dashed divide-lera-light">
              {reciprocity.map((r) => <li key={r.id} className="px-3 py-2.5"><p>{r.description}</p><p className="text-sm text-sot-3">{formatDate(r.occurred_at)}</p></li>)}
            </ul>
          ) : <p className="mb-3 text-sm text-sot-3">Plantor, hjälp, mat, en visning av resultatet – det som går tillbaka.</p>}
          {canWrite && (
            <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await repo.addReciprocity(personId, back.trim()); setBack(""); await refresh(); }}>
              <input className="input" required value={back} onChange={(e) => setBack(e.target.value)} placeholder="T.ex. fick plantor från orangeriet" aria-label="Vad Vreta gav tillbaka" />
              <button className="btn-secondary whitespace-nowrap">Lägg till</button>
            </form>
          )}
        </div>
      </div>
    </Section>
  );
}

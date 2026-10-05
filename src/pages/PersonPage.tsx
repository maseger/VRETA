import { CalendarClock, Lock, Mic, MicOff, Phone, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { ACQ_STATUS_LABEL, ACQUISITION_LABEL, CHANNEL_INTERACTION_LABEL, EVENT_LABEL, PERSON_ROLES } from "../domain/labels";
import type { Consent, InteractionChannel } from "../domain/types";
import { EmptyState, MediaImage, Section, StatusStamp, formatDate } from "../ui/bits";
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
    const [acqs, objects, events, orgs] = await Promise.all([r.allAcquisitions(), r.objects(), r.eventsFor("person", id!), r.organizations()]);
    const deals = acqs.filter((a) => a.person_id === id).map((a) => ({ a, o: objects.find((o) => o.id === a.object_id) })).filter((x) => x.o);
    const covers = await Promise.all(deals.map((d) => r.mediaFor("object", d.o!.id).then((m) => m[0])));
    const interactions = person.notes !== undefined ? await r.interactions(id!) : [];
    return { person, deals: deals.map((d, i) => ({ ...d, cover: covers[i] })), events, interactions, org: orgs.find((o) => o.id === person.organization_id) };
  }, [id]);

  const [channel, setChannel] = useState<InteractionChannel>("samtal");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [editPrivate, setEditPrivate] = useState(false);
  const [editRoles, setEditRoles] = useState(false);
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const append = useCallback((t: string) => setSummary((s) => (s ? `${s} ${t}` : t)), []);
  const dictation = useDictation(append);

  if (data === null) return <EmptyState title="Personen finns inte" />;
  if (!data) return null;
  const { person, deals, events, interactions, org } = data;
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
    ...events.map((e) => ({ at: e.occurred_at, title: EVENT_LABEL[e.event_type] ?? e.event_type, text: e.summary, kind: "event" as const })),
    ...interactions.map((i) => ({ at: i.occurred_at, title: CHANNEL_INTERACTION_LABEL[i.channel], text: i.summary, kind: "interaction" as const, follow: i.follow_up })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/samla?vy=manniskor" className="text-sm font-semibold text-falu">← Människor</Link>
      <header className="mb-6 mt-2 flex items-start gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-linolja-pale font-serif text-3xl font-semibold text-linolja">{person.name.charAt(0)}</span>
        <div className="min-w-0 flex-1">
          <h1>{person.name}</h1>
          <p className="text-sot-3">{[person.locality, org?.name].filter(Boolean).join(" · ")}</p>
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
        </div>
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
      </Section>

      <Section title="Relationen">
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

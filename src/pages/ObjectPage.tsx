import { ArrowRight, Camera, MapPin, Megaphone, Sparkles, Star, Truck } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { ACQ_STATUS_LABEL, ACQUISITION_LABEL, EVENT_LABEL, PICKUP_STATUS_LABEL, PIPELINE, STATUS_LABEL, VISIBILITY_LABEL, humanizeSummary } from "../domain/labels";
import { OBJECT_TRANSITIONS, nextAcquisitionStep, nextStep } from "../domain/stateMachine";
import type { Acquisition, ObjectStatus, Person, Pickup, Visibility } from "../domain/types";
import { prepareImage } from "../services/images";
import { EmptyState, MediaImage, StatusStamp, VisibilityIcon, formatDate } from "../ui/bits";
import { LocationSelect, locationPath } from "../ui/location";

type Tab = "resa" | "fakta" | "manniskor" | "ekonomi";

export function ObjectPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { repo, profile, refresh, toast } = useApp();
  const [tab, setTab] = useState<Tab>("resa");
  const [pending, setPending] = useState<ObjectStatus | null>(null);
  const [place, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data } = useData(async (r) => {
    const object = await r.object(id!);
    if (!object) return null;
    const [media, events, notes, acquisitions, people, content, zones, structures, locations, pickups] = await Promise.all([
      r.mediaFor("object", id!), r.eventsFor("object", id!), r.storyNotesFor("object", id!), r.acquisitionsFor(id!),
      r.persons(), r.contentFor("object", id!), r.zones(), r.structures(), r.storageLocations(), r.pickups(),
    ]);
    const linked = acquisitions.map((a) => ({ a, person: people.find((p) => p.id === a.person_id) ?? null }));
    const mine: Pickup[] = [];
    for (const p of pickups) if ((await r.pickupItems(p.id)).some((i) => i.object_id === id)) mine.push(p);
    return { object, media, events, notes, linked, content, zones, structures, locations, pickups: mine };
  }, [id]);

  if (data === null) return <EmptyState title="Objektet finns inte">Det kan vara arkiverat eller privat.</EmptyState>;
  if (!data) return null;
  const { object, media, events, notes, linked, content, zones, structures, locations, pickups } = data;
  const where = locationPath(locations, object.storage_location_id);
  const canWrite = profile?.role !== "viewer";
  const step = nextStep(object.status);
  const others = OBJECT_TRANSITIONS[object.status].filter((s) => s !== step?.to && s !== object.status);
  const placeName = zones.find((z) => z.id === object.zone_id)?.name ?? structures.find((s) => s.id === object.structure_id)?.name;
  const shared = content.filter((c) => c.status === "shared").length;

  async function go(to: ObjectStatus) {
    setError(null);
    if (to === "stored" && !place) {
      setPending("stored");
      return;
    }
    if (to === "stored") {
      try {
        await repo.storeObject(object.id, place);
        setPending(null);
        setPlace("");
        await refresh();
        toast(`Lagt i ${locationPath(locations, place)}`);
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    if (to === "in_use" && !place && !object.zone_id && !object.structure_id) {
      setPending(to);
      return;
    }
    try {
      const [kind, pid] = place.split(":");
      await repo.changeStatus(object.id, to, place ? (kind === "z" ? { zone_id: pid } : { structure_id: pid }) : undefined);
      setPending(null);
      setPlace("");
      await refresh();
      toast(`Status: ${STATUS_LABEL[to]}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <article className="mx-auto max-w-3xl">
      {params.get("ny") === "1" && <AfterApprove objectId={object.id} onDone={() => setParams({}, { replace: true })} />}

      <div className="card mb-5 overflow-hidden">
        {media.length ? (
          <div className="scroll-snap-x flex overflow-x-auto">
            {media.map((m) => (
              <figure key={m.id} className="relative min-w-full">
                <MediaImage media={m} alt={object.title} className="aspect-[4/3] w-full sm:aspect-[16/9]" />
                {m.role !== "general" && <figcaption className="stamp absolute left-3 top-3 border-kalk bg-sot/60 text-kalk">{m.role === "before" ? "Före" : m.role === "after" ? "Efter" : "Under"}</figcaption>}
              </figure>
            ))}
          </div>
        ) : (
          <div className="flex aspect-[16/9] items-center justify-center bg-kalk-2 text-sot-3">Inga bilder ännu</div>
        )}
      </div>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusStamp status={object.status} />
            <VisibilityIcon visibility={object.visibility} withLabel />
            {shared > 0 && <span className="text-[12px] text-sot-3">Berättat {shared} gång{shared > 1 ? "er" : ""}</span>}
          </div>
          <h1>{object.title}</h1>
          <p className="mt-1 text-sot-3">
            {object.quantity} {object.unit} · {object.category}
            {placeName ? ` · ${placeName}` : ""}
          </p>
          {where && object.status === "stored" && (
            <Link to={`/lager/${object.storage_location_id}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-linolja hover:underline">
              <MapPin size={15} aria-hidden="true" /> {where}
            </Link>
          )}
        </div>
        <Link to={`/objekt/${object.id}/beratta`} className="btn-secondary">
          <Megaphone size={18} aria-hidden="true" /> Berätta
        </Link>
      </header>

      {linked.length > 0 && <Inflow object={object} acquisition={linked[0].a} pickups={pickups} canWrite={canWrite} />}

      {canWrite && (step || others.length > 0) && (
        <div className="mb-8 space-y-3">
          {pending === "stored" ? (
            <div className="card space-y-3 p-4">
              <label className="field-label" htmlFor="loc">Var lägger du det?</label>
              <LocationSelect id="loc" locations={locations} value={place} onChange={setPlace} />
              {!locations.length && <p className="text-sm text-sot-3">Inga lagerplatser ännu – <Link to="/lager" className="font-semibold text-falu">skapa en</Link>.</p>}
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => { setPending(null); setPlace(""); }}>Avbryt</button>
                <button className="btn-primary flex-1" disabled={!place} onClick={() => go("stored")}>Lägg i lager</button>
              </div>
            </div>
          ) : pending === "in_use" ? (
            <div className="card space-y-3 p-4">
              <label className="field-label" htmlFor="place">Var får det nytt liv?</label>
              <select id="place" className="input" value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="">Välj zon eller byggnad</option>
                <optgroup label="Zoner">{zones.map((z) => <option key={z.id} value={`z:${z.id}`}>{z.name}</option>)}</optgroup>
                <optgroup label="Byggnader">{structures.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup>
              </select>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setPending(null)}>Avbryt</button>
                <button className="btn-moss flex-1" disabled={!place} onClick={() => go("in_use")}>Bekräfta nytt liv</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {step && (
                <button className={step.to === "in_use" ? "btn-moss flex-1 sm:flex-none" : "btn-primary flex-1 sm:flex-none"} onClick={() => go(step.to)}>
                  {step.label} <ArrowRight size={18} aria-hidden="true" />
                </button>
              )}
              {others.length > 0 && (
                <select className="input w-auto min-w-[160px] flex-none" value="" onChange={(e) => e.target.value && go(e.target.value as ObjectStatus)} aria-label="Annan status">
                  <option value="">Annan status …</option>
                  {others.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              )}
            </div>
          )}
          {error && <p className="text-sm text-falu">{error}</p>}
        </div>
      )}

      <div role="tablist" className="mb-5 flex gap-1 border-b border-lera-light">
        {([["resa", "Resa"], ["fakta", "Fakta"], ["manniskor", "Människor"], ["ekonomi", "Ekonomi"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2.5 text-[15px] font-semibold ${tab === k ? "border-falu text-sot" : "border-transparent text-sot-3"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "resa" && (
        <ol className="relative ml-2 space-y-5 border-l-2 border-dashed border-lera pl-6">
          {[
            ...events.map((e) => ({ at: e.occurred_at, title: EVENT_LABEL[e.event_type] ?? e.event_type, text: humanizeSummary(e.summary).replace(`${object.title}: `, ""), star: e.story_worthy })),
            ...notes.filter((n) => n.kind !== "moment").map((n) => ({ at: n.created_at, title: n.kind === "why" ? "Varför det är intressant" : "Citat", text: n.text, star: false })),
          ]
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((item, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[33px] top-1 h-4 w-4 rounded-full border-2 border-kalk ${item.star ? "bg-ockra" : "bg-falu"}`} aria-hidden="true" />
                <p className="kicker">{formatDate(item.at)}</p>
                <p className="flex items-center gap-1.5 font-serif text-[17px] font-semibold">
                  {item.title} {item.star && <Star size={14} className="fill-ockra text-ockra" aria-label="Bra att berätta" />}
                </p>
                <p className="text-sot-2">{item.text}</p>
              </li>
            ))}
        </ol>
      )}

      {tab === "fakta" && (
        <dl className="card grid grid-cols-1 gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
          {([["Kategori", object.category], ["Antal", `${object.quantity} ${object.unit}`], ["Material", object.material], ["Mått", object.dimensions], ["Ålder/period", object.era], ["Skick", object.condition ? `${object.condition} av 5` : ""], ["Beskrivning", object.description], ["Synlighet", VISIBILITY_LABEL[object.visibility]]] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <dt className="kicker">{k}</dt>
              <dd className="mt-0.5">{v || <span className="text-sot-3">–</span>}</dd>
            </div>
          ))}
          {canWrite && (
            <div className="sm:col-span-2">
              <label className="kicker" htmlFor="vis">Ändra synlighet</label>
              <select id="vis" className="input mt-1" value={object.visibility} onChange={async (e) => { await repo.updateObject(object.id, { visibility: e.target.value as Visibility }); await refresh(); }}>
                {(["private", "internal", "shareable", "public"] as Visibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
              </select>
            </div>
          )}
          {Object.values(object.field_meta).some((m) => !m.verified) && (
            <p className="flex items-center gap-1.5 text-sm text-[#8a6118] sm:col-span-2"><Sparkles size={14} /> Vissa fält är AI-förslag som inte har bekräftats.</p>
          )}
        </dl>
      )}

      {tab === "manniskor" && (
        linked.some((l) => l.person) ? (
          <ul className="space-y-3">
            {linked.filter((l) => l.person).map(({ a, person }) => <PersonCard key={a.id} person={person!} relation={ACQUISITION_LABEL[a.type]} />)}
          </ul>
        ) : (
          <EmptyState title="Ingen person kopplad">Personer kopplas när du godkänner ett förslag med säljare eller givare.</EmptyState>
        )
      )}

      {tab === "ekonomi" && (
        <div className="card divide-y divide-dashed divide-lera-light">
          {linked.length ? linked.map(({ a }) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-3">
              <span>{ACQUISITION_LABEL[a.type]}{a.deadline ? ` · hämtas senast ${formatDate(a.deadline)}` : ""}</span>
              <span className="font-semibold">{a.price === undefined ? <span className="text-sm font-normal text-sot-3">Privat</span> : a.price == null ? "–" : `${a.price.toLocaleString("sv-SE")} kr`}</span>
            </div>
          )) : <p className="px-4 py-3 text-sot-3">Ingen anskaffning registrerad.</p>}
          <p className="px-4 py-3 text-[12px] text-sot-3">Priser är privata och används aldrig i berättelser eller annonser.</p>
        </div>
      )}
    </article>
  );
}

function PersonCard({ person, relation }: { person: Person; relation: string }) {
  const { repo, profile, refresh } = useApp();
  const isOwner = profile?.role === "owner";
  const consent = (k: "consent_name" | "consent_image" | "consent_contribution", label: string) => (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <select className="input w-auto py-1.5 text-sm" disabled={!isOwner} value={person[k]} onChange={async (e) => { await repo.updateConsent(person.id, { [k]: e.target.value }); await refresh(); }}>
        <option value="yes">Ja</option>
        <option value="no">Nej</option>
        <option value="ask">Fråga varje gång</option>
      </select>
    </label>
  );
  return (
    <li className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <Link to={`/person/${person.id}`} className="font-serif text-lg font-semibold hover:underline">{person.name}</Link>
          <p className="text-sm text-sot-3">{relation}{person.locality ? ` · ${person.locality}` : ""}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">{person.roles.map((r) => <span key={r} className="stamp border-linolja text-linolja">{r}</span>)}</div>
      </div>
      <div className="space-y-2 rounded-md bg-kalk-2/70 p-3">
        <p className="kicker">Samtycke för berättelser</p>
        {consent("consent_name", "Namn får nämnas")}
        {consent("consent_image", "Bild får visas")}
        {consent("consent_contribution", "Bidrag får beskrivas")}
        {!isOwner && <p className="text-[12px] text-sot-3">Bara ägaren kan ändra samtycke.</p>}
      </div>
      {person.notes !== undefined && (
        <p className="mt-3 text-sm text-sot-3">Kontakt och anteckningar är privata{person.contact ? `: ${person.contact}` : "."}</p>
      )}
    </li>
  );
}

/** Berättarfångst direkt efter godkännande (specifikationen 4.1 steg 7). */
function AfterApprove({ objectId, onDone }: { objectId: string; onDone: () => void }) {
  const { repo, refresh, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [moment, setMoment] = useState("");

  async function addBefore(files: FileList | null) {
    if (!files?.[0]) return;
    const p = await prepareImage(files[0]);
    await repo.saveMedia({ id: crypto.randomUUID(), original: p.original, clean: p.clean, mime: p.original.type || "image/jpeg", width: p.width, height: p.height, entity_type: "object", entity_id: objectId, role: "before" });
    await refresh();
    toast("Före-bild sparad");
  }

  return (
    <div className="card mb-6 border-linolja/40 bg-linolja-pale/40 p-4">
      <p className="kicker mb-1 text-linolja">Sparat</p>
      <p className="mb-3 font-serif text-lg font-semibold">Vill du fånga något till berättelsen?</p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addBefore(e.target.files)} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary bg-kalk" onClick={() => fileRef.current?.click()}>
          <Camera size={18} aria-hidden="true" /> Ta en före-bild
        </button>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await repo.markMoment(objectId, moment.trim());
          setMoment("");
          await refresh();
          toast("Markerat som bra ögonblick");
        }}
      >
        <input className="input" placeholder="Något som hände? (valfritt)" value={moment} onChange={(e) => setMoment(e.target.value)} />
        <button className="btn-secondary shrink-0 bg-kalk">
          <Star size={18} aria-hidden="true" /> Ögonblick
        </button>
      </form>
      <button className="btn-ghost mt-2 -ml-3 text-sm" onClick={onDone}>Klar</button>
    </div>
  );
}

/** Inflödet för objektet: anskaffningens steg och hämtningar (specifikationen 4.2–4.3). */
function Inflow({ object, acquisition, pickups, canWrite }: { object: { id: string; status: ObjectStatus }; acquisition: Acquisition; pickups: Pickup[]; canWrite: boolean }) {
  const { repo, refresh, toast } = useApp();
  const step = nextAcquisitionStep(acquisition.status);
  const idx = PIPELINE.indexOf(acquisition.status);
  const ended = acquisition.status === "declined" || acquisition.status === "lost";
  const openPickup = pickups.find((p) => p.status !== "completed" && p.status !== "cancelled");
  const needsPickup = !openPickup && ["discovered", "contacted", "reserved"].includes(object.status) && !ended;

  async function advance() {
    if (!step) return;
    await repo.setAcquisitionStatus(acquisition.id, step.to);
    if (step.to === "agreed" && (object.status === "discovered" || object.status === "contacted")) await repo.changeStatus(object.id, "reserved");
    if (step.to === "contacted" && object.status === "discovered") await repo.changeStatus(object.id, "contacted");
    await refresh();
    toast(`Anskaffning: ${ACQ_STATUS_LABEL[step.to]}`);
  }

  if (acquisition.status === "settled" && !openPickup) return null;
  return (
    <section className="card mb-6 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="kicker">{ACQUISITION_LABEL[acquisition.type]}</p>
        {ended && <span className="stamp border-jarn text-sot-3">{ACQ_STATUS_LABEL[acquisition.status]}</span>}
      </div>
      {!ended && (
        <ol className="mb-4 flex items-center gap-1" aria-label="Anskaffningens steg">
          {PIPELINE.map((s, i) => (
            <li key={s} className="flex flex-1 flex-col items-center gap-1" aria-current={i === idx ? "step" : undefined}>
              <span className={`h-1.5 w-full rounded-full ${i <= idx ? "bg-falu" : "bg-kalk-3"}`} />
              <span className={`text-[10.5px] font-semibold ${i === idx ? "text-sot" : "text-sot-3"} ${i === idx ? "" : "hidden sm:block"}`}>{ACQ_STATUS_LABEL[s]}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        {canWrite && step && <button className="btn-secondary" onClick={advance}>{step.label}</button>}
        {canWrite && needsPickup && <Link className="btn-primary" to={`/hamtning/ny?objekt=${object.id}`}><Truck size={18} aria-hidden="true" /> Planera hämtning</Link>}
        {openPickup && (
          <Link className="btn-moss" to={`/hamtning/${openPickup.id}`}>
            <Truck size={18} aria-hidden="true" /> Hämtning {openPickup.scheduled_date ? formatDate(openPickup.scheduled_date) : ""} · {PICKUP_STATUS_LABEL[openPickup.status]}
          </Link>
        )}
      </div>
    </section>
  );
}

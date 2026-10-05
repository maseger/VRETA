import { AlarmClock, ArrowRight, Archive, CalendarClock, Heart, Inbox, Megaphone, MessageSquare, Tag, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { repoStore } from "../services/askVreta";
import { longestInStock } from "../../supabase/functions/_shared/knowledge";
import { EmptyState, MediaImage, Section, StatusStamp, formatDate } from "../ui/bits";

function greeting() {
  const h = new Date().getHours();
  return h < 10 ? "God morgon" : h < 17 ? "God dag" : "God kväll";
}

export function TodayPage() {
  const { profile, site } = useApp();
  const role = profile?.role ?? "viewer";
  const { data } = useData(async (repo) => {
    const [proposals, offline, tasks, objects, pickups, followUps, people, leads, listings, contributions] = await Promise.all([
      repo.proposals(), repo.capturesWithoutProposal(), repo.tasks(), repo.objects(), repo.pickups(), repo.followUps(), repo.persons(),
      repo.leads(), repo.listings(), repo.contributions(),
    ]);
    // Intressenter som väntar på svar (FR-045) och människor som inte tackats (4.8)
    const waiting = leads.filter((l) => l.status === "new").map((l) => ({ lead: l, listing: listings.find((x) => x.id === l.listing_id), person: people.find((p) => p.id === l.person_id) })).filter((x) => x.listing);
    const thankIds = [...new Set(contributions.filter((c) => !c.thanked_at).map((c) => c.person_id))];
    const toThank = thankIds.map((pid) => ({ person: people.find((p) => p.id === pid), count: contributions.filter((c) => c.person_id === pid && !c.thanked_at).length })).filter((x) => x.person);
    const storyCandidates = [];
    for (const o of objects.slice(0, 12)) {
      const [content, notes, media] = await Promise.all([repo.contentFor("object", o.id), repo.storyNotesFor("object", o.id), repo.mediaFor("object", o.id)]);
      if (!content.some((c) => c.status === "shared") && (notes.length || o.status === "in_use")) storyCandidates.push({ object: o, cover: media[0], why: notes.find((n) => n.kind === "why")?.text });
    }
    const covers = await Promise.all(objects.slice(0, 6).map((o) => repo.mediaFor("object", o.id).then((m) => m[0])));
    const upcoming = pickups.filter((p) => p.status !== "completed" && p.status !== "cancelled").slice(0, 4);
    const today = new Date().toISOString().slice(0, 10);
    const due = followUps.filter((f) => f.follow_up! <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).map((f) => ({ f, person: people.find((p) => p.id === f.person_id) }));
    // Legat i lager över ett år (S1): samma verktyg som chatboten använder
    const old = ((await longestInStock(repoStore(repo, role, today), 20)).facts as { title: string; since: string; months: number }[])
      .filter((x) => x.months >= 12).map((x) => ({ ...x, object: objects.find((o) => o.title === x.title) })).filter((x) => x.object).slice(0, 5);
    const overdue = tasks.filter((t) => t.due && t.due < today);
    const later = tasks.filter((t) => !t.due || t.due >= today);
    return { today, upcoming, due, waiting, toThank, old, overdue, later, proposals, offline, tasks, recent: objects.slice(0, 6).map((o, i) => ({ object: o, cover: covers[i] })), stories: storyCandidates.slice(0, 3) };
  }, [role]);

  const today = new Date().toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });
  const toReview = (data?.proposals.length ?? 0) + (data?.offline.length ?? 0);

  return (
    <div>
      <header className="mb-8">
        <p className="kicker mb-1">{today}</p>
        <h1>
          {greeting()}, {profile?.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sot-3">Det här händer på {site?.name} just nu.</p>
      </header>

      {toReview > 0 && (
        <Link to="/granska" className="card mb-8 flex items-center gap-4 border-ockra/60 bg-ockra-light/20 p-4 hover:bg-ockra-light/30">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ockra text-kalk">
            <Inbox size={22} aria-hidden="true" />
          </span>
          <span className="flex-1">
            <span className="block font-serif text-lg font-semibold">Att granska: {toReview}</span>
            <span className="text-sm text-sot-3">
              {data?.offline.length ? `${data.offline.length} väntar på nät för att tolkas. ` : ""}Förslag från dina senaste fångster.
            </span>
          </span>
          <ArrowRight size={20} className="text-sot-3" aria-hidden="true" />
        </Link>
      )}

      {!!data?.upcoming.length && (
        <Section title="Hämtningar" action={<Link to="/samla?vy=hamtningar" className="text-sm font-semibold text-falu">Alla</Link>}>
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.upcoming.map((p) => (
              <li key={p.id}>
                <Link to={`/hamtning/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <Truck size={18} className="text-falu" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.title}</span>
                    {p.address && <span className="block truncate text-sm text-sot-3">{p.address}</span>}
                  </span>
                  <span className={`text-sm ${p.scheduled_date === data.today ? "font-semibold text-falu" : "text-sot-3"}`}>
                    {p.scheduled_date === data.today ? "Idag" : p.scheduled_date ? formatDate(p.scheduled_date) : ""}
                    {p.window_from ? ` ${p.window_from.slice(0, 5)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!data?.overdue.length && (
        <Section title="Försenat">
          <ul className="card divide-y divide-dashed divide-lera-light border-falu/40">
            {data.overdue.map((t) => (
              <li key={t.id}>
                <Link to={t.entity_type === "listing" ? `/annons/${t.entity_id}` : t.entity_id ? `/objekt/${t.entity_id}` : "#"} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <AlarmClock size={18} className="text-falu" aria-hidden="true" />
                  <span className="flex-1 font-medium">{t.title}</span>
                  <span className="text-sm font-semibold text-falu">sedan {formatDate(t.due)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!data?.waiting.length && (
        <Section title="Väntar på svar" action={<Link to="/samla?vy=annonser" className="text-sm font-semibold text-falu">Annonser</Link>}>
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.waiting.map(({ lead, listing, person }) => (
              <li key={lead.id}>
                <Link to={`/annons/${listing!.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <Tag size={18} className="text-falu" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{person?.name ?? "Intressent"} · {listing!.title}</span>
                    {lead.message && <span className="block truncate text-sm text-sot-3">”{lead.message}”</span>}
                  </span>
                  <span className="text-sm text-sot-3">nr {lead.queue_position}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!data?.due.length && (
        <Section title="Följ upp">
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.due.map(({ f, person }) => (
              <li key={f.id}>
                <Link to={`/person/${f.person_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <MessageSquare size={18} className="text-linolja" aria-hidden="true" />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{person?.name}</span><span className="block truncate text-sm text-sot-3">{f.summary}</span></span>
                  <span className="text-sm text-sot-3">{formatDate(f.follow_up)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Att göra">
        {data?.later.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.later.map((t) => (
              <li key={t.id}>
                <Link to={t.entity_type === "listing" ? `/annons/${t.entity_id}` : t.entity_id ? `/objekt/${t.entity_id}` : "#"} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <CalendarClock size={18} className="text-falu" aria-hidden="true" />
                  <span className="flex-1 font-medium">{t.title}</span>
                  {t.due && <span className="text-sm text-sot-3">senast {formatDate(t.due)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        ) : data?.overdue.length ? (
          <p className="text-sot-3">Inget mer planerat.</p>
        ) : (
          <EmptyState title="Inget som brådskar">Uppgifter skapas när du fångar fynd med en tidsgräns, eller när du ber Fråga Vreta om det.</EmptyState>
        )}
      </Section>

      {!!data?.toThank.length && (
        <Section title="Att tacka">
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.toThank.map(({ person, count }) => (
              <li key={person!.id}>
                <Link to={`/person/${person!.id}/tacka`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <Heart size={18} className="text-falu" aria-hidden="true" />
                  <span className="flex-1 font-medium">{person!.name}</span>
                  <span className="text-sm text-sot-3">{count} {count === 1 ? "bidrag" : "bidrag"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!data?.old.length && (
        <Section title="Legat i lager över ett år">
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.old.map((x) => (
              <li key={x.object!.id}>
                <Link to={`/objekt/${x.object!.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
                  <Archive size={18} className="text-sot-3" aria-hidden="true" />
                  <span className="flex-1 font-medium">{x.title}</span>
                  <span className="text-sm text-sot-3">sedan {formatDate(x.since)} – använda, lägga ut eller skänka?</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!data?.stories.length && (
        <Section title="Att berätta">
          <div className="scroll-snap-x -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0">
            {data.stories.map(({ object, cover, why }) => (
              <Link key={object.id} to={`/objekt/${object.id}/beratta`} className="card group w-64 shrink-0 overflow-hidden sm:w-auto">
                <MediaImage media={cover} className="aspect-[4/3] w-full" />
                <div className="p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-falu">
                    <Megaphone size={14} aria-hidden="true" /> Berätta
                  </p>
                  <p className="font-serif text-[17px] font-semibold">{object.title}</p>
                  {why && <p className="mt-1 line-clamp-2 text-sm text-sot-3">{why}</p>}
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Senaste fynden" action={<Link to="/samla" className="text-sm font-semibold text-falu">Visa alla</Link>}>
        {data?.recent.length ? (
          <ul className="card divide-y divide-dashed divide-lera-light">
            {data.recent.map(({ object, cover }) => (
              <li key={object.id}>
                <Link to={`/objekt/${object.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-kalk-2/60">
                  <MediaImage media={cover} className="h-12 w-12 shrink-0 rounded-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{object.title}</span>
                    <span className="text-sm text-sot-3">
                      {object.quantity} {object.unit} · {object.category}
                    </span>
                  </span>
                  <StatusStamp status={object.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Inga fynd ännu">Tryck på + för att fånga ditt första fynd med kamera och röst.</EmptyState>
        )}
      </Section>
    </div>
  );
}

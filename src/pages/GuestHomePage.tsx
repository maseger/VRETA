import { ChevronRight, Hammer, Leaf, MapPinned } from "lucide-react";
import { Link } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { PROJECT_STATUS_LABEL } from "../domain/labels";
import { needProgress, sortProjects, summarizeProjects } from "../domain/places";
import { MediaImage, PageHeader, Section, StatusStamp, formatDate } from "../ui/bits";

/** Startsidan för gäster: vad som växer fram på Vreta – projekt, nytt liv och de senaste fynden. */
export function GuestHomePage() {
  const { site, profile } = useApp();
  const { data } = useData(async (r) => {
    const [projects, usage, contributions, needs, objects, zones] = await Promise.all([r.projects(), r.allUsageEvents(), r.contributions(), r.needs(), r.objects(), r.zones()]);
    const fulfillments = await r.needFulfillments(needs.map((n) => n.id));
    const live = sortProjects(summarizeProjects(projects, usage, contributions)).filter((p) => p.project.status !== "done").slice(0, 4)
      .map((p) => ({ ...p, needs: needs.filter((n) => n.project_id === p.project.id && n.status === "open").map((n) => ({ n, ...needProgress(n, fulfillments) })) }));
    const newLife = usage.filter((u) => u.type !== "removed").slice(0, 6).map((u) => ({ u, o: objects.find((o) => o.id === u.object_id), where: zones.find((z) => z.id === u.zone_id)?.name })).filter((x) => x.o);
    const recent = objects.slice(0, 6);
    const covers = await Promise.all([...newLife.map((x) => x.o!), ...recent].map((o) => r.mediaFor("object", o.id).then((m) => m.find((x) => x.role === "after") ?? m[0])));
    return { live, newLife: newLife.map((x, i) => ({ ...x, cover: covers[i] })), recent: recent.map((o, i) => ({ o, cover: covers[newLife.length + i] })) };
  });
  const name = site?.name ?? "Vreta";

  return (
    <div>
      <PageHeader kicker={`Hej ${profile?.name ?? ""}`.trim()} title={`Det här växer fram på ${name}`} />
      <p className="-mt-3 mb-8 max-w-xl text-sot-3">Gamla saker får nytt liv, och platsen byggs upp med skogsträdgård, odling och återbruk. Titta runt – kartan, projekten och sakerna finns i menyn.</p>

      {!!data?.live.length && (
        <Section title="Projekt som pågår" action={<Link to="/platser/projekt" className="text-sm font-semibold text-falu">Alla</Link>}>
          <ul className="space-y-3">
            {data.live.map(({ project: p, needs, object_ids }) => (
              <li key={p.id}>
                <Link to={`/projekt/${p.id}`} className="card block p-4 hover:bg-kalk-2/60">
                  <div className="flex items-center gap-3">
                    <Hammer size={20} strokeWidth={1.5} className="shrink-0 text-falu" aria-hidden="true" />
                    <span className="flex-1 font-serif text-lg font-semibold">{p.name}</span>
                    <span className="stamp border-linolja text-linolja">{PROJECT_STATUS_LABEL[p.status]}</span>
                  </div>
                  {p.description && <p className="mt-2 line-clamp-2 text-sm text-sot-2">{p.description}</p>}
                  {needs.slice(0, 2).map(({ n, share, label }) => (
                    <div key={n.id} className="mt-3">
                      <p className="mb-1 flex justify-between text-[13px]"><span>{n.title}</span><span className="text-sot-3">{label}</span></p>
                      <div className="h-1.5 overflow-hidden rounded-full bg-kalk-3"><span className="block h-full bg-ockra" style={{ width: `${share * 100}%` }} /></div>
                    </div>
                  ))}
                  {object_ids.length > 0 && <p className="mt-2 text-[13px] text-sot-3">{object_ids.length === 1 ? "1 återbrukad sak" : `${object_ids.length} återbrukade saker`}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!data?.newLife.length && (
        <Section title="Har fått nytt liv">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.newLife.map(({ u, o, where, cover }) => (
              <li key={u.id}>
                <Link to={`/objekt/${o!.id}`} className="card block overflow-hidden">
                  <MediaImage media={cover} className="aspect-square w-full" alt={o!.title} />
                  <div className="space-y-1 p-3">
                    <p className="truncate font-medium">{o!.title}</p>
                    <p className="flex items-center gap-1 truncate text-[12px] text-sot-3"><Leaf size={12} aria-hidden="true" />{[where, formatDate(u.occurred_at)].filter(Boolean).join(" · ")}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!data?.recent.length && (
        <Section title="Senaste fynden" action={<Link to="/saker" className="text-sm font-semibold text-falu">Alla saker</Link>}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.recent.map(({ o, cover }) => (
              <li key={o.id}>
                <Link to={`/objekt/${o.id}`} className="card block overflow-hidden">
                  <MediaImage media={cover} className="aspect-square w-full" alt={o.title} />
                  <div className="space-y-1.5 p-3"><p className="truncate font-medium">{o.title}</p><StatusStamp status={o.status} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Link to="/platser" className="card mb-8 flex items-center gap-4 p-5 hover:bg-kalk-2/60">
        <MapPinned size={28} strokeWidth={1.5} className="shrink-0 text-falu" aria-hidden="true" />
        <span className="flex-1"><span className="block font-serif text-lg font-semibold">Vretakartan</span><span className="text-sm text-sot-3">Områden, byggnader och var allt har hamnat</span></span>
        <ChevronRight size={18} className="text-sot-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

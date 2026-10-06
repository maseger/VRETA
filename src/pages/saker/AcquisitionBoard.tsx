import { Link } from "react-router-dom";
import { useData } from "../../app/AppContext";
import { ACQ_STATUS_LABEL, ACQUISITION_LABEL, PIPELINE } from "../../domain/labels";
import { EmptyState } from "../../ui/bits";

/** Pipeline för inflödet (specifikationen 10.2): kanban på datorn, rader på mobilen. */
export function AcquisitionBoard() {
  const { data } = useData(async (repo) => {
    const [acqs, objects, people] = await Promise.all([repo.allAcquisitions(), repo.objects(), repo.persons()]);
    return acqs.map((a) => ({ a, o: objects.find((o) => o.id === a.object_id), p: people.find((p) => p.id === a.person_id) })).filter((x) => x.o);
  });
  if (data && !data.length) return <EmptyState title="Inga inköp eller gåvor ännu">De skapas när du godkänner ett fynd med säljare eller givare.</EmptyState>;
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
      {PIPELINE.map((status) => {
        const col = (data ?? []).filter((x) => x.a.status === status);
        return (
          <section key={status} className="w-56 shrink-0 snap-start">
            <h3 className="mb-2 flex items-baseline justify-between px-1 text-[15px]">
              {ACQ_STATUS_LABEL[status]} <span className="font-sans text-sm font-normal text-sot-3">{col.length}</span>
            </h3>
            <ul className="space-y-2 rounded-md bg-kalk-2/60 p-2" style={{ minHeight: 80 }}>
              {col.map(({ a, o, p }) => (
                <li key={a.id}>
                  <Link to={`/objekt/${o!.id}`} className="card block p-3 hover:shadow-md">
                    <p className="font-medium">{o!.title}</p>
                    <p className="text-[13px] text-sot-3">{[ACQUISITION_LABEL[a.type], p?.name, a.price != null ? `${a.price.toLocaleString("sv-SE")} kr` : ""].filter(Boolean).join(" · ")}</p>
                    {a.deadline && <p className="mt-1 text-[12px] text-falu">Senast {new Date(a.deadline).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

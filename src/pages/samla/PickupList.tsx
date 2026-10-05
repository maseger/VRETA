import { Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../../app/AppContext";
import { PICKUP_STATUS_LABEL } from "../../domain/labels";
import { EmptyState, formatDate } from "../../ui/bits";

export function PickupList() {
  const { data } = useData((repo) => repo.pickups());
  if (data && !data.length) return <EmptyState title="Inga hämtningar ännu">Planera en hämtning från ett objekt när ni är överens.</EmptyState>;
  const open = (data ?? []).filter((p) => p.status !== "completed" && p.status !== "cancelled");
  const done = (data ?? []).filter((p) => p.status === "completed" || p.status === "cancelled");
  const row = (p: NonNullable<typeof data>[number]) => (
    <li key={p.id}>
      <Link to={`/hamtning/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
        <Truck size={20} className={p.status === "completed" ? "text-linolja" : "text-falu"} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{p.title}</span>
          <span className="text-sm text-sot-3">{[p.scheduled_date ? formatDate(p.scheduled_date) : "Inget datum", p.window_from ? `${p.window_from.slice(0, 5)}–${p.window_to?.slice(0, 5) ?? ""}` : ""].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="stamp border-sot-2 text-sot-2">{PICKUP_STATUS_LABEL[p.status]}</span>
      </Link>
    </li>
  );
  return (
    <>
      {open.length > 0 && <ul className="card mb-6 divide-y divide-dashed divide-lera-light">{open.map(row)}</ul>}
      {done.length > 0 && (<><p className="kicker mb-2">Avslutade</p><ul className="card divide-y divide-dashed divide-lera-light opacity-80">{done.map(row)}</ul></>)}
    </>
  );
}

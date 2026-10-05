import { Megaphone } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../../app/AppContext";
import { LISTING_STATUS_LABEL, LISTING_TYPE_LABEL } from "../../domain/labels";
import type { Listing } from "../../domain/types";
import { EmptyState, formatDate } from "../../ui/bits";

const OPEN = ["draft", "ready", "published", "agreed"];

export function ListingsList() {
  const { data } = useData(async (r) => ({ listings: await r.listings(), leads: await r.leads(), posts: await r.channelPosts() }));
  if (data && !data.listings.length) {
    return <EmptyState title="Inga annonser ännu">Öppna ett objekt i lager och tryck <b>Lägg ut</b> för att sälja, skänka eller byta.</EmptyState>;
  }
  const open = (data?.listings ?? []).filter((l) => OPEN.includes(l.status));
  const done = (data?.listings ?? []).filter((l) => !OPEN.includes(l.status));
  const row = (l: Listing) => {
    const waiting = data!.leads.filter((x) => x.listing_id === l.id && x.status === "new").length;
    const out = data!.posts.filter((p) => p.listing_id === l.id && p.status === "posted").length;
    return (
      <li key={l.id}>
        <Link to={`/annons/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-kalk-2/60">
          <Megaphone size={20} className={l.status === "published" || l.status === "agreed" ? "text-falu" : "text-sot-3"} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{l.title}</span>
            <span className="text-sm text-sot-3">
              {[LISTING_TYPE_LABEL[l.type], l.price != null && l.type === "sell" ? `${l.price.toLocaleString("sv-SE")} kr` : "", out ? `${out} ${out === 1 ? "kanal" : "kanaler"}` : "", formatDate(l.updated_at)].filter(Boolean).join(" · ")}
            </span>
          </span>
          {waiting > 0 && <span className="rounded-full bg-falu px-2 py-0.5 text-[12px] font-bold text-kalk" title="Intressenter som väntar svar">{waiting}</span>}
          <span className="stamp border-sot-2 text-sot-2">{LISTING_STATUS_LABEL[l.status]}</span>
        </Link>
      </li>
    );
  };
  return (
    <>
      {open.length > 0 && <ul className="card mb-6 divide-y divide-dashed divide-lera-light">{open.map(row)}</ul>}
      {done.length > 0 && (<><p className="kicker mb-2">Avslutade</p><ul className="card divide-y divide-dashed divide-lera-light opacity-80">{done.map(row)}</ul></>)}
    </>
  );
}

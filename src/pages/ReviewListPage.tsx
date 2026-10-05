import { CloudOff, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../app/AppContext";
import { EmptyState, MediaImage, PageHeader, formatDate } from "../ui/bits";

export function ReviewListPage() {
  const { data } = useData(async (repo) => {
    const [proposals, offline] = await Promise.all([repo.proposals(), repo.capturesWithoutProposal()]);
    const covers = await Promise.all(proposals.map((p) => repo.mediaFor("capture", p.capture_id).then((m) => m[0])));
    return { proposals: proposals.map((p, i) => ({ p, cover: covers[i] })), offline };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader kicker="Att granska" title="Förslag att godkänna" />
      {!!data?.offline.length && (
        <p className="card mb-4 flex items-center gap-2 px-4 py-3 text-sm text-sot-2">
          <CloudOff size={16} aria-hidden="true" /> {data.offline.length} fångst{data.offline.length > 1 ? "er" : ""} sparade offline tolkas när du har nät.
        </p>
      )}
      {data?.proposals.length ? (
        <ul className="space-y-3">
          {data.proposals.map(({ p, cover }) => (
            <li key={p.id}>
              <Link to={`/granska/${p.id}`} className="card flex items-center gap-4 p-3 hover:bg-kalk-2/60">
                <MediaImage media={cover} className="h-16 w-16 shrink-0 rounded-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-lg font-semibold">{p.content.object?.title.value || "Fångst"}</span>
                  <span className="flex items-center gap-1.5 text-sm text-sot-3">
                    <Sparkles size={14} className="text-ockra" aria-hidden="true" />
                    {p.content.agent === "claude" ? "Tolkat av AI" : "Enkel tolkning"} · {formatDate(p.created_at)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Allt är granskat">Nya fångster hamnar här tills du har godkänt dem.</EmptyState>
      )}
    </div>
  );
}

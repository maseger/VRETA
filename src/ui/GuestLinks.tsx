import { Copy, Link2, Plus, Share2, X } from "lucide-react";
import { useState } from "react";
import { useApp, useData } from "../app/AppContext";
import { Section, formatDate } from "./bits";

export const guestUrl = (token: string) => `${window.location.origin}/gast/${token}`;

/** Ägarens gästlänkar: familj och vänner tittar utan konto och kan inte ändra något (M9). */
export function GuestLinks() {
  const { repo, refresh, toast } = useApp();
  const { data: links } = useData((r) => r.guestLinks().catch(() => []));
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);

  async function share(url: string) {
    const text = "Titta in på Vreta – du behöver inget konto.";
    if (navigator.share) {
      try {
        await navigator.share({ title: "Vreta", text, url });
        return;
      } catch {
        /* avbrutet – kopiera i stället */
      }
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast("Länken är kopierad");
  }

  return (
    <Section title="Gäster">
      <div className="card space-y-4 p-4">
        <p className="text-sm text-sot-2">Skicka en gästlänk till familj och vänner. De kommer in direkt utan konto och kan titta på allt utom priser, kontaktuppgifter, adresser och relationer. Människor syns bara om de sagt ja till att namnges. Gäster kan inte ändra något och inte använda Fråga Vreta.</p>
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const { id, token } = await repo.createGuestLink(label.trim() || "Gäster");
          setFresh({ id, url: guestUrl(token) });
          setLabel("");
          await refresh();
        }}>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vem är länken till? T.ex. Familjen" aria-label="Namn på gästlänken" />
          <button className="btn-primary shrink-0"><Plus size={18} aria-hidden="true" /> Skapa länk</button>
        </form>

        {fresh && (
          <div className="space-y-2 rounded-md border border-ockra bg-kalk-2/70 p-3">
            <p className="text-sm font-semibold">Den nya länken – spara eller skicka den nu, den visas bara den här gången.</p>
            <p className="break-all rounded bg-[#FBF8F1] px-2 py-1.5 font-mono text-[12px]">{fresh.url}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => share(fresh.url)}><Share2 size={18} aria-hidden="true" /> Skicka</button>
              <button type="button" className="btn-secondary" onClick={async () => { await navigator.clipboard?.writeText(fresh.url).catch(() => undefined); toast("Länken är kopierad"); }}><Copy size={18} aria-hidden="true" /> Kopiera</button>
              <button type="button" className="btn-ghost" onClick={() => setFresh(null)}>Klar</button>
            </div>
          </div>
        )}

        {!!links?.length && (
          <ul className="divide-y divide-dashed divide-lera-light">
            {links.map((l) => (
              <li key={l.id} className={`flex items-center gap-3 py-2.5 ${l.revoked_at ? "opacity-50" : ""}`}>
                <Link2 size={18} className="shrink-0 text-sot-3" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{l.label || "Gäster"}</span>
                  <span className="text-[13px] text-sot-3">{[
                    `Skapad ${formatDate(l.created_at)}`,
                    l.uses ? `öppnad ${l.uses} ${l.uses === 1 ? "gång" : "gånger"}, senast ${formatDate(l.last_used_at)}` : "inte öppnad än",
                    l.revoked_at ? `stängd ${formatDate(l.revoked_at)}` : "",
                  ].filter(Boolean).join(" · ")}</span>
                </span>
                {!l.revoked_at && (
                  <button className="btn-ghost min-h-[36px] text-sm text-falu" onClick={async () => {
                    if (!window.confirm(`Stäng länken ”${l.label || "Gäster"}”? De som använt den kommer inte in längre.`)) return;
                    await repo.revokeGuestLink(l.id);
                    if (fresh?.id === l.id) setFresh(null);
                    await refresh();
                    toast("Länken är stängd");
                  }}><X size={16} aria-hidden="true" /> Stäng</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

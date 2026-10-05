import { AlertTriangle, ChevronDown, Loader2, Send, Share2, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { CHANNEL_LABEL, GOAL_LABEL } from "../domain/labels";
import type { Channel, ContentGoal, ContentItem } from "../domain/types";
import { shareStory } from "../services/share";
import { draftForObject, type StoryDraftResult } from "../services/storyAgent";
import { MediaImage, PageHeader } from "../ui/bits";

const CHANNELS: Channel[] = ["facebook", "instagram", "linkedin", "privat"];

export function StoryStudioPage() {
  const { id } = useParams();
  const { repo, profile, refresh, toast } = useApp();
  const isOwner = profile?.role === "owner";
  const { data } = useData(async (r) => {
    const object = await r.object(id!);
    return object ? { object, media: await r.mediaFor("object", id!) } : null;
  }, [id]);

  const [goal, setGoal] = useState<ContentGoal>("fyndet");
  const [channels, setChannels] = useState<Channel[]>(["facebook", "instagram"]);
  const [result, setResult] = useState<StoryDraftResult | null>(null);
  const [texts, setTexts] = useState<Partial<Record<Channel, string>>>({});
  const [active, setActive] = useState<Channel>("facebook");
  const [selected, setSelected] = useState<string[]>([]);
  const [item, setItem] = useState<ContentItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [askUrl, setAskUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);

  if (data === null) return <p>Objektet finns inte.</p>;
  if (!data) return null;
  const { object, media } = data;

  async function draft() {
    setBusy(true);
    try {
      await runDraft();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runDraft() {
    const r = await draftForObject(repo, object.id, goal, channels);
    setResult(r);
    if (r.ok) {
      setTexts(Object.fromEntries(r.variants.map((v) => [v.channel, v.text])));
      setActive(r.variants[0]?.channel ?? "facebook");
      setSelected(r.media_ids.slice(0, 4));
      const saved = await repo.saveContent({
        id: item?.id, goal, source_type: "object", source_id: object.id, status: "draft",
        variants: r.variants.map((v) => ({ ...v, media_ids: r.media_ids.slice(0, 4) })),
        sources: [`object:${object.id}`], warnings: r.warnings,
      });
      setItem(saved);
    }
  }

  const variants = () => channels.filter((c) => texts[c] !== undefined).map((c) => ({ channel: c, text: texts[c]!, media_ids: selected }));

  async function submitForReview() {
    const saved = await repo.saveContent({ ...item!, variants: variants(), status: "review" });
    setItem(saved);
    toast("Skickat till ägaren för godkännande");
  }

  async function approveAndShare(channel: Channel) {
    setBusy(true);
    try {
      let current = item!;
      if (current.status !== "approved") current = await repo.saveContent({ ...current, variants: variants(), status: "approved" });
      setItem(current);
      const images = [];
      for (const m of media.filter((m) => selected.includes(m.id))) {
        const blob = await repo.mediaBlob(m);
        if (blob) images.push({ name: `vreta-${object.title.toLowerCase().replace(/[^a-zåäö0-9]+/g, "-")}-${images.length + 1}.jpg`, blob });
      }
      const outcome = await shareStory(texts[channel] ?? "", images);
      if (outcome === "copied") toast("Texten är kopierad och bilderna nedladdade");
      if (outcome !== "cancelled") setAskUrl(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmShared() {
    await repo.markShared(item!.id, url.trim());
    setAskUrl(false);
    setItem({ ...item!, status: "shared" });
    await refresh();
    toast("Markerat som delat");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={`/objekt/${object.id}`} className="text-sm font-semibold text-falu">← {object.title}</Link>
      <PageHeader kicker="Berätta" title="Gör en berättelse" />

      <p className="field-label">1. Vad vill du berätta?</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {(Object.keys(GOAL_LABEL) as ContentGoal[]).map((g) => (
          <button key={g} onClick={() => setGoal(g)} className={`chip ${goal === g ? "chip-on" : ""}`}>{GOAL_LABEL[g]}</button>
        ))}
      </div>

      <p className="field-label">2. Var ska det delas?</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {CHANNELS.map((c) => (
          <button key={c} onClick={() => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))} className={`chip ${channels.includes(c) ? "chip-on" : ""}`}>{CHANNEL_LABEL[c]}</button>
        ))}
      </div>

      <button onClick={draft} disabled={busy || channels.length === 0} className="btn-primary mb-8 w-full">
        {busy ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} aria-hidden="true" />} {result ? "Skriv nya utkast" : "Skriv utkast"}
      </button>

      {result && !result.ok && (
        <div className="card mb-6 border-falu/40 p-4">
          {result.warnings.map((w) => <p key={w} className="flex gap-2 text-sot-2"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-falu" /> {w}</p>)}
        </div>
      )}

      {result?.ok && (
        <>
          <section className="card mb-6 p-4">
            <p className="mb-2 flex items-center gap-2 font-semibold text-linolja"><ShieldCheck size={18} aria-hidden="true" /> Granskning</p>
            <p className="mb-2 text-sm text-sot-2">Utkasten bygger bara på delbar information om objektet{result.source === "mall" ? " och är skrivna från mallar i demoläget" : ""}.</p>
            {result.warnings.map((w) => (
              <p key={w} className="mb-2 flex gap-2 rounded-md bg-ockra-light/30 px-3 py-2 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#8a6118]" /> {w}</p>
            ))}
            {result.removed.length > 0 && (
              <>
                <button onClick={() => setShowRemoved((s) => !s)} className="flex items-center gap-1 text-sm font-semibold text-sot-3">
                  <ChevronDown size={16} className={showRemoved ? "rotate-180" : ""} /> Togs bort av integritetsfiltret ({result.removed.length})
                </button>
                {showRemoved && <ul className="mt-2 list-disc pl-6 text-sm text-sot-3">{result.removed.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              </>
            )}
          </section>

          {media.some((m) => result.media_ids.includes(m.id)) && (
            <>
              <p className="field-label">Bilder (utan platsdata)</p>
              <div className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {media.filter((m) => result.media_ids.includes(m.id)).map((m) => (
                  <button key={m.id} onClick={() => setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))} className={`relative overflow-hidden rounded-md ring-offset-2 ring-offset-kalk ${selected.includes(m.id) ? "ring-2 ring-falu" : "opacity-50"}`} aria-pressed={selected.includes(m.id)}>
                    <MediaImage media={m} className="aspect-square w-full" />
                  </button>
                ))}
              </div>
            </>
          )}

          <div role="tablist" className="mb-3 flex gap-1 overflow-x-auto border-b border-lera-light">
            {channels.filter((c) => texts[c] !== undefined).map((c) => (
              <button key={c} role="tab" aria-selected={active === c} onClick={() => setActive(c)} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${active === c ? "border-falu" : "border-transparent text-sot-3"}`}>{CHANNEL_LABEL[c]}</button>
            ))}
          </div>
          <textarea className="input mb-2 font-serif text-[16px] leading-relaxed" rows={8} value={texts[active] ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [active]: e.target.value }))} aria-label={`Text för ${CHANNEL_LABEL[active]}`} />
          <p className="mb-6 text-right text-[12px] text-sot-3">{(texts[active] ?? "").length} tecken</p>

          {askUrl ? (
            <div className="card space-y-3 p-4">
              <p className="font-semibold">Blev det delat?</p>
              <input className="input" placeholder="Klistra in länken till inlägget (valfritt)" value={url} onChange={(e) => setUrl(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setAskUrl(false)}>Inte än</button>
                <button className="btn-moss flex-1" onClick={confirmShared}>Ja, markera som delat</button>
              </div>
            </div>
          ) : item?.status === "shared" ? (
            <p className="card p-4 text-center font-semibold text-linolja">Delat – berättelsen syns nu i objektets resa.</p>
          ) : isOwner ? (
            <button className="btn-primary w-full text-base" disabled={busy} onClick={() => approveAndShare(active)}>
              <Share2 size={18} aria-hidden="true" /> Godkänn och dela till {CHANNEL_LABEL[active]}
            </button>
          ) : item?.status === "review" ? (
            <p className="card p-4 text-center text-sot-2">Väntar på att ägaren godkänner och delar.</p>
          ) : (
            <button className="btn-primary w-full" onClick={submitForReview}>
              <Send size={18} aria-hidden="true" /> Skicka till ägaren för godkännande
            </button>
          )}
        </>
      )}
    </div>
  );
}

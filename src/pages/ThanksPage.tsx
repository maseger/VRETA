import { AlertTriangle, ChevronDown, Loader2, Send, Share2, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { CHANNEL_LABEL } from "../domain/labels";
import type { Channel, ContentItem, Media } from "../domain/types";
import { DROPS_SHARED_TEXT, copyText, shareStory } from "../services/share";
import { PasteHint, PasteNote } from "../ui/PasteHint";
import { draftThanksForPerson, type ThanksDraft } from "../services/thanks";
import { MediaImage, PageHeader } from "../ui/bits";
import { ConsentForPost } from "./StoryStudioPage";

const CHANNELS: Channel[] = ["privat", "facebook", "instagram", "linkedin"];

/** Tack till en person (4.8): publikt med samtycke eller privat meddelande med bild. */
export function ThanksPage() {
  const { id } = useParams();
  const { repo, profile, refresh, toast } = useApp();
  const isOwner = profile?.role === "owner";
  const { data } = useData(async (r) => {
    const person = await r.person(id!);
    if (!person) return null;
    const acqs = (await r.allAcquisitions()).filter((a) => a.person_id === id);
    const objectIds = new Set([...acqs.map((a) => a.object_id), ...(await r.contributions(id!)).map((c) => c.object_id).filter(Boolean)]);
    const media: Media[] = (await Promise.all([...objectIds].map((oid) => r.mediaFor("object", oid!)))).flat();
    return { person, media };
  }, [id]);
  const [channels, setChannels] = useState<Channel[]>(["privat", "facebook"]);
  const [draft, setDraft] = useState<ThanksDraft | null>(null);
  const [texts, setTexts] = useState<Partial<Record<Channel, string>>>({});
  const [active, setActive] = useState<Channel>("privat");
  const [selected, setSelected] = useState<string[]>([]);
  const [item, setItem] = useState<ContentItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [askUrl, setAskUrl] = useState(false);
  const [pasteHint, setPasteHint] = useState<{ text: string; where: string; copied: boolean } | null>(null);
  const [url, setUrl] = useState("");

  if (data === null) return <p>Personen finns inte.</p>;
  if (!data) return null;
  const { person, media } = data;

  async function write(contentId = item?.id) {
    setBusy(true);
    try {
      const d = await draftThanksForPerson(repo, person.id, channels, contentId);
      setDraft(d);
      setTexts(Object.fromEntries(d.variants.map((v) => [v.channel, v.text])));
      setActive(d.variants[0]?.channel ?? "privat");
      setSelected(d.media_ids.slice(0, 4));
      const saved = await repo.saveContent({
        id: contentId, goal: "tack", source_type: "person", source_id: person.id, status: "draft",
        variants: d.variants.map((v) => ({ ...v, media_ids: d.media_ids.slice(0, 4) })), sources: [`person:${person.id}`], warnings: d.warnings,
      });
      setItem(saved);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const variants = () => channels.filter((c) => texts[c] !== undefined).map((c) => ({ channel: c, text: texts[c]!, media_ids: selected }));

  async function approveAndShare(channel: Channel) {
    // Kopiera direkt vid knapptrycket – senare tillåter telefonen det inte
    const text = texts[channel] ?? "";
    const copied = copyText(text);
    setBusy(true);
    try {
      let current = item!;
      if (current.status !== "approved") current = await repo.saveContent({ ...current, variants: variants(), status: "approved" });
      setItem(current);
      const images = [];
      for (const m of media.filter((m) => selected.includes(m.id))) {
        const blob = await repo.mediaBlob(m);
        if (blob) images.push({ name: `vreta-tack-${images.length + 1}.jpg`, blob });
      }
      const { outcome, textCopied } = await shareStory(text, images, copied);
      if (outcome === "copied") toast(textCopied ? "Texten är kopierad och bilderna nedladdade" : "Bilderna är nedladdade – kopiera texten nedan");
      if (outcome !== "cancelled") setAskUrl(true);
      if (outcome !== "cancelled" && images.length && (outcome === "copied" || DROPS_SHARED_TEXT.has(channel))) setPasteHint({ text, where: CHANNEL_LABEL[channel], copied: textCopied });
    } finally {
      setBusy(false);
    }
  }

  async function confirmShared() {
    await repo.markShared(item!.id, url.trim());
    if (draft) await repo.markThanked(draft.contribution_ids);
    setAskUrl(false);
    setItem({ ...item!, status: "shared" });
    await refresh();
    toast(`${person.name.split(" ")[0]} är tackad`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={`/person/${person.id}`} className="text-sm font-semibold text-falu">← {person.name}</Link>
      <PageHeader kicker="Berätta · Tacka" title={`Tacka ${person.name.split(" ")[0]}`} />

      <p className="field-label">Hur vill du tacka?</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {CHANNELS.map((c) => (
          <button key={c} onClick={() => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))} className={`chip ${channels.includes(c) ? "chip-on" : ""}`}>{CHANNEL_LABEL[c]}</button>
        ))}
      </div>
      <button onClick={() => write()} disabled={busy || channels.length === 0} className="btn-primary mb-8 w-full">
        {busy ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} aria-hidden="true" />} {draft ? "Skriv nya utkast" : "Skriv tack"}
      </button>

      {draft && (
        <>
          <section className="card mb-6 p-4">
            <p className="mb-2 flex items-center gap-2 font-semibold text-linolja"><ShieldCheck size={18} aria-hidden="true" /> Granskning</p>
            <p className="mb-2 text-sm text-sot-2">
              {draft.context.name ? `${person.name} nämns vid namn.` : `${person.name} nämns inte vid namn.`} Kontaktuppgifter, hemort, anteckningar och priser används aldrig.
            </p>
            {draft.warnings.map((w) => <p key={w} className="mb-2 flex gap-2 rounded-md bg-ockra-light/30 px-3 py-2 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#8a6118]" /> {w}</p>)}
            {draft.removed.length > 0 && (
              <>
                <button onClick={() => setShowRemoved((s) => !s)} className="flex items-center gap-1 text-sm font-semibold text-sot-3">
                  <ChevronDown size={16} className={showRemoved ? "rotate-180" : ""} /> Togs bort av integritetsfiltret ({draft.removed.length})
                </button>
                {showRemoved && <ul className="mt-2 list-disc pl-6 text-sm text-sot-3">{draft.removed.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              </>
            )}
            {isOwner && item && (person.consent_name === "ask" || person.consent_contribution === "ask") && (
              <ConsentForPost person={person} contentId={item.id} onSaved={() => write(item.id)} />
            )}
          </section>

          {media.some((m) => draft.media_ids.includes(m.id)) && (
            <>
              <p className="field-label">Bilder (utan platsdata)</p>
              <div className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {media.filter((m) => draft.media_ids.includes(m.id)).map((m) => (
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
          <textarea className="input mb-6 font-serif text-[16px] leading-relaxed" rows={7} value={texts[active] ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [active]: e.target.value }))} aria-label={`Text för ${CHANNEL_LABEL[active]}`} />

          {askUrl && pasteHint && <PasteHint {...pasteHint} />}
          {askUrl ? (
            <div className="card space-y-3 p-4">
              <p className="font-semibold">Blev det skickat eller delat?</p>
              {active !== "privat" && <input className="input" placeholder="Klistra in länken till inlägget (valfritt)" value={url} onChange={(e) => setUrl(e.target.value)} />}
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => { setAskUrl(false); setPasteHint(null); }}>Inte än</button>
                <button className="btn-moss flex-1" onClick={confirmShared}>Ja, markera som tackad</button>
              </div>
            </div>
          ) : item?.status === "shared" ? (
            <p className="card p-4 text-center font-semibold text-linolja">Tackat – det syns i {person.name.split(" ")[0]}s relation.</p>
          ) : isOwner ? (
            <>
              <button className="btn-primary w-full text-base" disabled={busy} onClick={() => approveAndShare(active)}>
                <Share2 size={18} aria-hidden="true" /> Godkänn och {active === "privat" ? "skicka" : `dela till ${CHANNEL_LABEL[active]}`}
              </button>
              {DROPS_SHARED_TEXT.has(active) && selected.length > 0 && <PasteNote where={CHANNEL_LABEL[active]} />}
            </>
          ) : item?.status === "review" ? (
            <p className="card p-4 text-center text-sot-2">Väntar på att ägaren godkänner.</p>
          ) : (
            <button className="btn-primary w-full" onClick={async () => { setItem(await repo.saveContent({ ...item!, variants: variants(), status: "review" })); toast("Skickat till ägaren"); }}>
              <Send size={18} aria-hidden="true" /> Skicka till ägaren för godkännande
            </button>
          )}
        </>
      )}
    </div>
  );
}

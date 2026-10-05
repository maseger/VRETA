import { AlertTriangle, Bot, Check, ChevronDown, Copy, ExternalLink, HandCoins, Link2, Loader2, Megaphone, Share2, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import { DISPOSAL_LABEL, LISTING_STATUS_LABEL, LISTING_TYPE_LABEL, PAYMENT_METHODS } from "../domain/labels";
import type { ChannelPost, DisposalType, Listing, Media, Person, PublishMode } from "../domain/types";
import { packagesForListing, rawListingContext } from "../services/marketplaceAgent";
import { shareStory } from "../services/share";
import { adaptersFor, type ChannelAdapter } from "../../supabase/functions/_shared/channels";
import { guardListing, priceLabel, type ListingPackage, type PriceSuggestion } from "../../supabase/functions/_shared/listingPackage";
import { MediaImage, PageHeader, Section } from "../ui/bits";
import { LeadQueue } from "./listing/LeadQueue";

/** S8 Annonsstudion: gemensamma fält, bildval, en flik per kanal, intressentkö och avslut. */
export function ListingStudioPage() {
  const { id } = useParams();
  const { repo, profile, refresh, toast } = useApp();
  const canWrite = profile?.role !== "viewer";
  // Svarsutkastet ligger här så att det överlever när studion laddas om efter en statusändring
  const reply = useState<{ lead: string; text: string } | null>(null);
  const { data, reload } = useData(async (r) => {
    const listing = await r.listing(id!);
    if (!listing) return null;
    const [object, posts, media, persons, raw] = await Promise.all([
      listing.object_id ? r.object(listing.object_id) : Promise.resolve(null),
      r.channelPosts(id!),
      listing.object_id ? r.mediaFor("object", listing.object_id) : Promise.resolve([] as Media[]),
      r.persons(),
      rawListingContext(r, listing),
    ]);
    return { listing, object, posts, media, persons, guard: guardListing(raw) };
  }, [id]);

  if (data === null) return <p>Annonsen finns inte.</p>;
  if (!data) return null;
  return <Studio key={`${data.listing.id}-${data.listing.status}`} {...data} reply={reply} canWrite={canWrite} reload={reload} onChanged={async (msg) => { await refresh(); reload(); if (msg) toast(msg); }} repoKind={repo.kind} />;
}

interface StudioProps {
  listing: Listing;
  object: Awaited<ReturnType<import("../data/repo").Repo["object"]>>;
  posts: ChannelPost[];
  media: Media[];
  persons: Person[];
  guard: ReturnType<typeof guardListing>;
  reply: ReplyState;
  canWrite: boolean;
  reload: () => void;
  onChanged: (msg?: string) => Promise<void>;
  repoKind: "local" | "supabase";
}

type ReplyState = [{ lead: string; text: string } | null, (r: { lead: string; text: string } | null) => void];

function Studio({ listing, object, posts, media, persons, guard, reply, canWrite, onChanged }: StudioProps) {
  const { repo, toast } = useApp();
  const adapters = adaptersFor(listing.type);
  const editable = canWrite && (listing.status === "draft" || listing.status === "ready" || listing.status === "published");
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [price, setPrice] = useState(listing.price != null ? String(listing.price) : "");
  const [locality, setLocality] = useState(listing.locality);
  const [images, setImages] = useState<string[]>(listing.image_ids.length ? listing.image_ids : guard.context?.media_ids.slice(0, 8) ?? []);
  const [suggestion, setSuggestion] = useState<PriceSuggestion | null>(null);
  const [packages, setPackages] = useState<Record<string, ListingPackage>>(() =>
    Object.fromEntries(posts.filter((p) => p.title || p.text).map((p) => [p.channel, { channel: p.channel, title: p.title, text: p.text, category: "", price_label: "", image_ids: [] }])),
  );
  const [active, setActive] = useState(adapters[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<{ removed: string[]; warnings: string[]; source: string } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const dirty = title !== listing.title || description !== listing.description || (price ? Number(price) : null) !== listing.price || locality !== listing.locality || images.join() !== listing.image_ids.join();

  async function save(priceOverride?: number): Promise<Listing> {
    const l = await repo.saveListing({
      id: listing.id, object_id: listing.object_id, type: listing.type, title: title.trim(), description: description.trim(),
      price: priceOverride ?? (price === "" ? null : Number(price)), quantity: listing.quantity, locality: locality.trim(), image_ids: images,
    });
    return l;
  }

  async function generate(priceOverride?: number) {
    setBusy(true);
    try {
      const l = dirty || priceOverride != null ? await save(priceOverride) : listing;
      const r = await packagesForListing(repo, l, adapters.map((a) => a.id));
      setNotes({ removed: r.removed, warnings: r.warnings, source: r.source });
      if (!r.ok) return;
      setSuggestion(r.price);
      setPackages(Object.fromEntries(r.packages.map((p) => [p.channel, p])));
      for (const p of r.packages) await repo.saveChannelDraft(l.id, p.channel, p.title, p.text);
      if (!listing.image_ids.length && r.media_ids.length) setImages(r.media_ids.slice(0, 8));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Första gången: bygg paketen direkt (AC-07: annonspaket på under 3 minuter)
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (editable && Object.keys(packages).length === 0 && guard.allowed) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pkgPrice = useMemo(() => (guard.context ? priceLabel({ ...guard.context, price: price === "" ? null : Number(price) }) : ""), [guard.context, price]);
  const open = ["draft", "ready", "published", "agreed"].includes(listing.status);

  return (
    <div className="mx-auto max-w-3xl">
      {object ? <Link to={`/objekt/${object.id}`} className="text-sm font-semibold text-falu">← {object.title}</Link> : <Link to="/samla?vy=annonser" className="text-sm font-semibold text-falu">← Annonser</Link>}
      <PageHeader kicker={`Annonsstudion · ${LISTING_TYPE_LABEL[listing.type]}`} title={listing.title}>
        <span className="stamp self-center border-falu text-falu">{LISTING_STATUS_LABEL[listing.status]}</span>
      </PageHeader>

      {!guard.allowed && (
        <div className="card mb-6 p-4">{guard.warnings.map((w) => <p key={w} className="flex gap-2 text-sot-2"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-falu" /> {w}</p>)}</div>
      )}

      {listing.status === "agreed" && canWrite && <CompletePanel listing={listing} onDone={onChanged} />}
      {listing.status === "completed" && <AfterDisposal listing={listing} posts={posts} objectId={object?.id ?? null} canWrite={canWrite} onChanged={onChanged} />}

      {guard.allowed && open && (
        <>
          <Section title="Gemensamt">
            <div className="card grid gap-4 p-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="lt">Rubrik</label>
                <input id="lt" className="input" disabled={!editable} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="ld">Beskrivning</label>
                <textarea id="ld" rows={3} className="input" disabled={!editable} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Skick, mått, ursprung – utan namn eller adress" />
              </div>
              {listing.type !== "give" && listing.type !== "wanted" && listing.type !== "help_wanted" && (
                <div>
                  <label className="field-label" htmlFor="lp">Pris (kr{listing.quantity ? `, för alla ${listing.quantity}` : ""})</label>
                  <input id="lp" type="number" min={0} className="input" disabled={!editable} value={price} onChange={(e) => setPrice(e.target.value)} />
                  {suggestion && suggestion.price != null && (
                    <p className="mt-1.5 text-[13px] text-sot-2">
                      <Sparkles size={13} className="mr-1 inline text-linolja" aria-hidden="true" />
                      Förslag: <b>{suggestion.price.toLocaleString("sv-SE")} kr</b>. {suggestion.motivation}{" "}
                      {editable && String(suggestion.price) !== price && <button className="font-semibold text-falu underline" onClick={() => { setPrice(String(suggestion.price)); void generate(suggestion.price!); }}>Använd</button>}
                    </p>
                  )}
                  {suggestion && suggestion.price == null && <p className="mt-1.5 text-[13px] text-sot-3">{suggestion.motivation}</p>}
                </div>
              )}
              <div>
                <label className="field-label" htmlFor="lo">Ort</label>
                <input id="lo" className="input" disabled={!editable} value={locality} onChange={(e) => setLocality(e.target.value)} />
              </div>
              {listing.quantity != null && <p className="text-sm text-sot-2 sm:col-span-2">Antal: <b>{listing.quantity} {object?.unit ?? "st"}</b>{listing.allocation_id ? " (avdelat från partiet)" : ""}</p>}
            </div>

            {media.length > 0 && (
              <>
                <p className="field-label mt-5">Bilder – tryck i den ordning de ska visas</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {media.map((m) => {
                    const ok = guard.context?.media_ids.includes(m.id);
                    const pos = images.indexOf(m.id);
                    return (
                      <button key={m.id} disabled={!ok || !editable} onClick={() => setImages((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                        className={`relative overflow-hidden rounded-md ring-offset-2 ring-offset-kalk ${pos >= 0 ? "ring-2 ring-falu" : "opacity-60"} disabled:cursor-not-allowed`} aria-pressed={pos >= 0}
                        title={ok ? "Utan platsdata" : "Kan inte användas (personer eller intern bild)"}>
                        <MediaImage media={m} className="aspect-square w-full" />
                        {pos >= 0 && <span className="absolute left-1 top-1 rounded-full bg-falu px-1.5 text-[11px] font-bold text-kalk">{pos + 1}</span>}
                        {ok ? <span className="absolute bottom-1 right-1 rounded-full bg-linolja p-0.5 text-kalk"><Check size={12} aria-label="Utan platsdata" /></span>
                          : <span className="absolute inset-x-0 bottom-0 bg-sot/70 py-0.5 text-center text-[10px] text-kalk">Används inte</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {editable && (
              <div className="mt-4 flex flex-wrap gap-2">
                {dirty && <button className="btn-secondary" onClick={async () => { await save(); await onChanged("Sparat"); }}>Spara ändringar</button>}
                <button className="btn-secondary" disabled={busy} onClick={() => generate()}>
                  {busy ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} aria-hidden="true" />} {Object.keys(packages).length ? "Skriv om annonserna" : "Skapa annonspaket"}
                </button>
              </div>
            )}
          </Section>

          {notes && (notes.warnings.length > 0 || notes.removed.length > 0) && (
            <section className="card mb-6 p-4">
              <p className="mb-2 flex items-center gap-2 font-semibold text-linolja"><ShieldCheck size={18} aria-hidden="true" /> Granskning</p>
              <p className="mb-2 text-sm text-sot-2">Annonserna nämner aldrig givare, köpare, adress, lagerplats eller vad du betalade{notes.source === "mall" ? ". Texterna är skrivna från mallar" : ""}.</p>
              {notes.warnings.map((w) => <p key={w} className="mb-2 flex gap-2 rounded-md bg-ockra-light/30 px-3 py-2 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#8a6118]" /> {w}</p>)}
              {notes.removed.length > 0 && (
                <>
                  <button onClick={() => setShowRemoved((s) => !s)} className="flex items-center gap-1 text-sm font-semibold text-sot-3">
                    <ChevronDown size={16} className={showRemoved ? "rotate-180" : ""} /> Togs bort av integritetsfiltret ({notes.removed.length})
                  </button>
                  {showRemoved && <ul className="mt-2 list-disc pl-6 text-sm text-sot-3">{notes.removed.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                </>
              )}
            </section>
          )}

          {adapters.length > 0 && (
            <Section title="Kanaler">
              <div role="tablist" className="mb-3 flex gap-1 overflow-x-auto border-b border-lera-light">
                {adapters.map((a) => {
                  const p = posts.find((x) => x.channel === a.id);
                  return (
                    <button key={a.id} role="tab" aria-selected={active === a.id} onClick={() => setActive(a.id)} className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${active === a.id ? "border-falu" : "border-transparent text-sot-3"}`}>
                      {a.name} {p?.status === "posted" && <Check size={14} className="text-linolja" aria-label="Ute" />}
                    </button>
                  );
                })}
              </div>
              {adapters.filter((a) => a.id === active).map((a) => (
                <ChannelPanel key={a.id} adapter={a} listing={listing} post={posts.find((p) => p.channel === a.id) ?? null}
                  pkg={packages[a.id] ?? null} priceText={pkgPrice} media={media.filter((m) => images.includes(m.id)).sort((x, y) => images.indexOf(x.id) - images.indexOf(y.id))}
                  editable={editable} beforePublish={async () => { if (dirty) await save(); }}
                  onEdit={(p) => setPackages((s) => ({ ...s, [a.id]: p }))} onChanged={onChanged} />
              ))}
            </Section>
          )}
        </>
      )}

      {canWrite && listing.status !== "draft" && <LeadQueue listing={listing} persons={persons} context={guard.context} reply={reply} onChanged={onChanged} />}

      {canWrite && open && (
        <button className="btn-ghost mt-6 text-sm text-sot-3" onClick={async () => {
          if (!confirm("Dra tillbaka annonsen? Det som var utannonserat går tillbaka till lager.")) return;
          await repo.setListingStatus(listing.id, "withdrawn");
          await onChanged("Annonsen är tillbakadragen");
        }}>
          <Undo2 size={16} aria-hidden="true" /> Dra tillbaka annonsen
        </button>
      )}
    </div>
  );
}

function ChannelPanel({ adapter: a, listing, post, pkg, priceText, media, editable, beforePublish, onEdit, onChanged }: {
  adapter: ChannelAdapter; listing: Listing; post: ChannelPost | null; pkg: ListingPackage | null; priceText: string; media: Media[]; editable: boolean;
  beforePublish: () => Promise<void>; onEdit: (p: ListingPackage) => void; onChanged: (msg?: string) => Promise<void>;
}) {
  const { repo, toast } = useApp();
  const [url, setUrl] = useState(post?.external_url ?? "");
  const [mode, setMode] = useState<PublishMode>("manual");
  const [agentPrompt, setAgentPrompt] = useState(false);
  const p = pkg ?? { channel: a.id, title: "", text: "", category: "", price_label: "", image_ids: [] };
  const titleOver = p.title.length > a.title_max_length;
  const textOver = p.text.length > a.text_max_length;
  const urlOk = !url || new RegExp(a.url_pattern).test(url);
  const imgs = media.slice(0, a.max_images);
  const fullText = `${p.title}\n\n${p.text}`;

  async function persist() {
    await repo.saveChannelDraft(listing.id, a.id, p.title, p.text);
  }

  async function share() {
    await persist();
    const files = [];
    for (const m of imgs) {
      const blob = await repo.mediaBlob(m);
      if (blob) files.push({ name: `annons-${files.length + 1}.jpg`, blob });
    }
    const outcome = await shareStory(fullText, files);
    if (outcome === "copied") toast(`Texten är kopierad${files.length ? " och bilderna nedladdade" : ""} – klistra in på ${a.name}`);
  }

  async function publish() {
    await beforePublish();
    await persist();
    await repo.publishChannel(listing.id, a.id, url.trim(), mode);
    await onChanged(`Ute på ${a.name}`);
  }

  // Instruktion till Claude i Chrome (webbläsaragent, 9.4). Användaren gör alltid sista klicket själv (INV-04).
  const prompt = [
    `Hjälp mig lägga upp en annons på ${a.name} (${a.new_listing_url}) i min inloggade webbläsare.`,
    `Fyll i formuläret men publicera inte – jag granskar och trycker på publicera själv. Logga inte in och betala inget åt mig.`,
    ``,
    `Rubrik: ${p.title}`,
    p.category ? `Kategori: ${p.category}` : "",
    a.supports_price && priceText ? `Pris: ${priceText}` : "",
    listing.locality ? `Ort: ${listing.locality}` : "",
    ``,
    `Text:`,
    p.text,
    ``,
    `Bilderna ligger i min nedladdningsmapp (annons-1.jpg …). Ladda upp dem i den ordningen.`,
    `När annonsen är publicerad: ge mig länken så klistrar jag in den i VRETA.`,
  ].filter((x) => x !== "").join("\n");

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-sot-3">
        <span>Upp till {a.max_images} bilder</span>
        <span>Rubrik max {a.title_max_length} tecken</span>
        {a.supports_free && <span>Gratis möjligt</span>}
        <span>Publicering: {a.publish_modes.map((m) => ({ manual: "manuell", browser_agent: "webbläsaragent", api: "API" })[m]).join(", ")}</span>
        {!a.verified && <span className="text-[#8a6118]" title="Kanalens regler ska kontrolleras före lansering (Q-03)">Gränser ej verifierade</span>}
      </div>

      <div>
        <label className="field-label" htmlFor={`t-${a.id}`}>Rubrik</label>
        <input id={`t-${a.id}`} className="input" disabled={!editable} value={p.title} onChange={(e) => onEdit({ ...p, title: e.target.value })} onBlur={persist} />
        <p className={`mt-1 text-right text-[12px] ${titleOver ? "font-semibold text-falu" : "text-sot-3"}`}>{p.title.length}/{a.title_max_length}</p>
      </div>
      <div>
        <label className="field-label" htmlFor={`x-${a.id}`}>Text</label>
        <textarea id={`x-${a.id}`} rows={9} className="input font-serif text-[15.5px] leading-relaxed" disabled={!editable} value={p.text} onChange={(e) => onEdit({ ...p, text: e.target.value })} onBlur={persist} />
        <p className={`mt-1 text-right text-[12px] ${textOver ? "font-semibold text-falu" : "text-sot-3"}`}>{p.text.length}/{a.text_max_length}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {p.category && <div><dt className="kicker">Kategori</dt><dd>{p.category}</dd></div>}
        {a.supports_price && priceText && <div><dt className="kicker">Pris</dt><dd>{priceText}</dd></div>}
        <div><dt className="kicker">Bilder</dt><dd>{imgs.length} valda</dd></div>
      </dl>

      {post?.status === "posted" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-linolja/10 px-3 py-2.5">
          <Check size={18} className="text-linolja" aria-hidden="true" />
          <span className="flex-1 text-sm">Ute på {a.name}{post.publish_mode === "browser_agent" ? " (via agent)" : ""}</span>
          {post.external_url && <a href={post.external_url} target="_blank" rel="noreferrer" className="btn-ghost text-sm"><ExternalLink size={16} /> Öppna</a>}
          {editable && <button className="btn-ghost text-sm" onClick={async () => { await repo.removeChannel(listing.id, a.id); await onChanged(`Markerad som nedtagen på ${a.name}`); }}>Tagen ner</button>}
        </div>
      ) : editable && p.text ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary flex-1 sm:flex-none" onClick={share}><Share2 size={18} aria-hidden="true" /> Dela eller kopiera</button>
            <a className="btn-secondary" href={a.new_listing_url} target="_blank" rel="noreferrer"><ExternalLink size={18} aria-hidden="true" /> Öppna {a.name}</a>
            {a.publish_modes.includes("browser_agent") && (
              <button className="btn-secondary" onClick={() => setAgentPrompt((s) => !s)}><Bot size={18} aria-hidden="true" /> Låt agent publicera</button>
            )}
          </div>
          {agentPrompt && (
            <div className="rounded-md border border-dashed border-lera p-3">
              <p className="mb-2 text-sm text-sot-2">Klistra in instruktionen i Claude i Chrome. Claude fyller i formuläret i din inloggade webbläsare – inloggning, betalning och sista publiceringsklicket gör du själv.</p>
              <button className="btn-secondary text-sm" onClick={async () => { await share(); await navigator.clipboard?.writeText(prompt).catch(() => undefined); setMode("browser_agent"); toast("Instruktionen är kopierad"); }}>
                <Copy size={16} aria-hidden="true" /> Kopiera instruktion och spara bilderna
              </button>
            </div>
          )}
          <div className="border-t border-dashed border-lera-light pt-4">
            <label className="field-label" htmlFor={`u-${a.id}`}>Klistra in annonslänken när den är ute</label>
            <div className="flex gap-2">
              <input id={`u-${a.id}`} className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={a.new_listing_url} />
              <button className="btn-moss whitespace-nowrap" disabled={!urlOk} onClick={publish}><Link2 size={18} aria-hidden="true" /> Den är ute</button>
            </div>
            {!urlOk && <p className="mt-1 text-sm text-falu">Länken ser inte ut att vara från {a.name}.</p>}
          </div>
        </>
      ) : !p.text ? (
        <p className="text-sm text-sot-3">Tryck <b>Skapa annonspaket</b> så skrivs texten för {a.name}.</p>
      ) : null}
    </div>
  );
}

function CompletePanel({ listing, onDone }: { listing: Listing; onDone: (msg?: string) => Promise<void> }) {
  const { repo } = useApp();
  const defaultType: DisposalType = ({ give: "donated", exchange: "exchanged", lend: "lent" } as Record<string, DisposalType>)[listing.type] ?? "sold";
  const [type, setType] = useState<DisposalType>(defaultType);
  const [price, setPrice] = useState(listing.price != null && type === "sold" ? String(listing.price) : "");
  const [method, setMethod] = useState("Swish");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card mb-6 border-linolja/40 p-4">
      <p className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold"><HandCoins size={20} className="text-linolja" aria-hidden="true" /> Avsluta affären</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["sold", "donated", "exchanged", "lent"] as DisposalType[]).map((t) => <button key={t} className={`chip ${type === t ? "chip-on" : ""}`} onClick={() => setType(t)}>{DISPOSAL_LABEL[t]}</button>)}
      </div>
      {type === "sold" && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="cp">Slutpris (kr) – privat</label>
            <input id="cp" type="number" min={0} className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <p className="field-label">Betalning</p>
            <div className="flex flex-wrap gap-1.5">{PAYMENT_METHODS.map((m) => <button key={m} className={`chip ${method === m ? "chip-on" : ""}`} onClick={() => setMethod(m)}>{m}</button>)}</div>
          </div>
        </div>
      )}
      <p className="mb-3 text-[13px] text-sot-3">Objektet får ny status, köparen sparas i CRM:et och du får påminnelser om att ta ner annonsen i alla kanaler.</p>
      {error && <p className="mb-2 text-sm text-falu">{error}</p>}
      <button className="btn-moss w-full" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await repo.completeDisposal(listing.id, { type, price: type === "sold" && price ? Number(price) : null, payment_method: type === "sold" ? method : "" });
          await onDone(`${DISPOSAL_LABEL[type]} – klart`);
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}>
        {busy ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} aria-hidden="true" />} Klart – {DISPOSAL_LABEL[type].toLowerCase()}
      </button>
    </section>
  );
}

function AfterDisposal({ listing, posts, objectId, canWrite, onChanged }: { listing: Listing; posts: ChannelPost[]; objectId: string | null; canWrite: boolean; onChanged: (msg?: string) => Promise<void> }) {
  const { repo } = useApp();
  const still = posts.filter((p) => p.status === "posted");
  return (
    <section className="card mb-6 p-4">
      <p className="mb-2 font-serif text-lg font-semibold text-linolja">Det har fått ett nytt hem.</p>
      {still.length > 0 ? (
        <>
          <p className="mb-2 text-sm text-sot-2">Ta ner annonsen där den fortfarande ligger ute:</p>
          <ul className="mb-3 space-y-2">
            {still.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="flex-1">{adaptersFor(listing.type).find((a) => a.id === p.channel)?.name ?? p.channel}</span>
                {p.external_url && <a href={p.external_url} target="_blank" rel="noreferrer" className="btn-ghost text-sm"><ExternalLink size={16} /> Öppna</a>}
                {canWrite && <button className="btn-secondary text-sm" onClick={async () => { await repo.removeChannel(listing.id, p.channel); await onChanged("Markerad som nedtagen"); }}>Tagen ner</button>}
              </li>
            ))}
          </ul>
        </>
      ) : <p className="mb-3 text-sm text-sot-2">Annonsen är nedtagen i alla kanaler.</p>}
      {objectId && (
        <Link to={`/objekt/${objectId}/beratta?mal=visa_vad_som_hant`} className="btn-secondary"><Megaphone size={18} aria-hidden="true" /> Berätta vart det tog vägen</Link>
      )}
    </section>
  );
}

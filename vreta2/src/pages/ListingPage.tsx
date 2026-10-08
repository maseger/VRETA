// Annonsstudion: ett annonspaket per kanal (rubrik, text, bilder, kategori), prisförslag med motivering,
// delning med texten kopierad först, och intressenterna i kö med svarsutkast (R1.1 9.2–9.4).
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bot, Check, Copy, ExternalLink, Share2, Sparkles, UserPlus } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { useScreen } from "../app/useScreen";
import { LISTING_TYPES, DISPOSAL_TYPES } from "../app/labels";
import { d, dt, kr } from "../app/format";
import { listingPackages } from "../services/ai";
import { copyText, shareContent } from "../services/share";
import { adapterFromCode, browserAgentInstruction, leadReplyDraft, needsPaste, type ChannelPackage } from "@shared/listingPackage.ts";
import { AiBadge, Card, Empty, ErrorNote, PageHeader, Section, Spinner, Stamp, statusTone } from "../ui/base";
import { Gallery } from "../ui/media";
import { NumberField, PersonPicker, Select, TextArea, TextField, numOrNull, strOrNull, type PersonChoice } from "../ui/fields";
import { BusyButton, Sheet } from "../ui/sheet";
import { Timeline } from "../ui/timeline";
import { useToast } from "../app/toast";

export default function ListingPage() {
  const { id } = useParams();
  const { data: l, error, loading } = useQuery<any>("q_listing", { id });
  useScreen(l ? { id: l.id, type: "listing", title: l.title } : null);
  if (loading) return <Spinner />;
  if (error || !l) return <ErrorNote>{error ?? "Annonsen finns inte"}</ErrorNote>;
  return <Studio l={l} />;
}

function Studio({ l }: { l: any }) {
  const { repo, ctx } = useApp();
  const can = useCan();
  const run = useCommand();
  const toast = useToast();
  const [pkgs, setPkgs] = useState<Record<string, ChannelPackage> | null>(null);
  const [price, setPrice] = useState<{ price: number | null; rationale: string } | null>(null);
  const [local, setLocal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState(false);
  const [close, setClose] = useState<any>(null);
  const channelCodes = (l.channels ?? []).map((c: any) => c.channel);
  const codes = (ctx?.codes.channel ?? []).filter((c) => channelCodes.includes(c.code));
  const open = !["completed", "archived", "withdrawn"].includes(l.status);

  async function generate() {
    setBusy(true);
    try {
      const r = await listingPackages(repo, l.id, codes);
      setPkgs(r.packages);
      setPrice(r.price);
      setLocal(r.local);
    } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  }
  useEffect(() => { if (open && l.channels.some((c: any) => !c.body)) generate(); }, [l.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader kicker={`${LISTING_TYPES[l.type]} · annons`} title={l.title}
        sub={<span className="flex flex-wrap items-center gap-2"><Stamp tone={statusTone(null, l.status)}>{l.status_label}</Stamp>
          {l.price ? <span>{kr(l.price)}{l.quantity > 1 ? "/st" : ""}</span> : null}
          {l.object && <Link to={`/objekt/${l.object.id}`}>{l.object.label}</Link>}
          {l.need && <Link to={l.need.route ?? "#"}>{l.need.title}</Link>}</span>} />
      <Gallery media={l.media?.length ? l.media : l.object?.media ?? []} />

      {open && can("SetListingStatus") && (
        <div className="my-3 flex flex-wrap gap-2">
          {(l.next ?? []).filter((n: any) => n.to !== "completed").map((n: any) => (
            <BusyButton key={n.to} className={["withdrawn", "archived"].includes(n.to) ? "btn-ghost" : "btn-secondary"}
              onClick={() => run("SetListingStatus", { listing_id: l.id, status: n.to }, { success: n.label })}>{n.note ? `${n.label} (${n.note})` : n.label}</BusyButton>
          ))}
        </div>
      )}

      {open && ["sell", "exchange", "lend"].includes(l.type) && (
        <Section title="Pris">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><div className="text-2xl font-bold text-forest">{l.price ? kr(l.price) : "Inget pris satt"}</div>{l.price_rationale && <div className="text-sm text-sot-3">{l.price_rationale}</div>}</div>
              {price?.price && price.price !== Number(l.price) && can("UpdateFields") && (
                <div className="ai-field px-3 py-2">
                  <div className="flex items-center gap-2"><span className="font-semibold">Förslag: {kr(price.price)}</span><AiBadge /></div>
                  <div className="text-sm text-sot-3">{price.rationale}</div>
                  <BusyButton className="btn-secondary btn-small mt-1" onClick={() => run("UpdateFields", { id: l.id, fields: { price: price.price, price_rationale: price.rationale } }, { success: "Priset är uppdaterat" })}>Använd</BusyButton>
                </div>
              )}
            </div>
          </Card>
        </Section>
      )}

      <Section title="Kanaler" action={open && <button type="button" className="btn-ghost btn-small" disabled={busy} onClick={generate}><Sparkles size={15} /> {busy ? "Skriver …" : "Skriv om texterna"}</button>}>
        {!local && <p className="mb-2 text-sm text-sot-3">Texterna är skrivna av Claude och kontrollerade av integritetsfiltret.</p>}
        <div className="flex flex-col gap-3">
          {codes.map((c) => <ChannelCard key={c.code} code={c} listing={l} saved={l.channels.find((x: any) => x.channel === c.code)} pkg={pkgs?.[c.code] ?? null} />)}
        </div>
      </Section>

      <Section title={`Intresserade · ${l.leads.length}`} action={open && can("LogLead") && <button type="button" className="btn-ghost btn-small" onClick={() => setLead(true)}><UserPlus size={15} /> Ny intressent</button>}>
        {l.leads.length === 0 ? <Empty>Ingen har hört av sig än.</Empty> : (
          <div className="flex flex-col gap-2">
            {l.leads.map((x: any) => <LeadCard key={x.id} lead={x} listing={l} onClose={() => setClose(x)} />)}
          </div>
        )}
      </Section>

      <Section title="Tidslinje"><Timeline events={l.timeline ?? []} hideLink={l.id} /></Section>
      <LogLeadSheet open={lead} onClose={() => setLead(false)} listingId={l.id} />
      {close && <CloseDealSheet lead={close} listing={l} onClose={() => setClose(null)} />}
    </div>
  );
}

function ChannelCard({ code, listing, saved, pkg }: { code: any; listing: any; saved: any; pkg: ChannelPackage | null }) {
  const { repo } = useApp();
  const can = useCan();
  const run = useCommand();
  const toast = useToast();
  const adapter = adapterFromCode(code);
  const [title, setTitle] = useState(saved?.title ?? pkg?.title ?? listing.title);
  const [body, setBody] = useState(saved?.body ?? pkg?.body ?? "");
  const [url, setUrl] = useState(saved?.external_url ?? "");
  const [posting, setPosting] = useState(false);
  useEffect(() => { if (pkg && !saved?.body) { setTitle(pkg.title); setBody(pkg.body); } }, [pkg]); // eslint-disable-line react-hooks/exhaustive-deps
  const media = (listing.media?.length ? listing.media : listing.object?.media ?? []).filter((m: any) => m.share_path).slice(0, adapter.max_images);
  const dirty = title !== (saved?.title ?? "") || body !== (saved?.body ?? "");
  const posted = saved?.status === "posted";

  async function share() {
    if (dirty && can("SaveChannelPost")) await run("SaveChannelPost", { listing_id: listing.id, channel_code: code.code, title, body, media_ids: media.map((m: any) => m.id) });
    const urls = (await Promise.all(media.map((m: any) => repo.mediaUrl(m.share_path)))).filter(Boolean) as string[];
    const r = await shareContent({ title, text: `${title}\n\n${body}`, urls });
    toast(needsPaste(adapter) ? "Texten är kopierad – klistra in den i inlägget" : r.copied ? "Texten är kopierad" : "Delat", "info");
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-dashed border-lera px-4 py-2.5">
        <h3 className="text-lg">{code.label}</h3>
        {posted ? <Stamp tone="ok">Ute {saved.posted_at ? d(saved.posted_at) : ""}</Stamp> : saved?.status === "removed" ? <Stamp>Nedtagen</Stamp> : <Stamp tone="warn">Inte ute</Stamp>}
      </div>
      <div className="px-4 py-3">
        <TextField label={`Rubrik${adapter.title_max_length ? ` (högst ${adapter.title_max_length} tecken)` : ""}`} value={title} onChange={setTitle} />
        <TextArea label="Text" value={body} onChange={setBody} rows={6} />
        {(pkg?.warnings ?? []).map((w, i) => <div key={i} className="mb-2 text-sm text-falu">{w}</div>)}
        <div className="mb-2 text-sm text-sot-3">{media.length === 1 ? "1 bild" : `${media.length} bilder`} (utan platsdata){pkg?.category ? ` · kategori: ${pkg.category}` : ""}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary btn-small" onClick={share}><Share2 size={15} /> Dela</button>
          <button type="button" className="btn-secondary btn-small" onClick={async () => { await copyText(`${title}\n\n${body}`); toast("Texten är kopierad"); }}><Copy size={15} /> Kopiera text</button>
          <button type="button" className="btn-ghost btn-small" title="Instruktion till Claude i Chrome – du loggar in och trycker på publicera själv"
            onClick={async () => { await copyText(browserAgentInstruction({ channel: code.code, title, body, media_ids: [], category: pkg?.category, warnings: [] }, code.label)); toast("Instruktionen är kopierad – klistra in den i Claude i Chrome"); }}>
            <Bot size={15} /> Låt Claude lägga upp</button>
          {dirty && can("SaveChannelPost") && <BusyButton className="btn-ghost btn-small" onClick={() => run("SaveChannelPost", { listing_id: listing.id, channel_code: code.code, title, body, media_ids: media.map((m: any) => m.id) }, { success: "Sparat" })}>Spara</BusyButton>}
        </div>
        {can("MarkChannelPosted") && (
          <div className="mt-3 border-t border-dashed border-lera pt-3">
            {posted ? (
              <div className="flex flex-wrap items-center gap-2">
                {saved.external_url && <a href={saved.external_url} target="_blank" rel="noreferrer" className="btn-ghost btn-small"><ExternalLink size={15} /> Öppna annonsen</a>}
                <BusyButton className="btn-ghost btn-small" onClick={() => run("MarkChannelRemoved", { listing_id: listing.id, channel_code: code.code }, { success: "Markerad som nedtagen" })}>Har tagit ner den</BusyButton>
              </div>
            ) : posting ? (
              <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run("MarkChannelPosted", { listing_id: listing.id, channel_code: code.code, external_url: strOrNull(url), publish_mode: "manual" }, { success: `Ute på ${code.label}` })) setPosting(false); }}>
                <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Annonsens adress (valfritt)" aria-label="Annonsens adress" />
                <button type="submit" className="btn-done btn-small">Spara</button>
              </form>
            ) : <button type="button" className="btn-secondary btn-small" onClick={() => setPosting(true)}><Check size={15} /> Jag har lagt upp den</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function LeadCard({ lead, listing, onClose }: { lead: any; listing: any; onClose: () => void }) {
  const can = useCan();
  const run = useCommand();
  const toast = useToast();
  const [viewing, setViewing] = useState<string | null>(null);
  const first = lead.person?.display_name?.split(" ")[0];
  const draftKind = lead.status === "new" ? "viewing" : lead.status === "agreed" ? "agreed" : "reply";
  const closed = ["completed", "lost", "rejected", "no_show"].includes(lead.status);
  return (
    <Card className="!py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{lead.queue_position}. {lead.person ? <Link to={`/person/${lead.person.id}`}>{lead.person.display_name}</Link> : "Okänd"}{lead.bid ? ` · bud ${kr(lead.bid)}` : ""}</div>
          {lead.message && <p className="text-sot-2">"{lead.message}"</p>}
          <div className="text-sm text-sot-3">{d(lead.created_at)}{lead.viewing_at ? ` · visning ${dt(lead.viewing_at)}` : ""}</div>
        </div>
        <Stamp tone={statusTone(null, lead.status)}>{lead.status_label}</Stamp>
      </div>
      {!closed && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className="btn-secondary btn-small" onClick={async () => { await copyText(leadReplyDraft(draftKind, listing.title, first)); toast("Svaret är kopierat – klistra in det i chatten"); }}><Copy size={14} /> Svarsutkast</button>
          {can("SetLeadStatus") && lead.next.filter((n: any) => n.to !== "completed").map((n: any) => (
            n.to === "viewing_booked"
              ? <button key={n.to} type="button" className="btn-ghost btn-small" onClick={() => setViewing("")}>{n.label}</button>
              : <BusyButton key={n.to} className="btn-ghost btn-small" onClick={() => run("SetLeadStatus", { lead_id: lead.id, status: n.to }, { success: n.label })}>{n.label}</BusyButton>
          ))}
          {can("CompleteDisposal") && ["agreed", "viewing_booked", "replied"].includes(lead.status) && listing.object && (
            <button type="button" className="btn-done btn-small" onClick={onClose}>Affären är klar</button>
          )}
        </div>
      )}
      {viewing !== null && (
        <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run("SetLeadStatus", { lead_id: lead.id, status: "viewing_booked", viewing_at: viewing ? new Date(viewing).toISOString() : null }, { success: "Visningen är bokad" })) setViewing(null); }}>
          <input className="input" type="datetime-local" value={viewing} onChange={(e) => setViewing(e.target.value)} aria-label="När är visningen?" />
          <button type="submit" className="btn-secondary btn-small">Boka</button>
        </form>
      )}
    </Card>
  );
}

function LogLeadSheet({ open, onClose, listingId }: { open: boolean; onClose: () => void; listingId: string }) {
  const run = useCommand();
  const [who, setWho] = useState<PersonChoice | null>(null);
  const [msg, setMsg] = useState("");
  const [bid, setBid] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Någon har hört av sig"
      footer={<BusyButton disabled={!who} onClick={async () => {
        const r = await run("LogLead", { listing_id: listingId, person_id: who?.id ?? null, person_name: who && !who.id ? who.name : null, message: strOrNull(msg), bid: numOrNull(bid) }, { success: "Intressenten står i kön" });
        if (r) { setWho(null); setMsg(""); setBid(""); onClose(); }
      }}>Spara</BusyButton>}>
      <PersonPicker label="Vem?" value={who} onChange={setWho} />
      <TextArea label="Vad skrev hen?" value={msg} onChange={setMsg} rows={2} />
      <NumberField label="Bud (valfritt)" value={bid} onChange={setBid} unit="kr" />
    </Sheet>
  );
}

function CloseDealSheet({ lead, listing, onClose }: { lead: any; listing: any; onClose: () => void }) {
  const run = useCommand();
  const defaultType = listing.type === "give" ? "donated" : listing.type === "exchange" ? "exchanged" : listing.type === "lend" ? "lent" : "sold";
  const [type, setType] = useState(defaultType);
  const [price, setPrice] = useState(String(lead.bid ?? listing.price ?? ""));
  const [qty, setQty] = useState(String(listing.quantity ?? ""));
  return (
    <Sheet open onClose={onClose} title={`Klart med ${lead.person?.display_name ?? "köparen"}`}
      footer={<BusyButton className="btn-done" onClick={async () => {
        const r = await run("CompleteDisposal", { object_id: listing.object.id, type, listing_id: listing.id, lead_id: lead.id, counterpart_person_id: lead.person?.id ?? null,
          quantity: numOrNull(qty), price: type === "sold" ? numOrNull(price) : null }, { success: "Affären är klar – de andra i kön kan få ett vänligt nej" });
        if (r) onClose();
      }}>Klart</BusyButton>}>
      <Select label="Hur?" value={type} onChange={setType} options={Object.entries(DISPOSAL_TYPES).filter(([k]) => k !== "discarded").map(([value, label]) => ({ value, label }))} />
      {type === "sold" && <NumberField label="Pris totalt" value={price} onChange={setPrice} unit="kr" />}
      {listing.object?.batch && <NumberField label="Antal" value={qty} onChange={setQty} unit={listing.object.batch.unit} />}
    </Sheet>
  );
}

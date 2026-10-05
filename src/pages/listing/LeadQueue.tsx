import { ArrowRight, Copy, Handshake, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp, useData } from "../../app/AppContext";
import { LEAD_STATUS_LABEL } from "../../domain/labels";
import { nextLeadStep } from "../../domain/stateMachine";
import type { Lead, Listing, Person } from "../../domain/types";
import { adaptersFor } from "../../../supabase/functions/_shared/channels";
import { draftLeadReply, type ReplyStage, type SafeListingContext } from "../../../supabase/functions/_shared/listingPackage";
import { Section, formatDate } from "../../ui/bits";

const ACTIVE = ["new", "replied", "viewing_booked", "agreed"];

/** Intressentkö (FR-026): köordning, koppling till person i CRM, svarsutkast. */
export function LeadQueue({ listing, persons, context, reply: [reply, setReply], onChanged }: {
  listing: Listing; persons: Person[]; context: SafeListingContext | null;
  reply: [{ lead: string; text: string } | null, (r: { lead: string; text: string } | null) => void];
  onChanged: (msg?: string) => Promise<void>;
}) {
  const { repo, toast } = useApp();
  const { data: leads, reload } = useData((r) => r.leads(listing.id), [listing.id, listing.updated_at]);
  const [adding, setAdding] = useState(false);
  const closed = listing.status === "completed" || listing.status === "withdrawn" || listing.status === "archived";
  const hasAgreed = (leads ?? []).some((l) => l.status === "agreed");

  async function act(fn: () => Promise<void>, msg: string) {
    try {
      await fn();
      reload();
      await onChanged(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  function draft(lead: Lead, stage: ReplyStage) {
    if (!context) return;
    const name = persons.find((p) => p.id === lead.person_id)?.name.split(" ")[0] ?? null;
    setReply({ lead: lead.id, text: draftLeadReply(context, stage, name) });
  }

  const active = (leads ?? []).filter((l) => ACTIVE.includes(l.status));
  const nextInLine = (released: Lead) => active.find((l) => l.id !== released.id && l.queue_position > released.queue_position && l.status !== "agreed");

  return (
    <Section title="Intressenter" action={!closed ? <button className="btn-ghost text-sm" onClick={() => setAdding((s) => !s)}><Plus size={16} aria-hidden="true" /> Ny intressent</button> : undefined}>
      {adding && <AddLead listing={listing} persons={persons} onDone={async () => { setAdding(false); reload(); await onChanged("Intressenten står i kön"); }} />}
      {leads && leads.length === 0 && !adding && <p className="text-sm text-sot-3">Ingen har hört av sig ännu. När någon skriver: lägg in dem här, så håller appen ordning på kön.</p>}
      <ol className="space-y-3">
        {(leads ?? []).map((lead) => {
          const person = persons.find((p) => p.id === lead.person_id);
          const step = nextLeadStep(lead.status);
          const isActive = ACTIVE.includes(lead.status);
          return (
            <li key={lead.id} className={`card p-4 ${isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-kalk-3 text-sm font-bold">{lead.queue_position}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {person ? <Link to={`/person/${person.id}`} className="hover:underline">{person.name}</Link> : "Okänd"}
                    {lead.bid != null && <span className="ml-2 text-sm font-normal text-sot-2">bud {lead.bid.toLocaleString("sv-SE")} kr</span>}
                  </p>
                  <p className="text-[13px] text-sot-3">{[adaptersFor(listing.type).find((a) => a.id === lead.channel)?.name ?? lead.channel, formatDate(lead.created_at)].filter(Boolean).join(" · ")}</p>
                  {lead.message && <p className="mt-1 text-sm text-sot-2">”{lead.message}”</p>}
                </div>
                <span className={`stamp ${lead.status === "new" ? "border-falu text-falu" : lead.status === "agreed" ? "border-linolja text-linolja" : "border-sot-2 text-sot-2"}`}>{LEAD_STATUS_LABEL[lead.status]}</span>
              </div>

              {isActive && !closed && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {lead.status !== "agreed" && context && (
                    <select className="input w-auto py-1.5 text-sm" value="" onChange={(e) => e.target.value && draft(lead, e.target.value as ReplyStage)} aria-label="Svarsutkast">
                      <option value="">Svarsutkast …</option>
                      <option value="available">Finns kvar</option>
                      <option value="booking">Bekräfta visning</option>
                      {hasAgreed && <option value="taken">Redan bortlovat</option>}
                    </select>
                  )}
                  {step && <button className="btn-secondary text-sm" onClick={() => act(() => repo.setLeadStatus(lead.id, step.to), LEAD_STATUS_LABEL[step.to])}>{step.label}</button>}
                  {lead.status !== "agreed" && !hasAgreed && (
                    <button className="btn-moss text-sm" onClick={() => act(() => repo.agreeLead(lead.id), "Överens – reserverat för köparen")}><Handshake size={16} aria-hidden="true" /> Vi är överens</button>
                  )}
                  {lead.status === "agreed" && context && <button className="btn-ghost text-sm" onClick={() => draft(lead, "agreed")}>Svarsutkast: bekräfta</button>}
                  <select className="input w-auto py-1.5 text-sm" value="" aria-label="Avbryt" onChange={async (e) => {
                    const to = e.target.value as "no_show" | "lost" | "rejected";
                    if (!to) return;
                    const next = nextInLine(lead);
                    await act(() => repo.releaseLead(lead.id, to), LEAD_STATUS_LABEL[to]);
                    if (next && context) draft(next, "next_in_line");
                  }}>
                    <option value="">Föll bort …</option>
                    {(lead.status === "viewing_booked" || lead.status === "agreed") && <option value="no_show">Kom inte</option>}
                    <option value="lost">Hörde inte av sig</option>
                    {lead.status !== "agreed" && <option value="rejected">Nej tack från mig</option>}
                  </select>
                </div>
              )}

              {reply?.lead === lead.id && !closed && (
                <div className="mt-3 rounded-md border border-dashed border-lera p-3">
                  <textarea className="input mb-2 text-[15px]" rows={3} value={reply.text} onChange={(e) => setReply({ ...reply, text: e.target.value })} aria-label="Svar" />
                  <button className="btn-secondary text-sm" onClick={async () => { await navigator.clipboard?.writeText(reply.text).catch(() => undefined); toast("Svaret är kopierat"); setReply(null); }}>
                    <Copy size={16} aria-hidden="true" /> Kopiera svaret
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {hasAgreed && !closed && <p className="mt-3 flex items-center gap-1.5 text-sm text-sot-2"><ArrowRight size={14} aria-hidden="true" /> Avsluta affären högst upp när saken är hämtad.</p>}
    </Section>
  );
}

function AddLead({ listing, persons, onDone }: { listing: Listing; persons: Person[]; onDone: () => Promise<void> }) {
  const { repo, toast } = useApp();
  const channels = adaptersFor(listing.type);
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [channel, setChannel] = useState(channels[0]?.id ?? "annat");
  const [message, setMessage] = useState("");
  const [bid, setBid] = useState("");
  const matches = query.length >= 2 && !personId ? persons.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5) : [];

  async function save() {
    try {
      let pid = personId;
      if (!pid) {
        const p = await repo.createPerson({ name: query.trim(), locality: "", roles: [], how_we_met: `Svarade på annonsen ”${listing.title}”`, organization_id: null, contact: "", notes: "" });
        pid = p.id;
      }
      await repo.addLead({ listing_id: listing.id, person_id: pid, channel, message: message.trim(), bid: bid ? Number(bid) : null });
      await onDone();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="card mb-4 space-y-3 p-4">
      <div className="relative">
        <label className="field-label" htmlFor="ln">Vem?</label>
        <div className="flex items-center gap-2">
          <UserRound size={18} className="text-sot-3" aria-hidden="true" />
          <input id="ln" className="input" value={query} onChange={(e) => { setQuery(e.target.value); setPersonId(null); }} placeholder="Namn – befintlig person eller ny" />
        </div>
        {matches.length > 0 && (
          <ul className="card absolute inset-x-0 z-10 mt-1 divide-y divide-dashed divide-lera-light">
            {matches.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left hover:bg-kalk-2" onClick={() => { setPersonId(p.id); setQuery(p.name); }}>{p.name}{p.locality ? <span className="text-sot-3"> · {p.locality}</span> : null}</button></li>)}
          </ul>
        )}
        {query.trim().length >= 2 && !personId && <p className="mt-1 text-[12px] text-sot-3">Skapas som ny person i CRM:et.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="lc">Kanal</label>
          <select id="lc" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="annat">Annat (sms, telefon …)</option>
          </select>
        </div>
        {listing.type === "sell" && (
          <div>
            <label className="field-label" htmlFor="lb">Bud (kr)</label>
            <input id="lb" type="number" min={0} className="input" value={bid} onChange={(e) => setBid(e.target.value)} />
          </div>
        )}
      </div>
      <div>
        <label className="field-label" htmlFor="lm">Meddelande (privat)</label>
        <textarea id="lm" rows={2} className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Klistra in eller diktera vad de skrev" />
      </div>
      <button className="btn-primary w-full" disabled={query.trim().length < 2} onClick={save}>Lägg i kön</button>
    </div>
  );
}

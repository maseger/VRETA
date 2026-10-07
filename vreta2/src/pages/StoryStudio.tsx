// Berätta-studion: välj vad som ska berättas, varför och var. Integritetsfiltret bygger den rensade kontexten
// och visar vad som togs bort; utkasten är förslag som en människa godkänner (R1.1 S9, 12.1).
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Copy, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { draftStory, type StoryDrafts } from "../services/ai";
import { copyText } from "../services/share";
import { newKey } from "../data/repo";
import { AiBadge, Card, Chip, ErrorNote, PageHeader, Section, Stamp } from "../ui/base";
import { MediaImg } from "../ui/media";
import { TextArea } from "../ui/fields";
import { BusyButton } from "../ui/sheet";
import { useToast } from "../app/toast";

type Source = { id: string; title: string; type_label?: string };

export default function StoryStudio() {
  const [sp] = useSearchParams();
  const { repo, ctx } = useApp();
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const toast = useToast();
  const initialIds = [sp.get("kalla"), sp.get("handelse")].filter(Boolean) as string[];
  const [sources, setSources] = useState<Source[]>([]);
  const [personIds, setPersonIds] = useState<string[]>(sp.get("person") ? [sp.get("person")!] : []);
  const [goal, setGoal] = useState(sp.get("mal") ?? (sp.get("handelse") ? "show_what_happened" : "story"));
  const social = (ctx?.codes.channel ?? []).filter((c) => c.attributes?.kind === "social" || c.code === "private_message");
  const [channels, setChannels] = useState<string[]>(sp.get("kanal") ? [sp.get("kanal")!] : ["facebook", "instagram"]);
  const [tone, setTone] = useState<"warm" | "plain" | "short">("warm");
  const [result, setResult] = useState<StoryDrafts | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<string[]>([]);
  const [q, setQ] = useState("");

  // Förvalda källor från länken (sak, händelse)
  useEffect(() => {
    Promise.all(initialIds.map((id) => repo.query<any>("q_entity", { id }).catch(() => null)))
      .then((refs) => setSources(refs.filter(Boolean).map((r) => ({ id: r.id, title: r.title, type_label: r.type_label }))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: hits } = useQuery<any[]>(q.trim().length >= 2 ? "q_search" : null, { q: q.trim(), limit: 8 });
  const { data: raw } = useQuery<any>(sources.length ? "q_story_context" : null, { source_ids: sources.map((s) => s.id), person_ids: personIds });
  const people: any[] = raw?.people ?? [];
  const allowedMedia = useMemo(() => (raw?.media ?? []).filter((m: any) => result?.context.media_ids.includes(m.id)), [raw, result]);

  async function write() {
    const chosen = social.filter((c) => channels.includes(c.code));
    const r = await draftStory(repo, { source_ids: sources.map((s) => s.id), person_ids: personIds, goal, channels: chosen, tone });
    setResult(r);
    setDrafts(r.drafts);
    setMedia(r.context.media_ids.slice(0, 4));
  }

  async function save() {
    if (!result) return;
    const id = newKey();
    const title = sources.map((s) => s.title).join(" · ").slice(0, 120) || "Berättelse";
    const c = await run("CreateContent", { id, source_ids: sources.map((s) => s.id), goal_code: goal, title, person_ids: personIds, channels });
    if (!c) return;
    for (const ch of channels) {
      await run("SaveChannelVariant", { content_id: id, channel_code: ch, body: drafts[ch] ?? "", media_ids: media, tone,
        removed_by_guard: result.removed, warnings: result.warnings, person_ids: personIds }, { silent: false });
    }
    await run("SetContentStatus", { content_id: id, status: "review" });
    toast("Utkastet är sparat – granska och godkänn");
    nav(`/berattelse/${id}`);
  }

  if (!can("CreateContent")) return <div><PageHeader title="Berätta" /><ErrorNote>Bara ägare och medhjälpare kan berätta.</ErrorNote></div>;

  return (
    <div>
      <PageHeader kicker="Berätta" title="Vad vill du berätta?" sub="VRETA skriver ett utkast utan namn, adresser eller priser som inte får delas." />

      <Section title="Om vad">
        <Card>
          <div className="mb-2 flex flex-wrap gap-2">
            {sources.map((s) => (
              <span key={s.id} className="chip chip-on">{s.title}<button type="button" aria-label={`Ta bort ${s.title}`} onClick={() => { setSources((x) => x.filter((y) => y.id !== s.id)); setResult(null); }}><X size={14} /></button></span>
            ))}
            {!sources.length && <span className="text-sot-3">Välj en sak, ett projekt, en plats eller en händelse.</span>}
          </div>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-sot-3" aria-hidden />
            <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök sak, projekt, plats …" aria-label="Sök källa" />
          </div>
          {hits && q.trim().length >= 2 && (
            <ul className="mt-1 rounded-lg border border-lera">
              {hits.filter((h) => !sources.some((s) => s.id === h.id)).slice(0, 6).map((h) => (
                <li key={h.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-kalk-2" onClick={() => { setSources((x) => [...x, { id: h.id, title: h.title, type_label: h.type_label }]); setQ(""); setResult(null); }}>
                  {h.title} <span className="text-sm text-sot-3">{h.type_label}</span></button></li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title="Varför">
        <div className="flex flex-wrap gap-2">{(ctx?.codes.content_goal ?? []).map((g) => <Chip key={g.code} on={goal === g.code} onClick={() => { setGoal(g.code); setResult(null); }}>{g.label}</Chip>)}</div>
      </Section>

      <Section title="Var">
        <div className="flex flex-wrap gap-2">
          {social.map((c) => <Chip key={c.code} on={channels.includes(c.code)} onClick={() => { setChannels((x) => x.includes(c.code) ? x.filter((y) => y !== c.code) : [...x, c.code]); setResult(null); }}>{c.label}</Chip>)}
        </div>
      </Section>

      {people.length > 0 && (
        <Section title="Människor i berättelsen">
          <Card>
            {people.map((p) => {
              const c = p.consent?.name ?? "ask";
              return (
                <label key={p.id} className="flex min-h-[44px] items-center gap-3">
                  <input type="checkbox" className="h-5 w-5 accent-falu" checked={personIds.includes(p.id)} onChange={(e) => { setPersonIds((x) => e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)); setResult(null); }} />
                  <span className="flex-1">{p.display_name}</span>
                  <Stamp tone={c === "yes" ? "ok" : c === "no" ? "falu" : "warn"}>{c === "yes" ? "Får nämnas" : c === "no" ? "Nämns inte" : "Fråga först"}</Stamp>
                </label>
              );
            })}
          </Card>
        </Section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-sot-3">Ton:</span>
        {(["warm", "plain", "short"] as const).map((t) => <Chip key={t} on={tone === t} onClick={() => { setTone(t); setResult(null); }}>{{ warm: "Varm", plain: "Saklig", short: "Kort" }[t]}</Chip>)}
      </div>

      <BusyButton className="btn-primary mb-6 w-full" disabled={!sources.length || !channels.length} onClick={write}><Sparkles size={18} /> {result ? "Skriv nytt utkast" : "Skriv utkast"}</BusyButton>

      {result && !result.allowed && (
        <div className="mb-4">
          <ErrorNote>Det går inte att berätta det här: {result.blocked_reason}</ErrorNote>
          {can("SetVisibility") && (raw?.sources ?? []).some((x: any) => x.visibility === "internal") && channels.some((c) => c !== "private_message") && (
            <BusyButton className="btn-secondary mt-2" onClick={async () => {
              for (const x of (raw?.sources ?? []).filter((y: any) => y.visibility === "internal")) await run("SetVisibility", { id: x.id, visibility: "shareable" });
              toast("Nu är källorna delbara");
              await write();
            }}>Gör delbart och skriv igen</BusyButton>
          )}
        </div>
      )}
      {result?.allowed && (
        <>
          <GuardPanel r={result} />
          {allowedMedia.length > 0 && (
            <Section title="Bilder">
              <div className="flex flex-wrap gap-2">
                {allowedMedia.map((m: any) => (
                  <button key={m.id} type="button" aria-pressed={media.includes(m.id)} onClick={() => setMedia((x) => x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id])}
                    className={`overflow-hidden rounded-lg border-4 ${media.includes(m.id) ? "border-linolja" : "border-transparent opacity-60"}`}>
                    <MediaImg m={m} className="h-24 w-24" />
                  </button>
                ))}
              </div>
            </Section>
          )}
          {channels.map((ch) => (
            <Section key={ch} title={social.find((c) => c.code === ch)?.label ?? ch} action={<AiBadge />}>
              <div className="ai-field p-2"><TextArea label="Utkast" value={drafts[ch] ?? ""} onChange={(v) => setDrafts((x) => ({ ...x, [ch]: v }))} rows={7} /></div>
            </Section>
          ))}
          <BusyButton className="btn-done w-full" onClick={save}>Spara och granska</BusyButton>
        </>
      )}
    </div>
  );
}

export function GuardPanel({ r }: { r: { removed: { kind: string; text: string }[]; warnings: string[]; ask_messages: { person_id: string; name: string; message: string }[] } }) {
  const toast = useToast();
  const KIND: Record<string, string> = { name: "Namn", address: "Adress", phone: "Telefon", email: "Mejl", price: "Pris", locality: "Hemort", image: "Bild", quote: "Citat", contribution: "Bidrag", storage_location: "Lagerplats" };
  if (!r.removed.length && !r.warnings.length && !r.ask_messages.length) {
    return <div className="mb-4 flex items-center gap-2 rounded-lg bg-linolja-pale/50 px-3 py-2 text-linolja"><ShieldCheck size={18} /> Integritetsfiltret hittade inget att ta bort.</div>;
  }
  return (
    <Card className="mb-4">
      <h3 className="mb-2 flex items-center gap-2 text-lg"><ShieldCheck size={18} className="text-linolja" /> Integritetsfiltret</h3>
      {r.removed.length > 0 && (<>
        <div className="kicker mb-1">Togs bort</div>
        <ul className="mb-3 text-sot-2">{dedupeRemoved(r.removed).map((x, i) => <li key={i}>– {KIND[x.kind] ?? x.kind}: {x.text}</li>)}</ul>
      </>)}
      {r.warnings.map((w, i) => <div key={i} className="mb-1 text-ockra">⚠ {w}</div>)}
      {r.ask_messages.map((a) => (
        <div key={a.person_id} className="mt-2 rounded-lg border border-dashed border-ockra p-3">
          <div className="mb-1 font-semibold">Fråga {a.name}</div>
          <p className="mb-2 text-sot-2">{a.message}</p>
          <button type="button" className="btn-secondary btn-small" onClick={async () => { await copyText(a.message); toast("Frågan är kopierad – skicka den till " + a.name.split(" ")[0]); }}><Copy size={14} /> Kopiera frågan</button>
        </div>
      ))}
    </Card>
  );
}

// "i Ockelbo", "från Ockelbo" och "Ockelbo (givarens hemort)" visas som en rad
function dedupeRemoved(items: { kind: string; text: string }[]) {
  const seen = new Map<string, { kind: string; text: string }>();
  for (const x of items) {
    const core = x.kind === "locality" ? x.text.replace(/\s*\(.*\)$/, "").replace(/^(i|från|på|utanför)\s+/i, "").trim() : x.text;
    const key = `${x.kind}:${core.toLocaleLowerCase("sv")}`;
    if (!seen.has(key)) seen.set(key, { kind: x.kind, text: core });
  }
  return [...seen.values()];
}

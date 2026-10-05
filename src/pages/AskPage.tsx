import { ArrowUp, Check, ExternalLink, History, Loader2, MessageCircle, Mic, MicOff, Plus, Radio, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp, useData } from "../app/AppContext";
import type { AskMessage, AskThread } from "../domain/types";
import { ask, executeAction } from "../services/askVreta";
import { canListen, canSpeak, isNo, isStop, isYes, listenOnce, speak, stopListening, stopSpeaking } from "../services/speech";
import { formatDate } from "../ui/bits";
import { useDictation } from "../ui/useDictation";
import type { Screen, SourceCard } from "../../supabase/functions/_shared/knowledge";

const SUGGESTIONS = [
  "Vad behöver jag följa upp idag?",
  "Vad har legat i lager längst?",
  "Vilka har jag inte tackat?",
  "Vad kan bli bra innehåll denna vecka?",
  "Hur mycket har jag köpt och sålt för i år?",
];

const SCREEN_TYPES: [RegExp, string][] = [
  [/^\/objekt\/([^/]+)/, "object"],
  [/^\/person\/([^/]+)/, "person"],
  [/^\/zon\/([^/]+)/, "zone"],
  [/^\/annons\/([^/]+)/, "listing"],
  [/^\/hamtning\/([^/]+)/, "pickup"],
  [/^\/lager\/([^/]+)/, "storage"],
];

/** S11 Fråga Vreta: chatboten med källkort, åtgärder med bekräftelse och röstläge (11.6, 7.5). */
export function AskPage() {
  const { repo, profile, refresh, toast } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const from = params.get("fran") ?? "";
  const { data: threads, reload: reloadThreads } = useData((r) => r.askThreads());
  const { data: screen } = useData(async (r): Promise<Screen> => {
    for (const [re, type] of SCREEN_TYPES) {
      const m = from.match(re);
      if (!m || m[1] === "ny") continue;
      const id = m[1];
      const title =
        type === "object" ? (await r.object(id))?.title
        : type === "person" ? (await r.person(id))?.name
        : type === "zone" ? (await r.zones()).find((z) => z.id === id)?.name
        : type === "listing" ? (await r.listing(id))?.title
        : type === "pickup" ? (await r.pickup(id))?.title
        : (await r.storageLocations()).find((l) => l.id === id)?.name;
      return { type, id, title };
    }
    return { type: null, id: null };
  }, [from]);

  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [voice, setVoice] = useState(false);
  const voiceRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Röstläget kör i en egen loop och behöver alltid senaste meddelandena
  const latest = useRef<AskMessage[]>([]);
  latest.current = messages;
  const append = useCallback((t: string) => setInput((s) => (s ? `${s} ${t}` : t)), []);
  const dictation = useDictation(append);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages.length, busy]);
  useEffect(() => () => { voiceRef.current = false; stopListening(); stopSpeaking(); }, []);

  async function persist(next: AskMessage[]) {
    try {
      await repo.saveAskThread({ id: threadId, title: next.find((m) => m.role === "user")?.text.slice(0, 60) ?? "Fråga", messages: next });
      reloadThreads();
    } catch {
      /* trådar är en bekvämlighet – svaret visas ändå */
    }
  }

  async function send(question: string): Promise<{ reply: AskMessage; index: number } | null> {
    const q = question.trim();
    if (!q) return null;
    setInput("");
    const now = new Date().toISOString();
    const history = latest.current;
    const withQ = [...history, { role: "user" as const, text: q, at: now }];
    latest.current = withQ;
    setMessages(withQ);
    setBusy(true);
    try {
      const a = await ask(repo, profile!.role, q, screen ?? { type: null, id: null }, history);
      const reply: AskMessage = { role: "assistant", text: a.text, cards: a.cards, action: a.action, action_state: a.action ? "pending" : undefined, general: a.general, at: new Date().toISOString() };
      const next = [...withQ, reply];
      latest.current = next;
      setMessages(next);
      await persist(next);
      return { reply, index: withQ.length };
    } catch (e) {
      const reply: AskMessage = { role: "assistant", text: `Något gick fel: ${(e as Error).message}`, at: new Date().toISOString() };
      setMessages([...withQ, reply]);
      return { reply, index: withQ.length };
    } finally {
      setBusy(false);
    }
  }

  async function resolveAction(index: number, accept: boolean): Promise<string> {
    const action = latest.current[index]?.action;
    if (!action) return "";
    let note = "";
    if (accept) {
      if (action.kind === "navigate") {
        navigate(action.href);
        return "";
      }
      try {
        note = await executeAction(repo, action);
        await refresh();
        toast(note);
      } catch (e) {
        note = (e as Error).message;
        toast(note);
      }
    }
    setMessages((ms) => {
      const next = ms.map((m, i) => (i === index ? { ...m, action_state: accept ? ("done" as const) : ("cancelled" as const) } : m));
      void persist(next);
      return next;
    });
    return accept ? note : "Okej, jag lät bli.";
  }

  // Röstläge: lyssna → svara med tal → bekräfta åtgärder med "ja" (aldrig publicering eller samtycke)
  async function voiceLoop() {
    await speak("Röstläge. Fråga på.");
    while (voiceRef.current) {
      const heard = await listenOnce(10000);
      if (!voiceRef.current) break;
      if (!heard) continue;
      if (isStop(heard)) break;
      const res = await send(heard);
      if (!res || !voiceRef.current) continue;
      await speak(res.reply.text.replace(/^Allmänt råd:/, "Allmänt råd."));
      if (res.reply.action && res.reply.action.kind !== "navigate") {
        await speak("Säg ja eller nej.");
        const answer = await listenOnce(8000);
        if (answer && isYes(answer)) await speak((await resolveAction(res.index, true)) || "Klart.");
        else if (answer && isNo(answer)) await speak(await resolveAction(res.index, false));
        else await speak("Jag väntar med det. Du kan bekräfta på skärmen.");
      }
    }
    voiceRef.current = false;
    setVoice(false);
    stopSpeaking();
  }
  function toggleVoice() {
    if (voice) {
      voiceRef.current = false;
      stopListening();
      stopSpeaking();
      setVoice(false);
      return;
    }
    voiceRef.current = true;
    setVoice(true);
    void voiceLoop();
  }

  function openThread(t: AskThread) {
    setThreadId(t.id);
    latest.current = t.messages;
    setMessages(t.messages);
    setShowThreads(false);
  }
  function newThread() {
    setThreadId(crypto.randomUUID());
    latest.current = [];
    setMessages([]);
    setShowThreads(false);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1">Fråga Vreta</p>
          <h1>Vad undrar du?</h1>
        </div>
        <div className="flex gap-1">
          <button className="btn-ghost px-2" onClick={() => setShowThreads((s) => !s)} aria-expanded={showThreads} aria-label="Tidigare frågor"><History size={20} /></button>
          <button className="btn-ghost px-2" onClick={newThread} aria-label="Ny fråga"><Plus size={20} /></button>
        </div>
      </header>

      {showThreads && (
        <section className="card mb-4 p-2" aria-label="Tidigare frågor">
          {threads?.length ? (
            <ul className="divide-y divide-dashed divide-lera-light">
              {threads.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <button className="min-w-0 flex-1 px-2 py-2 text-left hover:bg-kalk-2" onClick={() => openThread(t)}>
                    <span className="block truncate font-medium">{t.title || "Fråga"}</span>
                    <span className="text-[12px] text-sot-3">{formatDate(t.updated_at)} · {t.messages.length} meddelanden</span>
                  </button>
                  <button className="rounded-md p-2 text-sot-3 hover:bg-kalk-2" aria-label={`Radera ${t.title}`} onClick={async () => { await repo.deleteAskThread(t.id); if (t.id === threadId) newThread(); reloadThreads(); }}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="px-2 py-2 text-sm text-sot-3">Inga sparade frågor. Trådar är privata – bara du ser dem.</p>}
        </section>
      )}

      {screen?.type && (
        <p className="mb-3 flex items-center gap-2 text-sm text-sot-2">
          <span className="rounded-full bg-kalk-3 px-3 py-1">Om: <b>{screen.title}</b></span>
          <button className="rounded-full p-1 text-sot-3 hover:bg-kalk-2" aria-label="Fråga om allt i stället" onClick={() => setParams({}, { replace: true })}><X size={14} /></button>
        </p>
      )}

      <div className="flex-1 space-y-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-3 text-sot-2">
              <MessageCircle size={28} strokeWidth={1.5} className="shrink-0 text-linolja" aria-hidden="true" />
              <p>Jag känner till allt i appen som du har behörighet att se, och svarar med källor. Jag kan också flytta saker, skapa uppgifter och öppna annons- och Berätta-studion – efter att du bekräftat.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(screen?.type === "object" ? ["Vad har hänt med den här?", ...SUGGESTIONS.slice(0, 3)] : SUGGESTIONS).map((s) => (
                <button key={s} className="chip text-left" onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-sot px-4 py-2.5 text-kalk">{m.text}</p>
        ) : (
          <div key={i} className="max-w-[95%]">
            {m.general && <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-[#8a6118]">Allmänt råd – inte fakta om Vreta</p>}
            <p className="whitespace-pre-line font-serif text-[17px] leading-relaxed text-sot">{m.text}</p>
            {!!m.cards?.length && (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="Källor">
                {m.cards.map((c) => <Card key={`${c.type}-${c.id}-${c.title}`} card={c} />)}
              </ul>
            )}
            {m.action && (
              <div className={`mt-3 rounded-md border px-3 py-2.5 ${m.action_state === "pending" ? "border-falu/50 bg-[#FBF8F1]" : "border-lera-light text-sot-3"}`}>
                <p className="mb-2 text-sm font-semibold">{m.action.label}</p>
                {m.action_state === "pending" ? (
                  <div className="flex gap-2">
                    <button className="btn-moss min-h-[40px] text-sm" onClick={() => void resolveAction(i, true)}>
                      {m.action.kind === "navigate" ? <><ExternalLink size={16} aria-hidden="true" /> Öppna</> : <><Check size={16} aria-hidden="true" /> Ja, gör det</>}
                    </button>
                    {m.action.kind !== "navigate" && <button className="btn-secondary min-h-[40px] text-sm" onClick={() => void resolveAction(i, false)}>Nej</button>}
                  </div>
                ) : <p className="text-sm">{m.action_state === "done" ? "Klart." : "Inte utfört."}</p>}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="flex items-center gap-2 text-sot-3" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Letar i Vreta …</p>}
        <div ref={endRef} />
      </div>

      <form className="sticky bottom-24 mt-6 md:bottom-6" onSubmit={(e) => { e.preventDefault(); if (!busy) void send(input); }}>
        <div className="card flex items-end gap-1 p-2">
          <label htmlFor="fraga" className="sr-only">Din fråga</label>
          <textarea id="fraga" rows={1} className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[16px] focus:outline-none" placeholder={voice ? "Röstläge – prata …" : "Fråga eller be om något …"} value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy) void send(input); } }} />
          {dictation.supported && !voice && (
            <button type="button" onClick={dictation.toggle} className={`rounded-md p-2.5 ${dictation.listening ? "bg-falu text-kalk" : "text-sot-3 hover:bg-kalk-2"}`} aria-label={dictation.listening ? "Sluta diktera" : "Diktera"}>
              {dictation.listening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          )}
          {canListen() && canSpeak() && (
            <button type="button" onClick={toggleVoice} className={`rounded-md p-2.5 ${voice ? "bg-linolja text-kalk" : "text-sot-3 hover:bg-kalk-2"}`} aria-pressed={voice} aria-label={voice ? "Avsluta röstläge" : "Röstläge"}>
              {voice ? <Square size={20} /> : <Radio size={20} />}
            </button>
          )}
          <button className="rounded-md bg-falu p-2.5 text-kalk disabled:opacity-40" disabled={!input.trim() || busy} aria-label="Skicka"><ArrowUp size={20} /></button>
        </div>
        {voice && <p className="mt-1 text-center text-[12px] text-sot-3">Säg ”stopp” för att avsluta. Publicering och samtycke kräver alltid ett tryck.</p>}
      </form>
    </div>
  );
}

function Card({ card }: { card: SourceCard }) {
  return (
    <li>
      <Link to={card.href} className="card flex h-full flex-col px-3 py-2 hover:bg-kalk-2/60">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-sot-3">{{ object: "Objekt", person: "Person", listing: "Annons", pickup: "Hämtning", zone: "Zon", storage: "Lagerplats", task: "Uppgift", journal: "Journal" }[card.type]}</span>
        <span className="font-medium">{card.title}</span>
        {card.subtitle && <span className="text-sm text-sot-3">{card.subtitle}</span>}
      </Link>
    </li>
  );
}

// Fråga Vreta: svar ur platsens egna data med källor (INV-10). Allmänna råd märks som allmänna råd.
// Åtgärder föreslås i en förhandsvisning och körs först när du bekräftat dem; känsliga handlingar
// (godkänna och dela berättelser, samtycke) görs alltid med ett eget tryck på sin egen sida.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUp, BookOpen, Check, History, Mic, MicOff, Trash2, Volume2, VolumeX } from "lucide-react";
import { useApp, useCan, useCommand, useQuery } from "../app/AppContext";
import { recentScreen } from "../app/screen";
import { ago } from "../app/format";
import { ask, type AskResult } from "../services/ai";
import { NO, YES, listenOnce, speak, stopSpeaking, useDictation } from "../services/speech";
import { SUGGESTED_QUESTIONS, type ProposedAction } from "@shared/knowledgeLocal.ts";
import { Chip, PageHeader, Stamp } from "../ui/base";
import { BusyButton, Sheet } from "../ui/sheet";

type Msg = { role: "user" | "assistant"; content: string; sources?: any[]; general_advice?: string | null; actions?: ProposedAction[]; navigate?: string | null; local?: boolean };

export default function Ask() {
  const { repo } = useApp();
  const can = useCan();
  const run = useCommand();
  const nav = useNavigate();
  const screen = useMemo(() => recentScreen(), []);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<string | null>(null);
  const [voice, setVoice] = useState(false);
  const [history, setHistory] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const dict = useDictation((t, final) => { setQ(t); if (final && voice && t.trim()) { dict.stop(); send(t); } });
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => () => stopSpeaking(), []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setBusy(true);
    try {
      const r: AskResult = await ask(repo, question, { thread_id: thread, screen: screen ?? undefined, history: msgs.slice(-8).map((m) => ({ role: m.role, content: m.content })) });
      const a: Msg = { role: "assistant", content: r.text, sources: r.sources, general_advice: r.general_advice, actions: r.actions, navigate: r.navigate, local: r.local };
      setMsgs((m) => [...m, a]);
      if (r.thread_id) setThread(r.thread_id);
      else if (can("AppendAssistantMessage")) {
        const saved = await run<{ thread_id: string }>("AppendAssistantMessage", { thread_id: thread, screen: screen ?? {}, messages: [
          { role: "user", content: question }, { role: "assistant", content: r.text, sources: r.sources, general_advice: r.general_advice ?? null }] }, { silent: true });
        if (saved?.thread_id) setThread(saved.thread_id);
      }
      if (voice) await voiceFollowUp(a);
    } finally { setBusy(false); }
  }

  async function voiceFollowUp(a: Msg) {
    await speak(a.content + (a.general_advice ? ` Allmänt råd: ${a.general_advice}` : ""));
    const actions = (a.actions ?? []).filter((x) => !x.requires_own_tap);
    for (const act of actions) {
      await speak(`${act.label}. ${act.effect}. Ska jag göra det?`);
      const ans = await listenOnce();
      if (YES.test(ans)) { await run(act.command_type, act.payload, { success: "Klart" }); await speak("Klart."); }
      else if (NO.test(ans)) await speak("Okej, jag låter bli.");
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-180px)] flex-col">
      <PageHeader kicker="Fråga Vreta" title="Vad undrar du?" sub={screen?.title ? <>Utgår från {screen.title}</> : "Svaren kommer från det som finns i VRETA – med källor."}>
        <button type="button" className={voice ? "btn-primary btn-small" : "btn-secondary btn-small"} aria-pressed={voice}
          onClick={() => { if (voice) stopSpeaking(); setVoice(!voice); }}>{voice ? <Volume2 size={16} /> : <VolumeX size={16} />} Röstläge</button>
        <button type="button" className="btn-ghost btn-small" onClick={() => setHistory(true)}><History size={16} /> Tidigare</button>
      </PageHeader>

      <div className="flex-1">
        {msgs.length === 0 && (
          <div className="mb-4 flex flex-wrap gap-2">{SUGGESTED_QUESTIONS.map((s) => <Chip key={s} onClick={() => send(s)}>{s}</Chip>)}</div>
        )}
        <div className="flex flex-col gap-3">
          {msgs.map((m, i) => m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-sot px-4 py-2.5 text-kalk">{m.content}</div>
          ) : <AnswerCard key={i} m={m} onNavigate={(to) => nav(to)} />)}
          {busy && <div className="max-w-[85%] animate-pulse rounded-2xl bg-papper px-4 py-3 text-sot-3 shadow-papper">Letar i VRETA …</div>}
          <div ref={bottom} />
        </div>
      </div>

      <form className="sticky bottom-20 z-10 mt-4 flex items-end gap-2 rounded-2xl border border-lera bg-papper p-2 shadow-upphojd md:bottom-4"
        onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <textarea className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 focus:outline-none" rows={1} value={q} placeholder="Var är fönstren från Ockelbo?"
          aria-label="Din fråga" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q); } }} />
        {dict.available && (
          <button type="button" className={`rounded-full p-2.5 ${dict.listening ? "bg-falu text-kalk" : "text-sot-2 hover:bg-kalk-2"}`} aria-label={dict.listening ? "Sluta lyssna" : "Tala"}
            onClick={() => (dict.listening ? dict.stop() : dict.start())}>{dict.listening ? <MicOff size={20} /> : <Mic size={20} />}</button>
        )}
        <button type="submit" className="rounded-full bg-falu p-2.5 text-kalk disabled:opacity-40" disabled={!q.trim() || busy} aria-label="Skicka"><ArrowUp size={20} /></button>
      </form>
      <HistorySheet open={history} onClose={() => setHistory(false)} onPick={(t) => { setThread(t.id); setMsgs(t.messages); setHistory(false); }} />
    </div>
  );
}

function AnswerCard({ m, onNavigate }: { m: Msg; onNavigate: (to: string) => void }) {
  return (
    <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-papper px-4 py-3 shadow-papper">
      <p className="whitespace-pre-wrap">{m.content}</p>
      {m.general_advice && (
        <div className="mt-2 rounded-lg border border-dashed border-lera px-3 py-2 text-sot-2">
          <div className="kicker mb-0.5">Allmänt råd – inte från VRETA:s data</div>{m.general_advice}
        </div>
      )}
      {(m.sources ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <BookOpen size={14} className="mt-1.5 text-sot-3" aria-label="Källor" />
          {m.sources!.slice(0, 8).map((s: any) => s.route
            ? <Link key={s.id} to={s.route} className="chip min-h-[30px] px-2 text-xs no-underline">{s.title}</Link>
            : <span key={s.id} className="chip min-h-[30px] px-2 text-xs">{s.title}</span>)}
        </div>
      )}
      {m.navigate && <button type="button" className="btn-secondary btn-small mt-2" onClick={() => onNavigate(m.navigate!)}>Öppna</button>}
      {(m.actions ?? []).length > 0 && <ActionPreview actions={m.actions!} />}
      {m.local && <div className="mt-1 text-xs text-sot-3">Svarat utan AI, ur VRETA:s data.</div>}
    </div>
  );
}

// Action Preview: visar exakt vad som kommer att ändras, och kör bara det du kryssat i.
function ActionPreview({ actions }: { actions: ProposedAction[] }) {
  const run = useCommand();
  const can = useCan();
  const [chosen, setChosen] = useState<string[]>(actions.filter((a) => !a.requires_own_tap).map((a) => a.key));
  const [done, setDone] = useState<string[]>([]);
  return (
    <div className="mt-3 rounded-xl border-2 border-dashed border-ockra/70 bg-ockra-light/10 p-3">
      <div className="kicker mb-2">Förslag – inget ändras förrän du bekräftar</div>
      {actions.map((a) => (
        <label key={a.key} className="mb-1 flex min-h-[44px] items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-falu" disabled={a.requires_own_tap || done.includes(a.key) || !can(a.command_type)}
            checked={chosen.includes(a.key) && !a.requires_own_tap} onChange={(e) => setChosen((x) => e.target.checked ? [...x, a.key] : x.filter((y) => y !== a.key))} />
          <span><span className="font-semibold">{a.label}</span>{done.includes(a.key) && <Stamp tone="ok">Gjort</Stamp>}
            <span className="block text-sm text-sot-2">{a.effect}</span>
            {a.requires_own_tap && <span className="block text-sm text-ockra">Görs med ett eget tryck på sin sida.</span>}</span>
        </label>
      ))}
      {chosen.some((k) => !done.includes(k)) && (
        <BusyButton className="btn-done btn-small mt-1" onClick={async () => {
          for (const a of actions.filter((x) => chosen.includes(x.key) && !done.includes(x.key) && !x.requires_own_tap)) {
            const r = await run(a.command_type, a.payload, { success: a.label });
            if (r) setDone((x) => [...x, a.key]);
          }
        }}><Check size={15} /> Gör det</BusyButton>
      )}
    </div>
  );
}

function HistorySheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: { id: string; messages: Msg[] }) => void }) {
  const { repo } = useApp();
  const run = useCommand();
  const { data, reload } = useQuery<any[]>(open ? "q_assistant_threads" : null);
  return (
    <Sheet open={open} onClose={onClose} title="Tidigare samtal">
      {(data ?? []).length === 0 ? <p className="text-sot-3">Inga sparade samtal.</p> : (
        <ul className="divide-y divide-dashed divide-lera">
          {data!.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-2">
              <button type="button" className="flex-1 text-left" onClick={async () => {
                const th = await repo.query<any>("q_assistant_thread", { id: t.id });
                onPick({ id: t.id, messages: (th?.messages ?? []).map((m: any) => ({ role: m.role, content: m.content, sources: m.sources, general_advice: m.general_advice })) });
              }}><span className="font-semibold">{t.title}</span><span className="block text-sm text-sot-3">{ago(t.updated_at)}</span></button>
              <button type="button" className="rounded-full p-2 text-sot-3 hover:text-falu" aria-label="Radera samtalet"
                onClick={async () => { if (await run("DeleteAssistantThread", { thread_id: t.id })) reload(); }}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

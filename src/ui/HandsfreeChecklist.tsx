import { Radio, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChecklistItem } from "../domain/types";
import { canListen, canSpeak, isNext, isRepeat, isStop, isYes, listenOnce, speak, stopListening, stopSpeaking } from "../services/speech";

/**
 * Checklistan läses upp och bockas av med rösten (AC-21): efter ett tryck behöver du inte
 * röra skärmen. Säg "ja"/"klart" för att bocka av, "nästa" för att hoppa över,
 * "upprepa" för att höra igen och "stopp" för att avsluta.
 */
export function HandsfreeChecklist({ items, isDone, onCheck }: { items: ChecklistItem[]; isDone: (c: ChecklistItem) => boolean; onCheck: (c: ChecklistItem) => Promise<void> }) {
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const runRef = useRef(false);
  useEffect(() => () => { runRef.current = false; stopListening(); stopSpeaking(); }, []);
  if (!canListen() || !canSpeak()) return null;

  async function run() {
    runRef.current = true;
    setRunning(true);
    const todo = items.filter((c) => !isDone(c));
    if (!todo.length) await speak("Allt på checklistan är redan bockat.");
    else await speak(`${todo.length} saker kvar. Säg ja när det är klart, nästa för att hoppa över, eller stopp.`);
    const skipped: ChecklistItem[] = [];
    for (const c of todo) {
      if (!runRef.current) break;
      setCurrent(c.id);
      let handled = false;
      for (let attempt = 0; attempt < 3 && runRef.current && !handled; attempt++) {
        await speak(`${c.label}?`);
        const heard = await listenOnce(9000);
        if (!runRef.current) break;
        if (!heard) continue;
        if (isStop(heard)) { runRef.current = false; break; }
        if (isRepeat(heard)) { attempt--; continue; }
        if (isYes(heard)) { await onCheck(c); await speak("Bockat."); handled = true; }
        else if (isNext(heard)) { skipped.push(c); handled = true; }
        else await speak("Jag hörde inte. Säg ja, nästa eller stopp.");
      }
      if (!handled && runRef.current) skipped.push(c);
    }
    if (runRef.current) await speak(skipped.length ? `Klart. Kvar: ${skipped.map((c) => c.label).join(", ")}.` : "Allt är bockat. Lycka till!");
    runRef.current = false;
    setCurrent(null);
    setRunning(false);
  }

  function stop() {
    runRef.current = false;
    stopListening();
    stopSpeaking();
    setRunning(false);
    setCurrent(null);
  }

  return (
    <div className="mb-2 flex items-center gap-3">
      {running ? (
        <button className="btn-moss text-sm" onClick={stop}><Square size={16} aria-hidden="true" /> Avsluta uppläsningen</button>
      ) : (
        <button className="btn-secondary text-sm" onClick={() => void run()}><Radio size={16} aria-hidden="true" /> Läs upp och bocka av med rösten</button>
      )}
      {running && current && <span className="text-sm text-sot-3" role="status">Lyssnar: {items.find((c) => c.id === current)?.label}</span>}
    </div>
  );
}

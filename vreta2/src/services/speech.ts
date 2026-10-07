// Talstöd (R1.1 7.5): diktering i textfält, röstfångst, röstkommandon och röstläge. Webbläsarens inbyggda
// taligenkänning och talsyntes på svenska; en egen taltjänst med VRETA:s ordlista väljs i ADR-003.
// Mikrofonen är bara aktiv när användaren tryckt på den – appen lyssnar aldrig i bakgrunden.
import { useCallback, useEffect, useRef, useState } from "react";

type Rec = { start(): void; stop(): void; abort(): void; lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };

export function recognitionAvailable(): boolean {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

function newRecognition(): Rec | null {
  const C = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!C) return null;
  const r: Rec = new C();
  r.lang = "sv-SE";
  r.interimResults = true;
  r.continuous = true;
  return r;
}

// Diktering: mikrofonknapp i alla textfält.
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const stop = useCallback(() => { rec.current?.stop(); setListening(false); }, []);
  const start = useCallback(() => {
    const r = newRecognition();
    if (!r) return false;
    let finalText = "";
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      cb.current((finalText + interim).trim(), interim === "");
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
    return true;
  }, []);
  useEffect(() => () => rec.current?.abort(), []);
  return { listening, start, stop, available: recognitionAvailable() };
}

// Lyssnar på ett kort svar ("ja", "nej", "nästa", "stopp", "bocka av") i röstläget.
export function listenOnce(timeoutMs = 7000): Promise<string> {
  return new Promise((resolve) => {
    const r = newRecognition();
    if (!r) return resolve("");
    r.continuous = false;
    r.interimResults = false;
    let done = false;
    const finish = (t: string) => { if (!done) { done = true; try { r.abort(); } catch { /* */ } resolve(t.toLocaleLowerCase("sv").trim()); } };
    r.onresult = (e: any) => finish(e.results[0][0].transcript);
    r.onend = () => finish("");
    r.onerror = () => finish("");
    setTimeout(() => finish(""), timeoutMs);
    r.start();
  });
}

let rate = Number(localStorage.getItem("vreta2-tts-rate") ?? "1");
export function setSpeechRate(r: number) { rate = r; localStorage.setItem("vreta2-tts-rate", String(r)); }
export function getSpeechRate() { return rate; }

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "sv-SE";
    u.rate = rate;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("sv"));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

export const YES = /^(ja|japp|jajamän|okej|ok|kör|gör det|bekräfta)\b/;
export const NO = /^(nej|nä|avbryt|stopp|sluta)\b/;

// Ljudinspelning för röstfångst: ljudet sparas alltid (privat) tillsammans med transkriptionen.
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunks.current = [];
    mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    mr.start();
    rec.current = mr;
    setRecording(true);
  }, []);
  const stop = useCallback(() => new Promise<Blob | null>((resolve) => {
    const mr = rec.current;
    if (!mr) return resolve(null);
    mr.onstop = () => {
      mr.stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      resolve(chunks.current.length ? new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }) : null);
    };
    mr.stop();
  }), []);
  return { recording, start, stop, available: typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia };
}

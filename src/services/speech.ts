// Tal in och ut (7.5): uppläsning med svensk röst och korta lyssningar för röstläge och
// handsfree-checklistor. Mikrofonen är bara aktiv när användaren själv startat den.

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

const RATE_KEY = "vreta.tal.hastighet";

function Recognition(): (new () => RecognitionLike) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const canListen = () => !!Recognition();
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function speechRate(): number {
  try {
    return Number(localStorage.getItem(RATE_KEY)) || 1;
  } catch {
    return 1;
  }
}
export function setSpeechRate(rate: number) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* bara en bekvämlighet */
  }
}

function swedishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "sv-SE") ?? voices.find((v) => v.lang.startsWith("sv")) ?? null;
}

/** Läser upp en text. Löser när uppläsningen är klar eller avbruten. */
export function speak(text: string): Promise<void> {
  if (!canSpeak() || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "sv-SE";
    u.rate = speechRate();
    const v = swedishVoice();
    if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

let active: RecognitionLike | null = null;

/** Lyssnar efter en replik. Ger texten, eller null vid tystnad, fel eller avbrott. */
export function listenOnce(timeoutMs = 8000): Promise<string | null> {
  const Ctor = Recognition();
  if (!Ctor) return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = new Ctor();
    r.lang = "sv-SE";
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      active = null;
      resolve(v);
    };
    const timer = setTimeout(() => {
      r.abort();
      finish(null);
    }, timeoutMs);
    r.onresult = (e) => finish(e.results[0]?.[0]?.transcript?.trim() ?? null);
    r.onerror = () => finish(null);
    r.onend = () => finish(null);
    active = r;
    r.start();
  });
}

export function stopListening() {
  active?.abort();
  active = null;
}

const norm = (t: string) => t.toLowerCase().replace(/[.,!?]/g, "").trim();
export const isYes = (t: string) => /^(ja|japp|jo|jajamän|absolut|gör det|kör|okej|ok|visst|klart|check|bocka av|bockad|stämmer)\b/.test(norm(t));
export const isNo = (t: string) => /^(nej|nä|nix|avbryt|inte|ångra)\b/.test(norm(t));
export const isStop = (t: string) => /\b(stopp|stop|sluta|avsluta|tyst)\b/.test(norm(t));
export const isNext = (t: string) => /^(nästa|hoppa över|skippa|senare|vänta)\b/.test(norm(t));
export const isRepeat = (t: string) => /^(upprepa|igen|vad sa du|en gång till)\b/.test(norm(t));

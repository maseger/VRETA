import { useCallback, useRef, useState } from "react";

// Diktering med webbläsarens taligenkänning (svenska). Fungerar i Chrome, Edge och Safari.
// Saknas stöd visas en hänvisning till tangentbordets mikrofon.

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const ref = useRef<RecognitionLike | null>(null);
  const Ctor = (window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => RecognitionLike }).webkitSpeechRecognition;
  const supported = !!Ctor;

  const toggle = useCallback(() => {
    if (!Ctor) return;
    if (listening) {
      ref.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "sv-SE";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text) onText(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    ref.current = r;
    r.start();
    setListening(true);
  }, [Ctor, listening, onText]);

  return { supported, listening, toggle };
}

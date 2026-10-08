// Fånga: ett ställe för allt – foto, röst, text eller länk. Fångsten sparas direkt (även offline), tolkas
// sedan till ett förslag som en människa granskar. Inget blir fakta utan godkännande (INV-02).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, MapPin, Mic, Square, X } from "lucide-react";
import { useApp, useCan, useCommand } from "../app/AppContext";
import { recentScreen } from "../app/screen";
import { interpretCapture } from "../services/ai";
import { useDictation, useRecorder } from "../services/speech";
import { here as gpsHere } from "../services/geo";
import { newKey } from "../data/repo";
import { Chip, ErrorNote, PageHeader } from "../ui/base";
import { PhotoPicker, useUpload } from "../ui/media";
import { PlacePicker, TextArea } from "../ui/fields";
import { useToast } from "../app/toast";

const KINDS = [
  { code: "", label: "Låt Vreta gissa" },
  { code: "find", label: "Fynd eller inköp" },
  { code: "contribution", label: "Någon hjälpte till" },
  { code: "observation", label: "Något jag såg" },
  { code: "moment", label: "Något vi gjorde" },
  { code: "task", label: "Att göra" },
  { code: "person", label: "En person" },
];

export default function Capture() {
  const { repo, ctx } = useApp();
  const can = useCan();
  const run = useCommand();
  const upload = useUpload();
  const toast = useToast();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [kind, setKind] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [gps, setGps] = useState<{ lon: number; lat: number } | null>(null);
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screen = useMemo(() => recentScreen(), []);
  const [useScreenCtx, setUseScreenCtx] = useState(!!screen);
  const recorder = useRecorder();
  const dictation = useDictation((t) => setTranscript(t));

  // Delningsmål: text eller länk som delats till appen
  useEffect(() => {
    const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const shared = p.get("text") || p.get("title");
    const sharedUrl = p.get("url");
    if (shared) setText(shared);
    if (sharedUrl) { setUrl(sharedUrl); setShowUrl(true); }
  }, []);

  if (!can("RecordCapture")) {
    return <div><PageHeader title="Fånga" /><ErrorNote>Din roll kan läsa men inte lägga till. Be ägaren om rollen medhjälpare.</ErrorNote></div>;
  }

  async function startVoice() {
    setError(null);
    try {
      if (recorder.available) await recorder.start();
      dictation.start();
    } catch {
      setError("Mikrofonen gick inte att starta. Tillåt mikrofonen i webbläsaren eller skriv i stället.");
    }
  }
  async function stopVoice() {
    dictation.stop();
    const blob = await recorder.stop();
    if (blob) setAudio(blob);
  }

  async function save() {
    setError(null);
    if (!text.trim() && !transcript.trim() && !files.length && !audio && !url.trim()) {
      setError("Ta en bild, tala in eller skriv något först.");
      return;
    }
    try {
      setStep("Sparar bilderna …");
      const mediaIds = await upload(files);
      if (audio) {
        // Ljudet sparas alltid privat tillsammans med transkriptionen (R1.1 7.5)
        mediaIds.push(await repo.uploadMedia({ file: audio, kind: "audio", filename: "röstfångst.webm", transcript: transcript || undefined }, ctx!.site!.id));
      }
      setStep("Sparar fångsten …");
      const id = newKey();
      const places = placeId ? { place_id: placeId } : {};
      const context = {
        here: gps || placeId ? { ...gps, ...places } : null,
        // "Här": positionen blir en nål i rätt zon när fångsten godkänns (AC-23)
        geometry: gps ? { type: "Point", coordinates: [gps.lon, gps.lat] } : null,
        screen: useScreenCtx && screen ? { route: screen.route, entity_id: screen.entity_id, entity_type: screen.entity_type, title: screen.title } : null,
      };
      const r = await run<{ capture_id: string; queued?: boolean }>("RecordCapture", {
        id, text: text.trim() || null, transcript: transcript.trim() || null, url: url.trim() || null, media_ids: mediaIds,
        kind_hint: kind || null, context, client_created_at: new Date().toISOString(),
      });
      if (!r) { setStep(null); return; }
      if ((r as any).queued) {
        toast("Fångsten är sparad på telefonen och tolkas när nätet kommer tillbaka", "info");
        nav("/");
        return;
      }
      setStep("Tolkar …");
      const res = await interpretCapture(repo, { id, text, transcript, kind_hint: kind || null },
        context.here ?? undefined, context.screen ?? undefined);
      if (res?.proposal_id) nav(`/granska/${res.proposal_id}`, { replace: true });
      else { toast("Fångsten är sparad. Den väntar under Granska.", "info"); nav("/granska"); }
    } catch (e) {
      setError((e as Error).message);
      setStep(null);
    }
  }

  return (
    <div>
      <PageHeader kicker="Fånga" title="Vad har hänt?" sub="Ta en bild, tala in eller skriv – Vreta gör ett förslag som du granskar." />

      <div className="card card-pad mb-4">
        <PhotoPicker files={files} onChange={setFiles} />
        <div className="divider my-4" />
        <div className="mb-3 flex items-center gap-3">
          {recorder.recording || dictation.listening ? (
            <button type="button" className="btn-primary" onClick={stopVoice}><Square size={18} fill="currentColor" /> Sluta spela in</button>
          ) : (
            <button type="button" className="btn-secondary" onClick={startVoice} disabled={!recorder.available && !dictation.available}>
              <Mic size={18} /> Tala in
            </button>
          )}
          {(recorder.recording || dictation.listening) && <span className="flex items-center gap-2 text-falu"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-falu" /> Lyssnar …</span>}
          {audio && !recorder.recording && <span className="text-sm text-sot-3">Ljud sparas privat <button type="button" className="ml-1 align-middle" aria-label="Ta bort ljudet" onClick={() => setAudio(null)}><X size={14} /></button></span>}
        </div>
        {(transcript || dictation.listening) && (
          <TextArea label="Det du sa" value={transcript} onChange={setTranscript} rows={3} hint="Rätta gärna om något blev fel." />
        )}
        <TextArea label="Eller skriv" value={text} onChange={setText} rows={3} placeholder="Till exempel: Sex gjutjärnsfönster från Anders i Ockelbo, 200 kr styck" />
        {showUrl ? (
          <div className="mb-3"><label className="label" htmlFor="cap-url">Länk</label>
            <input id="cap-url" className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></div>
        ) : (
          <button type="button" className="btn-ghost btn-small mb-2" onClick={() => setShowUrl(true)}><Link2 size={16} /> Lägg till länk</button>
        )}
      </div>

      <section className="mb-4">
        <h2 className="kicker mb-2">Vad gäller det? (valfritt)</h2>
        <div className="flex flex-wrap gap-2">{KINDS.map((k) => <Chip key={k.code} on={kind === k.code} onClick={() => setKind(k.code)}>{k.label}</Chip>)}</div>
      </section>

      <section className="card card-pad mb-4">
        <PlacePicker label={<span className="inline-flex items-center gap-1"><MapPin size={15} /> Var på Vreta? (valfritt)</span>} value={placeId} onChange={setPlaceId} storage empty="Vet inte / spelar ingen roll" />
        <button type="button" className="btn-ghost btn-small" onClick={async () => {
          try { const h = await gpsHere(); setGps({ lon: h.lon, lat: h.lat }); toast("Platsen är med (bara internt)", "info"); }
          catch { toast("Platsen gick inte att hämta", "error"); }
        }}>{gps ? "✓ GPS-position med" : "Använd min position"}</button>
        {screen && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-falu" checked={useScreenCtx} onChange={(e) => setUseScreenCtx(e.target.checked)} />
            Gäller {screen.title ?? "sidan jag just tittade på"}
          </label>
        )}
      </section>

      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      <div className="sticky bottom-20 z-10 flex gap-2 md:bottom-4">
        <button type="button" className="btn-primary flex-1 text-[17px]" disabled={!!step} onClick={save}>{step ?? "Spara och tolka"}</button>
      </div>
    </div>
  );
}

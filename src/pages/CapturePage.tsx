import { Camera, ImagePlus, Loader2, Mic, MicOff, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app/AppContext";
import type { CaptureInput } from "../domain/types";
import { proposeForCapture } from "../services/captureAgent";
import { prepareImage, type PreparedImage } from "../services/images";
import { PageHeader } from "../ui/bits";
import { useDictation } from "../ui/useDictation";

const KINDS: { value: CaptureInput["kind"]; label: string }[] = [
  { value: "find", label: "Fynd" },
  { value: "person", label: "Person" },
  { value: "observation", label: "Observation" },
  { value: "other", label: "Låt AI avgöra" },
];

export function CapturePage() {
  const { repo, online, toast, refresh } = useApp();
  const navigate = useNavigate();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PreparedImage[]>([]);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<CaptureInput["kind"]>("find");
  const [busy, setBusy] = useState<null | "photo" | "saving" | "thinking">(null);
  const [error, setError] = useState<string | null>(null);

  const appendText = useCallback((t: string) => setText((prev) => (prev ? `${prev} ${t}` : t)), []);
  const dictation = useDictation(appendText);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("photo");
    try {
      const prepared = await Promise.all(Array.from(files).map(prepareImage));
      setPhotos((p) => [...p, ...prepared]);
    } catch {
      setError("Kunde inte läsa bilden.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setBusy("saving");
    try {
      const captureId = crypto.randomUUID();
      const mediaIds: string[] = [];
      for (const p of photos) {
        const m = await repo.saveMedia({
          id: crypto.randomUUID(), original: p.original, clean: p.clean, mime: p.original.type || "image/jpeg",
          width: p.width, height: p.height, entity_type: "capture", entity_id: captureId,
        });
        mediaIds.push(m.id);
      }
      const capture = await repo.saveCapture(captureId, { text: text.trim(), kind, media_ids: mediaIds });
      if (!online) {
        toast("Sparat – tolkas och läggs i Att granska när du har nät.");
        await refresh();
        navigate("/");
        return;
      }
      setBusy("thinking");
      const content = await proposeForCapture(repo, capture);
      const proposal = await repo.attachProposal(capture.id, content);
      await refresh();
      navigate(`/granska/${proposal.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const canSave = (photos.length > 0 || text.trim().length > 0) && !busy;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader kicker="Fånga" title="Vad har du hittat?" />

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />

      {photos.length === 0 ? (
        <button type="button" onClick={() => cameraRef.current?.click()} className="card mb-3 flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-lera text-sot-2 hover:bg-kalk-2/60">
          {busy === "photo" ? <Loader2 className="animate-spin" size={40} /> : <Camera size={44} strokeWidth={1.5} />}
          <span className="font-serif text-lg">Ta foto</span>
        </button>
      ) : (
        <div className="scroll-snap-x mb-3 flex gap-3 overflow-x-auto pb-2">
          {photos.map((p, i) => (
            <div key={p.previewUrl} className="relative w-64 shrink-0">
              <img src={p.previewUrl} alt={`Foto ${i + 1}`} className="aspect-[4/3] w-full rounded-md object-cover shadow-papper" />
              <button type="button" onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))} className="absolute right-2 top-2 rounded-full bg-sot/70 p-1.5 text-kalk" aria-label="Ta bort foto">
                <X size={16} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => cameraRef.current?.click()} className="card flex aspect-[4/3] w-40 shrink-0 flex-col items-center justify-center gap-2 border-dashed text-sot-3">
            <Camera size={28} strokeWidth={1.5} /> Ett till
          </button>
        </div>
      )}
      <button type="button" onClick={() => galleryRef.current?.click()} className="btn-ghost mb-6 -ml-3 text-sm">
        <ImagePlus size={18} aria-hidden="true" /> Välj från bilder eller skärmdump
      </button>

      <div className="mb-2 flex items-end justify-between">
        <label htmlFor="capture-text" className="field-label mb-0">Berätta</label>
        {dictation.supported ? (
          <button type="button" onClick={dictation.toggle} className={`btn min-h-[40px] px-3 text-sm ${dictation.listening ? "bg-falu text-kalk" : "btn-secondary"}`}>
            {dictation.listening ? <MicOff size={16} /> : <Mic size={16} />}
            {dictation.listening ? "Lyssnar … tryck för att sluta" : "Diktera"}
          </button>
        ) : (
          <span className="text-[12px] text-sot-3">Använd tangentbordets mikrofon för att diktera</span>
        )}
      </div>
      <textarea
        id="capture-text"
        className="input mb-1"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="T.ex. ”Sex gjutjärnsfönster, Anders i Ockelbo, 200 kr styck, måste hämtas före november, behöver släp”"
      />
      <p className="mb-6 text-[12px] text-sot-3">Klistra gärna in en annonslänk eller annonstext. Bilder delas aldrig med platsdata.</p>

      <p className="field-label">Vad är det?</p>
      <div className="mb-8 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.value} type="button" onClick={() => setKind(k.value)} className={`chip ${kind === k.value ? "chip-on" : ""}`}>
            {k.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-falu">{error}</p>}
      <button type="button" onClick={save} disabled={!canSave} className="btn-primary w-full text-base">
        {busy === "saving" && <Loader2 className="animate-spin" size={18} />}
        {busy === "thinking" && <Loader2 className="animate-spin" size={18} />}
        {busy === "saving" ? "Sparar …" : busy === "thinking" ? "Tolkar fyndet …" : online ? "Spara och tolka" : "Spara (tolkas när du har nät)"}
      </button>
    </div>
  );
}

// Bilder: visas alltid i de rensade versionerna (utan platsdata). Originalen är privata (INV-07).
import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { useApp } from "../app/AppContext";

export type MediaRef = { id: string; kind?: string; share_path?: string | null; thumb_path?: string | null; caption?: string | null;
  visibility?: string; has_people?: boolean; flagged?: boolean; transcript?: string | null; mime_type?: string | null; role?: string };

export function useMediaUrl(path?: string | null): string | null {
  const { repo } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) repo.mediaUrl(path).then((u) => alive && setUrl(u), () => undefined);
    return () => { alive = false; };
  }, [path, repo]);
  return url;
}

export function MediaImg({ m, size = "thumb", className = "", alt = "" }: { m?: MediaRef | null; size?: "thumb" | "share"; className?: string; alt?: string }) {
  const path = m ? (size === "thumb" ? m.thumb_path ?? m.share_path : m.share_path ?? m.thumb_path) : null;
  const url = useMediaUrl(path);
  if (!m || !path) return <div className={`bg-kalk-2 ${className}`} aria-hidden />;
  if (!url) return <div className={`animate-pulse bg-kalk-2 ${className}`} aria-hidden />;
  return <img src={url} alt={alt || m.caption || ""} className={`object-cover ${className}`} loading="lazy" />;
}

// Omslagsbild i listor (kvadratisk tumnagel eller tom yta).
export function Thumb({ m, size = 48 }: { m?: MediaRef | null; size?: number }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-lg bg-kalk-2" style={{ width: size, height: size }}>
      {m ? <MediaImg m={m} className="h-full w-full" /> : null}
    </div>
  );
}

export function Gallery({ media, onOpen }: { media: MediaRef[]; onOpen?: (m: MediaRef) => void }) {
  const [open, setOpen] = useState<MediaRef | null>(null);
  const photos = media.filter((m) => m.share_path || m.thumb_path);
  if (!photos.length) return null;
  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((m) => (
          <button key={m.id} type="button" onClick={() => (onOpen ? onOpen(m) : setOpen(m))} className="shrink-0 overflow-hidden rounded-lg border border-lera-light">
            <MediaImg m={m} className="h-28 w-36" />
          </button>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Bild" className="fixed inset-0 z-50 flex items-center justify-center bg-sot/80 p-4" onClick={() => setOpen(null)}>
          <button type="button" className="absolute right-4 top-4 rounded-full bg-papper p-2" aria-label="Stäng"><X size={20} /></button>
          <MediaImg m={open} size="share" className="max-h-[85vh] max-w-full rounded-lg object-contain" />
          {open.caption && <div className="absolute bottom-6 left-0 right-0 text-center text-kalk">{open.caption}</div>}
        </div>
      )}
    </>
  );
}

// Fotoväljare: kamera på telefon, filväljare på dator. Returnerar valda filer – uppladdning sker vid sparande.
export function PhotoPicker({ files, onChange, label = "Lägg till bild", multiple = true }: { files: File[]; onChange: (f: File[]) => void; label?: string; multiple?: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const previews = useObjectUrls(files);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {files.map((f, i) => (
          <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg border border-lera-light bg-kalk-2">
            {f.type.startsWith("image/") ? <img src={previews[i]} alt="" className="h-full w-full object-cover" /> : <span className="p-1 text-xs">{f.name}</span>}
            <button type="button" aria-label="Ta bort bilden" onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute right-0.5 top-0.5 rounded-full bg-papper/90 p-0.5"><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn-secondary h-20 w-20 flex-col gap-0 px-1 text-xs" onClick={() => cam.current?.click()}>
          <Camera size={22} aria-hidden /> Fota
        </button>
        <button type="button" className="btn-secondary h-20 w-20 flex-col gap-0 px-1 text-xs" onClick={() => pick.current?.click()}>
          <ImagePlus size={22} aria-hidden /> {label === "Lägg till bild" ? "Välj" : label}
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
      <input ref={pick} type="file" accept="image/*" multiple={multiple} hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
  );
}

function useObjectUrls(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  return urls;
}

// Laddar upp valda bilder och returnerar media-id:n (rensade versioner skapas i webbläsaren).
export function useUpload() {
  const { repo, ctx } = useApp();
  return async (files: File[], opts: { hasPeople?: boolean; caption?: string } = {}): Promise<string[]> => {
    const ids: string[] = [];
    for (const f of files) {
      const kind = f.type.startsWith("image/") ? "photo" : f.type.startsWith("audio/") ? "audio" : f.type.startsWith("video/") ? "video" : "document";
      ids.push(await repo.uploadMedia({ file: f, kind, filename: f.name, hasPeople: opts.hasPeople, caption: opts.caption }, ctx!.site!.id));
    }
    return ids;
  };
}

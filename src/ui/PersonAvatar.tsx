import { Camera, Lock, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { personPhotoVisibility } from "../domain/labels";
import type { Media, Person } from "../domain/types";
import { prepareImage } from "../services/images";
import type { Repo } from "../data/repo";
import { MediaImage } from "./bits";

const SIZES = {
  sm: "h-10 w-10 text-lg",
  lg: "h-16 w-16 text-3xl",
} as const;

/** Sparar ett foto på en person. Synligheten följer personens bildsamtycke. */
export async function savePersonPhoto(repo: Repo, person: Pick<Person, "id" | "consent_image">, file: File): Promise<void> {
  const p = await prepareImage(file);
  URL.revokeObjectURL(p.previewUrl);
  await repo.saveMedia({
    id: crypto.randomUUID(), original: p.original, clean: p.clean, mime: p.original.type || "image/jpeg", width: p.width, height: p.height,
    entity_type: "person", entity_id: person.id, role: "general", has_people: true, visibility: personPhotoVisibility(person.consent_image),
  });
}

/** Personens senaste foto, annars initialen. */
export function PersonAvatar({ name, photo, size = "sm" }: { name: string; photo?: Media | null; size?: keyof typeof SIZES }) {
  if (photo) return <MediaImage media={photo} alt={`Foto på ${name}`} className={`${SIZES[size].split(" ").slice(0, 2).join(" ")} shrink-0 rounded-full`} />;
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-linolja-pale font-serif font-semibold text-linolja ${SIZES[size]}`} aria-hidden="true">
      {name.charAt(0)}
    </span>
  );
}

/** Avatar med knappar för att lägga till, byta och ta bort foto. */
export function EditablePersonAvatar({ person, photo, canWrite }: { person: Person; photo: Media | null; canWrite: boolean }) {
  const { repo, refresh, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.[0]) return;
    setBusy(true);
    try {
      await savePersonPhoto(repo, person, files[0]);
      // Ett foto i taget: det gamla arkiveras
      if (photo) await repo.archiveMedia(photo.id);
      await refresh();
      toast(photo ? "Fotot är bytt" : "Foto sparat");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    if (!photo || !confirm(`Ta bort fotot på ${person.name}?`)) return;
    await repo.archiveMedia(photo.id);
    await refresh();
    toast("Fotot är borttaget");
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      {canWrite ? (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="group relative rounded-full" aria-label={photo ? "Byt foto" : "Lägg till foto"}>
          <PersonAvatar name={person.name} photo={photo} size="lg" />
          <span className={`absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-lera-light bg-[#FBF8F1] text-falu shadow-papper ${busy ? "animate-pulse" : ""}`}>
            <Camera size={14} aria-hidden="true" />
          </span>
        </button>
      ) : <PersonAvatar name={person.name} photo={photo} size="lg" />}
      {canWrite && <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => add(e.target.files)} />}
      {canWrite && photo && (
        <button type="button" onClick={remove} className="flex items-center gap-1 text-[11px] font-semibold text-sot-3 hover:text-falu">
          <Trash2 size={12} aria-hidden="true" /> Ta bort
        </button>
      )}
      {photo?.visibility === "private" && (
        <span className="flex max-w-[5.5rem] items-start gap-1 text-center text-[10px] leading-tight text-sot-3" title="Fotot syns bara för dig och ägaren tills personen sagt ja till bild">
          <Lock size={10} className="mt-px shrink-0" aria-hidden="true" /> Privat tills ja till bild
        </span>
      )}
    </div>
  );
}

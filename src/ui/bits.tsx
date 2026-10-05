import { Globe, House, Link2, Lock, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../app/AppContext";
import { STATUS_LABEL, VISIBILITY_LABEL } from "../domain/labels";
import type { Media, ObjectStatus, Visibility } from "../domain/types";

const STATUS_TONE: Partial<Record<ObjectStatus, string>> = {
  discovered: "border-ockra text-[#8a6118]",
  contacted: "border-ockra text-[#8a6118]",
  reserved: "border-ockra text-[#8a6118]",
  pickup_planned: "border-ockra text-[#8a6118]",
  collected: "border-jarn text-sot-2",
  stored: "border-sot-2 text-sot-2",
  processing: "border-sot-2 text-sot-2",
  in_use: "border-linolja text-linolja",
  lent: "border-linolja text-linolja",
  listed: "border-falu text-falu",
  reserved_out: "border-falu text-falu",
};

export function StatusStamp({ status }: { status: ObjectStatus }) {
  return <span className={`stamp ${STATUS_TONE[status] ?? "border-jarn text-sot-3"}`}>{STATUS_LABEL[status]}</span>;
}

export function VisibilityIcon({ visibility, withLabel = false }: { visibility: Visibility; withLabel?: boolean }) {
  const Icon = { private: Lock, internal: House, shareable: Link2, public: Globe }[visibility];
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-sot-3" title={VISIBILITY_LABEL[visibility]}>
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      {withLabel ? VISIBILITY_LABEL[visibility] : <span className="sr-only">{VISIBILITY_LABEL[visibility]}</span>}
    </span>
  );
}

export function AiMark({ confidence }: { confidence: number }) {
  const unsure = confidence < 0.7;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${unsure ? "text-[#8a6118]" : "text-linolja"}`}>
      <Sparkles size={12} aria-hidden="true" />
      {unsure ? "Osäkert" : "Förslag"}
    </span>
  );
}

export function PageHeader({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <p className="kicker mb-1">{kicker}</p>}
        <h1>{title}</h1>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </header>
  );
}

export function MediaImage({ media, className, alt = "" }: { media: Media | undefined | null; className?: string; alt?: string }) {
  const { repo } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    if (media) repo.mediaUrl(media, "clean").then((u) => alive && (setUrl(u), (created = u)));
    return () => {
      alive = false;
      if (created?.startsWith("blob:")) URL.revokeObjectURL(created);
    };
  }, [media, repo]);
  if (!url) return <div className={`bg-kalk-3 ${className ?? ""}`} aria-hidden="true" />;
  return <img src={url} alt={alt} className={`object-cover ${className ?? ""}`} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="font-serif text-lg">{title}</p>
      {children && <div className="max-w-sm text-sm text-sot-3">{children}</div>}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-lera-light pb-2">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" });
}

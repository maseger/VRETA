// Designsystemet: kort, stämplar, chips, knappar, flikrader, listor, avatarer och AI-fält (Designdokument 2.0).
import { Link } from "react-router-dom";
import { Globe2, Home, Link2, Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({ kicker, title, children, sub }: { kicker?: ReactNode; title: ReactNode; children?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {kicker && <div className="kicker mb-1">{kicker}</div>}
        <h1 className="break-words text-[28px] leading-tight md:text-[32px]">{title}</h1>
        {sub && <div className="mt-1 text-sot-3">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Card({ children, className = "", as: As = "section", ...rest }: { children: ReactNode; className?: string; as?: any } & Record<string, any>) {
  return <As className={`card card-pad ${className}`} {...rest}>{children}</As>;
}

export function Section({ title, children, action, className = "" }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`mb-5 ${className}`}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="kicker">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  // Profilen: ockra och solros är aldrig text på kalk – de bär ram och fyllning, texten är skogsgrön eller bark
  neutral: "border-jarn text-sot-2",
  ok: "border-forest text-forest",
  warn: "border-rust-pressed text-rust-pressed",
  falu: "border-rust-pressed text-rust-pressed",
  plan: "border-lera border-dashed text-sot-3",
  vision: "border-ockra text-forest hatch",
  forecast: "border-jarn text-sot-2 italic",
  uncertain: "border-ockra border-dashed text-forest",
  inspiration: "border-lera text-sot-3",
  dark: "border-forest bg-forest text-cream",
};
export function Stamp({ children, tone = "neutral", title }: { children: ReactNode; tone?: keyof typeof TONES | string; title?: string }) {
  return <span className={`stamp ${TONES[tone] ?? TONES.neutral}`} title={title}>{children}</span>;
}

export function statusTone(group?: string | null, status?: string | null): string {
  if (status && ["sold", "donated", "exchanged", "completed", "settled", "done", "shared", "approved", "received"].includes(status)) return "ok";
  if (status && ["declined", "lost", "discarded", "cancelled", "rejected", "withdrawn", "no_show"].includes(status)) return "neutral";
  if (group === "incoming" || (status && ["discovered", "contacted", "negotiating", "lead", "planned", "review", "pending", "new", "draft"].includes(status))) return "warn";
  if (group === "in_use" || status === "in_use" || status === "active") return "ok";
  return "neutral";
}

export function Chip({ on, children, onClick, title }: { on?: boolean; children: ReactNode; onClick?: () => void; title?: string }) {
  return <button type="button" className={`chip ${on ? "chip-on" : ""}`} aria-pressed={on} onClick={onClick} title={title}>{children}</button>;
}

// Flikrad: segmenterad kontroll med vald flik som upphöjt papper.
export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto rounded-full bg-mist/60 p-1">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={`min-h-[40px] flex-1 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition ${value === t.value ? "bg-papper text-forest shadow-papper" : "text-sot-2 hover:text-forest"}`}>
          {t.label}{t.count !== undefined && t.count > 0 && <span className="ml-1 text-sot-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Listor i kort med streckade avdelare och 44 px träffytor.
export function List({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`card divide-y divide-mist ${className}`}>{children}</ul>;
}
export function Row({ to, onClick, children, right, leading }: { to?: string; onClick?: () => void; children: ReactNode; right?: ReactNode; leading?: ReactNode }) {
  const inner = (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {right}
    </div>
  );
  if (to) return <li><Link to={to} className="block text-sot no-underline hover:bg-kalk-2/60 hover:no-underline">{inner}</Link></li>;
  if (onClick) return <li><button type="button" onClick={onClick} className="block w-full text-left hover:bg-kalk-2/60">{inner}</button></li>;
  return <li>{inner}</li>;
}

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return url ? (
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-forest-pale font-sans font-bold text-forest" style={{ width: size, height: size, fontSize: size * 0.42 }}>{initial}</span>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-lera px-4 py-8 text-center text-sot-3">
      <div>{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Laddar …" }: { label?: string }) {
  return <div role="status" className="py-8 text-center text-sot-3">{label}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-lg border border-rust/40 bg-rust/5 px-3 py-2 text-rust-pressed">{children}</div>;
}

// Synlighet syns: lås (privat), hus (internt), länk (delbart), jordglob (publikt).
export function VisibilityIcon({ v, withLabel }: { v?: string | null; withLabel?: boolean }) {
  const map: Record<string, [any, string]> = { private: [Lock, "Privat"], internal: [Home, "Intern"], shareable: [Link2, "Delbar"], public: [Globe2, "Publik"] };
  const [Icon, label] = map[v ?? "internal"] ?? map.internal;
  return <span className="inline-flex items-center gap-1 text-sot-3" title={label}><Icon size={14} aria-hidden />{withLabel ? <span className="text-xs">{label}</span> : <span className="sr-only">{label}</span>}</span>;
}

export function Progress({ value, max, tone = "ok" }: { value: number; max: number; tone?: "ok" | "warn" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-kalk-3" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full ${tone === "ok" ? "bg-linolja-light" : "bg-ockra"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const ALLOC_COLORS: Record<string, string> = {
  in_use: "#6B7F46", stored: "#A2724D", collected: "#CFC6B4", processing: "#EDCB86", listed: "#D99D36", reserved_out: "#D99D36",
  lent: "#D8D8D3", sold: "#5A4636", donated: "#1F4D2E", exchanged: "#75604F", discarded: "#D8D8D3", discovered: "#EDCB86",
  contacted: "#EDCB86", reserved: "#EDCB86", pickup_planned: "#EDCB86",
};
// Partiets fördelning som stapel: "250 i bruk · 120 i lager · 30 sålda".
export function AllocationBar({ parts }: { parts: { status: string; label: string; quantity: number }[] }) {
  const total = parts.reduce((n, p) => n + Number(p.quantity), 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-kalk-3" aria-hidden>
        {parts.map((p) => <div key={p.status} style={{ width: `${(Number(p.quantity) / total) * 100}%`, background: ALLOC_COLORS[p.status] ?? "#D8D8D3" }} />)}
      </div>
      <div className="mt-1 text-sm text-sot-2">{parts.map((p) => `${Number(p.quantity).toLocaleString("sv-SE")} ${p.label.toLowerCase()}`).join(" · ")}</div>
    </div>
  );
}

// AI-förslag: streckad kant och gnista; osäkra fält (< 0,7) markeras gula.
export function AiBadge({ confidence }: { confidence?: number | null }) {
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  const unsure = confidence != null && confidence < 0.7;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${unsure ? "font-semibold text-rust-pressed" : "text-sot-3"}`} title="Förslag – inte bekräftat">
      <Sparkles size={13} aria-hidden />{pct !== null ? `${pct} %` : "förslag"}{unsure ? " · osäkert" : ""}
    </span>
  );
}

export function Kv({ k, children }: { k: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-sot-3">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export function RefLink({ r }: { r?: { title: string; route?: string | null } | null }) {
  if (!r) return null;
  return r.route ? <Link to={r.route}>{r.title}</Link> : <span>{r.title}</span>;
}

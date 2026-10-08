// Blad som glider upp nerifrån på telefon och visas som dialog på dator. Används för alla snabba handlingar
// (flytta, använd, ändra status, logga) så att användaren stannar kvar på sidan.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])")?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-sot/40 md:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}
        className="flex max-h-[92vh] w-full max-w-falt flex-col rounded-t-2xl bg-kalk shadow-upphojd md:max-w-lg md:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-dashed border-lera px-4 py-3">
          <h2 className="text-xl">{title}</h2>
          <button type="button" data-close className="rounded-full p-2 hover:bg-kalk-2" aria-label="Stäng" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-dashed border-lera px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

// Hjälpare för ett blad med formulär: öppna/stäng, och "spara"-knapp som visar att något pågår.
export function useSheet() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

export function BusyButton({ onClick, children, className = "btn-primary", disabled, type = "button" }: {
  onClick?: () => Promise<unknown> | unknown; children: ReactNode; className?: string; disabled?: boolean; type?: "button" | "submit";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button type={type} className={className} disabled={disabled || busy} aria-busy={busy}
      onClick={async () => { if (!onClick) return; setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>
      {children}
    </button>
  );
}

// Bekräftelse för handlingar som inte går att ångra (radera person, stänga länk).
export function ConfirmButton({ onConfirm, children, question, className = "btn-secondary", confirmLabel = "Ja, gör det" }: {
  onConfirm: () => Promise<unknown> | unknown; children: ReactNode; question: ReactNode; className?: string; confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Är du säker?"
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Avbryt</button>
          <BusyButton className="btn-primary" onClick={async () => { await onConfirm(); setOpen(false); }}>{confirmLabel}</BusyButton>
        </>}>
        <div>{question}</div>
      </Sheet>
    </>
  );
}

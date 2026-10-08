// Appskalet: fem flikar och den röda Fånga-knappen (Designdokument 2.0, Navigering). På dator blir flikarna
// en sidomeny. Fråga Vreta nås från alla sidor; synkstatus syns i toppen när något väntar eller behöver lösas.
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { CloudOff, Inbox, Map, MessageCircleQuestion, Package, Plus, RefreshCw, Search, Settings, Sun, TriangleAlert, Users, PenLine, ListChecks, BookOpen } from "lucide-react";
import { useApp, useCan } from "./AppContext";
import type { JournalEntry, Role } from "../data/repo";
import { Lockup } from "../ui/brand";

const TABS = [
  { to: "/", label: "Idag", icon: Sun, end: true },
  { to: "/saker", label: "Saker", icon: Package },
  { to: "/fanga", label: "Fånga", icon: Plus, capture: true },
  { to: "/manniskor", label: "Människor", icon: Users },
  { to: "/platser", label: "Platser", icon: Map },
];

export function useSyncState() {
  const { repo, version } = useApp();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [online, setOnline] = useState(repo.online());
  useEffect(() => {
    let alive = true;
    repo.journal().then((j) => alive && setEntries(j), () => undefined);
    return () => { alive = false; };
  }, [repo, version]);
  useEffect(() => {
    const on = () => setOnline(repo.online());
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const t = setInterval(on, 5000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); clearInterval(t); };
  }, [repo]);
  return { online, pending: entries.filter((e) => e.status !== "rejected").length, rejected: entries.filter((e) => e.status === "rejected").length, entries };
}

function SyncBadge() {
  const s = useSyncState();
  if (s.online && s.pending === 0 && s.rejected === 0) return null;
  const label = s.rejected ? `${s.rejected} att lösa` : !s.online ? (s.pending ? `Offline · ${s.pending} väntar` : "Offline") : `${s.pending} synkas`;
  return (
    <Link to="/synk" className={`flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-sm font-semibold no-underline ${s.rejected ? "bg-falu text-kalk" : "bg-kalk-2 text-sot-2"}`}>
      {s.rejected ? <TriangleAlert size={15} /> : !s.online ? <CloudOff size={15} /> : <RefreshCw size={15} className="animate-spin" />}
      {label}
    </Link>
  );
}

function DemoSwitcher() {
  const { repo } = useApp();
  const users = repo.demoUsers?.();
  if (!users) return null;
  const current = users.find((u) => u.current);
  return (
    <label className="flex items-center gap-1 text-sm text-sot-3">
      <span className="hidden sm:inline">Demo som</span>
      <select className="rounded-md border border-lera bg-papper px-2 py-1 text-sm text-sot" value={current?.role}
        aria-label="Byt demoroll" onChange={(e) => repo.switchDemoUser?.(e.target.value as Role)}>
        {users.map((u) => <option key={u.role} value={u.role}>{u.label}</option>)}
      </select>
    </label>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { ctx, repo } = useApp();
  const can = useCan();
  const loc = useLocation();
  const nav = useNavigate();
  const role = ctx?.role;
  const guest = role === "guest" || (ctx?.is_anonymous && role !== "host");
  const canCapture = can("RecordCapture");
  // Fråga-knappen döljs där sidan har egna knappar längst ner (granskning, formulär)
  const hideAsk = guest || /^\/(fraga|fanga|granska\/|beratta|synk)|\/ny$/.test(loc.pathname);

  // Lämna gästvyn: i demoläget tillbaka till ägaren, annars avslutas den anonyma sessionen
  const leave = async () => {
    if (repo.switchDemoUser) await repo.switchDemoUser("owner");
    else await repo.signOut();
    nav("/", { replace: true });
  };

  if (guest) {
    return (
      <div className="min-h-screen bg-kalk">
        <div className="flex items-center justify-center gap-3 bg-forest px-4 py-2 text-center text-sm text-cream">
          <span>Du ser {ctx?.site?.name ?? "Vreta"} som gäst – bara det som är delat med familj och vänner.</span>
          <button type="button" className="rounded-full border border-cream/50 px-3 py-0.5 font-semibold" onClick={leave}>Lämna</button>
        </div>
        <header className="mx-auto flex max-w-falt items-center justify-between px-4 py-3">
          <Link to="/gast" className="no-underline hover:no-underline"><Lockup size="sm" /></Link>
          <DemoSwitcher />
        </header>
        <main className="mx-auto max-w-falt px-4 pb-16">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-kalk md:flex">
      {/* Sidomeny på dator */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-mist bg-kalk-2/50 px-3 py-4 md:flex">
        <Link to="/" className="mb-6 px-3 pt-1 no-underline hover:no-underline"><Lockup /></Link>
        {canCapture && (
          <Link to="/fanga" className="btn-primary mb-4 justify-start"><Plus size={20} /> Fånga</Link>
        )}
        <nav aria-label="Huvudmeny" className="flex flex-col gap-0.5">
          {TABS.filter((t) => !t.capture).map((t) => <SideLink key={t.to} to={t.to} end={t.end} icon={t.icon}>{t.label}</SideLink>)}
          <div className="my-2 border-t border-mist" />
          {canCapture && <SideLink to="/granska" icon={Inbox}>Granska</SideLink>}
          <SideLink to="/beratta" icon={PenLine}>Berätta</SideLink>
          <SideLink to="/uppgifter" icon={ListChecks}>Uppgifter</SideLink>
          <SideLink to="/journal" icon={BookOpen}>Journal</SideLink>
          <SideLink to="/fraga" icon={MessageCircleQuestion}>Fråga Vreta</SideLink>
          <SideLink to="/sok" icon={Search}>Sök</SideLink>
          <SideLink to="/installningar" icon={Settings}>Inställningar</SideLink>
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-2 text-sm text-sot-3">
          <SyncBadge />
          <DemoSwitcher />
          <span>{ctx?.display_name} · {roleLabel(role)}</span>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Toppfält på telefon */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-mist bg-kalk/95 px-4 py-2 backdrop-blur md:hidden">
          <Link to="/" className="no-underline hover:no-underline"><Lockup size="sm" /></Link>
          <div className="flex items-center gap-1">
            <SyncBadge />
            <DemoSwitcher />
            <Link to="/sok" className="rounded-full p-2 text-forest" aria-label="Sök"><Search size={20} /></Link>
            <Link to="/installningar" className="rounded-full p-2 text-forest" aria-label="Inställningar"><Settings size={20} /></Link>
          </div>
        </header>
        <main className="mx-auto max-w-falt px-4 pb-32 pt-4 md:px-6 md:pb-12">{children}</main>
      </div>

      {/* Fråga Vreta finns på alla sidor */}
      {!hideAsk && (
        <button type="button" onClick={() => nav("/fraga", { state: { from: loc.pathname } })}
          className="fixed bottom-24 right-4 z-30 flex h-12 items-center gap-2 rounded-full border border-mist bg-papper px-4 text-[14px] font-semibold text-forest shadow-upphojd md:bottom-6 md:right-6">
          <MessageCircleQuestion size={20} className="text-rust" /> Fråga
        </button>
      )}

      {/* Flikrad på telefon */}
      <nav aria-label="Huvudmeny" className="fixed inset-x-0 bottom-0 z-40 border-t border-mist bg-papper pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="mx-auto grid max-w-falt grid-cols-5">
          {TABS.map((t) => t.capture ? (
            <li key={t.to} className="flex justify-center">
              {canCapture ? (
                <NavLink to={t.to} aria-label="Fånga" className="-mt-5 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-rust text-white no-underline shadow-upphojd ring-4 ring-papper hover:bg-rust-pressed hover:no-underline">
                  <Plus size={28} strokeWidth={2.5} />
                  <span className="text-[10px] font-semibold">Fånga</span>
                </NavLink>
              ) : <NavLink to="/fraga" className="flex min-h-[60px] flex-col items-center justify-center text-xs text-sot-3 no-underline"><MessageCircleQuestion size={22} />Fråga</NavLink>}
            </li>
          ) : (
            <li key={t.to}>
              <NavLink to={t.to} end={t.end} className={({ isActive }) => `flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs no-underline hover:no-underline ${isActive ? "font-semibold text-forest" : "text-sot-3"}`}>
                <t.icon size={22} aria-hidden />{t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function SideLink({ to, end, icon: Icon, children }: { to: string; end?: boolean; icon: any; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[15px] no-underline hover:bg-kalk-2 hover:no-underline ${isActive ? "bg-forest-pale font-semibold text-forest" : "text-forest"}`}>
      <Icon size={19} aria-hidden />{children}
    </NavLink>
  );
}

export function roleLabel(r?: string | null): string {
  return ({ owner: "Ägare", helper: "Medhjälpare", reader: "Läsare", guest: "Gäst", host: "Värd" } as Record<string, string>)[r ?? ""] ?? "";
}

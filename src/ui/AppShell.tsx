import { Boxes, CloudOff, House, MessageCircle, Plus, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useApp } from "../app/AppContext";
import { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "Idag", icon: Sun },
  { to: "/samla", label: "Samla", icon: Boxes },
  { to: "/vreta", label: "Vreta", icon: House },
  { to: "/fraga", label: "Fråga", icon: MessageCircle },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, online, toastMessage, repo } = useApp();
  const { pathname } = useLocation();
  const canWrite = profile?.role !== "viewer";

  return (
    <div className="min-h-dvh md:flex">
      {/* Dator: vänsterkolumn */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-lera-light bg-kalk-2/60 px-4 py-6 md:flex">
        <NavLink to="/" className="mb-8 px-2">
          <Logo />
        </NavLink>
        {canWrite && (
          <NavLink to="/fanga" className="btn-primary mb-6 w-full">
            <Plus size={18} aria-hidden="true" /> Fånga
          </NavLink>
        )}
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `flex min-h-[44px] items-center gap-3 rounded-md px-3 font-medium ${isActive ? "bg-sot text-kalk" : "text-sot-2 hover:bg-kalk-3/60"}`}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          {repo.kind === "local" && <p className="rounded-md border border-dashed border-ockra px-3 py-2 text-[12px] text-sot-3">Demoläge – data sparas bara i den här webbläsaren.</p>}
          <NavLink to="/installningar" className="flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sot-2 hover:bg-kalk-3/60">
            <Settings size={18} strokeWidth={1.75} aria-hidden="true" /> {profile?.name ?? "Inställningar"}
          </NavLink>
        </div>
      </aside>

      {/* Mobil: toppfält */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-lera-light bg-kalk/90 px-4 py-3 backdrop-blur md:hidden">
        <NavLink to="/">
          <Logo />
        </NavLink>
        <div className="flex items-center gap-1">
          {!online && <CloudOff size={18} className="text-sot-3" aria-label="Offline – sparas lokalt" />}
          <NavLink to="/installningar" className="rounded-md p-2 text-sot-2" aria-label="Inställningar">
            <Settings size={20} strokeWidth={1.75} />
          </NavLink>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-32 pt-6 md:px-10 md:pb-16 md:pt-10">{children}</main>

      {/* Mobil: nedre fält med + i mitten */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-lera-light bg-kalk/95 backdrop-blur md:hidden" aria-label="Huvudmeny">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end">
          {[NAV[0], NAV[1]].map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${isActive ? "text-falu" : "text-sot-3"}`}>
              <Icon size={22} strokeWidth={1.75} aria-hidden="true" /> {label}
            </NavLink>
          ))}
          <div className="flex justify-center">
            {canWrite ? (
              <NavLink to="/fanga" aria-label="Fånga" className={`-mt-6 flex h-16 w-16 items-center justify-center rounded-full border-4 border-kalk bg-falu text-kalk shadow-lg ${pathname === "/fanga" ? "ring-2 ring-falu/40" : ""}`}>
                <Plus size={30} strokeWidth={2.25} />
              </NavLink>
            ) : (
              <span className="h-16 w-16" />
            )}
          </div>
          {[NAV[2], NAV[3]].map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${isActive ? "text-falu" : "text-sot-3"}`}>
              <Icon size={22} strokeWidth={1.75} aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {toastMessage && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-sm rounded-md bg-sot px-4 py-3 text-center text-sm text-kalk shadow-lg md:bottom-8">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

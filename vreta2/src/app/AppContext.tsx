import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MODE } from "../config";
import type { AnyCommandResult, Repo, Role, Session } from "../data/repo";
import { reasonCode, reasonText } from "../data/pglite/engine";
import { useToast } from "./toast";

export type CodeValue = { code: string; label: string; parent?: string | null; sort: number; attributes: Record<string, any>; site: boolean; id: string };
export type CatalogEntry = { type: string; version: number; label: string; context: string; offline_class: string; roles: Role[]; feature: string; requires_own_tap: boolean };
export type AppCtx = {
  user_id: string | null;
  is_anonymous: boolean;
  sites: { site_id: string; name: string; role: Role; display_name: string }[];
  site: { id: string; name: string; slug: string; description: string; timezone: string; approx_lat?: number; approx_lon?: number } | null;
  role: Role | null;
  display_name: string | null;
  flags: Record<string, boolean>;
  settings: Record<string, any>;
  catalog: CatalogEntry[];
  states: Record<string, { state: string; label: string; terminal: boolean }[]>;
  transitions: Record<string, Record<string, string[]>>;
  entity_types: Record<string, { label: string; plural: string; route: string | null; context: string; is_place: boolean; simple_fields: string[]; ui_release: string }>;
  codes: Record<string, CodeValue[]>;
  categories: { id: string; code: string; name: string; parent_id: string | null; default_unit: string | null }[];
  members: { membership_id: string; user_id: string; role: Role; display_name: string }[];
};

type Phase = "starting" | "login" | "bootstrap" | "ready" | "error";
type State = {
  repo: Repo;
  phase: Phase;
  progress: string;
  error: string | null;
  session: Session | null;
  ctx: AppCtx | null;
  version: number;
  refreshContext: () => Promise<void>;
  setPhase: (p: Phase) => void;
};

const AppContext = createContext<State | null>(null);

async function createRepo(): Promise<Repo> {
  if (MODE === "supabase") {
    const { SupabaseRepo } = await import("../data/supabase/supabaseRepo");
    return new SupabaseRepo();
  }
  const { DemoRepo } = await import("../data/pglite/demoRepo");
  return new DemoRepo();
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [progress, setProgress] = useState("Startar …");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<AppCtx | null>(null);
  const [version, setVersion] = useState(0);
  const sessionId = useRef<string | null>(null);

  const loadContext = useCallback(async (r: Repo) => {
    const s = await r.session();
    setSession(s);
    sessionId.current = s?.user_id ?? null;
    if (!s) { setCtx(null); setPhase(location.hash.includes("/gast/") || location.pathname.includes("/gast/") ? "ready" : "login"); return; }
    const c = await r.query<AppCtx>("q_context");
    if (r.mode === "supabase") (r as any).setCatalog?.(c.catalog);
    setCtx(c);
    setPhase(c.sites.length === 0 && !c.is_anonymous ? "bootstrap" : "ready");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await createRepo();
        if (!alive) return;
        setRepo(r);
        await r.init((m) => alive && setProgress(m));
        await loadContext(r);
        r.subscribe(async () => {
          setVersion((v) => v + 1);
          const s = await r.session();
          if ((s?.user_id ?? null) !== sessionId.current) await loadContext(r);
        });
      } catch (e) {
        console.error(e);
        if (alive) { setError((e as Error).message); setPhase("error"); }
      }
    })();
    return () => { alive = false; };
  }, [loadContext]);

  const refreshContext = useCallback(async () => { if (repo) await loadContext(repo); }, [repo, loadContext]);

  const value = useMemo<State | null>(() => repo ? { repo, phase, progress, error, session, ctx, version, refreshContext, setPhase } : null,
    [repo, phase, progress, error, session, ctx, version, refreshContext]);

  if (!value) {
    return <Starting progress={progress} error={error} />;
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function Starting({ progress, error }: { progress: string; error?: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-kalk p-8 text-center">
      <div className="font-serif text-4xl text-falu">VRETA</div>
      {error ? <p className="max-w-sm text-falu">{error}</p> : <p className="text-sot-3" aria-live="polite">{progress}</p>}
      {!error && <div className="h-1 w-40 overflow-hidden rounded bg-kalk-3"><div className="h-full w-1/3 animate-pulse rounded bg-falu" /></div>}
    </div>
  );
}

export function useApp(): State {
  const s = useContext(AppContext);
  if (!s) throw new Error("useApp utanför AppProvider");
  return s;
}

export function useRole(): Role | null {
  return useApp().ctx?.role ?? null;
}

// Kan den inloggade köra kommandot? (Servern avgör alltid; det här styr bara vad som visas.)
export function useCan() {
  const { ctx } = useApp();
  return useCallback((type: string) => {
    const c = ctx?.catalog.find((x) => x.type === type);
    if (!c || !ctx?.role) return false;
    if (!c.roles.includes(ctx.role)) return false;
    return c.feature === "core" || ctx.flags[c.feature] === true;
  }, [ctx]);
}

export function useFlag(flag: string): boolean {
  return !!useApp().ctx?.flags[flag];
}

export function useQuery<T = any>(name: string | null, params: Record<string, unknown> = {}) {
  const { repo, version, ctx } = useApp();
  const key = name ? `${name}:${JSON.stringify(params)}` : null;
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; key: string | null }>({ data: null, error: null, loading: !!name, key: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!name || !key) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, ...(s.key !== key ? { data: null } : {}) }));
    repo.query<T>(name, params).then(
      (data) => alive && setState({ data, error: null, loading: false, key }),
      (e) => alive && setState((s) => ({ ...s, error: reasonText((e as Error).message), loading: false, key })),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, tick, ctx?.user_id]);
  return { data: state.data, error: state.error, loading: state.loading && state.data === null, refreshing: state.loading, reload: () => setTick((t) => t + 1) };
}

export type RunOptions = { success?: string; silent?: boolean; label?: string; onRejected?: (r: { reason?: string; suggestion?: any; code: string }) => void };

export function useCommand() {
  const { repo } = useApp();
  const toast = useToast();
  return useCallback(async function run<T = any>(type: string, payload: Record<string, unknown>, opts: RunOptions = {}): Promise<T | null> {
    try {
      const r: AnyCommandResult<T> = await repo.command<T>(type, payload, { label: opts.label });
      if (r.status === "accepted" || r.status === "superseded") {
        if (opts.success) toast(opts.success);
        return (r as any).result ?? ({} as T);
      }
      if (r.status === "queued") {
        toast("Sparat på telefonen – synkas när nätet kommer tillbaka", "info");
        return { queued: true } as unknown as T;
      }
      const code = reasonCode(r.reason);
      if (opts.onRejected) opts.onRejected({ reason: r.reason, suggestion: (r as any).suggestion, code });
      if (!opts.silent) toast(reasonText(r.reason), "error");
      return null;
    } catch (e) {
      toast(reasonText((e as Error).message), "error");
      return null;
    }
  }, [repo, toast]);
}

export function useLabels() {
  const { ctx } = useApp();
  return useMemo(() => {
    const state = (machine: string, s?: string | null) => ctx?.states[machine]?.find((x) => x.state === s)?.label ?? s ?? "";
    const code = (list: string, c?: string | null) => ctx?.codes[list]?.find((x) => x.code === c)?.label ?? c ?? "";
    const codes = (list: string) => ctx?.codes[list] ?? [];
    const route = (type?: string | null, id?: string | null) => {
      const r = type ? ctx?.entity_types[type]?.route : null;
      return r && id ? r.replace(":id", id) : null;
    };
    const typeLabel = (type?: string | null) => (type ? ctx?.entity_types[type]?.label ?? type : "");
    const next = (machine: string, s: string) => ctx?.transitions[machine]?.[s] ?? [];
    return { state, code, codes, route, typeLabel, next };
  }, [ctx]);
}

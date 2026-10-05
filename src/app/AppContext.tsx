import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRepo, type Repo } from "../data";
import { LocalRepo } from "../data/localRepo";
import { seedDemo } from "../data/demoSeed";
import type { Profile, Site } from "../domain/types";
import { processPendingCaptures } from "../services/captureAgent";

interface AppState {
  repo: Repo;
  profile: Profile | null;
  site: Site | null;
  ready: boolean;
  online: boolean;
  version: number;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  toastMessage: string | null;
  pending: number;
}

const Ctx = createContext<AppState | null>(null);
let seeding: Promise<void> | null = null;

export function AppProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => createRepo(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [toastMessage, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  const sync = useCallback(async () => {
    if (!navigator.onLine || !(await repo.session())) return;
    const sent = (await repo.flushOutbox?.()) ?? 0;
    const tolkade = await processPendingCaptures(repo);
    if (sent || tolkade) {
      setToast(tolkade ? `Synkat. ${tolkade} fångst${tolkade > 1 ? "er" : ""} väntar på granskning.` : "Synkat");
      setVersion((v) => v + 1);
    }
  }, [repo]);

  const refresh = useCallback(async () => {
    const p = await repo.session();
    setProfile(p);
    setSite(p ? await repo.site() : null);
    setVersion((v) => v + 1);
  }, [repo]);

  useEffect(() => {
    (async () => {
      if (repo instanceof LocalRepo) await (seeding ??= seedDemo(repo));
      await refresh();
      setReady(true);
      await sync();
    })();
  }, [repo, refresh, sync]);

  useEffect(() => {
    repo.pendingSync?.().then(setPending);
  }, [repo, version, toastMessage]);

  useEffect(() => {
    const on = async () => {
      setOnline(true);
      await sync();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [sync]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const value: AppState = { repo, profile, site, ready, online, version, refresh, toast: setToast, toastMessage, pending };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp utanför AppProvider");
  return v;
}

/** Laddar data och laddar om när appens version ändras (efter skrivningar). */
export function useData<T>(load: (repo: Repo) => Promise<T>, deps: unknown[] = []): { data: T | undefined; reload: () => void; error: string | null } {
  const { repo, version } = useApp();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    load(repo)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, version, tick, ...deps]);
  return { data, reload: () => setTick((t) => t + 1), error };
}

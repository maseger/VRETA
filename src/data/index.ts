import { LocalRepo } from "./localRepo";
import type { Repo } from "./repo";
import { OfflineSupabaseRepo } from "./offlineSupabaseRepo";

export function createRepo(): Repo {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) return new OfflineSupabaseRepo(url, key);
  return new LocalRepo();
}

export type { Repo } from "./repo";

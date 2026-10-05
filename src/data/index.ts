import { LocalRepo } from "./localRepo";
import type { Repo } from "./repo";
import { SupabaseRepo } from "./supabaseRepo";

export function createRepo(): Repo {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) return new SupabaseRepo(url, key);
  return new LocalRepo();
}

export type { Repo } from "./repo";

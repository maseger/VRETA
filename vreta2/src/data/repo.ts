// Datalagret i appen (Repo): ett gränssnitt med tre implementationer – lokalt i webbläsaren (demoläge),
// Supabase, och Supabase med offlinecache. Repo exponerar kommandon och frågor; appen känner inga
// affärsregler (Designdokument 2.0, Målarkitektur).
import type { CommandOptions, CommandResult } from "./pglite/engine";

export type { CommandOptions, CommandResult };
export type Role = "owner" | "helper" | "reader" | "guest" | "host";
export type QueuedResult = { status: "queued"; key: string };
export type AnyCommandResult<T = any> = CommandResult<T> | QueuedResult;

export type Session = { user_id: string; is_anonymous: boolean; email?: string | null };

export type MediaInput = {
  file: Blob;
  kind: "photo" | "audio" | "video" | "document";
  filename?: string;
  caption?: string;
  hasPeople?: boolean;
  transcript?: string;
  // Kartunderlag: större delningsversion i WebP
  map?: boolean;
};

export type JournalEntry = {
  key: string;
  type: string;
  payload: Record<string, unknown>;
  client_time: string;
  label?: string;
  status: "pending" | "rejected" | "sending";
  reason?: string;
  attempts: number;
};

export interface Repo {
  readonly mode: "demo" | "supabase";
  init(onProgress?: (msg: string) => void): Promise<void>;
  session(): Promise<Session | null>;
  signOut(): Promise<void>;
  command<T = any>(type: string, payload: Record<string, unknown>, opts?: CommandOptions & { offlineClass?: string; label?: string }): Promise<AnyCommandResult<T>>;
  query<T = any>(name: string, params?: Record<string, unknown>): Promise<T>;
  api<T = any>(fn: string, params?: Record<string, unknown>): Promise<T>;
  processJobs(): Promise<void>;
  uploadMedia(input: MediaInput, siteId: string): Promise<string>;
  mediaUrl(path: string | null | undefined): Promise<string | null>;
  invoke<T = any>(fn: string, body: Record<string, unknown>): Promise<T>;
  journal(): Promise<JournalEntry[]>;
  flush(): Promise<void>;
  online(): boolean;
  subscribe(listener: () => void): () => void;
  // Inloggning (Supabase)
  signInWithEmail?(email: string): Promise<void>;
  signInWithPassword?(email: string, password: string): Promise<void>;
  updatePassword?(password: string): Promise<void>;
  signInAnonymously?(): Promise<void>;
  // Demoläge
  demoUsers?(): { role: Role; label: string; current: boolean }[];
  switchDemoUser?(role: Role): Promise<void>;
  resetDemo?(): Promise<void>;
  guestToken?(): Promise<string | null>;
}

export function newKey(): string {
  return crypto.randomUUID();
}

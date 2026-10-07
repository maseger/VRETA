// Repo mot Supabase med offlinecache: kommandon via api.run_command, frågor via api.q_*, filer i Storage.
// Utan nät köas kommandon i journalen (utom känsliga, som kräver nät) och frågor läses från cachen.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AnyCommandResult, CommandOptions, JournalEntry, MediaInput, Repo, Session } from "../repo";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../../config";
import { cacheGet, cachePut, enqueue, entries, remove, update } from "./journal";
import { deleteBlob, getBlob, putBlob } from "../mediaStore";
import { extOf, makeDerivatives } from "../../services/images";

function isNetworkError(e: unknown): boolean {
  const m = String((e as any)?.message ?? e);
  return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network|fetch failed/i.test(m);
}

export class SupabaseRepo implements Repo {
  readonly mode = "supabase" as const;
  readonly client: SupabaseClient<any, any, any>;
  private listeners = new Set<() => void>();
  private flushing = false;
  private signed = new Map<string, { url: string; until: number }>();
  private offlineClass = new Map<string, string>();

  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: "api" },
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    window.addEventListener("online", () => { this.flush().catch(() => undefined); });
    this.client.auth.onAuthStateChange(() => this.emit());
  }

  async init(): Promise<void> {
    await this.client.auth.getSession();
    if (navigator.onLine) this.flush().catch(() => undefined);
    setInterval(() => { if (navigator.onLine) this.flush().catch(() => undefined); }, 30_000);
  }

  async session(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    const u = data.session?.user;
    return u ? { user_id: u.id, is_anonymous: !!(u as any).is_anonymous, email: u.email } : null;
  }
  async signOut(): Promise<void> { await this.client.auth.signOut(); this.emit(); }
  async signInWithEmail(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0] } });
    if (error) throw error;
  }
  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.emit();
  }
  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw error;
  }
  async signInAnonymously(): Promise<void> {
    const { error } = await this.client.auth.signInAnonymously();
    if (error) throw error;
  }

  // Kommandoklassen avgör vad som får köas offline (Designdokument 2.0, Kommandon och offline).
  setCatalog(catalog: { type: string; offline_class: string }[]) {
    for (const c of catalog) this.offlineClass.set(c.type, c.offline_class);
  }

  async command<T = any>(type: string, payload: Record<string, unknown>, opts: CommandOptions & { label?: string } = {}): Promise<AnyCommandResult<T>> {
    const key = opts.idempotencyKey ?? crypto.randomUUID();
    const klass = this.offlineClass.get(type) ?? "invariant";
    const queue = async (): Promise<AnyCommandResult<T>> => {
      if (klass === "sensitive") throw new Error("Det här kräver nät – försök igen när du har täckning");
      await enqueue({ key, type, payload, client_time: new Date().toISOString(), status: "pending", attempts: 0, label: opts.label });
      this.emit();
      return { status: "queued", key };
    };
    if (!navigator.onLine) return queue();
    try {
      const r = await this.rpcCommand<T>(type, payload, key, opts.clientTime, opts.origin ?? "online", opts.agent);
      if (r.status === "accepted") { this.emit(); this.kickJobs(); }
      return r;
    } catch (e) {
      if (isNetworkError(e)) return queue();
      throw e;
    }
  }

  private async rpcCommand<T>(type: string, payload: Record<string, unknown>, key: string, clientTime?: string, origin = "online", agent?: string) {
    const { data, error } = await this.client.rpc("run_command", {
      p_type: type, p_payload: payload, p_idempotency_key: key, p_version: 1, p_client_time: clientTime ?? null,
      p_site_id: null, p_origin: origin, p_agent: agent ?? null,
    });
    if (error) throw error;
    return data as AnyCommandResult<T>;
  }

  async query<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    const cacheKey = `${name}:${JSON.stringify(params)}`;
    try {
      const { data, error } = await this.client.rpc(name, { p: params });
      if (error) throw error;
      cachePut(cacheKey, data).catch(() => undefined);
      return data as T;
    } catch (e) {
      if (isNetworkError(e)) {
        const c = await cacheGet(cacheKey);
        if (c) return c.value as T;
      }
      throw e;
    }
  }

  async api<T = any>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(fn, { p: params });
    if (error) throw error;
    return data as T;
  }

  async processJobs(): Promise<void> {
    const { error } = await this.client.rpc("process_jobs", { p_max: 50 });
    if (!error) this.emit();
  }
  private jobsTimer: ReturnType<typeof setTimeout> | null = null;
  private kickJobs() {
    if (this.jobsTimer) clearTimeout(this.jobsTimer);
    this.jobsTimer = setTimeout(() => { this.processJobs().catch(() => undefined); }, 400);
  }

  async uploadMedia(input: MediaInput, siteId: string): Promise<string> {
    const id = crypto.randomUUID();
    const ext = extOf(input.file.type);
    const files: [string, Blob][] = [[`${siteId}/${id}/original.${ext}`, input.file]];
    let share: string | null = null;
    let thumb: string | null = null;
    let width: number | undefined;
    let height: number | undefined;
    if (input.kind === "photo") {
      const d = await makeDerivatives(input.file);
      share = `${siteId}/${id}/share.${extOf(d.share.type, "jpg")}`;
      thumb = `${siteId}/${id}/thumb.${extOf(d.thumb.type, "jpg")}`;
      files.push([share, d.share], [thumb, d.thumb]);
      width = d.width;
      height = d.height;
    }
    // Filerna sparas lokalt först så att inget går förlorat offline; laddas upp före kommandot.
    for (const [path, blob] of files) await putBlob(`pending/${path}`, blob);
    const payload = {
      id, kind: input.kind, mime_type: input.file.type, byte_size: input.file.size, width, height, caption: input.caption,
      transcript: input.transcript, has_people: !!input.hasPeople, share_path: share, thumb_path: thumb, original_path: files[0][0],
      original_filename: input.filename, _files: files.map(([p]) => p),
    };
    if (navigator.onLine) {
      try {
        await this.uploadPending(files.map(([p]) => p));
        const r = await this.command("RegisterMedia", { ...payload, _files: undefined });
        if (r.status === "rejected") throw new Error(r.reason);
        return id;
      } catch (e) {
        if (!isNetworkError(e)) throw e;
      }
    }
    await enqueue({ key: crypto.randomUUID(), type: "RegisterMedia", payload, client_time: new Date().toISOString(), status: "pending", attempts: 0, label: "Bild" });
    this.emit();
    return id;
  }

  private async uploadPending(paths: string[]) {
    for (const path of paths) {
      const blob = await getBlob(`pending/${path}`);
      if (!blob) continue;
      const { error } = await this.client.storage.from("media").upload(path, blob, { contentType: blob.type, upsert: true });
      if (error && !/exists/i.test(error.message)) throw error;
      await deleteBlob(`pending/${path}`);
    }
  }

  async mediaUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const local = await getBlob(`pending/${path}`);
    if (local) return URL.createObjectURL(local);
    const c = this.signed.get(path);
    if (c && c.until > Date.now()) return c.url;
    const { data, error } = await this.client.storage.from("media").createSignedUrl(path, 3600);
    if (error || !data) return null;
    this.signed.set(path, { url: data.signedUrl, until: Date.now() + 3_300_000 });
    return data.signedUrl;
  }

  async invoke<T = any>(fn: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke(fn, { body });
    if (error) throw error;
    return data as T;
  }

  async journal(): Promise<JournalEntry[]> {
    return entries();
  }

  async flush(): Promise<void> {
    if (this.flushing || !navigator.onLine) return;
    this.flushing = true;
    let changed = false;
    try {
      for (const e of await entries()) {
        if (e.status === "rejected") continue;
        try {
          const files = (e.payload as any)._files as string[] | undefined;
          if (files) await this.uploadPending(files);
          const payload = { ...e.payload };
          delete (payload as any)._files;
          const r = await this.rpcCommand(e.type, payload, e.key, e.client_time, "offline");
          changed = true;
          if (r.status === "rejected") await update({ ...e, status: "rejected", reason: (r as any).reason, attempts: e.attempts + 1 });
          else await remove(e.key);
        } catch (err) {
          if (isNetworkError(err)) break;
          await update({ ...e, attempts: e.attempts + 1, reason: String((err as Error).message), status: e.attempts >= 4 ? "rejected" : "pending" });
        }
      }
    } finally {
      this.flushing = false;
      if (changed) { this.emit(); this.kickJobs(); }
    }
  }

  async dropJournalEntry(key: string): Promise<void> {
    await remove(key);
    this.emit();
  }

  online(): boolean { return navigator.onLine; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() { for (const l of this.listeners) l(); }
}

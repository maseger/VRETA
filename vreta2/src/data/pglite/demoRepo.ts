// Repo för demoläget: Domain API i PGlite (Web Worker), filer i IndexedDB, och demoanvändare för varje roll.
import type { AnyCommandResult, JournalEntry, MediaInput, Repo, Role, Session } from "../repo";
import type { Claims, CommandOptions } from "./engine";
import { blobUrl, clearBlobs, putBlob } from "../mediaStore";
import { extOf, makeDerivatives } from "../../services/images";
import { seedDemo } from "../seed/demoSeed";
import { illustration } from "./demoIllustrations";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
const ROLE_KEY = "vreta2-demo-role";
const ROLES: { role: Role; label: string; email: string; anon?: boolean }[] = [
  { role: "owner", label: "Ägare", email: "agare@demo.vreta" },
  { role: "helper", label: "Medhjälpare", email: "medhjalpare@demo.vreta" },
  { role: "reader", label: "Läsare", email: "lasare@demo.vreta" },
  { role: "guest", label: "Gäst (via gästlänk)", email: "gast@demo.vreta", anon: true },
];

export class DemoRepo implements Repo {
  readonly mode = "demo" as const;
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<() => void>();
  private onProgress?: (m: string) => void;
  private users = new Map<Role, string>();
  private role: Role = (localStorage.getItem(ROLE_KEY) as Role) || "owner";
  private jobsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => {
      const { id, ok, result, error, progress } = e.data;
      if (progress) { this.onProgress?.(progress); return; }
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result); else p.reject(new Error(error));
    };
  }

  private rpc<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, ...args });
    });
  }

  private claims(role: Role = this.role): Claims {
    const id = this.users.get(role);
    return { sub: id, role: "authenticated", is_anonymous: role === "guest" };
  }

  async init(onProgress?: (msg: string) => void): Promise<void> {
    this.onProgress = onProgress;
    const { fresh } = await this.rpc<{ fresh: boolean }>("init");
    await this.loadOrCreateUsers();
    if (fresh) {
      onProgress?.("Lägger in exempeldata från Vreta …");
      await clearBlobs();
      await this.seed();
    }
    if (this.role === "guest") await this.ensureGuest();
    onProgress?.("Klart");
  }

  private async loadOrCreateUsers() {
    for (const u of ROLES) {
      const rows = await this.rpc<{ id: string }[]>("sql", { text: "select id from auth.users where email = $1", params: [u.email] });
      let id = rows[0]?.id;
      if (!id) {
        id = crypto.randomUUID();
        await this.rpc("sql", { text: "insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)", params: [id, u.email, !!u.anon] });
      }
      this.users.set(u.role, id);
    }
  }

  private async seed() {
    const asRole = (as: "owner" | "helper" | "reader") => this.claims(as);
    const ids = await seedDemo({
      bootstrap: (params) => this.rpc("api", { claims: asRole("owner"), fn: "bootstrap_site", params }),
      ok: async (as, type, payload) => {
        const r = await this.rpc("command", { claims: asRole(as), type, payload, opts: {} });
        if (r.status !== "accepted") throw new Error(`${type}: ${r.reason}`);
        return r.result;
      },
      join: async (as, token) => { await this.rpc("api", { claims: asRole(as), fn: "redeem_guest_link", params: { token } }); },
      media: async (_as, spec) => {
        const site = (await this.rpc<any>("query", { claims: asRole("owner"), name: "q_context", params: {} })).site.id;
        const blob = illustration(spec.kind, spec.title, spec.color);
        const id = crypto.randomUUID();
        const path = `${site}/${id}/share.svg`;
        await putBlob(path, blob);
        const r = await this.rpc("command", { claims: asRole("owner"), type: "RegisterMedia", payload: {
          id, kind: "photo", mime_type: "image/svg+xml", byte_size: blob.size, width: 800, height: 600, caption: spec.title,
          share_path: path, thumb_path: path, original_path: path, has_people: !!spec.people } });
        if (r.status !== "accepted") throw new Error(r.reason);
        return id;
      },
    });
    localStorage.setItem("vreta2-demo-guest-token", ids.guest_token);
    await this.rpc("jobs", { claims: asRole("owner") });
  }

  private async ensureGuest() {
    const token = localStorage.getItem("vreta2-demo-guest-token");
    if (!token) return;
    try { await this.rpc("api", { claims: this.claims("guest"), fn: "redeem_guest_link", params: { token } }); } catch { /* stängd länk */ }
  }

  async session(): Promise<Session | null> {
    return { user_id: this.users.get(this.role)!, is_anonymous: this.role === "guest", email: ROLES.find((r) => r.role === this.role)?.email };
  }
  async signOut(): Promise<void> { await this.switchDemoUser("owner"); }

  demoUsers() {
    return ROLES.map((r) => ({ role: r.role, label: r.label, current: r.role === this.role }));
  }
  async switchDemoUser(role: Role): Promise<void> {
    this.role = role;
    localStorage.setItem(ROLE_KEY, role);
    if (role === "guest") await this.ensureGuest();
    this.emit();
  }
  async guestToken(): Promise<string | null> {
    return localStorage.getItem("vreta2-demo-guest-token");
  }
  async resetDemo(): Promise<void> {
    this.onProgress?.("Börjar om …");
    await this.rpc("reset");
    await this.loadOrCreateUsers();
    await clearBlobs();
    await this.seed();
    this.emit();
  }

  async command<T = any>(type: string, payload: Record<string, unknown>, opts: CommandOptions = {}): Promise<AnyCommandResult<T>> {
    const r = await this.rpc("command", { claims: this.claims(), type, payload, opts: { ...opts, idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID() } });
    if (r.status === "accepted") { this.emit(); this.scheduleJobs(); }
    return r;
  }
  query<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.rpc("query", { claims: this.claims(), name, params });
  }
  api<T = any>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.rpc("api", { claims: this.claims(), fn, params });
  }
  async processJobs(): Promise<void> {
    if (this.role === "guest") return;
    const n = await this.rpc<number>("jobs", { claims: this.role === "host" ? this.claims("owner") : this.claims() });
    if (n > 0) this.emit();
  }
  private scheduleJobs() {
    if (this.jobsTimer) clearTimeout(this.jobsTimer);
    this.jobsTimer = setTimeout(() => { this.processJobs().catch(() => undefined); }, 250);
  }

  async uploadMedia(input: MediaInput, siteId: string): Promise<string> {
    const id = crypto.randomUUID();
    const ext = extOf(input.file.type);
    const original = `${siteId}/${id}/original.${ext}`;
    await putBlob(original, input.file);
    let share: string | null = null;
    let thumb: string | null = null;
    let width: number | undefined;
    let height: number | undefined;
    if (input.kind === "photo") {
      const d = await makeDerivatives(input.file, input.map ? { max: 4096, type: "image/webp" } : {});
      share = `${siteId}/${id}/share.${extOf(d.share.type, "jpg")}`;
      thumb = `${siteId}/${id}/thumb.${extOf(d.thumb.type, "jpg")}`;
      await putBlob(share, d.share);
      await putBlob(thumb, d.thumb);
      width = d.width;
      height = d.height;
    }
    const r = await this.command("RegisterMedia", {
      id, kind: input.kind, mime_type: input.file.type, byte_size: input.file.size, width, height, caption: input.caption,
      transcript: input.transcript, has_people: !!input.hasPeople, share_path: share, thumb_path: thumb, original_path: original,
      original_filename: input.filename,
    });
    if (r.status !== "accepted") throw new Error((r as any).reason ?? "Kunde inte spara filen");
    return id;
  }
  async mediaUrl(path: string | null | undefined): Promise<string | null> {
    return path ? blobUrl(path) : null;
  }
  async invoke<T = any>(fn: string): Promise<T> {
    throw Object.assign(new Error(`Serverfunktionen ${fn} finns inte i demoläget`), { code: "no_server" });
  }
  async journal(): Promise<JournalEntry[]> { return []; }
  async flush(): Promise<void> { /* demoläget har ingen server att synka mot */ }
  online(): boolean { return true; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() { for (const l of this.listeners) l(); }
}

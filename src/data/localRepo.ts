// Lokal implementation av datalagret i IndexedDB. Används i demoläge och följer samma
// regler som databasen: tillståndsmaskin, INV-05, roller, privata fält och audit.
import { openDB, type IDBPDatabase } from "idb";
import { assertTransition } from "../domain/stateMachine";
import type {
  Acquisition, AuditEntry, Capture, CaptureInput, ContentItem, EventLink, EventRec, Media, ObjectStatus, Person,
  Profile, Proposal, ProposalContent, Role, Site, StoryNote, Structure, Task, VObject, Zone,
} from "../domain/types";
import type { StoryRows } from "../../supabase/functions/_shared/storyContext";
import { PermissionError, type ApproveInput, type MediaInput, type PlaceRef, type Repo } from "./repo";

const STORES = [
  "sites", "zones", "structures", "objects", "persons", "person_private", "acquisitions", "acquisition_private",
  "media", "blobs", "captures", "proposals", "events", "event_links", "story_notes", "content_items", "tasks",
  "audit_entries", "meta",
] as const;
type Store = (typeof STORES)[number];

interface PersonPrivate { person_id: string; site_id: string; contact: string; notes: string; created_by: string }
interface AcqPrivate { acquisition_id: string; site_id: string; price: number | null; payment_method: string; created_by: string }

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

export class LocalRepo implements Repo {
  readonly kind = "local" as const;
  private dbp: Promise<IDBPDatabase>;

  constructor(dbName = "vreta-demo") {
    this.dbp = openDB(dbName, 1, {
      upgrade(db) {
        for (const s of STORES) {
          const key = s === "person_private" ? "person_id" : s === "acquisition_private" ? "acquisition_id" : s === "blobs" || s === "meta" ? undefined : "id";
          db.createObjectStore(s, key ? { keyPath: key } : undefined);
        }
      },
    });
  }

  // ------------------------------------------------------------ hjälpfunktioner
  private async all<T>(store: Store): Promise<T[]> {
    return (await (await this.dbp).getAll(store)) as T[];
  }
  private async get<T>(store: Store, key: string): Promise<T | undefined> {
    return (await (await this.dbp).get(store, key)) as T | undefined;
  }
  private async put(store: Store, value: unknown, key?: string): Promise<void> {
    await (await this.dbp).put(store, value, key);
  }

  private async me(): Promise<Profile> {
    const p = await this.session();
    if (!p) throw new PermissionError("Inte inloggad");
    return p;
  }
  private async siteId(): Promise<string> {
    const s = await this.site();
    if (!s) throw new Error("Ingen plats");
    return s.id;
  }
  private async requireWriter(): Promise<Profile> {
    const me = await this.me();
    if (me.role === "viewer") throw new PermissionError("Läsare kan inte registrera");
    return me;
  }
  private async requireOwner(): Promise<Profile> {
    const me = await this.me();
    if (me.role !== "owner") throw new PermissionError("Bara ägaren kan göra detta");
    return me;
  }
  private seesPrivate(me: Profile, createdBy: string) {
    return me.role === "owner" || me.id === createdBy;
  }
  private async base(me: Profile) {
    const t = now();
    return { id: uuid(), site_id: await this.siteId(), created_at: t, created_by: me.id, updated_at: t, archived_at: null };
  }
  private async audit_(me: Profile, action: string, entity_type: string, entity_id: string, before: unknown, after: unknown) {
    const entry: AuditEntry = { id: uuid(), site_id: await this.siteId(), at: now(), actor: me.id, action, entity_type, entity_id, before, after };
    await this.put("audit_entries", entry);
  }
  private async event(me: Profile, event_type: string, summary: string, links: { type: string; id: string; role?: string }[], story_worthy = false) {
    const ev: EventRec = { ...(await this.base(me)), event_type, occurred_at: now(), summary, notes: "", story_worthy, visibility: "shareable" };
    await this.put("events", ev);
    for (const l of links) {
      const link: EventLink = { id: uuid(), event_id: ev.id, entity_type: l.type, entity_id: l.id, role: l.role ?? "subject" };
      await this.put("event_links", link);
    }
    return ev;
  }

  // ------------------------------------------------------------ session
  async session(): Promise<Profile | null> {
    return (await this.get<Profile>("meta", "profile")) ?? null;
  }
  async signInWithEmail(): Promise<void> {}
  async signOut(): Promise<void> {}
  async bootstrapSite(siteName: string, memberName: string): Promise<void> {
    const profile: Profile = { id: "demo-owner", name: memberName, role: "owner" };
    await this.put("meta", profile, "profile");
    const t = now();
    const site: Site = { id: uuid(), name: siteName, description: "", created_at: t, created_by: profile.id, updated_at: t, archived_at: null };
    await this.put("sites", site);
  }
  async setDemoRole(role: Role): Promise<void> {
    const ids: Record<Role, string> = { owner: "demo-owner", contributor: "demo-contributor", viewer: "demo-viewer" };
    const names: Record<Role, string> = { owner: "Ägaren (demo)", contributor: "Medhjälpare (demo)", viewer: "Läsare (demo)" };
    await this.put("meta", { id: ids[role], name: names[role], role } satisfies Profile, "profile");
  }

  // ------------------------------------------------------------ plats
  async site(): Promise<Site | null> {
    return (await this.all<Site>("sites"))[0] ?? null;
  }
  async zones(): Promise<Zone[]> {
    return (await this.all<Zone>("zones")).filter((z) => !z.archived_at).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }
  async createZone(input: Pick<Zone, "name" | "kind" | "notes">): Promise<Zone> {
    const me = await this.requireWriter();
    const z: Zone = { ...(await this.base(me)), ...input, status: "existing" };
    await this.put("zones", z);
    return z;
  }
  async structures(): Promise<Structure[]> {
    return (await this.all<Structure>("structures")).filter((s) => !s.archived_at).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }
  async createStructure(input: Pick<Structure, "name" | "kind" | "notes" | "zone_id">): Promise<Structure> {
    const me = await this.requireWriter();
    const s: Structure = { ...(await this.base(me)), ...input, status: "existing" };
    await this.put("structures", s);
    return s;
  }

  // ------------------------------------------------------------ objekt
  async objects(): Promise<VObject[]> {
    const me = await this.me();
    return (await this.all<VObject>("objects"))
      .filter((o) => !o.archived_at && (o.visibility !== "private" || this.seesPrivate(me, o.created_by)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async object(id: string): Promise<VObject | null> {
    const me = await this.me();
    const o = await this.get<VObject>("objects", id);
    if (!o || (o.visibility === "private" && !this.seesPrivate(me, o.created_by))) return null;
    return o;
  }
  async updateObject(id: string, patch: Partial<VObject>): Promise<void> {
    const me = await this.requireWriter();
    const o = await this.get<VObject>("objects", id);
    if (!o) throw new Error("Objektet finns inte");
    await this.put("objects", { ...o, ...patch, updated_at: now() });
    if (patch.visibility && patch.visibility !== o.visibility) {
      await this.audit_(me, "visibility_change", "object", id, { visibility: o.visibility }, { visibility: patch.visibility });
    }
  }
  async changeStatus(id: string, to: ObjectStatus, place?: PlaceRef): Promise<void> {
    const me = await this.requireWriter();
    const o = await this.get<VObject>("objects", id);
    if (!o) throw new Error("Objektet finns inte");
    assertTransition(o.status, to);
    const next: VObject = { ...o, status: to, updated_at: now() };
    if (place) {
      next.zone_id = place.zone_id ?? next.zone_id;
      next.structure_id = place.structure_id ?? next.structure_id;
    }
    if (to === "in_use" && !next.zone_id && !next.structure_id) {
      throw new Error("Ett objekt i bruk måste ha en plats (zon eller byggnad).");
    }
    await this.put("objects", next);
    await this.event(me, "object.status_changed", `${o.title}: ${o.status} → ${to}`, [{ type: "object", id }]);
    await this.audit_(me, "status_change", "object", id, { status: o.status }, { status: to });
  }

  // ------------------------------------------------------------ media
  async saveMedia(input: MediaInput): Promise<Media> {
    const me = await this.requireWriter();
    const site_id = await this.siteId();
    const originalPath = `${site_id}/${input.id}.orig`;
    const cleanPath = `${site_id}/${input.id}.jpg`;
    await this.put("blobs", input.original, `media-original/${originalPath}`);
    await this.put("blobs", input.clean, `media-clean/${cleanPath}`);
    const t = now();
    const m: Media = {
      id: input.id, site_id, created_at: t, created_by: me.id, updated_at: t, archived_at: null,
      kind: input.mime.startsWith("audio") ? "audio" : "image", original_path: originalPath, clean_path: cleanPath,
      mime: input.mime, width: input.width, height: input.height, caption: "", role: input.role ?? "general",
      has_people: input.has_people ?? false, visibility: "shareable", entity_type: input.entity_type, entity_id: input.entity_id,
    };
    await this.put("media", m);
    return m;
  }
  async mediaFor(entity_type: string, entity_id: string): Promise<Media[]> {
    const me = await this.me();
    return (await this.all<Media>("media"))
      .filter((m) => m.entity_type === entity_type && m.entity_id === entity_id && !m.archived_at)
      .filter((m) => m.visibility !== "private" || this.seesPrivate(me, m.created_by))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async mediaBlob(media: Media): Promise<Blob | null> {
    if (!media.clean_path) return null;
    return (await this.get<Blob>("blobs", `media-clean/${media.clean_path}`)) ?? null;
  }
  async mediaUrl(media: Media, variant: "clean" | "original"): Promise<string | null> {
    if (variant === "original") {
      const me = await this.me();
      if (!this.seesPrivate(me, media.created_by)) return null;
      const b = await this.get<Blob>("blobs", `media-original/${media.original_path}`);
      return b ? URL.createObjectURL(b) : null;
    }
    const b = await this.mediaBlob(media);
    return b ? URL.createObjectURL(b) : null;
  }

  // ------------------------------------------------------------ fångst och förslag
  async saveCapture(id: string, input: CaptureInput): Promise<Capture> {
    const me = await this.requireWriter();
    const c: Capture = { ...(await this.base(me)), id, input, sync_state: "local", proposal_id: null };
    await this.put("captures", c);
    return c;
  }
  private async mine<T extends { created_by: string; archived_at: string | null }>(store: Store): Promise<T[]> {
    const me = await this.me();
    return (await this.all<T>(store)).filter((r) => !r.archived_at && this.seesPrivate(me, r.created_by));
  }
  async capturesWithoutProposal(): Promise<Capture[]> {
    return (await this.mine<Capture>("captures")).filter((c) => !c.proposal_id);
  }
  async capture(id: string): Promise<Capture | null> {
    return (await this.mine<Capture>("captures")).find((c) => c.id === id) ?? null;
  }
  async attachProposal(captureId: string, content: ProposalContent): Promise<Proposal> {
    const me = await this.requireWriter();
    const p: Proposal = { ...(await this.base(me)), capture_id: captureId, status: "pending", content };
    await this.put("proposals", p);
    const c = await this.get<Capture>("captures", captureId);
    if (c) await this.put("captures", { ...c, proposal_id: p.id, sync_state: "synced", updated_at: now() });
    return p;
  }
  async proposals(): Promise<Proposal[]> {
    return (await this.mine<Proposal>("proposals")).filter((p) => p.status === "pending").sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async proposal(id: string): Promise<Proposal | null> {
    return (await this.mine<Proposal>("proposals")).find((p) => p.id === id) ?? null;
  }
  async rejectProposal(id: string): Promise<void> {
    await this.requireWriter();
    const p = await this.get<Proposal>("proposals", id);
    if (p) await this.put("proposals", { ...p, status: "rejected", updated_at: now() });
  }

  async approveProposal(input: ApproveInput): Promise<string> {
    const me = await this.requireWriter();
    const b = await this.base(me);
    const o = input.object;
    const obj: VObject = {
      ...b, title: o.title, category: o.category || "Övrigt", description: o.description, material: o.material,
      dimensions: o.dimensions, era: "", condition: o.condition, is_batch: o.quantity > 1, quantity: o.quantity, unit: o.unit || "st",
      status: "discovered", visibility: "shareable", source_type: "ai_capture", zone_id: null, structure_id: null,
      cover_media_id: input.media_ids[0] ?? null, field_meta: o.field_meta,
    };
    await this.put("objects", obj);

    let personId: string | null = null;
    if (input.person) {
      if (input.person.existing_person_id) personId = input.person.existing_person_id;
      else {
        const p: Person = {
          ...(await this.base(me)), name: input.person.name, locality: input.person.locality,
          roles: [input.acquisition?.type === "gift" ? "Givare" : "Leverantör"],
          consent_name: "ask", consent_image: "ask", consent_contribution: "ask",
        };
        await this.put("persons", p);
        await this.put("person_private", { person_id: p.id, site_id: p.site_id, contact: "", notes: "", created_by: me.id } satisfies PersonPrivate);
        personId = p.id;
      }
    }
    if (input.acquisition) {
      const a: Acquisition = {
        ...(await this.base(me)), object_id: obj.id, person_id: personId, type: input.acquisition.type, status: "lead",
        source_url: "", deadline: input.acquisition.deadline,
      };
      await this.put("acquisitions", a);
      await this.put("acquisition_private", { acquisition_id: a.id, site_id: a.site_id, price: input.acquisition.price, payment_method: "", created_by: me.id } satisfies AcqPrivate);
    }
    if (input.task) {
      const t: Task = { ...(await this.base(me)), title: input.task.title, due: input.task.due, status: "open", entity_type: "object", entity_id: obj.id };
      await this.put("tasks", t);
    }
    if (input.why) {
      await this.addStoryNote({ entity_type: "object", entity_id: obj.id, kind: "why", text: input.why, quote_consent: false });
    }
    for (const id of input.media_ids) {
      const m = await this.get<Media>("media", id);
      if (m) await this.put("media", { ...m, entity_type: "object", entity_id: obj.id });
    }
    const links = [{ type: "object", id: obj.id }];
    if (personId) links.push({ type: "person", id: personId, role: "counterpart" } as { type: string; id: string; role: string });
    await this.event(me, "object.discovered", `Upptäckt: ${obj.title}`, links, true);

    const prop = await this.get<Proposal>("proposals", input.proposal_id);
    if (prop) await this.put("proposals", { ...prop, status: input.partial ? "partially_accepted" : "accepted", updated_at: now() });
    await this.audit_(me, "create_from_proposal", "object", obj.id, null, input);
    return obj.id;
  }

  // ------------------------------------------------------------ människor
  async persons(): Promise<Person[]> {
    const me = await this.me();
    const priv = await this.all<PersonPrivate>("person_private");
    return (await this.all<Person>("persons"))
      .filter((p) => !p.archived_at)
      .map((p) => {
        const pp = priv.find((x) => x.person_id === p.id);
        return pp && this.seesPrivate(me, pp.created_by) ? { ...p, contact: pp.contact, notes: pp.notes } : p;
      });
  }
  async person(id: string): Promise<Person | null> {
    return (await this.persons()).find((p) => p.id === id) ?? null;
  }
  async updateConsent(id: string, patch: Partial<Pick<Person, "consent_name" | "consent_image" | "consent_contribution">>): Promise<void> {
    const me = await this.requireOwner();
    const p = await this.get<Person>("persons", id);
    if (!p) return;
    await this.put("persons", { ...p, ...patch, updated_at: now() });
    await this.audit_(me, "consent_change", "person", id,
      { name: p.consent_name, image: p.consent_image, contribution: p.consent_contribution },
      { name: patch.consent_name ?? p.consent_name, image: patch.consent_image ?? p.consent_image, contribution: patch.consent_contribution ?? p.consent_contribution });
  }
  async acquisitionsFor(objectId: string): Promise<Acquisition[]> {
    const me = await this.me();
    const priv = await this.all<AcqPrivate>("acquisition_private");
    return (await this.all<Acquisition>("acquisitions"))
      .filter((a) => a.object_id === objectId)
      .map((a) => {
        const ap = priv.find((x) => x.acquisition_id === a.id);
        return ap && this.seesPrivate(me, ap.created_by) ? { ...a, price: ap.price, payment_method: ap.payment_method } : a;
      });
  }

  // ------------------------------------------------------------ historik och berättande
  async eventsFor(entity_type: string, entity_id: string): Promise<EventRec[]> {
    const links = (await this.all<EventLink>("event_links")).filter((l) => l.entity_type === entity_type && l.entity_id === entity_id);
    const ids = new Set(links.map((l) => l.event_id));
    return (await this.all<EventRec>("events")).filter((e) => ids.has(e.id)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  async addStoryNote(input: Pick<StoryNote, "entity_type" | "entity_id" | "kind" | "text" | "quote_consent">): Promise<void> {
    const me = await this.requireWriter();
    await this.put("story_notes", { ...(await this.base(me)), ...input } satisfies StoryNote);
  }
  async storyNotesFor(entity_type: string, entity_id: string): Promise<StoryNote[]> {
    return (await this.all<StoryNote>("story_notes")).filter((n) => n.entity_type === entity_type && n.entity_id === entity_id && !n.archived_at);
  }
  async markMoment(objectId: string, text: string): Promise<void> {
    const me = await this.requireWriter();
    await this.addStoryNote({ entity_type: "object", entity_id: objectId, kind: "moment", text, quote_consent: false });
    await this.event(me, "story.moment", text || "Markerat som bra ögonblick", [{ type: "object", id: objectId }], true);
  }
  async contentFor(source_type: string, source_id: string): Promise<ContentItem[]> {
    return (await this.all<ContentItem>("content_items"))
      .filter((c) => c.source_type === source_type && c.source_id === source_id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async saveContent(item: Partial<ContentItem> & Pick<ContentItem, "goal" | "source_type" | "source_id" | "variants" | "status">): Promise<ContentItem> {
    const me = await this.requireWriter();
    const existing = item.id ? await this.get<ContentItem>("content_items", item.id) : undefined;
    if ((item.status === "approved" || item.status === "shared") && existing?.status !== item.status && me.role !== "owner") {
      throw new PermissionError("Bara ägaren kan godkänna och dela");
    }
    const { id: _ignored, ...fields } = item;
    void _ignored;
    const next: ContentItem = {
      ...(existing ?? { ...(await this.base(me)), sources: [], warnings: [], approved_by: null, shared_url: "" }),
      ...fields,
      updated_at: now(),
    } as ContentItem;
    if (item.status === "approved") next.approved_by = me.id;
    await this.put("content_items", next);
    if (item.status === "approved" && existing?.status !== "approved") {
      await this.audit_(me, "content_approved", "content", next.id, { status: existing?.status ?? null }, { status: "approved", variants: next.variants });
    }
    return next;
  }
  async markShared(id: string, url: string): Promise<void> {
    const me = await this.requireOwner();
    const c = await this.get<ContentItem>("content_items", id);
    if (!c) return;
    await this.put("content_items", { ...c, status: "shared", shared_url: url, updated_at: now() });
    await this.event(me, "content.shared", "Berättelse delad", [{ type: c.source_type, id: c.source_id }, { type: "content", id }]);
    await this.audit_(me, "content_shared", "content", id, { status: c.status }, { status: "shared", shared_url: url, variants: c.variants });
  }

  // ------------------------------------------------------------ övrigt
  async tasks(): Promise<Task[]> {
    return (await this.all<Task>("tasks"))
      .filter((t) => t.status === "open" || t.status === "in_progress")
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }
  async storyRows(objectId: string): Promise<StoryRows> {
    const o = await this.object(objectId);
    if (!o) throw new Error("Objektet finns inte");
    const acquisitions = (await this.all<Acquisition>("acquisitions")).filter((a) => a.object_id === objectId);
    const personIds = new Set(acquisitions.map((a) => a.person_id));
    const persons = (await this.all<Person>("persons")).filter((p) => personIds.has(p.id));
    return {
      object: { ...o },
      // Priser och kontaktuppgifter hämtas aldrig till berättelser (samma som servern).
      acquisitions: acquisitions.map((a) => ({ object_id: a.object_id, person_id: a.person_id, type: a.type, price: null })),
      persons: persons.map((p) => ({ id: p.id, name: p.name, locality: p.locality, contact: "", notes: "", consent_name: p.consent_name, consent_contribution: p.consent_contribution })),
      notes: (await this.storyNotesFor("object", objectId)).map((n) => ({ kind: n.kind, text: n.text, quote_consent: n.quote_consent })),
      events: (await this.eventsFor("object", objectId)).map((e) => ({ summary: e.summary, occurred_at: e.occurred_at, visibility: e.visibility })),
      media: (await this.mediaFor("object", objectId)).map((m) => ({ id: m.id, visibility: m.visibility, has_people: m.has_people, clean_path: m.clean_path })),
    };
  }
  async audit(): Promise<AuditEntry[]> {
    const me = await this.me();
    if (me.role !== "owner") return [];
    return (await this.all<AuditEntry>("audit_entries")).sort((a, b) => b.at.localeCompare(a.at));
  }
  async exportAll(): Promise<Record<string, unknown[]>> {
    await this.requireOwner();
    const out: Record<string, unknown[]> = {};
    for (const s of STORES) if (s !== "blobs" && s !== "meta") out[s] = await this.all(s);
    return out;
  }

  /** Används av demodata och tester. */
  async rawPut(store: Store, value: unknown, key?: string) {
    await this.put(store, value, key);
  }
}

// Lokal implementation av datalagret i IndexedDB. Används i demoläge och följer samma
// regler som databasen: tillståndsmaskin, INV-05, roller, privata fält och audit.
import { openDB, type IDBPDatabase } from "idb";
import { ACQUISITION_TRANSITIONS, LEAD_TRANSITIONS, LISTING_TRANSITIONS, PICKUP_TRANSITIONS, assertTransition } from "../domain/stateMachine";
import type {
  ExternalPlace, Project,
  BatchAllocation, Decision, MapLayer, Observation, UsageEvent,
  ChannelPost, ContentConsent, Contribution, Disposal, DisposalType, Lead, LeadStatus, Listing, ListingStatus, PublishMode, ReciprocityEntry, AskThread,
  AcquisitionStatus, ChecklistItem, ChecklistTemplate, Interaction, Organization, Pickup, PickupItem, PickupStatus,
  StorageLocation,
  Acquisition, AuditEntry, Capture, CaptureInput, ContentItem, EventLink, EventRec, Media, ObjectStatus, Person,
  Profile, Proposal, ProposalContent, Role, Site, StoryNote, Structure, Task, VObject, Zone,
} from "../domain/types";
import type { StoryRows } from "../../supabase/functions/_shared/storyContext";
import type { PolygonGeom } from "../geo/geo";
import { PermissionError, type DisposalInput, type ListingInput, type NewMapLayer, type UsageInput, type ApproveInput, type MediaInput, type NewExternalPlace, type NewPerson, type NewProject, type NewPickup, type PlaceRef, type Receipt, type Repo } from "./repo";

const STORES = [
  "sites", "zones", "structures", "objects", "persons", "person_private", "acquisitions", "acquisition_private",
  "media", "blobs", "captures", "proposals", "events", "event_links", "story_notes", "content_items", "tasks",
  "audit_entries", "meta",
  // M2
  "organizations", "organization_private", "interactions", "storage_locations", "checklist_templates", "pickups",
  "pickup_private", "pickup_items", "checklist_items",
  // M3
  "map_layers", "batch_allocations", "usage_events", "observations", "decisions",
  // M4
  "listings", "channel_posts", "leads", "disposals", "disposal_private", "contributions", "reciprocity_entries", "content_consents",
  // M5
  "ask_threads",
  // M6
  "projects", "external_places", "external_place_private",
] as const;

const KEY_PATHS: Partial<Record<string, string | null>> = {
  person_private: "person_id",
  acquisition_private: "acquisition_id",
  organization_private: "organization_id",
  pickup_private: "pickup_id",
  disposal_private: "disposal_id",
  external_place_private: "place_id",
  blobs: null,
  meta: null,
};

export const DEFAULT_CHECKLISTS: [string, string[]][] = [
  ["Stora byggnadsdelar", ["Släp", "Spännband", "Filtar och skydd", "Bärhjälp", "Handskar", "Kofot och skruvdragare"]],
  ["Fönster och glas", ["Släp eller skåpbil", "Filtar mellan fönstren", "Spännband", "Bärhjälp", "Handskar"]],
  ["Växter", ["Säckar eller hinkar", "Spade", "Vatten", "Presenning", "Handskar"]],
  ["Småsaker", ["Lådor", "Tidningspapper", "Märkpenna"]],
];
type Store = (typeof STORES)[number];

interface PersonPrivate { person_id: string; site_id: string; contact: string; notes: string; created_by: string }
interface OrgPrivate { organization_id: string; site_id: string; contact: string; notes: string; created_by: string }
interface PickupPrivate { pickup_id: string; site_id: string; address: string; created_by: string }
interface DisposalPrivate { disposal_id: string; site_id: string; price: number | null; payment_method: string; created_by: string }
interface PlacePrivate { place_id: string; site_id: string; address: string; created_by: string }
interface AcqPrivate { acquisition_id: string; site_id: string; price: number | null; payment_method: string; created_by: string }

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

export class LocalRepo implements Repo {
  readonly kind = "local" as const;
  private dbp: Promise<IDBPDatabase>;

  constructor(dbName = "vreta-demo") {
    this.dbp = openDB(dbName, 6, {
      upgrade(db) {
        for (const s of STORES) {
          if (db.objectStoreNames.contains(s)) continue;
          const key = s in KEY_PATHS ? KEY_PATHS[s] : "id";
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
  private async event(me: Profile, event_type: string, summary: string, links: { type: string; id: string; role?: string }[], story_worthy = false, extra: Partial<EventRec> = {}) {
    const ev: EventRec = { ...(await this.base(me)), event_type, occurred_at: now(), summary, notes: "", story_worthy, visibility: "shareable", ...extra };
    await this.put("events", ev);
    if (links.some((l) => ["object", "zone", "structure"].includes(l.type)) && !links.some((l) => l.type === "site")) {
      links = [...links, { type: "site", id: ev.site_id, role: "place" }];
    }
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
    for (const [name, items] of DEFAULT_CHECKLISTS) {
      await this.put("checklist_templates", { ...(await this.base(profile)), name, items } satisfies ChecklistTemplate);
    }
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
    const z: Zone = { ...(await this.base(me)), ...input, status: "existing", geom: null };
    await this.put("zones", z);
    return z;
  }
  async structures(): Promise<Structure[]> {
    return (await this.all<Structure>("structures")).filter((s) => !s.archived_at).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }
  async createStructure(input: Pick<Structure, "name" | "kind" | "notes" | "zone_id">): Promise<Structure> {
    const me = await this.requireWriter();
    const s: Structure = { ...(await this.base(me)), ...input, status: "existing", geom: null };
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
    const allocs = await this.allocations(id);
    if (o.is_batch && allocs.length > 1) throw new Error("Partiet är uppdelat – ändra status per del");
    assertTransition(o.status, to);
    const next: VObject = { ...o, status: to, updated_at: now() };
    if (to !== "stored" && to !== "processing") next.storage_location_id = null;
    if (place) {
      next.zone_id = place.zone_id ?? next.zone_id;
      next.structure_id = place.structure_id ?? next.structure_id;
    }
    if (to === "in_use" && !next.zone_id && !next.structure_id) {
      throw new Error("Ett objekt i bruk måste ha en plats (zon eller byggnad).");
    }
    await this.put("objects", next);
    if (allocs.length === 1) {
      await this.put("batch_allocations", { ...allocs[0], status: to, zone_id: next.zone_id, structure_id: next.structure_id, storage_location_id: next.storage_location_id, updated_at: now() });
    }
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
      status: "discovered", visibility: "shareable", source_type: "ai_capture", zone_id: null, structure_id: null, storage_location_id: null,
      cover_media_id: input.media_ids[0] ?? null, field_meta: o.field_meta,
    };
    await this.put("objects", obj);

    let personId: string | null = null;
    if (input.person) {
      if (input.person.existing_person_id) personId = input.person.existing_person_id;
      else {
        const p: Person = {
          ...(await this.base(me)), name: input.person.name, locality: input.person.locality,
          roles: [input.acquisition?.type === "gift" ? "Givare" : "Leverantör"], organization_id: null, how_we_met: "",
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
  async storyRows(objectId: string, contentId?: string): Promise<StoryRows> {
    const o = await this.object(objectId);
    if (!o) throw new Error("Objektet finns inte");
    const acquisitions = (await this.all<Acquisition>("acquisitions")).filter((a) => a.object_id === objectId);
    const contributions = (await this.contributions()).filter((c) => c.object_id === objectId);
    const personIds = new Set<string | null>([...acquisitions.map((a) => a.person_id), ...contributions.map((c) => c.person_id)]);
    const persons = (await this.all<Person>("persons")).filter((p) => personIds.has(p.id));
    return {
      object: { ...o },
      // Priser och kontaktuppgifter hämtas aldrig till berättelser (samma som servern).
      acquisitions: acquisitions.map((a) => ({ object_id: a.object_id, person_id: a.person_id, type: a.type, price: null })),
      persons: persons.map((p) => ({ id: p.id, name: p.name, locality: p.locality, contact: "", notes: "", consent_name: p.consent_name, consent_contribution: p.consent_contribution })),
      contributions: contributions.map((c) => ({ person_id: c.person_id, kind: c.kind, description: c.description, visibility: c.visibility })),
      consents: contentId ? await this.contentConsents(contentId) : [],
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
    const me = await this.me();
    for (const s of STORES) if (s !== "blobs" && s !== "meta") out[s] = await this.all(s);
    // Trådar med chatboten är privata även för ägaren (11.6)
    out.ask_threads = (out.ask_threads as AskThread[]).filter((t) => t.created_by === me.id);
    return out;
  }

  // ------------------------------------------------------------ M2: människor och inflöde
  async organizations(): Promise<Organization[]> {
    const me = await this.me();
    const priv = await this.all<OrgPrivate>("organization_private");
    return (await this.all<Organization>("organizations")).filter((o) => !o.archived_at).map((o) => {
      const p = priv.find((x) => x.organization_id === o.id);
      return p && this.seesPrivate(me, p.created_by) ? { ...o, contact: p.contact, notes: p.notes } : o;
    }).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }
  async createOrganization(input: Pick<Organization, "name" | "kind" | "locality">): Promise<Organization> {
    const me = await this.requireWriter();
    const o: Organization = { ...(await this.base(me)), ...input, roles: [] };
    await this.put("organizations", o);
    await this.put("organization_private", { organization_id: o.id, site_id: o.site_id, contact: "", notes: "", created_by: me.id } satisfies OrgPrivate);
    return o;
  }
  async createPerson(input: NewPerson): Promise<Person> {
    const me = await this.requireWriter();
    const p: Person = {
      ...(await this.base(me)), name: input.name, locality: input.locality, roles: input.roles, how_we_met: input.how_we_met,
      organization_id: input.organization_id, consent_name: "ask", consent_image: "ask", consent_contribution: "ask",
    };
    await this.put("persons", p);
    await this.put("person_private", { person_id: p.id, site_id: p.site_id, contact: input.contact, notes: input.notes, created_by: me.id } satisfies PersonPrivate);
    return p;
  }
  async updatePerson(id: string, patch: Partial<Pick<Person, "name" | "locality" | "roles" | "how_we_met" | "organization_id">>): Promise<void> {
    await this.requireWriter();
    const p = await this.get<Person>("persons", id);
    if (p) await this.put("persons", { ...p, ...patch, updated_at: now() });
  }
  async updatePersonPrivate(id: string, patch: { contact?: string; notes?: string }): Promise<void> {
    const me = await this.requireWriter();
    const pp = await this.get<PersonPrivate>("person_private", id);
    if (!pp || !this.seesPrivate(me, pp.created_by)) throw new PermissionError("Bara ägaren kan se och ändra privata uppgifter");
    await this.put("person_private", { ...pp, ...patch });
  }
  async interactions(person_id: string): Promise<Interaction[]> {
    return (await this.mine<Interaction>("interactions")).filter((i) => i.person_id === person_id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  async addInteraction(input: Pick<Interaction, "person_id" | "organization_id" | "channel" | "summary" | "follow_up"> & { occurred_at?: string }): Promise<void> {
    const me = await this.requireWriter();
    await this.put("interactions", { ...(await this.base(me)), ...input, occurred_at: input.occurred_at ?? now() } satisfies Interaction);
  }
  async followUps(): Promise<Interaction[]> {
    return (await this.mine<Interaction>("interactions")).filter((i) => i.follow_up).sort((a, b) => a.follow_up!.localeCompare(b.follow_up!));
  }
  async allAcquisitions(): Promise<Acquisition[]> {
    const me = await this.me();
    const priv = await this.all<AcqPrivate>("acquisition_private");
    return (await this.all<Acquisition>("acquisitions")).map((a) => {
      const ap = priv.find((x) => x.acquisition_id === a.id);
      return ap && this.seesPrivate(me, ap.created_by) ? { ...a, price: ap.price, payment_method: ap.payment_method } : a;
    });
  }
  async setAcquisitionStatus(id: string, to: AcquisitionStatus): Promise<void> {
    const me = await this.requireWriter();
    const a = await this.get<Acquisition>("acquisitions", id);
    if (!a) return;
    if (!ACQUISITION_TRANSITIONS[a.status].includes(to)) throw new Error(`Otillåten ändring av anskaffning: ${a.status} → ${to}`);
    await this.put("acquisitions", { ...a, status: to, updated_at: now() });
    await this.audit_(me, "acquisition_status", "acquisition", id, { status: a.status }, { status: to });
  }
  async updateAcquisitionPrivate(id: string, patch: { price?: number | null; payment_method?: string }): Promise<void> {
    const me = await this.requireWriter();
    const ap = await this.get<AcqPrivate>("acquisition_private", id);
    if (!ap || !this.seesPrivate(me, ap.created_by)) throw new PermissionError("Bara ägaren kan ändra priser");
    await this.put("acquisition_private", { ...ap, ...patch });
  }

  // ------------------------------------------------------------ M2: lager
  async storageLocations(): Promise<StorageLocation[]> {
    return (await this.all<StorageLocation>("storage_locations")).filter((l) => !l.archived_at).sort((a, b) => a.name.localeCompare(b.name, "sv", { numeric: true }));
  }
  async createStorageLocation(input: Pick<StorageLocation, "name" | "parent_id" | "structure_id" | "notes">): Promise<StorageLocation> {
    const me = await this.requireWriter();
    const l: StorageLocation = { ...(await this.base(me)), ...input };
    await this.put("storage_locations", l);
    return l;
  }
  async storeObject(objectId: string, locationId: string): Promise<void> {
    const me = await this.requireWriter();
    const o = await this.get<VObject>("objects", objectId);
    if (!o) throw new Error("Objektet finns inte");
    const allocs = await this.allocations(objectId);
    if (o.is_batch && allocs.length > 1) {
      for (const a of allocs.filter((a) => ["collected", "stored", "processing", "in_use", "listed", "lent"].includes(a.status))) {
        await this.put("batch_allocations", { ...a, status: "stored", storage_location_id: locationId, zone_id: null, structure_id: null, updated_at: now() });
      }
      await this.syncBatch(me, objectId);
      return;
    }
    if (o.status === "stored") {
      await this.put("objects", { ...o, storage_location_id: locationId, updated_at: now() });
      await this.audit_(me, "moved_in_storage", "object", objectId, { storage_location_id: o.storage_location_id }, { storage_location_id: locationId });
      return;
    }
    assertTransition(o.status, "stored");
    await this.put("objects", { ...o, status: "stored", storage_location_id: locationId, zone_id: null, structure_id: null, updated_at: now() });
    if (allocs.length === 1) await this.put("batch_allocations", { ...allocs[0], status: "stored", storage_location_id: locationId, zone_id: null, structure_id: null, updated_at: now() });
    await this.event(me, "object.status_changed", `${o.title}: ${o.status} → stored`, [{ type: "object", id: objectId }]);
    await this.audit_(me, "status_change", "object", objectId, { status: o.status }, { status: "stored" });
  }

  // ------------------------------------------------------------ M2: hämtningar
  async checklistTemplates(): Promise<ChecklistTemplate[]> {
    return (await this.all<ChecklistTemplate>("checklist_templates")).filter((t) => !t.archived_at);
  }
  private async withAddress(p: Pickup): Promise<Pickup> {
    const me = await this.me();
    if (me.role === "viewer") return p;
    const pp = await this.get<PickupPrivate>("pickup_private", p.id);
    return { ...p, address: pp?.address ?? "" };
  }
  async pickups(): Promise<Pickup[]> {
    const list = (await this.all<Pickup>("pickups")).filter((p) => !p.archived_at);
    return Promise.all(list.sort((a, b) => (a.scheduled_date ?? "9999").localeCompare(b.scheduled_date ?? "9999")).map((p) => this.withAddress(p)));
  }
  async pickup(id: string): Promise<Pickup | null> {
    const p = await this.get<Pickup>("pickups", id);
    return p ? this.withAddress(p) : null;
  }
  async pickupItems(pickupId: string): Promise<PickupItem[]> {
    return (await this.all<PickupItem>("pickup_items")).filter((i) => i.pickup_id === pickupId);
  }
  async checklist(pickupId: string): Promise<ChecklistItem[]> {
    return (await this.all<ChecklistItem>("checklist_items")).filter((i) => i.pickup_id === pickupId).sort((a, b) => a.position - b.position);
  }
  async createPickup(input: NewPickup): Promise<string> {
    const me = await this.requireWriter();
    const b = await this.base(me);
    const p: Pickup = {
      ...b, acquisition_id: input.acquisition_id, person_id: input.person_id, title: input.title, scheduled_date: input.scheduled_date,
      window_from: input.window_from, window_to: input.window_to, resources: input.resources, status: "planned",
      safety_note: input.safety_note, completed_at: null, place_id: input.place_id ?? null,
    };
    await this.put("pickups", p);
    await this.put("pickup_private", { pickup_id: p.id, site_id: p.site_id, address: input.address, created_by: me.id } satisfies PickupPrivate);
    for (const oid of input.object_ids) {
      await this.put("pickup_items", { id: uuid(), site_id: p.site_id, pickup_id: p.id, object_id: oid, receipt: null, note: "" } satisfies PickupItem);
      const o = await this.get<VObject>("objects", oid);
      if (o?.status === "reserved") await this.changeStatus(oid, "pickup_planned");
    }
    const tpl = input.template_id ? await this.get<ChecklistTemplate>("checklist_templates", input.template_id) : undefined;
    for (const [i, label] of (tpl?.items ?? []).entries()) {
      await this.put("checklist_items", { id: uuid(), site_id: p.site_id, pickup_id: p.id, label, done: false, position: i } satisfies ChecklistItem);
    }
    return p.id;
  }
  async setPickupStatus(id: string, to: PickupStatus): Promise<void> {
    const me = await this.requireWriter();
    const p = await this.get<Pickup>("pickups", id);
    if (!p) return;
    if (!PICKUP_TRANSITIONS[p.status].includes(to)) throw new Error(`Otillåten ändring av hämtning: ${p.status} → ${to}`);
    await this.put("pickups", { ...p, status: to, updated_at: now() });
    await this.audit_(me, "pickup_status", "pickup", id, { status: p.status }, { status: to });
  }
  async toggleChecklistItem(item: ChecklistItem, done: boolean): Promise<void> {
    await this.requireWriter();
    await this.put("checklist_items", { ...item, done });
  }
  async completePickup(id: string, receipts: Receipt[], locationId: string | null): Promise<void> {
    const me = await this.requireWriter();
    const p = await this.get<Pickup>("pickups", id);
    if (!p) throw new Error("Hämtningen finns inte");
    const items = await this.pickupItems(id);
    for (const it of items) {
      const r = receipts.find((x) => x.object_id === it.object_id);
      if (r) await this.put("pickup_items", { ...it, receipt: r.receipt, note: r.note });
    }
    const updated = await this.pickupItems(id);
    if (updated.some((i) => !i.receipt)) throw new Error("Alla objekt måste kvitteras innan hämtningen avslutas");
    if (p.status === "planned" || p.status === "confirmed") await this.setPickupStatus(id, "in_progress");
    const cur = (await this.get<Pickup>("pickups", id))!;
    if (!PICKUP_TRANSITIONS[cur.status].includes("completed")) throw new Error("Hämtningen kan inte avslutas");
    await this.put("pickups", { ...cur, status: "completed", completed_at: now(), updated_at: now() });
    await this.audit_(me, "pickup_status", "pickup", id, { status: cur.status }, { status: "completed" });

    const received = updated.filter((i) => i.receipt === "received" || i.receipt === "partial");
    const links = [{ type: "pickup", id }, ...received.map((i) => ({ type: "object", id: i.object_id }))];
    if (p.person_id) links.push({ type: "person", id: p.person_id });
    await this.event(me, "pickup.completed", `Hämtning klar: ${p.title}`, links, true);
    for (const it of received) {
      const o = await this.get<VObject>("objects", it.object_id);
      if (o && ["discovered", "contacted", "reserved", "pickup_planned"].includes(o.status)) await this.changeStatus(o.id, "collected");
      if (locationId) await this.storeObject(it.object_id, locationId);
    }
    if (p.acquisition_id) {
      const a = await this.get<Acquisition>("acquisitions", p.acquisition_id);
      if (a && ["lead", "contacted", "negotiating"].includes(a.status)) await this.setAcquisitionStatus(a.id, "agreed");
      const a2 = await this.get<Acquisition>("acquisitions", p.acquisition_id);
      if (a2?.status === "agreed") await this.setAcquisitionStatus(a2.id, "received");
    }
  }

  // ------------------------------------------------------------ M3: partier och nytt liv
  async allocations(objectId: string): Promise<BatchAllocation[]> {
    return (await this.all<BatchAllocation>("batch_allocations")).filter((a) => a.object_id === objectId).sort((a, b) => b.quantity - a.quantity);
  }
  private async ensureAllocations(o: VObject): Promise<BatchAllocation[]> {
    const existing = await this.allocations(o.id);
    if (existing.length || !o.is_batch) return existing;
    const a: BatchAllocation = {
      id: uuid(), site_id: o.site_id, object_id: o.id, quantity: o.quantity, status: o.status, storage_location_id: o.storage_location_id,
      zone_id: o.zone_id, structure_id: o.structure_id, created_at: now(), updated_at: now(),
    };
    await this.put("batch_allocations", a);
    return [a];
  }
  private async syncBatch(me: Profile, objectId: string): Promise<void> {
    const o = (await this.get<VObject>("objects", objectId))!;
    const allocs = await this.allocations(objectId);
    const sum = allocs.reduce((s, a) => s + a.quantity, 0);
    if (Math.abs(sum - o.quantity) > 1e-9) throw new Error("Fördelningen av partiet stämmer inte med totalen (INV-11)");
    const terminal = ["declined", "lost", "sold", "donated", "exchanged", "discarded"];
    const top = [...allocs].sort((a, b) => Number(terminal.includes(a.status)) - Number(terminal.includes(b.status)) || b.quantity - a.quantity || b.updated_at.localeCompare(a.updated_at))[0];
    if (!top) return;
    const changed = top.status !== o.status;
    await this.put("objects", { ...o, status: top.status, zone_id: top.zone_id, structure_id: top.structure_id, storage_location_id: top.storage_location_id, updated_at: now() });
    if (changed) {
      await this.event(me, "object.status_changed", `${o.title}: ${o.status} → ${top.status}`, [{ type: "object", id: objectId }]);
      await this.audit_(me, "status_derived", "object", objectId, { status: o.status }, { status: top.status });
    }
  }
  async recordUsage(objectId: string, input: UsageInput): Promise<void> {
    const me = await this.requireWriter();
    const o = await this.get<VObject>("objects", objectId);
    if (!o) throw new Error("Objektet finns inte");
    if (input.type !== "removed" && !input.zone_id && !input.structure_id) throw new Error("Nytt liv kräver plats (zon eller byggnad)");
    let allocationId: string | null = null;
    if (input.type !== "removed" && o.is_batch && input.quantity != null && input.quantity < o.quantity) {
      const allocs = await this.ensureAllocations(o);
      const usable = ["collected", "stored", "processing", "in_use", "listed"];
      const src = input.from_allocation_id
        ? allocs.find((a) => a.id === input.from_allocation_id)
        : [...allocs].filter((a) => usable.includes(a.status)).sort((a, b) => Number(b.status === "stored") - Number(a.status === "stored") || b.quantity - a.quantity)[0];
      if (!src || src.quantity < input.quantity) throw new Error(`Det finns inte ${input.quantity} ${o.unit} att använda`);
      assertTransition(src.status, "in_use");
      if (src.quantity === input.quantity) {
        await this.put("batch_allocations", { ...src, status: "in_use", zone_id: input.zone_id, structure_id: input.structure_id, storage_location_id: null, updated_at: now() });
        allocationId = src.id;
      } else {
        await this.put("batch_allocations", { ...src, quantity: src.quantity - input.quantity, updated_at: now() });
        allocationId = uuid();
        await this.put("batch_allocations", { id: allocationId, site_id: o.site_id, object_id: o.id, quantity: input.quantity, status: "in_use", storage_location_id: null, zone_id: input.zone_id, structure_id: input.structure_id, created_at: now(), updated_at: now() } satisfies BatchAllocation);
      }
      await this.syncBatch(me, objectId);
    } else if (input.type !== "removed") {
      const allocs = await this.allocations(objectId);
      if (allocs.length > 1) throw new Error("Partiet är uppdelat – välj hur många som används");
      await this.changeStatus(objectId, "in_use", { zone_id: input.zone_id, structure_id: input.structure_id });
    }
    const zones = await this.zones();
    const structures = await this.structures();
    const place = zones.find((z) => z.id === input.zone_id)?.name ?? structures.find((s) => s.id === input.structure_id)?.name ?? "";
    const verb: Record<string, string> = { installed: "Installerad", planted: "Planterad", built_in: "Inbyggd", renovated: "Renoverad", reused: "Återanvänd", moved: "Flyttad", removed: "Demonterad", replanted: "Omplanterad", decommissioned: "Tagen ur bruk" };
    const qty = o.is_batch && input.quantity != null ? `${input.quantity} ${o.unit} ` : "";
    const links: { type: string; id: string; role?: string }[] = [{ type: "object", id: objectId }];
    if (input.zone_id) links.push({ type: "zone", id: input.zone_id, role: "place" });
    if (input.structure_id) links.push({ type: "structure", id: input.structure_id, role: "place" });
    const project = await this.resolveProject(me, input.project, input.zone_id, input.occurred_at ?? now());
    if (project) links.push({ type: "project", id: project.id, role: "project" });
    const ev = await this.event(me, `usage.${input.type}`, `${verb[input.type]}: ${qty}${o.title.toLowerCase()}${place ? ` – ${place}` : ""}`, links, true,
      { occurred_at: input.occurred_at ?? now(), notes: input.note });
    const u: UsageEvent = {
      id: uuid(), site_id: o.site_id, object_id: objectId, allocation_id: allocationId, type: input.type, occurred_at: input.occurred_at ?? now(),
      zone_id: input.zone_id, structure_id: input.structure_id, quantity: input.quantity, project: project?.name ?? "", project_id: project?.id ?? null, note: input.note, geom: input.geom,
      event_id: ev.id, created_at: now(), created_by: me.id,
    };
    await this.put("usage_events", u);
  }
  async storeAllocation(allocationId: string, quantity: number, locationId: string): Promise<void> {
    const me = await this.requireWriter();
    const a = await this.get<BatchAllocation>("batch_allocations", allocationId);
    if (!a) throw new Error("Delen finns inte");
    if (quantity > a.quantity) throw new Error("För stort antal");
    if (a.status !== "stored") assertTransition(a.status, "stored");
    if (quantity === a.quantity) {
      await this.put("batch_allocations", { ...a, status: "stored", storage_location_id: locationId, zone_id: null, structure_id: null, updated_at: now() });
    } else {
      await this.put("batch_allocations", { ...a, quantity: a.quantity - quantity, updated_at: now() });
      await this.put("batch_allocations", { id: uuid(), site_id: a.site_id, object_id: a.object_id, quantity, status: "stored", storage_location_id: locationId, zone_id: null, structure_id: null, created_at: now(), updated_at: now() } satisfies BatchAllocation);
    }
    await this.syncBatch(me, a.object_id);
  }
  async usageEvents(objectId: string): Promise<UsageEvent[]> {
    return (await this.allUsageEvents()).filter((u) => u.object_id === objectId);
  }
  async allUsageEvents(): Promise<UsageEvent[]> {
    await this.backfillProjects();
    return (await this.all<UsageEvent>("usage_events")).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }

  // ------------------------------------------------------------ M3: observationer, beslut, journal
  async createObservation(input: Pick<Observation, "kind" | "text" | "zone_id" | "structure_id" | "object_id" | "geom" | "follow_up" | "visibility">): Promise<Observation> {
    const me = await this.requireWriter();
    const links: { type: string; id: string; role?: string }[] = [{ type: "site", id: await this.siteId(), role: "place" }];
    if (input.zone_id) links.push({ type: "zone", id: input.zone_id, role: "place" });
    if (input.object_id) links.push({ type: "object", id: input.object_id });
    const ev = await this.event(me, `observation.${input.kind}`, input.text, links, true, { visibility: input.visibility });
    const o: Observation = { ...(await this.base(me)), ...input, event_id: ev.id, occurred_at: ev.occurred_at };
    await this.put("observations", o);
    return o;
  }
  async observations(): Promise<Observation[]> {
    const me = await this.me();
    return (await this.all<Observation>("observations")).filter((o) => !o.archived_at && (o.visibility !== "private" || this.seesPrivate(me, o.created_by))).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  async createDecision(input: Pick<Decision, "question" | "options" | "choice" | "rationale" | "zone_id" | "object_id" | "visibility">): Promise<Decision> {
    const me = await this.requireWriter();
    const links: { type: string; id: string; role?: string }[] = [{ type: "site", id: await this.siteId(), role: "place" }];
    if (input.zone_id) links.push({ type: "zone", id: input.zone_id, role: "place" });
    if (input.object_id) links.push({ type: "object", id: input.object_id });
    const ev = await this.event(me, "decision", `Beslut: ${input.question} – ${input.choice}`, links, false, { notes: input.rationale, visibility: input.visibility });
    const d: Decision = { ...(await this.base(me)), ...input, outcome: "", event_id: ev.id, decided_on: now().slice(0, 10) };
    await this.put("decisions", d);
    return d;
  }
  async decisions(): Promise<Decision[]> {
    const me = await this.me();
    return (await this.all<Decision>("decisions")).filter((d) => d.visibility !== "private" || this.seesPrivate(me, d.created_by));
  }
  async eventLinks(eventIds: string[]): Promise<EventLink[]> {
    const ids = new Set(eventIds);
    return (await this.all<EventLink>("event_links")).filter((l) => ids.has(l.event_id));
  }

  // ------------------------------------------------------------ M3: Vretakartan
  async setZoneGeom(id: string, geom: PolygonGeom | null): Promise<void> {
    await this.requireWriter();
    const z = await this.get<Zone>("zones", id);
    if (z) await this.put("zones", { ...z, geom, updated_at: now() });
  }
  async setStructureGeom(id: string, geom: PolygonGeom | null): Promise<void> {
    await this.requireWriter();
    const s = await this.get<Structure>("structures", id);
    if (s) await this.put("structures", { ...s, geom, updated_at: now() });
  }
  async mapLayers(): Promise<MapLayer[]> {
    return (await this.all<MapLayer>("map_layers")).filter((l) => !l.archived_at).sort((a, b) => (a.taken_on ?? "").localeCompare(b.taken_on ?? "") || a.created_at.localeCompare(b.created_at));
  }
  async addMapLayer(input: NewMapLayer): Promise<MapLayer> {
    const me = await this.requireWriter();
    const b = await this.base(me);
    const path = `${b.site_id}/${b.id}.img`;
    await this.put("blobs", input.image, `maps/${path}`);
    const { image: _img, ...rest } = input;
    void _img;
    const l: MapLayer = { ...b, ...rest, image_path: path };
    await this.put("map_layers", l);
    return l;
  }
  async updateMapLayer(id: string, patch: Partial<Pick<MapLayer, "opacity" | "name" | "taken_on" | "archived_at">>): Promise<void> {
    await this.requireWriter();
    const l = await this.get<MapLayer>("map_layers", id);
    if (l) await this.put("map_layers", { ...l, ...patch, updated_at: now() });
  }
  async mapImage(layer: MapLayer): Promise<Blob | null> {
    return (await this.get<Blob>("blobs", `maps/${layer.image_path}`)) ?? null;
  }

  // ------------------------------------------------------------ M4: annonser och kanaler
  async listings(): Promise<Listing[]> {
    return (await this.all<Listing>("listings")).filter((l) => !l.archived_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async listing(id: string): Promise<Listing | null> {
    return (await this.get<Listing>("listings", id)) ?? null;
  }
  async saveListing(input: ListingInput): Promise<Listing> {
    const me = await this.requireWriter();
    const existing = input.id ? await this.get<Listing>("listings", input.id) : undefined;
    const { id: _id, ...fields } = input;
    void _id;
    const next: Listing = existing
      ? { ...existing, ...fields, object_id: existing.object_id, updated_at: now() }
      : { ...(await this.base(me)), ...fields, allocation_id: null, status: "draft" };
    await this.put("listings", next);
    if (!existing) await this.audit_(me, "listing_created", "listing", next.id, null, { type: next.type, title: next.title, object_id: next.object_id });
    return next;
  }
  private async moveListing(me: Profile, l: Listing, to: ListingStatus): Promise<Listing> {
    if (l.status === to) return l;
    if (!LISTING_TRANSITIONS[l.status].includes(to)) throw new Error(`Otillåten ändring av annons: ${l.status} → ${to}`);
    const next = { ...l, status: to, updated_at: now() };
    await this.put("listings", next);
    await this.audit_(me, "listings_status", "listings", l.id, { status: l.status }, { status: to });
    return next;
  }
  /** Status på det annonsen gäller: en del av ett parti eller hela objektet. */
  private async setListingTarget(me: Profile, l: Listing, to: ObjectStatus): Promise<void> {
    if (l.allocation_id) {
      const a = await this.get<BatchAllocation>("batch_allocations", l.allocation_id);
      if (!a) return;
      assertTransition(a.status, to);
      const out = ["sold", "donated", "exchanged", "discarded", "lent"].includes(to);
      await this.put("batch_allocations", { ...a, status: to, storage_location_id: out ? null : a.storage_location_id, updated_at: now() });
      await this.syncBatch(me, a.object_id);
    } else if (l.object_id) {
      await this.changeStatus(l.object_id, to);
    }
  }
  async setListingStatus(id: string, to: ListingStatus): Promise<void> {
    const me = await this.requireWriter();
    const l = await this.get<Listing>("listings", id);
    if (!l) throw new Error("Annonsen finns inte");
    const target = await this.listingTargetStatus(l);
    await this.moveListing(me, l, to);
    if (to === "withdrawn" && target === "listed") await this.setListingTarget(me, l, "stored");
    if (to === "withdrawn") {
      for (const cp of (await this.channelPosts(id)).filter((c) => c.status === "posted")) {
        await this.put("tasks", { ...(await this.base(me)), title: `Ta ner annonsen ”${l.title}” på ${cp.channel}`, due: now().slice(0, 10), status: "open", entity_type: "listing", entity_id: id } satisfies Task);
      }
    }
  }
  private async listingTargetStatus(l: Listing): Promise<ObjectStatus | null> {
    if (l.allocation_id) return (await this.get<BatchAllocation>("batch_allocations", l.allocation_id))?.status ?? null;
    if (l.object_id) return (await this.get<VObject>("objects", l.object_id))?.status ?? null;
    return null;
  }
  async channelPosts(listingId?: string): Promise<ChannelPost[]> {
    return (await this.all<ChannelPost>("channel_posts")).filter((c) => !listingId || c.listing_id === listingId);
  }
  async saveChannelDraft(listingId: string, channel: string, title: string, text: string): Promise<void> {
    await this.requireWriter();
    const existing = (await this.channelPosts(listingId)).find((c) => c.channel === channel);
    await this.put("channel_posts", existing
      ? { ...existing, title, text }
      : { id: uuid(), site_id: await this.siteId(), listing_id: listingId, channel, title, text, external_url: "", status: "not_posted", publish_mode: "manual", posted_at: null, removed_at: null } satisfies ChannelPost);
  }
  async publishChannel(listingId: string, channel: string, url: string, mode: PublishMode): Promise<void> {
    const me = await this.requireWriter();
    let l = await this.get<Listing>("listings", listingId);
    if (!l) throw new Error("Annonsen finns inte");
    const existing = (await this.channelPosts(listingId)).find((c) => c.channel === channel);
    const post: ChannelPost = existing ?? { id: uuid(), site_id: l.site_id, listing_id: listingId, channel, title: "", text: "", external_url: "", status: "not_posted", publish_mode: mode, posted_at: null, removed_at: null };
    await this.put("channel_posts", { ...post, external_url: url, status: "posted", publish_mode: mode, posted_at: now(), removed_at: null });
    await this.audit_(me, "channel_posted", "listing", listingId, null, { channel, url, mode });

    if (l.status !== "draft" && l.status !== "ready") return;
    if (l.status === "draft") l = await this.moveListing(me, l, "ready");
    l = await this.moveListing(me, l, "published");
    if (!l.object_id || !["sell", "give", "exchange", "lend"].includes(l.type)) return;
    const o = (await this.get<VObject>("objects", l.object_id))!;
    if (o.is_batch && l.quantity != null && l.quantity < o.quantity && !l.allocation_id) {
      const allocs = await this.ensureAllocations(o);
      const src = allocs.filter((a) => ["collected", "stored", "processing"].includes(a.status))
        .sort((a, b) => Number(b.status === "stored") - Number(a.status === "stored") || b.quantity - a.quantity)[0];
      if (!src || src.quantity < l.quantity) throw new Error(`Det finns inte ${l.quantity} ${o.unit} i lager att annonsera`);
      let allocId = src.id;
      if (src.quantity === l.quantity) {
        await this.put("batch_allocations", { ...src, status: "listed", updated_at: now() });
      } else {
        await this.put("batch_allocations", { ...src, quantity: src.quantity - l.quantity, updated_at: now() });
        allocId = uuid();
        await this.put("batch_allocations", { ...src, id: allocId, quantity: l.quantity, status: "listed", zone_id: null, structure_id: null, created_at: now(), updated_at: now() } satisfies BatchAllocation);
      }
      await this.put("listings", { ...l, allocation_id: allocId, updated_at: now() });
      await this.syncBatch(me, o.id);
    } else if (o.status !== "listed") {
      await this.setListingTarget(me, l, "listed");
    }
  }
  async removeChannel(listingId: string, channel: string): Promise<void> {
    const me = await this.requireWriter();
    const cp = (await this.channelPosts(listingId)).find((c) => c.channel === channel);
    if (!cp) return;
    await this.put("channel_posts", { ...cp, status: "removed", removed_at: now() });
    await this.audit_(me, "channel_removed", "listing", listingId, null, { channel });
    // Påminnelsen om att ta ner annonsen är klar
    for (const t of (await this.all<Task>("tasks")).filter((t) => t.entity_id === listingId && t.status === "open" && t.title.endsWith(` på ${channel}`))) {
      await this.put("tasks", { ...t, status: "done", updated_at: now() });
    }
  }

  // ------------------------------------------------------------ M4: intressenter och utflöde
  async leads(listingId?: string): Promise<Lead[]> {
    const me = await this.me();
    if (me.role === "viewer") return [];
    return (await this.all<Lead>("leads")).filter((l) => !listingId || l.listing_id === listingId).sort((a, b) => a.queue_position - b.queue_position);
  }
  async addLead(input: Pick<Lead, "listing_id" | "person_id" | "channel" | "message" | "bid">): Promise<Lead> {
    const me = await this.requireWriter();
    const pos = Math.max(0, ...(await this.leads(input.listing_id)).map((l) => l.queue_position)) + 1;
    const lead: Lead = { id: uuid(), site_id: await this.siteId(), ...input, queue_position: pos, status: "new", created_at: now(), created_by: me.id, updated_at: now() };
    await this.put("leads", lead);
    return lead;
  }
  private async moveLead(me: Profile, id: string, to: LeadStatus): Promise<Lead> {
    const l = await this.get<Lead>("leads", id);
    if (!l) throw new Error("Intressenten finns inte");
    if (!LEAD_TRANSITIONS[l.status].includes(to)) throw new Error(`Otillåten ändring: ${l.status} → ${to}`);
    const next = { ...l, status: to, updated_at: now() };
    await this.put("leads", next);
    await this.audit_(me, "leads_status", "leads", id, { status: l.status }, { status: to });
    return next;
  }
  async setLeadStatus(id: string, to: LeadStatus): Promise<void> {
    await this.moveLead(await this.requireWriter(), id, to);
  }
  async agreeLead(id: string): Promise<void> {
    const me = await this.requireWriter();
    const lead = await this.moveLead(me, id, "agreed");
    const l = (await this.get<Listing>("listings", lead.listing_id))!;
    if (l.status === "published") await this.moveListing(me, l, "agreed");
    await this.setListingTarget(me, l, "reserved_out");
  }
  async releaseLead(id: string, to: "no_show" | "lost" | "rejected"): Promise<void> {
    const me = await this.requireWriter();
    const lead = await this.moveLead(me, id, to);
    if ((await this.leads(lead.listing_id)).some((x) => x.status === "agreed")) return;
    const l = (await this.get<Listing>("listings", lead.listing_id))!;
    if (l.status === "agreed") {
      await this.moveListing(me, l, "published");
      await this.setListingTarget(me, l, "listed");
    }
  }
  async completeDisposal(listingId: string, input: DisposalInput): Promise<string> {
    const me = await this.requireWriter();
    let l = await this.get<Listing>("listings", listingId);
    if (!l) throw new Error("Annonsen finns inte");
    if (l.status !== "agreed") throw new Error("Annonsen måste ha en överenskommen intressent");
    const type: DisposalType = input.type ?? ({ give: "donated", exchange: "exchanged", lend: "lent" } as Record<string, DisposalType>)[l.type] ?? "sold";
    const lead = (await this.leads(listingId)).find((x) => x.status === "agreed" && (!input.lead_id || x.id === input.lead_id));
    const personId = lead?.person_id ?? input.person_id ?? null;

    await this.setListingTarget(me, l, type);
    l = await this.moveListing(me, l, "completed");
    if (lead) await this.moveLead(me, lead.id, "completed");
    for (const other of (await this.leads(listingId)).filter((x) => ["new", "replied", "viewing_booked"].includes(x.status))) await this.moveLead(me, other.id, "lost");

    if (personId) {
      const p = await this.get<Person>("persons", personId);
      const role = type === "sold" || type === "exchanged" ? "Köpare" : "Mottagare";
      if (p && !p.roles.includes(role)) await this.put("persons", { ...p, roles: [...p.roles, role], updated_at: now() });
    }
    const o = l.object_id ? await this.get<VObject>("objects", l.object_id) : undefined;
    const verb: Record<DisposalType, string> = { sold: "Såld", donated: "Skänkt", exchanged: "Bytt", lent: "Utlånad", discarded: "Kasserad" };
    const links: { type: string; id: string; role?: string }[] = [];
    if (l.object_id) links.push({ type: "object", id: l.object_id });
    if (personId) links.push({ type: "person", id: personId, role: "counterpart" });
    links.push({ type: "listing", id: listingId, role: "source" });
    const ev = await this.event(me, `disposal.${type}`, `${verb[type]}: ${l.quantity != null ? `${l.quantity} st ` : ""}${(o?.title ?? l.title).toLowerCase()}`, links, true);
    const d: Disposal = {
      id: uuid(), site_id: l.site_id, object_id: l.object_id ?? "", allocation_id: l.allocation_id, listing_id: listingId, person_id: personId,
      type, quantity: l.quantity, occurred_at: now(), event_id: ev.id, created_at: now(), created_by: me.id,
    };
    await this.put("disposals", d);
    await this.put("disposal_private", { disposal_id: d.id, site_id: l.site_id, price: input.price ?? null, payment_method: input.payment_method ?? "", created_by: me.id } satisfies DisposalPrivate);
    for (const cp of (await this.channelPosts(listingId)).filter((c) => c.status === "posted")) {
      await this.put("tasks", { ...(await this.base(me)), title: `Ta ner annonsen ”${l.title}” på ${cp.channel}`, due: now().slice(0, 10), status: "open", entity_type: "listing", entity_id: listingId } satisfies Task);
    }
    await this.audit_(me, "disposal", "listing", listingId, null, { type, disposal_id: d.id });
    return d.id;
  }
  async disposals(objectId?: string): Promise<Disposal[]> {
    const me = await this.me();
    const priv = await this.all<DisposalPrivate>("disposal_private");
    return (await this.all<Disposal>("disposals"))
      .filter((d) => !objectId || d.object_id === objectId)
      .map((d) => {
        const dp = priv.find((x) => x.disposal_id === d.id);
        return dp && this.seesPrivate(me, dp.created_by) ? { ...d, price: dp.price, payment_method: dp.payment_method } : d;
      })
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }

  // ------------------------------------------------------------ M4: bidrag, ömsesidighet och samtycke
  async contributions(personId?: string): Promise<Contribution[]> {
    await this.backfillProjects();
    const me = await this.me();
    return (await this.all<Contribution>("contributions"))
      .filter((c) => (!personId || c.person_id === personId) && (c.visibility !== "private" || this.seesPrivate(me, c.created_by)))
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  async addContribution(input: Pick<Contribution, "person_id" | "kind" | "description" | "hours" | "object_id" | "zone_id" | "project" | "visibility"> & { occurred_at?: string }): Promise<Contribution> {
    const me = await this.requireWriter();
    const p = await this.get<Person>("persons", input.person_id);
    if (!p) throw new Error("Personen finns inte");
    const role = ({ material: "Givare", kunskap: "Kunskapsbärare", transport: "Transportör" } as Record<string, string>)[input.kind] ?? "Medskapare";
    if (!p.roles.includes(role)) await this.put("persons", { ...p, roles: [...p.roles, role], updated_at: now() });
    const links: { type: string; id: string; role?: string }[] = [{ type: "person", id: p.id, role: "contributor" }, { type: "site", id: await this.siteId(), role: "place" }];
    if (input.object_id) links.push({ type: "object", id: input.object_id });
    if (input.zone_id) links.push({ type: "zone", id: input.zone_id, role: "place" });
    const occurred = input.occurred_at ?? now();
    const project = await this.resolveProject(me, input.project, input.zone_id, occurred);
    if (project) links.push({ type: "project", id: project.id, role: "project" });
    const ev = await this.event(me, `contribution.${input.kind}`, `Bidrag från ${p.name}: ${input.description}`, links, true, { occurred_at: occurred, visibility: input.visibility });
    const c: Contribution = { id: uuid(), site_id: p.site_id, ...input, project: project?.name ?? "", project_id: project?.id ?? null, occurred_at: occurred, thanked_at: null, event_id: ev.id, created_at: now(), created_by: me.id };
    await this.put("contributions", c);
    return c;
  }
  // ------------------------------------------------------------ M6: projekt och platser utanför Vreta
  async projects(): Promise<Project[]> {
    await this.backfillProjects();
    return (await this.all<Project>("projects")).filter((p) => !p.archived_at).sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }
  /** Demodata från före M6 har projekt bara som namn – som migrationen gör de dem till projekt. */
  private backfill?: Promise<void>;
  private backfillProjects(): Promise<void> {
    return (this.backfill ??= this.runBackfill());
  }
  private async runBackfill() {
    const me = await this.session();
    if (!me) return;
    for (const u of (await this.all<UsageEvent>("usage_events")).filter((x) => x.project?.trim() && !x.project_id)) {
      const p = await this.resolveProject(me, u.project, u.zone_id, u.occurred_at);
      if (p) await this.put("usage_events", { ...u, project: p.name, project_id: p.id });
    }
    for (const c of (await this.all<Contribution>("contributions")).filter((x) => x.project?.trim() && !x.project_id)) {
      const p = await this.resolveProject(me, c.project, c.zone_id, c.occurred_at);
      if (p) await this.put("contributions", { ...c, project: p.name, project_id: p.id });
    }
  }
  /** Som triggern resolve_project: ett namn slås upp utan hänsyn till skiftläge, annars skapas projektet. */
  private async resolveProject(me: Profile, name: string, zoneId: string | null, at: string): Promise<Project | null> {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return null;
    const found = (await this.all<Project>("projects")).find((p) => p.name.toLocaleLowerCase("sv") === clean.toLocaleLowerCase("sv"));
    if (found) return found;
    const p: Project = { ...(await this.base(me)), name: clean, kind: "", status: "active", description: "", zone_id: zoneId, structure_id: null, started_on: at.slice(0, 10), finished_on: null };
    await this.put("projects", p);
    return p;
  }
  private async assertUniqueProject(name: string, exceptId?: string) {
    const key = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv");
    if (!key) throw new Error("Projektet behöver ett namn");
    if ((await this.all<Project>("projects")).some((p) => p.id !== exceptId && p.name.toLocaleLowerCase("sv") === key)) throw new Error("Det finns redan ett projekt med det namnet");
  }
  async createProject(input: NewProject): Promise<Project> {
    const me = await this.requireWriter();
    await this.assertUniqueProject(input.name);
    const p: Project = { ...(await this.base(me)), ...input, name: input.name.trim().replace(/\s+/g, " ") };
    await this.put("projects", p);
    return p;
  }
  async updateProject(id: string, patch: Partial<NewProject>): Promise<void> {
    const me = await this.requireWriter();
    const p = await this.get<Project>("projects", id);
    if (!p) throw new Error("Projektet finns inte");
    if (patch.name !== undefined) await this.assertUniqueProject(patch.name, id);
    const next: Project = { ...p, ...patch, updated_at: now() };
    if (patch.status && patch.status !== p.status) {
      if (patch.status === "done" && !next.finished_on) next.finished_on = now().slice(0, 10);
      if (patch.status === "active" && !next.started_on) next.started_on = now().slice(0, 10);
      await this.audit_(me, "project_status", "project", id, { status: p.status }, { status: patch.status });
    }
    await this.put("projects", next);
    if (patch.name !== undefined && next.name !== p.name) {
      for (const u of (await this.all<UsageEvent>("usage_events")).filter((x) => x.project_id === id)) await this.put("usage_events", { ...u, project: next.name });
      for (const c of (await this.all<Contribution>("contributions")).filter((x) => x.project_id === id)) await this.put("contributions", { ...c, project: next.name });
    }
  }
  async externalPlaces(): Promise<ExternalPlace[]> {
    const me = await this.me();
    const priv = await this.all<PlacePrivate>("external_place_private");
    return (await this.all<ExternalPlace>("external_places")).filter((p) => !p.archived_at)
      .map((p) => (me.role === "viewer" ? p : { ...p, address: priv.find((x) => x.place_id === p.id)?.address ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "sv"));
  }
  async createExternalPlace(input: NewExternalPlace): Promise<ExternalPlace> {
    const me = await this.requireWriter();
    const { address, ...rest } = input;
    if (!rest.name.trim()) throw new Error("Platsen behöver ett namn");
    const p: ExternalPlace = { ...(await this.base(me)), ...rest, name: rest.name.trim() };
    await this.put("external_places", p);
    await this.put("external_place_private", { place_id: p.id, site_id: p.site_id, address, created_by: me.id } satisfies PlacePrivate);
    return p;
  }
  async updateExternalPlace(id: string, patch: Partial<NewExternalPlace>): Promise<void> {
    const me = await this.requireWriter();
    const p = await this.get<ExternalPlace>("external_places", id);
    if (!p) throw new Error("Platsen finns inte");
    const { address, ...rest } = patch;
    await this.put("external_places", { ...p, ...rest, updated_at: now() });
    if (address !== undefined) await this.put("external_place_private", { place_id: id, site_id: p.site_id, address, created_by: me.id } satisfies PlacePrivate);
  }
  private async setPlace(store: "acquisitions" | "pickups" | "disposals", id: string, placeId: string | null) {
    await this.requireWriter();
    const row = await this.get<{ place_id?: string | null }>(store, id);
    if (!row) throw new Error("Posten finns inte");
    if (placeId && !(await this.get<ExternalPlace>("external_places", placeId))) throw new Error("Platsen finns inte");
    await this.put(store, { ...row, place_id: placeId });
  }
  async setAcquisitionPlace(id: string, placeId: string | null): Promise<void> {
    await this.setPlace("acquisitions", id, placeId);
  }
  async setPickupPlace(id: string, placeId: string | null): Promise<void> {
    await this.setPlace("pickups", id, placeId);
  }
  async setDisposalPlace(id: string, placeId: string | null): Promise<void> {
    await this.setPlace("disposals", id, placeId);
  }

  async markThanked(ids: string[]): Promise<void> {
    await this.requireWriter();
    for (const id of ids) {
      const c = await this.get<Contribution>("contributions", id);
      if (c && !c.thanked_at) await this.put("contributions", { ...c, thanked_at: now() });
    }
  }
  async reciprocity(personId: string): Promise<ReciprocityEntry[]> {
    return (await this.all<ReciprocityEntry>("reciprocity_entries")).filter((r) => r.person_id === personId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  async addReciprocity(personId: string, description: string): Promise<void> {
    const me = await this.requireWriter();
    await this.put("reciprocity_entries", { id: uuid(), site_id: await this.siteId(), person_id: personId, description, occurred_at: now(), created_at: now(), created_by: me.id } satisfies ReciprocityEntry);
  }
  async contentConsents(contentId: string): Promise<ContentConsent[]> {
    return (await this.all<ContentConsent>("content_consents")).filter((c) => c.content_id === contentId);
  }
  async setContentConsent(input: Pick<ContentConsent, "content_id" | "person_id" | "name_ok" | "image_ok" | "contribution_ok" | "how">): Promise<void> {
    const me = await this.requireOwner();
    const existing = (await this.contentConsents(input.content_id)).find((c) => c.person_id === input.person_id);
    const next: ContentConsent = { ...(existing ?? { id: uuid(), site_id: await this.siteId(), created_at: now(), created_by: me.id }), ...input };
    await this.put("content_consents", next);
    await this.audit_(me, "content_consent", "person", input.person_id, existing ?? null, next);
  }

  // ------------------------------------------------------------ M5: uppgifter, trådar, export
  async createTask(input: Pick<Task, "title" | "due" | "entity_type" | "entity_id">): Promise<Task> {
    const me = await this.requireWriter();
    const t: Task = { ...(await this.base(me)), ...input, status: "open" };
    await this.put("tasks", t);
    await this.audit_(me, "task_created", "task", t.id, null, input);
    return t;
  }
  async completeTask(id: string): Promise<void> {
    await this.requireWriter();
    const t = await this.get<Task>("tasks", id);
    if (t) await this.put("tasks", { ...t, status: "done", updated_at: now() });
  }
  async askThreads(): Promise<AskThread[]> {
    const me = await this.me();
    return (await this.all<AskThread>("ask_threads")).filter((t) => t.created_by === me.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async saveAskThread(thread: Pick<AskThread, "id" | "title" | "messages">): Promise<void> {
    const me = await this.me();
    const existing = await this.get<AskThread>("ask_threads", thread.id);
    if (existing && existing.created_by !== me.id) throw new PermissionError("Tråden är någon annans");
    await this.put("ask_threads", { ...(existing ?? { site_id: await this.siteId(), created_at: now(), created_by: me.id }), ...thread, updated_at: now() } satisfies AskThread);
  }
  async deleteAskThread(id: string): Promise<void> {
    const me = await this.me();
    const t = await this.get<AskThread>("ask_threads", id);
    if (t && t.created_by === me.id) await (await this.dbp).delete("ask_threads", id);
  }
  async mediaOriginal(media: Media): Promise<Blob | null> {
    await this.requireOwner();
    return (await this.get<Blob>("blobs", `media-original/${media.original_path}`)) ?? null;
  }
  async allAllocations(): Promise<BatchAllocation[]> {
    return this.all<BatchAllocation>("batch_allocations");
  }
  async allStoryNotes(): Promise<StoryNote[]> {
    return (await this.all<StoryNote>("story_notes")).filter((n) => !n.archived_at);
  }
  async allContent(): Promise<ContentItem[]> {
    return this.all<ContentItem>("content_items");
  }
  async allMedia(): Promise<Media[]> {
    return (await this.all<Media>("media")).filter((m) => !m.archived_at);
  }

  /** Används av demodata och tester. */
  async rawPut(store: Store, value: unknown, key?: string) {
    await this.put(store, value, key);
  }
}

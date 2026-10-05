// Supabase-implementation av datalagret. Regler (tillståndsmaskin, roller, privata fält,
// audit, händelser vid statusbyten) upprätthålls i databasen; klienten anropar bara.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AcquisitionStatus, ChecklistItem, ChecklistTemplate, Interaction, Organization, Pickup, PickupItem, PickupStatus,
  StorageLocation,
  Acquisition, AuditEntry, Capture, CaptureInput, ContentItem, EventRec, Media, ObjectStatus, Person, Profile,
  Proposal, ProposalContent, Site, StoryNote, Structure, Task, VObject, Zone,
} from "../domain/types";
import type { StoryRows } from "../../supabase/functions/_shared/storyContext";
import type { ApproveInput, MediaInput, NewPerson, NewPickup, PlaceRef, Receipt, Repo } from "./repo";

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export class SupabaseRepo implements Repo {
  readonly kind = "supabase" as const;
  readonly client: SupabaseClient;
  private siteIdCache: string | null = null;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
  }

  private async siteId(): Promise<string> {
    if (this.siteIdCache) return this.siteIdCache;
    const s = await this.site();
    if (!s) throw new Error("Ingen plats");
    this.siteIdCache = s.id;
    return s.id;
  }

  // ------------------------------------------------------------ session
  async session(): Promise<Profile | null> {
    const { data } = await this.client.auth.getUser();
    if (!data.user) return null;
    const rows = check(await this.client.from("site_members").select("site_id, role, name").eq("user_id", data.user.id).limit(1));
    if (!rows.length) return { id: data.user.id, name: data.user.email ?? "", role: "viewer" };
    this.siteIdCache = rows[0].site_id;
    return { id: data.user.id, name: rows[0].name || data.user.email || "", role: rows[0].role };
  }
  async signInWithEmail(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) throw new Error(error.message);
  }
  async signOut(): Promise<void> {
    await this.client.auth.signOut();
    this.siteIdCache = null;
  }
  async bootstrapSite(siteName: string, memberName: string): Promise<void> {
    check(await this.client.rpc("bootstrap_site", { p_name: siteName, p_member_name: memberName }));
  }

  // ------------------------------------------------------------ plats
  async site(): Promise<Site | null> {
    const rows = check(await this.client.from("sites").select("*").limit(1));
    return (rows[0] as Site) ?? null;
  }
  async zones(): Promise<Zone[]> {
    return check(await this.client.from("zones").select("*").is("archived_at", null).order("name")) as Zone[];
  }
  async createZone(input: Pick<Zone, "name" | "kind" | "notes">): Promise<Zone> {
    return check(await this.client.from("zones").insert({ ...input, site_id: await this.siteId() }).select().single()) as Zone;
  }
  async structures(): Promise<Structure[]> {
    return check(await this.client.from("structures").select("*").is("archived_at", null).order("name")) as Structure[];
  }
  async createStructure(input: Pick<Structure, "name" | "kind" | "notes" | "zone_id">): Promise<Structure> {
    return check(await this.client.from("structures").insert({ ...input, site_id: await this.siteId() }).select().single()) as Structure;
  }

  // ------------------------------------------------------------ objekt
  async objects(): Promise<VObject[]> {
    return check(await this.client.from("objects").select("*").is("archived_at", null).order("created_at", { ascending: false })) as VObject[];
  }
  async object(id: string): Promise<VObject | null> {
    return (check(await this.client.from("objects").select("*").eq("id", id).maybeSingle()) as VObject | null) ?? null;
  }
  async updateObject(id: string, patch: Partial<VObject>): Promise<void> {
    check(await this.client.from("objects").update(patch).eq("id", id));
  }
  async changeStatus(id: string, to: ObjectStatus, place?: PlaceRef): Promise<void> {
    const patch: Record<string, unknown> = { status: to };
    if (place?.zone_id !== undefined) patch.zone_id = place.zone_id;
    if (place?.structure_id !== undefined) patch.structure_id = place.structure_id;
    check(await this.client.from("objects").update(patch).eq("id", id));
  }

  // ------------------------------------------------------------ media
  async saveMedia(input: MediaInput): Promise<Media> {
    const site_id = await this.siteId();
    const originalPath = `${site_id}/${input.id}.orig`;
    const cleanPath = `${site_id}/${input.id}.jpg`;
    const up1 = await this.client.storage.from("media-original").upload(originalPath, input.original, { contentType: input.mime, upsert: false });
    if (up1.error) throw new Error(up1.error.message);
    const up2 = await this.client.storage.from("media-clean").upload(cleanPath, input.clean, { contentType: "image/jpeg", upsert: false });
    if (up2.error) throw new Error(up2.error.message);
    return check(
      await this.client.from("media").insert({
        id: input.id, site_id, kind: input.mime.startsWith("audio") ? "audio" : "image", original_path: originalPath,
        clean_path: cleanPath, mime: input.mime, width: input.width, height: input.height, role: input.role ?? "general",
        has_people: input.has_people ?? false, entity_type: input.entity_type, entity_id: input.entity_id,
      }).select().single(),
    ) as Media;
  }
  async mediaFor(entity_type: string, entity_id: string): Promise<Media[]> {
    return check(await this.client.from("media").select("*").eq("entity_type", entity_type).eq("entity_id", entity_id).order("created_at")) as Media[];
  }
  async mediaUrl(media: Media, variant: "clean" | "original"): Promise<string | null> {
    const bucket = variant === "clean" ? "media-clean" : "media-original";
    const path = variant === "clean" ? media.clean_path : media.original_path;
    if (!path) return null;
    const { data } = await this.client.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }
  async mediaBlob(media: Media): Promise<Blob | null> {
    if (!media.clean_path) return null;
    const { data } = await this.client.storage.from("media-clean").download(media.clean_path);
    return data ?? null;
  }

  // ------------------------------------------------------------ fångst och förslag
  async saveCapture(id: string, input: CaptureInput): Promise<Capture> {
    return check(await this.client.from("captures").insert({ id, input, site_id: await this.siteId() }).select().single()) as Capture;
  }
  async capturesWithoutProposal(): Promise<Capture[]> {
    return check(await this.client.from("captures").select("*").is("proposal_id", null)) as Capture[];
  }
  async capture(id: string): Promise<Capture | null> {
    return (check(await this.client.from("captures").select("*").eq("id", id).maybeSingle()) as Capture | null) ?? null;
  }
  async attachProposal(captureId: string, content: ProposalContent): Promise<Proposal> {
    const p = check(await this.client.from("proposals").insert({ capture_id: captureId, content, site_id: await this.siteId() }).select().single()) as Proposal;
    check(await this.client.from("captures").update({ proposal_id: p.id }).eq("id", captureId));
    return p;
  }
  async proposals(): Promise<Proposal[]> {
    return check(await this.client.from("proposals").select("*").eq("status", "pending").order("created_at", { ascending: false })) as Proposal[];
  }
  async proposal(id: string): Promise<Proposal | null> {
    return (check(await this.client.from("proposals").select("*").eq("id", id).maybeSingle()) as Proposal | null) ?? null;
  }
  async rejectProposal(id: string): Promise<void> {
    check(await this.client.from("proposals").update({ status: "rejected" }).eq("id", id));
  }
  async approveProposal(input: ApproveInput): Promise<string> {
    const payload = {
      proposal_id: input.proposal_id,
      proposal_status: input.partial ? "partially_accepted" : "accepted",
      object: input.object,
      person: input.person,
      acquisition: input.acquisition,
      task: input.task,
      why: input.why,
      media_ids: input.media_ids,
    };
    return check(await this.client.rpc("create_from_proposal", { p_site: await this.siteId(), p_input: payload })) as string;
  }

  // ------------------------------------------------------------ människor
  async persons(): Promise<Person[]> {
    const people = check(await this.client.from("persons").select("*").is("archived_at", null)) as Person[];
    const priv = check(await this.client.from("person_private").select("person_id, contact, notes")) as { person_id: string; contact: string; notes: string }[];
    return people.map((p) => {
      const pp = priv.find((x) => x.person_id === p.id);
      return pp ? { ...p, contact: pp.contact, notes: pp.notes } : p;
    });
  }
  async person(id: string): Promise<Person | null> {
    return (await this.persons()).find((p) => p.id === id) ?? null;
  }
  async updateConsent(id: string, patch: Partial<Pick<Person, "consent_name" | "consent_image" | "consent_contribution">>): Promise<void> {
    check(await this.client.from("persons").update(patch).eq("id", id));
  }
  async acquisitionsFor(objectId: string): Promise<Acquisition[]> {
    const acqs = check(await this.client.from("acquisitions").select("*").eq("object_id", objectId)) as Acquisition[];
    if (!acqs.length) return acqs;
    const priv = check(
      await this.client.from("acquisition_private").select("acquisition_id, price, payment_method").in("acquisition_id", acqs.map((a) => a.id)),
    ) as { acquisition_id: string; price: number | null; payment_method: string }[];
    return acqs.map((a) => {
      const ap = priv.find((x) => x.acquisition_id === a.id);
      return ap ? { ...a, price: ap.price, payment_method: ap.payment_method } : a;
    });
  }

  // ------------------------------------------------------------ historik och berättande
  async eventsFor(entity_type: string, entity_id: string): Promise<EventRec[]> {
    const links = check(await this.client.from("event_links").select("event_id").eq("entity_type", entity_type).eq("entity_id", entity_id)) as { event_id: string }[];
    if (!links.length) return [];
    return check(await this.client.from("events").select("*").in("id", links.map((l) => l.event_id)).order("occurred_at", { ascending: false })) as EventRec[];
  }
  async addStoryNote(input: Pick<StoryNote, "entity_type" | "entity_id" | "kind" | "text" | "quote_consent">): Promise<void> {
    check(await this.client.from("story_notes").insert({ ...input, site_id: await this.siteId() }));
  }
  async storyNotesFor(entity_type: string, entity_id: string): Promise<StoryNote[]> {
    return check(await this.client.from("story_notes").select("*").eq("entity_type", entity_type).eq("entity_id", entity_id)) as StoryNote[];
  }
  async markMoment(objectId: string, text: string): Promise<void> {
    const site_id = await this.siteId();
    await this.addStoryNote({ entity_type: "object", entity_id: objectId, kind: "moment", text, quote_consent: false });
    const ev = check(await this.client.from("events").insert({ site_id, event_type: "story.moment", summary: text || "Markerat som bra ögonblick", story_worthy: true }).select("id").single()) as { id: string };
    check(await this.client.from("event_links").insert({ site_id, event_id: ev.id, entity_type: "object", entity_id: objectId }));
  }
  async contentFor(source_type: string, source_id: string): Promise<ContentItem[]> {
    return check(await this.client.from("content_items").select("*").eq("source_type", source_type).eq("source_id", source_id).order("updated_at", { ascending: false })) as ContentItem[];
  }
  async saveContent(item: Partial<ContentItem> & Pick<ContentItem, "goal" | "source_type" | "source_id" | "variants" | "status">): Promise<ContentItem> {
    const row = { goal: item.goal, source_type: item.source_type, source_id: item.source_id, variants: item.variants, status: item.status, sources: item.sources ?? [], warnings: item.warnings ?? [] };
    if (item.id) return check(await this.client.from("content_items").update(row).eq("id", item.id).select().single()) as ContentItem;
    return check(await this.client.from("content_items").insert({ ...row, site_id: await this.siteId() }).select().single()) as ContentItem;
  }
  async markShared(id: string, url: string): Promise<void> {
    const c = check(await this.client.from("content_items").update({ status: "shared", shared_url: url }).eq("id", id).select().single()) as ContentItem;
    const site_id = await this.siteId();
    const ev = check(await this.client.from("events").insert({ site_id, event_type: "content.shared", summary: "Berättelse delad" }).select("id").single()) as { id: string };
    check(await this.client.from("event_links").insert([
      { site_id, event_id: ev.id, entity_type: c.source_type, entity_id: c.source_id },
      { site_id, event_id: ev.id, entity_type: "content", entity_id: id },
    ]));
  }

  // ------------------------------------------------------------ övrigt
  async tasks(): Promise<Task[]> {
    return check(await this.client.from("tasks").select("*").in("status", ["open", "in_progress"]).order("due", { ascending: true, nullsFirst: false })) as Task[];
  }
  async storyRows(): Promise<StoryRows> {
    // I drift bygger edge-funktionen story-agent kontexten på servern.
    throw new Error("storyRows används inte med Supabase");
  }
  async audit(): Promise<AuditEntry[]> {
    return check(await this.client.from("audit_entries").select("*").order("at", { ascending: false }).limit(200)) as AuditEntry[];
  }
  async exportAll(): Promise<Record<string, unknown[]>> {
    const tables = ["sites", "zones", "structures", "objects", "persons", "person_private", "acquisitions", "acquisition_private", "media", "captures", "proposals", "events", "event_links", "story_notes", "content_items", "tasks", "audit_entries"];
    const out: Record<string, unknown[]> = {};
    for (const t of tables) out[t] = check(await this.client.from(t).select("*")) as unknown[];
    return out;
  }

  // ------------------------------------------------------------ M2: människor och inflöde
  async organizations(): Promise<Organization[]> {
    const orgs = check(await this.client.from("organizations").select("*").is("archived_at", null).order("name")) as Organization[];
    const priv = check(await this.client.from("organization_private").select("organization_id, contact, notes")) as { organization_id: string; contact: string; notes: string }[];
    return orgs.map((o) => {
      const p = priv.find((x) => x.organization_id === o.id);
      return p ? { ...o, contact: p.contact, notes: p.notes } : o;
    });
  }
  async createOrganization(input: Pick<Organization, "name" | "kind" | "locality">): Promise<Organization> {
    const site_id = await this.siteId();
    const o = check(await this.client.from("organizations").insert({ ...input, site_id }).select().single()) as Organization;
    check(await this.client.from("organization_private").insert({ organization_id: o.id, site_id }));
    return o;
  }
  async createPerson(input: NewPerson): Promise<Person> {
    const site_id = await this.siteId();
    const { contact, notes, ...rest } = input;
    const p = check(await this.client.from("persons").insert({ ...rest, site_id }).select().single()) as Person;
    check(await this.client.from("person_private").insert({ person_id: p.id, site_id, contact, notes }));
    return p;
  }
  async updatePerson(id: string, patch: Partial<Pick<Person, "name" | "locality" | "roles" | "how_we_met" | "organization_id">>): Promise<void> {
    check(await this.client.from("persons").update(patch).eq("id", id));
  }
  async updatePersonPrivate(id: string, patch: { contact?: string; notes?: string }): Promise<void> {
    check(await this.client.from("person_private").update(patch).eq("person_id", id));
  }
  async interactions(person_id: string): Promise<Interaction[]> {
    return check(await this.client.from("interactions").select("*").eq("person_id", person_id).order("occurred_at", { ascending: false })) as Interaction[];
  }
  async addInteraction(input: Pick<Interaction, "person_id" | "organization_id" | "channel" | "summary" | "follow_up"> & { occurred_at?: string }): Promise<void> {
    check(await this.client.from("interactions").insert({ ...input, site_id: await this.siteId() }));
  }
  async followUps(): Promise<Interaction[]> {
    return check(await this.client.from("interactions").select("*").not("follow_up", "is", null).order("follow_up")) as Interaction[];
  }
  async allAcquisitions(): Promise<Acquisition[]> {
    const acqs = check(await this.client.from("acquisitions").select("*").is("archived_at", null)) as Acquisition[];
    const priv = check(await this.client.from("acquisition_private").select("acquisition_id, price, payment_method")) as { acquisition_id: string; price: number | null; payment_method: string }[];
    return acqs.map((a) => {
      const ap = priv.find((x) => x.acquisition_id === a.id);
      return ap ? { ...a, price: ap.price, payment_method: ap.payment_method } : a;
    });
  }
  async setAcquisitionStatus(id: string, to: AcquisitionStatus): Promise<void> {
    check(await this.client.from("acquisitions").update({ status: to }).eq("id", id));
  }
  async updateAcquisitionPrivate(id: string, patch: { price?: number | null; payment_method?: string }): Promise<void> {
    check(await this.client.from("acquisition_private").update(patch).eq("acquisition_id", id));
  }

  // ------------------------------------------------------------ M2: lager
  async storageLocations(): Promise<StorageLocation[]> {
    return check(await this.client.from("storage_locations").select("*").is("archived_at", null).order("name")) as StorageLocation[];
  }
  async createStorageLocation(input: Pick<StorageLocation, "name" | "parent_id" | "structure_id" | "notes">): Promise<StorageLocation> {
    return check(await this.client.from("storage_locations").insert({ ...input, site_id: await this.siteId() }).select().single()) as StorageLocation;
  }
  async storeObject(objectId: string, locationId: string): Promise<void> {
    check(await this.client.rpc("store_object", { p_object: objectId, p_location: locationId }));
  }

  // ------------------------------------------------------------ M2: hämtningar
  async checklistTemplates(): Promise<ChecklistTemplate[]> {
    return check(await this.client.from("checklist_templates").select("*").is("archived_at", null).order("name")) as ChecklistTemplate[];
  }
  async pickups(): Promise<Pickup[]> {
    const list = check(await this.client.from("pickups").select("*").is("archived_at", null).order("scheduled_date", { nullsFirst: false })) as Pickup[];
    const priv = check(await this.client.from("pickup_private").select("pickup_id, address")) as { pickup_id: string; address: string }[];
    return list.map((p) => ({ ...p, address: priv.find((x) => x.pickup_id === p.id)?.address }));
  }
  async pickup(id: string): Promise<Pickup | null> {
    const p = check(await this.client.from("pickups").select("*").eq("id", id).maybeSingle()) as Pickup | null;
    if (!p) return null;
    const priv = check(await this.client.from("pickup_private").select("address").eq("pickup_id", id).maybeSingle()) as { address: string } | null;
    return { ...p, address: priv?.address };
  }
  async pickupItems(pickupId: string): Promise<PickupItem[]> {
    return check(await this.client.from("pickup_items").select("*").eq("pickup_id", pickupId)) as PickupItem[];
  }
  async checklist(pickupId: string): Promise<ChecklistItem[]> {
    return check(await this.client.from("checklist_items").select("*").eq("pickup_id", pickupId).order("position")) as ChecklistItem[];
  }
  async createPickup(input: NewPickup): Promise<string> {
    return check(await this.client.rpc("create_pickup", { p_site: await this.siteId(), p_input: input })) as string;
  }
  async setPickupStatus(id: string, to: PickupStatus): Promise<void> {
    check(await this.client.from("pickups").update({ status: to }).eq("id", id));
  }
  async toggleChecklistItem(item: ChecklistItem, done: boolean): Promise<void> {
    check(await this.client.from("checklist_items").update({ done }).eq("id", item.id));
  }
  async completePickup(id: string, receipts: Receipt[], locationId: string | null): Promise<void> {
    check(await this.client.rpc("complete_pickup", { p_pickup: id, p_receipts: receipts, p_location: locationId }));
  }

  async pendingSync(): Promise<number> {
    return 0;
  }
  async flushOutbox(): Promise<number> {
    return 0;
  }
}

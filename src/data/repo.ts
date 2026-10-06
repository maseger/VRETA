import type {
  ExternalPlace, GuestLink, Need, NeedFulfillment, PersonRelation, Project,
  Acquisition, AcquisitionType, AuditEntry, Capture, CaptureInput, ContentItem, EventRec, Media, ObjectStatus,
  Person, Profile, Proposal, ProposalContent, Role, Site, StoryNote, Structure, Task, VObject, Zone, FieldMeta,
  AcquisitionStatus, ChecklistItem, ChecklistTemplate, Interaction, Organization, Pickup, PickupItem, PickupStatus,
  ReceiptStatus, StorageLocation,
  BatchAllocation, Decision, EventLink, MapLayer, Observation, UsageEvent, UsageType,
  ChannelPost, ContentConsent, Contribution, Disposal, DisposalType, Lead, LeadStatus, Listing, ListingStatus, PublishMode,
  ReciprocityEntry, AskThread,
} from "../domain/types";
import type { PointGeom, PolygonGeom } from "../geo/geo";
import type { StoryRows } from "../../supabase/functions/_shared/storyContext";

export interface MediaInput {
  id: string;
  original: Blob;
  clean: Blob;
  mime: string;
  width: number;
  height: number;
  entity_type: string;
  entity_id: string;
  role?: Media["role"];
  has_people?: boolean;
  /** Standard är shareable; foton på personer följer personens bildsamtycke. */
  visibility?: Media["visibility"];
}

export interface ApproveInput {
  proposal_id: string;
  partial: boolean;
  object: {
    title: string;
    category: string;
    description: string;
    material: string;
    dimensions: string;
    quantity: number;
    unit: string;
    condition: number | null;
    field_meta: Record<string, FieldMeta>;
  };
  person: { name: string; locality: string; existing_person_id: string | null } | null;
  acquisition: { type: AcquisitionType; price: number | null; deadline: string | null } | null;
  task: { title: string; due: string | null } | null;
  why: string;
  media_ids: string[];
}

export interface PlaceRef {
  zone_id?: string | null;
  structure_id?: string | null;
}

/** Datalagret. Implementeras av Supabase (riktig drift) och IndexedDB (demo/offline). */
export interface Repo {
  readonly kind: "local" | "supabase";

  session(): Promise<Profile | null>;
  signInWithEmail(email: string): Promise<void>;
  /** Inloggning utan mejl, för konton som har ett lösenord. */
  signInWithPassword?(email: string, password: string): Promise<void>;
  changePassword?(password: string): Promise<void>;
  signOut(): Promise<void>;
  bootstrapSite(siteName: string, memberName: string): Promise<void>;
  setDemoRole?(role: Role): Promise<void>;

  site(): Promise<Site | null>;
  zones(): Promise<Zone[]>;
  createZone(input: Pick<Zone, "name" | "kind" | "notes">): Promise<Zone>;
  structures(): Promise<Structure[]>;
  createStructure(input: Pick<Structure, "name" | "kind" | "notes" | "zone_id">): Promise<Structure>;

  objects(): Promise<VObject[]>;
  object(id: string): Promise<VObject | null>;
  updateObject(id: string, patch: Partial<Pick<VObject, "title" | "category" | "description" | "material" | "dimensions" | "era" | "condition" | "visibility" | "field_meta">>): Promise<void>;
  changeStatus(id: string, to: ObjectStatus, place?: PlaceRef): Promise<void>;

  saveMedia(input: MediaInput): Promise<Media>;
  mediaFor(entity_type: string, entity_id: string): Promise<Media[]>;
  /** Tar bort en bild ur vyerna (arkiveras – filen ligger kvar för export). */
  archiveMedia(id: string): Promise<void>;
  mediaUrl(media: Media, variant: "clean" | "original"): Promise<string | null>;
  mediaBlob(media: Media): Promise<Blob | null>;

  saveCapture(id: string, input: CaptureInput): Promise<Capture>;
  capturesWithoutProposal(): Promise<Capture[]>;
  capture(id: string): Promise<Capture | null>;
  attachProposal(captureId: string, content: ProposalContent): Promise<Proposal>;
  proposals(): Promise<Proposal[]>;
  proposal(id: string): Promise<Proposal | null>;
  rejectProposal(id: string): Promise<void>;
  approveProposal(input: ApproveInput): Promise<string>;

  persons(): Promise<Person[]>;
  person(id: string): Promise<Person | null>;
  updateConsent(id: string, patch: Partial<Pick<Person, "consent_name" | "consent_image" | "consent_contribution">>): Promise<void>;
  acquisitionsFor(objectId: string): Promise<Acquisition[]>;

  eventsFor(entity_type: string, entity_id: string): Promise<EventRec[]>;
  addStoryNote(input: Pick<StoryNote, "entity_type" | "entity_id" | "kind" | "text" | "quote_consent">): Promise<void>;
  storyNotesFor(entity_type: string, entity_id: string): Promise<StoryNote[]>;
  markMoment(objectId: string, text: string): Promise<void>;

  contentFor(source_type: string, source_id: string): Promise<ContentItem[]>;
  saveContent(item: Partial<ContentItem> & Pick<ContentItem, "goal" | "source_type" | "source_id" | "variants" | "status">): Promise<ContentItem>;
  markShared(id: string, url: string): Promise<void>;

  tasks(): Promise<Task[]>;

  // ---- M2: människor, inflöde, hämtning och lager
  organizations(): Promise<Organization[]>;
  createOrganization(input: Pick<Organization, "name" | "kind" | "locality">): Promise<Organization>;
  createPerson(input: NewPerson): Promise<Person>;
  updatePerson(id: string, patch: Partial<Pick<Person, "name" | "locality" | "roles" | "how_we_met" | "organization_id">>): Promise<void>;
  updatePersonPrivate(id: string, patch: { contact?: string; notes?: string }): Promise<void>;
  interactions(person_id: string): Promise<Interaction[]>;
  addInteraction(input: Pick<Interaction, "person_id" | "organization_id" | "channel" | "summary" | "follow_up"> & { occurred_at?: string }): Promise<void>;
  followUps(): Promise<Interaction[]>;
  allAcquisitions(): Promise<Acquisition[]>;
  setAcquisitionStatus(id: string, to: AcquisitionStatus): Promise<void>;
  updateAcquisitionPrivate(id: string, patch: { price?: number | null; payment_method?: string }): Promise<void>;

  storageLocations(): Promise<StorageLocation[]>;
  createStorageLocation(input: Pick<StorageLocation, "name" | "parent_id" | "structure_id" | "notes">): Promise<StorageLocation>;
  storeObject(objectId: string, locationId: string): Promise<void>;

  checklistTemplates(): Promise<ChecklistTemplate[]>;
  pickups(): Promise<Pickup[]>;
  pickup(id: string): Promise<Pickup | null>;
  pickupItems(pickupId: string): Promise<PickupItem[]>;
  checklist(pickupId: string): Promise<ChecklistItem[]>;
  createPickup(input: NewPickup): Promise<string>;
  setPickupStatus(id: string, to: PickupStatus): Promise<void>;
  toggleChecklistItem(item: ChecklistItem, done: boolean): Promise<void>;
  completePickup(id: string, receipts: Receipt[], locationId: string | null): Promise<void>;

  // ---- M3: nytt liv, partier, journal och karta
  allocations(objectId: string): Promise<BatchAllocation[]>;
  recordUsage(objectId: string, input: UsageInput): Promise<void>;
  storeAllocation(allocationId: string, quantity: number, locationId: string): Promise<void>;
  usageEvents(objectId: string): Promise<UsageEvent[]>;
  allUsageEvents(): Promise<UsageEvent[]>;
  createObservation(input: Pick<Observation, "kind" | "text" | "zone_id" | "structure_id" | "object_id" | "geom" | "follow_up" | "visibility">): Promise<Observation>;
  observations(): Promise<Observation[]>;
  createDecision(input: Pick<Decision, "question" | "options" | "choice" | "rationale" | "zone_id" | "object_id" | "visibility">): Promise<Decision>;
  decisions(): Promise<Decision[]>;
  eventLinks(eventIds: string[]): Promise<EventLink[]>;
  setZoneGeom(id: string, geom: PolygonGeom | null): Promise<void>;
  setStructureGeom(id: string, geom: PolygonGeom | null): Promise<void>;
  mapLayers(): Promise<MapLayer[]>;
  addMapLayer(input: NewMapLayer): Promise<MapLayer>;
  updateMapLayer(id: string, patch: Partial<Pick<MapLayer, "opacity" | "name" | "taken_on" | "archived_at">>): Promise<void>;
  mapImage(layer: MapLayer): Promise<Blob | null>;

  // ---- M4: utflöde, intressenter, bidrag och samtycke
  listings(): Promise<Listing[]>;
  listing(id: string): Promise<Listing | null>;
  saveListing(input: ListingInput): Promise<Listing>;
  setListingStatus(id: string, to: ListingStatus): Promise<void>;
  channelPosts(listingId?: string): Promise<ChannelPost[]>;
  saveChannelDraft(listingId: string, channel: string, title: string, text: string): Promise<void>;
  publishChannel(listingId: string, channel: string, url: string, mode: PublishMode): Promise<void>;
  removeChannel(listingId: string, channel: string): Promise<void>;
  leads(listingId?: string): Promise<Lead[]>;
  addLead(input: Pick<Lead, "listing_id" | "person_id" | "channel" | "message" | "bid">): Promise<Lead>;
  setLeadStatus(id: string, to: LeadStatus): Promise<void>;
  agreeLead(id: string): Promise<void>;
  releaseLead(id: string, to: "no_show" | "lost" | "rejected"): Promise<void>;
  completeDisposal(listingId: string, input: DisposalInput): Promise<string>;
  disposals(objectId?: string): Promise<Disposal[]>;
  contributions(personId?: string): Promise<Contribution[]>;
  addContribution(input: Pick<Contribution, "person_id" | "kind" | "description" | "hours" | "object_id" | "zone_id" | "project" | "visibility"> & { occurred_at?: string }): Promise<Contribution>;
  markThanked(contributionIds: string[]): Promise<void>;
  reciprocity(personId: string): Promise<ReciprocityEntry[]>;
  addReciprocity(personId: string, description: string): Promise<void>;
  contentConsents(contentId: string): Promise<ContentConsent[]>;
  setContentConsent(input: Pick<ContentConsent, "content_id" | "person_id" | "name_ok" | "image_ok" | "contribution_ok" | "how">): Promise<void>;

  // ---- M5: uppgifter, Fråga Vreta, export
  createTask(input: Pick<Task, "title" | "due" | "entity_type" | "entity_id">): Promise<Task>;
  completeTask(id: string): Promise<void>;
  askThreads(): Promise<AskThread[]>;
  saveAskThread(thread: Pick<AskThread, "id" | "title" | "messages">): Promise<void>;
  deleteAskThread(id: string): Promise<void>;
  /** Originalfilen (med EXIF) – bara för export till ägaren. */
  mediaOriginal(media: Media): Promise<Blob | null>;
  allMedia(): Promise<Media[]>;
  allAllocations(): Promise<BatchAllocation[]>;
  allStoryNotes(): Promise<StoryNote[]>;
  allContent(): Promise<ContentItem[]>;

  /** AI-förbrukning denna månad per funktion (bara Supabase, bara ägaren). */
  aiUsage?(): Promise<{ function: string; input_tokens: number; output_tokens: number; calls: number }[]>;

  /** Antal ändringar som väntar på att synkas (bara Supabase). */
  pendingSync?(): Promise<number>;
  flushOutbox?(): Promise<number>;
  // ---- M6: projekt och platser utanför Vreta
  projects(): Promise<Project[]>;
  createProject(input: NewProject): Promise<Project>;
  updateProject(id: string, patch: Partial<NewProject>): Promise<void>;
  externalPlaces(): Promise<ExternalPlace[]>;
  createExternalPlace(input: NewExternalPlace): Promise<ExternalPlace>;
  updateExternalPlace(id: string, patch: Partial<NewExternalPlace>): Promise<void>;
  setAcquisitionPlace(acquisitionId: string, placeId: string | null): Promise<void>;
  setPickupPlace(pickupId: string, placeId: string | null): Promise<void>;
  setDisposalPlace(disposalId: string, placeId: string | null): Promise<void>;

  // ---- M7: behov och projektytor
  needs(projectId?: string): Promise<Need[]>;
  createNeed(input: NewNeed): Promise<Need>;
  updateNeed(id: string, patch: Partial<Pick<Need, "title" | "quantity" | "unit" | "notes" | "status" | "listing_id">>): Promise<void>;
  needFulfillments(needIds?: string[]): Promise<NeedFulfillment[]>;
  fulfillNeed(input: NewFulfillment): Promise<NeedFulfillment>;
  removeFulfillment(id: string): Promise<void>;
  setProjectGeom(id: string, geom: PolygonGeom | null): Promise<void>;

  // ---- M8: relationer och organisationer
  /** Tom för läsare – relationer är personuppgifter. */
  relations(personId?: string): Promise<PersonRelation[]>;
  addRelation(input: Pick<PersonRelation, "person_id" | "other_id" | "kind" | "note">): Promise<PersonRelation>;
  removeRelation(id: string): Promise<void>;
  updateOrganization(id: string, patch: Partial<Pick<Organization, "name" | "kind" | "locality">>): Promise<void>;

  // ---- M9: gäster
  /** Öppnar en gästlänk utan konto. Kastar om länken inte gäller. */
  enterAsGuest(token: string): Promise<void>;
  guestLinks(): Promise<GuestLink[]>;
  /** Nyckeln returneras bara här – sedan finns bara dess hash kvar. */
  createGuestLink(label: string): Promise<{ id: string; token: string }>;
  revokeGuestLink(id: string): Promise<void>;

  storyRows(objectId: string, contentId?: string): Promise<StoryRows>;
  audit(): Promise<AuditEntry[]>;
  exportAll(): Promise<Record<string, unknown[]>>;
}

export interface NewPerson {
  name: string;
  locality: string;
  roles: string[];
  how_we_met: string;
  organization_id: string | null;
  contact: string;
  notes: string;
}

export interface NewPickup {
  acquisition_id: string | null;
  person_id: string | null;
  title: string;
  scheduled_date: string | null;
  window_from: string | null;
  window_to: string | null;
  resources: string[];
  address: string;
  object_ids: string[];
  template_id: string | null;
  safety_note: string;
  /** Plats utanför Vreta (M6). */
  place_id?: string | null;
}

export type NewNeed = Pick<Need, "project_id" | "title" | "quantity" | "unit" | "notes">;
export type NewFulfillment = Pick<NeedFulfillment, "need_id" | "quantity" | "object_id" | "contribution_id" | "note">;
export type NewProject = Pick<Project, "name" | "kind" | "status" | "description" | "zone_id" | "structure_id" | "started_on" | "finished_on">;
export type NewExternalPlace = Pick<ExternalPlace, "name" | "kind" | "locality" | "notes"> & { address: string };

export interface Receipt {
  object_id: string;
  receipt: ReceiptStatus;
  note: string;
}

export interface UsageInput {
  type: UsageType;
  zone_id: string | null;
  structure_id: string | null;
  quantity: number | null;
  project: string;
  note: string;
  occurred_at: string | null;
  geom: PointGeom | null;
  from_allocation_id: string | null;
}

export interface NewMapLayer {
  kind: MapLayer["kind"];
  name: string;
  taken_on: string | null;
  image: Blob;
  corners: [number, number][];
  source_crs: string;
  opacity: number;
}

export interface ListingInput {
  id?: string;
  object_id: string | null;
  type: Listing["type"];
  title: string;
  description: string;
  price: number | null;
  quantity: number | null;
  locality: string;
  image_ids: string[];
}

export interface DisposalInput {
  lead_id?: string | null;
  type?: DisposalType;
  price?: number | null;
  payment_method?: string;
  person_id?: string | null;
}

export class PermissionError extends Error {}

import type { PointGeom, PolygonGeom } from "../geo/geo";

// Domäntyper för R1 milstolpe M1. Namnen följer specifikationen (docs/spec-r1.md, avsnitt 5–6).

export type Visibility = "private" | "internal" | "shareable" | "public";
export type Role = "owner" | "contributor" | "viewer";

export type ObjectStatus =
  | "discovered"
  | "contacted"
  | "reserved"
  | "pickup_planned"
  | "collected"
  | "stored"
  | "processing"
  | "in_use"
  | "listed"
  | "reserved_out"
  | "lent"
  | "declined"
  | "lost"
  | "sold"
  | "donated"
  | "exchanged"
  | "discarded";

export type Consent = "yes" | "no" | "ask";

export type SourceType = "manual" | "ai_capture" | "marketplace_import" | "email_import" | "agent" | "system";

export interface Base {
  id: string;
  site_id: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  archived_at: string | null;
}

/** Per-fält-metadata för AI-extraherade värden (INV-02, NFR-014). */
export interface FieldMeta {
  confidence: number;
  verified: boolean;
}

export interface Site extends Omit<Base, "site_id"> {
  name: string;
  description: string;
}

export type PlaceStatus = "existing" | "planned" | "removed";

export interface Zone extends Base {
  name: string;
  kind: string;
  status: PlaceStatus;
  notes: string;
  geom: PolygonGeom | null;
}

export interface Structure extends Base {
  name: string;
  kind: string;
  zone_id: string | null;
  status: PlaceStatus;
  notes: string;
  geom: PolygonGeom | null;
}

export interface VObject extends Base {
  title: string;
  category: string;
  description: string;
  material: string;
  dimensions: string;
  era: string;
  condition: number | null; // 1–5
  is_batch: boolean;
  quantity: number;
  unit: string;
  status: ObjectStatus;
  visibility: Visibility;
  source_type: SourceType;
  zone_id: string | null;
  structure_id: string | null;
  cover_media_id: string | null;
  storage_location_id: string | null;
  field_meta: Record<string, FieldMeta>;
}

export interface Person extends Base {
  name: string;
  locality: string;
  roles: string[];
  organization_id: string | null;
  how_we_met: string;
  /** Privat (INV-13). Saknas när användaren inte får se det. */
  contact?: string;
  /** Privat. Saknas när användaren inte får se det. */
  notes?: string;
  consent_name: "yes" | "no" | "ask";
  consent_image: "yes" | "no" | "ask";
  consent_contribution: "yes" | "no" | "ask";
}

export type AcquisitionType = "purchase" | "gift" | "exchange" | "loan" | "work_trade";
export type AcquisitionStatus = "lead" | "contacted" | "negotiating" | "agreed" | "received" | "settled" | "declined" | "lost";

export interface Acquisition extends Base {
  object_id: string;
  person_id: string | null;
  organization_id?: string | null;
  type: AcquisitionType;
  status: AcquisitionStatus;
  /** Privat. Saknas när användaren inte får se det. */
  price?: number | null;
  payment_method?: string;
  source_url: string;
  deadline: string | null;
}

export type MediaKind = "image" | "audio";

export interface Media extends Base {
  kind: MediaKind;
  /** Original med metadata – alltid private. */
  original_path: string;
  /** Derivat utan EXIF/GPS, nedskalat – det enda som får lämna appen (INV-07). */
  clean_path: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  caption: string;
  role: "general" | "before" | "during" | "after";
  has_people: boolean;
  visibility: Visibility;
  entity_type: string;
  entity_id: string;
}

export interface CaptureInput {
  text: string;
  kind: "find" | "person" | "observation" | "other";
  media_ids: string[];
}

export interface Capture extends Base {
  input: CaptureInput;
  sync_state: "local" | "synced";
  proposal_id: string | null;
}

export interface ProposedValue<T = string | number | null> {
  value: T;
  confidence: number;
}

export interface ProposalContent {
  object: {
    title: ProposedValue<string>;
    category: ProposedValue<string>;
    description: ProposedValue<string>;
    material: ProposedValue<string>;
    dimensions: ProposedValue<string>;
    quantity: ProposedValue<number>;
    unit: ProposedValue<string>;
    condition: ProposedValue<number | null>;
  } | null;
  person: {
    name: ProposedValue<string>;
    locality: ProposedValue<string>;
    existing_person_id: string | null;
  } | null;
  acquisition: {
    type: ProposedValue<AcquisitionType>;
    price: ProposedValue<number | null>;
    deadline: ProposedValue<string | null>;
  } | null;
  task: { title: ProposedValue<string>; due: ProposedValue<string | null> } | null;
  why: ProposedValue<string>;
  agent: "claude" | "local";
}

export interface Proposal extends Base {
  capture_id: string;
  status: "pending" | "accepted" | "partially_accepted" | "rejected" | "expired";
  content: ProposalContent;
}

export interface EventRec extends Base {
  event_type: string;
  occurred_at: string;
  summary: string;
  notes: string;
  story_worthy: boolean;
  visibility: Visibility;
}

export interface EventLink {
  id: string;
  event_id: string;
  entity_type: string;
  entity_id: string;
  role: string;
}

export interface StoryNote extends Base {
  entity_type: string;
  entity_id: string;
  kind: "why" | "quote" | "moment";
  text: string;
  quote_consent: boolean;
}

export type ContentGoal = "fyndet" | "resan" | "fore_efter" | "tack" | "visa_vad_som_hant";
export type Channel = "facebook" | "instagram" | "linkedin" | "privat";
export type ContentStatus = "idea" | "draft" | "review" | "approved" | "shared" | "archived" | "rejected";

export interface ChannelVariant {
  channel: Channel;
  text: string;
  media_ids: string[];
}

export interface ContentItem extends Base {
  goal: ContentGoal;
  source_type: string;
  source_id: string;
  status: ContentStatus;
  variants: ChannelVariant[];
  sources: string[];
  warnings: string[];
  approved_by: string | null;
  shared_url: string;
}

export interface Task extends Base {
  title: string;
  due: string | null;
  status: "open" | "in_progress" | "done" | "snoozed" | "cancelled";
  entity_type: string;
  entity_id: string;
}

export interface AuditEntry {
  id: string;
  site_id: string;
  at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
}

export interface Profile {
  id: string;
  name: string;
  role: Role;
}

export interface Organization extends Base {
  name: string;
  kind: string;
  locality: string;
  roles: string[];
  contact?: string;
  notes?: string;
}

export type InteractionChannel = "samtal" | "meddelande" | "mote" | "mejl" | "annat";

export interface Interaction extends Base {
  person_id: string | null;
  organization_id: string | null;
  channel: InteractionChannel;
  occurred_at: string;
  summary: string;
  follow_up: string | null;
}

export interface StorageLocation extends Base {
  parent_id: string | null;
  structure_id: string | null;
  name: string;
  notes: string;
}

export type PickupStatus = "planned" | "confirmed" | "in_progress" | "completed" | "cancelled";
export type ReceiptStatus = "received" | "partial" | "deviation";

export interface Pickup extends Base {
  acquisition_id: string | null;
  person_id: string | null;
  title: string;
  scheduled_date: string | null;
  window_from: string | null;
  window_to: string | null;
  resources: string[];
  status: PickupStatus;
  safety_note: string;
  completed_at: string | null;
  /** Privat för läsare. */
  address?: string;
}

export interface PickupItem {
  id: string;
  site_id: string;
  pickup_id: string;
  object_id: string;
  receipt: ReceiptStatus | null;
  note: string;
}

export interface ChecklistItem {
  id: string;
  site_id: string;
  pickup_id: string;
  label: string;
  done: boolean;
  position: number;
}

export interface ChecklistTemplate extends Base {
  name: string;
  items: string[];
}

export interface MapLayer extends Base {
  kind: "base" | "overlay";
  name: string;
  taken_on: string | null;
  image_path: string;
  corners: [number, number][];
  source_crs: string;
  opacity: number;
}

export interface BatchAllocation {
  id: string;
  site_id: string;
  object_id: string;
  quantity: number;
  status: ObjectStatus;
  storage_location_id: string | null;
  zone_id: string | null;
  structure_id: string | null;
  created_at: string;
  updated_at: string;
}

export type UsageType = "installed" | "planted" | "built_in" | "renovated" | "reused" | "moved" | "removed" | "replanted" | "decommissioned";

export interface UsageEvent {
  id: string;
  site_id: string;
  object_id: string;
  allocation_id: string | null;
  type: UsageType;
  occurred_at: string;
  zone_id: string | null;
  structure_id: string | null;
  quantity: number | null;
  project: string;
  note: string;
  geom: PointGeom | null;
  event_id: string | null;
  created_at: string;
  created_by: string;
}

export interface Observation extends Base {
  kind: string;
  text: string;
  zone_id: string | null;
  structure_id: string | null;
  object_id: string | null;
  geom: PointGeom | null;
  follow_up: string | null;
  visibility: Visibility;
  event_id: string | null;
  occurred_at: string;
}

export interface Decision extends Base {
  question: string;
  options: string;
  choice: string;
  rationale: string;
  outcome: string;
  zone_id: string | null;
  object_id: string | null;
  visibility: Visibility;
  event_id: string | null;
  decided_on: string;
}

// ---------------------------------------------------------------- M4: utflöde och CRM

export type ListingType = "sell" | "give" | "exchange" | "lend" | "wanted" | "help_wanted";
export type ListingStatus = "draft" | "ready" | "published" | "agreed" | "completed" | "archived" | "withdrawn";

export interface Listing extends Base {
  object_id: string | null;
  allocation_id: string | null;
  type: ListingType;
  title: string;
  description: string;
  /** Annonserat pris – publikt i annonsen. */
  price: number | null;
  quantity: number | null;
  /** Ort på kommunnivå, aldrig adress (INV-12). */
  locality: string;
  status: ListingStatus;
  image_ids: string[];
}

export type PublishMode = "manual" | "browser_agent" | "api";

export interface ChannelPost {
  id: string;
  site_id: string;
  listing_id: string;
  channel: string;
  title: string;
  text: string;
  external_url: string;
  status: "not_posted" | "posted" | "removed";
  publish_mode: PublishMode;
  posted_at: string | null;
  removed_at: string | null;
}

export type LeadStatus = "new" | "replied" | "viewing_booked" | "agreed" | "completed" | "no_show" | "lost" | "rejected";

export interface Lead {
  id: string;
  site_id: string;
  listing_id: string;
  person_id: string | null;
  channel: string;
  queue_position: number;
  bid: number | null;
  message: string;
  status: LeadStatus;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export type DisposalType = "sold" | "donated" | "exchanged" | "discarded" | "lent";

export interface Disposal {
  id: string;
  site_id: string;
  object_id: string;
  allocation_id: string | null;
  listing_id: string | null;
  person_id: string | null;
  type: DisposalType;
  quantity: number | null;
  occurred_at: string;
  event_id: string | null;
  created_at: string;
  created_by: string;
  /** Privat. Saknas när användaren inte får se det. */
  price?: number | null;
  payment_method?: string;
}

export type ContributionKind = "material" | "tid" | "kunskap" | "maskin" | "transport" | "kontakter" | "mat" | "ekonomiskt" | "omsorg";

export interface Contribution {
  id: string;
  site_id: string;
  person_id: string;
  kind: ContributionKind;
  description: string;
  hours: number | null;
  object_id: string | null;
  zone_id: string | null;
  project: string;
  occurred_at: string;
  thanked_at: string | null;
  visibility: Visibility;
  event_id: string | null;
  created_at: string;
  created_by: string;
}

export interface ReciprocityEntry {
  id: string;
  site_id: string;
  person_id: string;
  description: string;
  occurred_at: string;
  created_at: string;
  created_by: string;
}

/** Samtycke för ett enskilt inlägg när personen har "fråga varje gång" (12.2). */
export interface ContentConsent {
  id: string;
  site_id: string;
  content_id: string;
  person_id: string;
  name_ok: boolean;
  image_ok: boolean;
  contribution_ok: boolean;
  how: string;
  created_at: string;
  created_by: string;
}

// ---------------------------------------------------------------- M5: Fråga Vreta

export interface AskMessage {
  role: "user" | "assistant";
  text: string;
  cards?: import("../../supabase/functions/_shared/knowledge").SourceCard[];
  action?: import("../../supabase/functions/_shared/knowledge").PendingAction;
  action_state?: "pending" | "done" | "cancelled";
  /** Allmänt råd från modellens kunskap – inte fakta om Vreta. */
  general?: boolean;
  at: string;
}

/** Samtalstråd med chatboten. Alltid privat för den som skapat den (11.6). */
export interface AskThread {
  id: string;
  site_id: string;
  title: string;
  messages: AskMessage[];
  created_at: string;
  created_by: string;
  updated_at: string;
}

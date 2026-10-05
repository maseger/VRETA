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
}

export interface Structure extends Base {
  name: string;
  kind: string;
  zone_id: string | null;
  status: PlaceStatus;
  notes: string;
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
  field_meta: Record<string, FieldMeta>;
}

export interface Person extends Base {
  name: string;
  locality: string;
  roles: string[];
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

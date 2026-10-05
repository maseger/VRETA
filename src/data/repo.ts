import type {
  Acquisition, AcquisitionType, AuditEntry, Capture, CaptureInput, ContentItem, EventRec, Media, ObjectStatus,
  Person, Profile, Proposal, ProposalContent, Role, Site, StoryNote, Structure, Task, VObject, Zone, FieldMeta,
} from "../domain/types";
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
  storyRows(objectId: string): Promise<StoryRows>;
  audit(): Promise<AuditEntry[]>;
  exportAll(): Promise<Record<string, unknown[]>>;
}

export class PermissionError extends Error {}

// Delade typer för appen och serverfunktionerna. Ren TypeScript utan beroenden (körs i både Vite och Deno).

export type Visibility = "private" | "internal" | "shareable" | "public";
export type ConsentValue = "yes" | "no" | "ask";

export type EvidenceKind = "transcript_excerpt" | "image_region" | "existing_relation" | "shared_attributes" | "context" | "text_excerpt";
export type Evidence = { kind: EvidenceKind; excerpt?: string; reference?: string; start_ms?: number; end_ms?: number; entity_id?: string };

export type ProposalField = { field: string; value: unknown; confidence: number; evidence?: Evidence[] };
export type MatchCandidate = { entity_id: string; title: string; shared: string[] };
export type CardKind = "object" | "person" | "acquisition" | "task" | "pickup" | "links" | "observation" | "moment" | "contribution";
export type ProposalCard = {
  key: string;
  kind: CardKind;
  fields: ProposalField[];
  match_entity_id?: string | null;
  match_candidates?: MatchCandidate[];
};
export type ProposalDraft = { summary: string; agent: string; model?: string; cards: ProposalCard[] };

// Det Fånga vet om platsen när en fångst tolkas (Kontextmedveten Fånga, 2.0).
export type CaptureKnowledge = {
  people: { id: string; display_name: string; locality?: string | null; roles?: string[] }[];
  places: { id: string; name: string; type: string }[];
  projects: { id: string; name: string; needs?: { id: string; title: string; unit?: string | null; quantity?: number | null }[] }[];
  categories?: { code: string; name: string }[];
  here?: { place_id?: string; place_name?: string; lon?: number; lat?: number } | null;
  screen?: { route?: string; entity_id?: string; entity_type?: string; title?: string } | null;
};

export type ChannelAdapter = {
  code: string;
  label: string;
  kind: "marketplace" | "social";
  max_images: number;
  title_max_length?: number;
  supports_price?: boolean;
  supports_free?: boolean;
  publish_modes?: string[];
  share_text: boolean;
  hashtags?: boolean;
};

// Råmaterialet från api.q_story_context (redan filtrerat av radnivåsäkerheten).
export type StoryPerson = {
  id: string;
  display_name: string;
  locality?: string | null;
  roles?: string[];
  consent?: { name: ConsentValue; image: ConsentValue; contribution: ConsentValue } | null;
  post_consent?: Partial<Record<"name" | "image" | "contribution" | "quote", ConsentValue>>;
  erased?: boolean;
};
export type StoryMedia = {
  id: string;
  share_path?: string | null;
  thumb_path?: string | null;
  visibility: Visibility;
  has_people?: boolean;
  flagged?: boolean;
  role?: string;
  depicts?: { person_id: string; image_consent?: ConsentValue | null }[];
  caption?: string | null;
};
export type StorySource = {
  id: string;
  type: string;
  title: string;
  visibility: Visibility;
  facts: Record<string, any>;
  timeline?: { summary: string; occurred_at: string; event_type: string }[];
};
export type StoryContextRaw = {
  site?: { name: string } | null;
  sources: StorySource[];
  people: StoryPerson[];
  contributions: { person_id: string; type_code: string; description?: string; hours?: number | null; occurred_at?: string }[];
  notes: { kind: "why" | "quote" | "moment"; text?: string | null; person_id?: string | null; quote_consent?: boolean }[];
  media: StoryMedia[];
};

export type RemovedItem = { kind: string; text: string };
export type CleanContext = {
  site_name: string;
  goal: string;
  channel_kind: "public" | "private";
  sources: { id: string; type: string; title: string; facts: Record<string, any>; moments: string[] }[];
  people: { id: string; name: string; contribution?: string | null }[];
  quotes: { text: string; person_name: string }[];
  why: string[];
  media_ids: string[];
};
export type GuardResult = {
  allowed: boolean;
  blocked_reason?: string;
  context: CleanContext;
  removed: RemovedItem[];
  warnings: string[];
  ask_messages: { person_id: string; name: string; message: string }[];
};

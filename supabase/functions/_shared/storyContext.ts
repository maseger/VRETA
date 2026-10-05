// Bygger den råa berättelsekontexten för ett objekt. Samma logik används i
// webbläsaren (demoläge) och i edge-funktionen story-agent (med användarens rättigheter).
import type { RawStoryContext, Vis, Consent } from "./privacyGuard.ts";

export interface StoryRows {
  object: RawStoryContext["object"] & { id: string };
  acquisitions: { object_id: string; person_id: string | null; type: string; price: number | null }[];
  persons: {
    id: string;
    name: string;
    locality: string;
    contact: string;
    notes: string;
    consent_name: Consent;
    consent_contribution: Consent;
  }[];
  notes: { kind: "why" | "quote" | "moment"; text: string; quote_consent: boolean }[];
  events: { summary: string; occurred_at: string; visibility: Vis }[];
  media: { id: string; visibility: Vis; has_people: boolean; clean_path: string | null }[];
}

export function buildRawStoryContext(rows: StoryRows): RawStoryContext {
  const acq = rows.acquisitions.find((a) => a.object_id === rows.object.id) ?? null;
  const people = rows.persons
    .filter((p) => acq?.person_id === p.id)
    .map((p) => ({ ...p, relation: acq?.type === "gift" ? "givare" : "leverantör" }));
  const { id: _id, ...object } = rows.object;
  void _id;
  return {
    object,
    acquisition: acq ? { type: acq.type, price: acq.price } : null,
    people,
    notes: rows.notes,
    events: [...rows.events]
      .filter((e) => !e.summary.includes(" → ")) // statusbyten är inte berättelser
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
    media: rows.media.map((m) => ({ id: m.id, visibility: m.visibility, has_people: m.has_people, has_clean: !!m.clean_path })),
  };
}

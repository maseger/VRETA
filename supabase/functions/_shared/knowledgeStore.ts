// KStore mot Supabase med användarens egen inloggning: radnivåsäkerheten avgör vad
// verktygen ser, så en medhjälpare får aldrig priser eller privata anteckningar.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KStore, Role } from "./knowledge.ts";

export function supabaseStore(sb: SupabaseClient, role: Role, today: string): KStore {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  const rows = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  };
  const withPrivate = async <T extends { id: string }>(table: string, privTable: string, key: string, cols: string): Promise<T[]> => {
    const [base, priv] = await Promise.all([rows<T>(sb.from(table).select("*")), rows<Record<string, unknown>>(sb.from(privTable).select(`${key}, ${cols}`))]);
    return base.map((b) => {
      const p = priv.find((x) => x[key] === b.id);
      if (!p) return b;
      const { [key]: _k, ...rest } = p;
      void _k;
      return { ...b, ...rest };
    });
  };
  return {
    role,
    today,
    objects: () => once("objects", () => rows(sb.from("objects").select("id,title,category,description,material,quantity,unit,status,is_batch,storage_location_id,zone_id,structure_id,created_at,updated_at").is("archived_at", null))),
    allocations: () => once("allocations", () => rows(sb.from("batch_allocations").select("id,object_id,quantity,status,storage_location_id,zone_id,structure_id,updated_at"))),
    storageLocations: () => once("locs", () => rows(sb.from("storage_locations").select("id,name,parent_id").is("archived_at", null))),
    zones: () => once("zones", () => rows(sb.from("zones").select("id,name").is("archived_at", null))),
    structures: () => once("structures", () => rows(sb.from("structures").select("id,name").is("archived_at", null))),
    persons: () => once("persons", () => withPrivate("persons", "person_private", "person_id", "contact, notes")),
    acquisitions: () => once("acqs", () => withPrivate("acquisitions", "acquisition_private", "acquisition_id", "price")),
    disposals: () => once("disposals", () => withPrivate("disposals", "disposal_private", "disposal_id", "price")),
    contributions: () => once("contribs", () => rows(sb.from("contributions").select("id,person_id,kind,description,occurred_at,thanked_at,object_id,project_id,hours"))),
    listings: () => once("listings", () => rows(sb.from("listings").select("id,object_id,title,type,status").is("archived_at", null))),
    leads: () => once("leads", () => rows(sb.from("leads").select("id,listing_id,person_id,status,message,queue_position,created_at"))),
    tasks: () => once("tasks", () => rows(sb.from("tasks").select("id,title,due,status,entity_type,entity_id").in("status", ["open", "in_progress"]))),
    pickups: () => once("pickups", () => rows(sb.from("pickups").select("id,title,scheduled_date,status,place_id"))),
    interactions: () => once("interactions", () => rows(sb.from("interactions").select("id,person_id,summary,follow_up,occurred_at"))),
    events: () => once("events", () => rows(sb.from("events").select("id,event_type,summary,occurred_at,story_worthy").order("occurred_at", { ascending: false }).limit(2000))),
    eventsFor: async (type, id) => {
      const links = await rows<{ event_id: string }>(sb.from("event_links").select("event_id").eq("entity_type", type).eq("entity_id", id));
      if (!links.length) return [];
      return rows(sb.from("events").select("id,event_type,summary,occurred_at,story_worthy").in("id", links.map((l) => l.event_id)));
    },
    notes: () => once("notes", () => rows(sb.from("story_notes").select("entity_type,entity_id,kind,text").is("archived_at", null))),
    content: () => once("content", () => rows(sb.from("content_items").select("source_type,source_id,status,goal"))),
    observations: () => once("obs", () => rows(sb.from("observations").select("id,kind,text,zone_id,occurred_at").is("archived_at", null))),
    decisions: () => once("decs", () => rows(sb.from("decisions").select("id,question,choice,rationale,zone_id,decided_on").is("archived_at", null))),
    projects: () => once("projects", () => rows(sb.from("projects").select("id,name,kind,status,description,zone_id,structure_id,started_on,finished_on").is("archived_at", null))),
    needs: () => once("needs", () => rows(sb.from("needs").select("id,project_id,title,quantity,unit,status,listing_id").is("archived_at", null))),
    needFulfillments: () => once("fulfillments", () => rows(sb.from("need_fulfillments").select("id,need_id,quantity,object_id"))),
    // Adressen hämtas aldrig hit – den behövs inte för att svara
    externalPlaces: () => once("places", () => rows(sb.from("external_places").select("id,name,kind,locality").is("archived_at", null))),
    usage: () => once("usage", () => rows(sb.from("usage_events").select("id,object_id,type,occurred_at,zone_id,structure_id,quantity,project_id"))),
    // RLS: läsare får inga rader
    relations: () => once("relations", () => rows(sb.from("person_relations").select("id,person_id,other_id,kind,note"))),
    proposalsWaiting: async () => (await rows(sb.from("proposals").select("id").eq("status", "pending"))).length,
  };
}

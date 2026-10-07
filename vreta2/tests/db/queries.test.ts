// Alla frågor (api.q_*) går att köra för alla roller utan behörighetsfel. Frågorna är security invoker,
// så RLS avgör vad som syns – men en hjälpfunktion som saknar EXECUTE-rätt bryter hela frågan.
import { beforeAll, describe, expect, test } from "vitest";
import { seeded, type Seeded } from "./seeded";
import type { User } from "./harness";

let s: Seeded;
let guest: User;
let fns: string[];
const params: Record<string, any> = {};

beforeAll(async () => {
  s = await seeded();
  guest = await s.h.user("gast", true);
  await s.h.api(guest, "redeem_guest_link", { token: s.ids.guest_token });
  fns = (await s.h.sql<{ f: string }>(
    `select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname like 'q\\_%' order by 1`)).map((r) => r.f);
  const one = async (sql: string) => (await s.h.sql<{ id: string }>(sql))[0]?.id;
  const id = {
    object: await one("select id from resources.object limit 1"),
    acquisition: await one("select id from resources.acquisition limit 1"),
    pickup: await one("select id from resources.pickup limit 1"),
    listing: await one("select id from resources.listing limit 1"),
    place: await one("select id from place.zone limit 1"),
    project: await one("select id from change.project limit 1"),
    person: await one("select id from people.person limit 1"),
    organization: await one("select id from people.organization limit 1"),
    content: await one("select id from story.content_item limit 1"),
    capture: await one("select id from core.capture limit 1"),
    proposal: await one("select id from core.proposal limit 1"),
    event: await one("select id from core.history_event limit 1"),
    tour: await one("select id from pub.tour limit 1"),
  };
  Object.assign(params, {
    q_object: { id: id.object }, q_acquisition: { id: id.acquisition }, q_pickup: { id: id.pickup }, q_listing: { id: id.listing },
    q_listing_package: { listing_id: id.listing }, q_place: { id: id.place }, q_project: { id: id.project }, q_person: { id: id.person },
    q_organization: { id: id.organization }, q_content: { id: id.content }, q_capture: { id: id.capture }, q_proposal: { id: id.proposal },
    q_event: { id: id.event }, q_entity: { id: id.object }, q_search: { q: "tegel" }, q_audit: { entity_id: id.object },
    q_story_context: { source_ids: [id.object], person_ids: [] }, q_privacy_check: { text: "Hej", person_ids: [] },
    q_live: { site: "vreta" }, q_public_tour: { id: id.tour ?? "00000000-0000-0000-0000-000000000000" },
    q_assistant_thread: { id: "00000000-0000-0000-0000-000000000000" }, q_tool: { tool: "search", args: { q: "fönster" } },
    q_export: { scope: "site" },
  });
});

describe("frågor för alla roller", () => {
  for (const who of ["owner", "helper", "reader", "guest"] as const) {
    test(`${who}: ingen fråga stoppas av saknad EXECUTE-rätt`, async () => {
      const u = who === "guest" ? guest : s[who];
      const failures: string[] = [];
      for (const f of fns) {
        try { await s.h.q(u, f, params[f] ?? {}); }
        catch (e) {
          const m = (e as Error).message;
          if (/permission denied for (function|schema|table)/.test(m)) failures.push(`${f}: ${m}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

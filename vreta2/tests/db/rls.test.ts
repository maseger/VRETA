// Behörighet i databasen (Designdokument 2.0): varje tabell har RLS-test för alla roller, även tabeller
// utan gränssnitt än – en tom tabell är också en läcka om policyn är fel.
import { beforeAll, describe, expect, test } from "vitest";
import { seeded, type Seeded } from "./seeded";
import type { User } from "./harness";

let s: Seeded;
let guest: User;
let outsider: User;
let tables: { table_name: string; policy_class: string }[];
let visTables: Set<string>;
let creatorTables: Set<string>;
let siteTables: Set<string>;

const SCHEMAS = ["core", "place", "life", "people", "resources", "change", "culture", "hospitality", "story", "rm", "pub", "commerce"];

beforeAll(async () => {
  s = await seeded();
  guest = await s.h.user("gast", true);
  await s.h.api(guest, "redeem_guest_link", { token: s.ids.guest_token });
  outsider = await s.h.user("obehorig");
  tables = await s.h.sql("select table_name, policy_class from core.table_registry order by table_name");
  const cols = await s.h.sql<{ t: string; c: string }>(
    `select n.nspname || '.' || c.relname as t, a.attname as c from pg_attribute a join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
       and n.nspname = any($1) and a.attname in ('visibility', 'created_by', 'site_id')`, [SCHEMAS]);
  visTables = new Set(cols.filter((r) => r.c === "visibility").map((r) => r.t));
  creatorTables = new Set(cols.filter((r) => r.c === "created_by").map((r) => r.t));
  siteTables = new Set(cols.filter((r) => r.c === "site_id").map((r) => r.t));
  // Mallarna (policyklass none) är inte åtkomliga för någon
  tables = tables.filter((t) => t.policy_class !== "none");
});

async function count(u: User | null, table: string, where = "true"): Promise<number | "denied"> {
  try {
    const r = await s.h.as<{ n: number }>(u, `select count(*)::int as n from ${table} where ${where}`);
    return r[0].n;
  } catch (e) {
    if (/permission denied/.test((e as Error).message)) return "denied";
    throw e;
  }
}

describe("struktur", () => {
  test("varje tabell i de tolv schemana är registrerad och har RLS", async () => {
    const all = await s.h.sql<{ t: string; rls: boolean }>(
      `select n.nspname || '.' || c.relname as t, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname = any($1)`, [SCHEMAS]);
    const registered = new Set((await s.h.sql<{ table_name: string }>("select table_name from core.table_registry")).map((t) => t.table_name));
    expect(all.length).toBeGreaterThan(150);
    for (const t of all) {
      expect(registered.has(t.t), `${t.t} saknas i registret`).toBe(true);
      expect(t.rls, `${t.t} saknar RLS`).toBe(true);
    }
  });

  test("klientroller kan aldrig skriva direkt till någon tabell", async () => {
    const rows = await s.h.sql<{ t: string; anon_w: boolean; auth_w: boolean }>(
      `select n.nspname || '.' || c.relname as t,
         has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') as anon_w,
         has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE') as auth_w
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname = any($1)`, [SCHEMAS]);
    for (const r of rows) {
      expect(r.anon_w, `anon kan skriva i ${r.t}`).toBe(false);
      expect(r.auth_w, `authenticated kan skriva i ${r.t}`).toBe(false);
    }
  });

  test("en direkt skrivning nekas även för ägaren – bara Domain API skriver", async () => {
    await expect(s.h.as(s.owner, "insert into resources.object (site_id, title) values ($1, 'smuggel')", [s.ids.site])).rejects.toThrow(/permission denied/);
    await expect(s.h.as(s.owner, "update people.person set display_name = 'x'")).rejects.toThrow(/permission denied/);
  });

  test("triggerfunktioner och kommandohanterare kan inte anropas direkt (NFR-019)", async () => {
    await expect(s.h.as(s.owner, "select cmd.create_object('{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await expect(s.h.as(s.owner, "select rm.refresh_site($1)", [s.ids.site])).rejects.toThrow(/permission denied/);
    await expect(s.h.as(s.owner, "select story.privacy_violations($1, 'x', '{}', '{}')", [s.ids.site])).rejects.toThrow(/permission denied/);
    await expect(s.h.as(null, "select api.run_command('CreateObject', '{}')")).rejects.toThrow(/permission denied/);
  });

  test("alla funktioner har fast sökväg", async () => {
    const rows = await s.h.sql<{ f: string }>(
      `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = any($1) and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`,
      [[...SCHEMAS, "api", "cmd"]]);
    expect(rows.map((r) => r.f)).toEqual([]);
  });
});

describe("läsrätt per roll och tabell", () => {
  test("ägaren ser allt på sin plats", async () => {
    for (const t of tables) {
      if (["none"].includes(t.policy_class)) continue;
      const all = await s.h.sql<{ n: number }>(`select count(*)::int as n from ${t.table_name}` +
        (siteTables.has(t.table_name) && t.policy_class !== "reference" ? ` where site_id = '${s.ids.site}'` : ""));
      const own = await count(s.owner, t.table_name);
      if (t.policy_class === "self") continue; // assistenttrådar är personliga
      expect(own, t.table_name).toBe(all[0].n);
    }
  });

  test("någon som inte är medlem ser ingenting utom globala referenser och publika projektioner", async () => {
    for (const t of tables) {
      const n = await count(outsider, t.table_name);
      if (["global", "pub_public"].includes(t.policy_class)) continue;
      expect(n, t.table_name).toBe(0);
    }
  });

  test("den anonyma rollen når bara pub-schemat", async () => {
    for (const t of tables) {
      const n = await count(null, t.table_name);
      if (t.policy_class === "pub_public") expect(n, t.table_name).not.toBe("denied");
      else expect(n === "denied" || n === 0, `${t.table_name}: ${n}`).toBe(true);
    }
    const templates = await s.h.sql<{ table_name: string }>("select table_name from core.table_registry where policy_class = 'none'");
    for (const t of templates) expect(await count(s.owner, t.table_name), t.table_name).toBe("denied");
    const nonPub = tables.filter((t) => t.policy_class !== "pub_public" && !t.table_name.startsWith("pub."));
    for (const t of nonPub) expect(await count(null, t.table_name), t.table_name).toBe("denied");
  });

  test("läsaren ser aldrig privata poster", async () => {
    for (const t of tables) {
      if (visTables.has(t.table_name)) expect(await count(s.reader, t.table_name, "visibility = 'private'"), t.table_name).toBe(0);
      if (["private", "owner", "command"].includes(t.policy_class) && t.table_name !== "core.domain_command") {
        expect(await count(s.reader, t.table_name), t.table_name).toBe(0);
      }
    }
  });

  test("medhjälparen ser inte andras privata poster", async () => {
    for (const t of tables) {
      if (visTables.has(t.table_name) && creatorTables.has(t.table_name)) {
        expect(await count(s.helper, t.table_name, `visibility = 'private' and created_by is distinct from '${s.helper.id}'`), t.table_name).toBe(0);
      }
      if (t.policy_class === "private") {
        expect(await count(s.helper, t.table_name, `created_by is distinct from '${s.helper.id}'`), t.table_name).toBe(0);
      }
      if (t.policy_class === "owner") expect(await count(s.helper, t.table_name), t.table_name).toBe(0);
    }
  });

  test("gästen läser bara gästprojektionen (AC-28)", async () => {
    for (const t of tables) {
      const n = await count(guest, t.table_name);
      if (["global", "pub_public"].includes(t.policy_class)) continue;
      if (t.table_name === "pub.guest_item") { expect(n).toBeGreaterThan(5); continue; }
      if (t.table_name === "core.site") { expect(n).toBe(1); continue; }
      if (t.table_name === "core.membership") { expect(n).toBe(1); continue; }
      expect(n, t.table_name).toBe(0);
    }
  });

  test("relationer mellan människor syns bara för ägare och medhjälpare", async () => {
    expect(await count(s.owner, "people.person_relation")).toBeGreaterThan(0);
    expect(await count(s.helper, "people.person_relation")).toBeGreaterThan(0);
    expect(await count(s.reader, "people.person_relation")).toBe(0);
  });

  test("priser och kontaktuppgifter syns bara för ägaren och den som skrev dem", async () => {
    expect(await count(s.owner, "resources.acquisition_private")).toBeGreaterThan(2);
    // Medhjälparen skrev radiatorns inköp själv och ser bara det
    expect(await count(s.helper, "resources.acquisition_private")).toBe(1);
    expect(await count(s.reader, "resources.acquisition_private")).toBe(0);
    expect(await count(s.helper, "people.person_private")).toBe(0);
    expect(await count(s.helper, "people.interaction")).toBe(0);
  });
});

describe("gästlänkar (AC-28)", () => {
  test("gästen kan inte ändra något, och en stängd länk tar bort åtkomsten direkt", async () => {
    const g = await s.h.user("gast2", true);
    const link = await s.h.ok(s.owner, "CreateGuestLink", { label: "Kusinerna" });
    await s.h.api(g, "redeem_guest_link", { token: link.token });
    const home = await s.h.q(g, "q_guest_home");
    expect(home.items.length).toBeGreaterThan(0);
    await expect(s.h.cmd(g, "CreateObject", { title: "x" })).resolves.toMatchObject({ status: "rejected" });
    await s.h.ok(s.owner, "CloseGuestLink", { id: link.id });
    expect((await s.h.q(g, "q_guest_home")).items).toEqual([]);
    await expect(s.h.api(g, "redeem_guest_link", { token: link.token })).rejects.toThrow(/link_closed/);
  });

  test("bara nyckelns hash sparas", async () => {
    const link = await s.h.ok(s.owner, "CreateGuestLink", { label: "Hash" });
    const rows = await s.h.sql("select token_hash from core.guest_link where id = $1", [link.id]);
    expect(rows[0].token_hash).not.toBe(link.token);
    expect(rows[0].token_hash).toHaveLength(64);
  });

  test("en inbjudan som medhjälpare kräver ett riktigt konto", async () => {
    const anon = await s.h.user("anonym", true);
    const link = await s.h.ok(s.owner, "CreateGuestLink", { label: "Hjälp", role: "helper" });
    await expect(s.h.api(anon, "redeem_guest_link", { token: link.token })).rejects.toThrow(/needs_account/);
  });
});

describe("värdens åtkomst (R2.6)", () => {
  test("värden ser bara sitt eget evenemang och dess anmälningar", async () => {
    const { h, owner } = s;
    await h.ok(owner, "SetFeatureFlag", { flag: "hospitality", enabled: true });
    const host = await h.user("vard");
    const link = await h.ok(owner, "CreateGuestLink", { label: "Värd", role: "host" });
    await h.api(host, "redeem_guest_link", { token: link.token });
    const e1 = await h.ok(owner, "CreateHostedEvent", { title: "Keramikretreat", starts_at: "2026-11-14T09:00:00Z", ends_at: "2026-11-16T15:00:00Z" });
    const e2 = await h.ok(owner, "CreateHostedEvent", { title: "Julmarknad", starts_at: "2026-12-12T10:00:00Z", ends_at: "2026-12-12T15:00:00Z" });
    await h.ok(owner, "RegisterParticipant", { hosted_event_id: e1.hosted_event_id, person_name: "Deltagare Ett" });
    await h.ok(owner, "RegisterParticipant", { hosted_event_id: e2.hosted_event_id, person_name: "Deltagare Två" });
    const m = (await h.sql("select id from core.membership where user_id = $1", [host.id]))[0];
    await h.ok(owner, "AssignHost", { membership_id: m.id, entity_id: e1.hosted_event_id });
    expect(await count(host, "hospitality.hosted_event")).toBe(1);
    expect(await count(host, "hospitality.registration")).toBe(1);
    expect(await count(host, "resources.object")).toBe(0);
    expect(await count(host, "people.person")).toBe(0);
    // Anmälningar är privata även för medhjälpare och läsare
    expect(await count(s.helper, "hospitality.registration")).toBe(0);
    expect(await count(s.reader, "hospitality.registration")).toBe(0);
    const att = await h.cmd(host, "RecordAttendance", { hosted_event_id: e2.hosted_event_id });
    expect(att.status).toBe("rejected");
    expect((await h.cmd(host, "RecordAttendance", { hosted_event_id: e1.hosted_event_id })).status).toBe("accepted");
  });
});

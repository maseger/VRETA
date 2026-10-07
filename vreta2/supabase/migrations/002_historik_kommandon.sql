-- VRETA 2 · Migrering 002 · Historik och kommandon
-- Entitetsregistret (polymorfa länkar, ADR-018), HistoryEvent (ADR-011), AuditEntry, Domain API med
-- kommandokatalog och idempotens (ADR-012), tillståndsmaskiner, Action Preview och bakgrundsjobb.

-- ------------------------------------------------------------------ entitetsregistret
-- Varje entitet som kan länkas, berättas om eller visas som källkort har en rad här. Generella
-- kopplingar (entity_type, entity_id) pekar hit med riktig främmande nyckel (Designregel 5).
create table core.entity_type (
  code text primary key,
  schema_name text not null,
  table_name text not null,
  label_sv text not null,
  label_plural_sv text not null,
  route text,
  context text not null,
  is_place boolean not null default false,
  -- Enkla fält som får ändras med det generiska kommandot UpdateFields (senaste skrivning vinner, ADR-002)
  simple_fields text[] not null default '{}',
  ui_release text not null default 'R2.0'
);

create table core.entity (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  entity_type text not null references core.entity_type (code),
  title text not null default '',
  visibility core.visibility not null default 'internal',
  created_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entity_site_type_idx on core.entity (site_id, entity_type);
create index entity_title_trgm on core.entity using gin (title extensions.gin_trgm_ops);

select core.register_table('core.entity_type', 'global', p_audit => false);
select core.register_table('core.entity', 'standard', p_audit => false);

create function core.define_entity_type(
  p_code text, p_table text, p_label text, p_plural text, p_route text, p_context text,
  p_simple_fields text[] default '{}', p_is_place boolean default false, p_ui_release text default 'R2.0'
) returns void language sql set search_path = '' as $$
  insert into core.entity_type (code, schema_name, table_name, label_sv, label_plural_sv, route, context, simple_fields, is_place, ui_release)
  values (p_code, split_part(p_table, '.', 1), split_part(p_table, '.', 2), p_label, p_plural, p_route, p_context,
          p_simple_fields, p_is_place, p_ui_release)
  on conflict (code) do update set schema_name = excluded.schema_name, table_name = excluded.table_name,
    label_sv = excluded.label_sv, label_plural_sv = excluded.label_plural_sv, route = excluded.route,
    context = excluded.context, simple_fields = excluded.simple_fields, is_place = excluded.is_place,
    ui_release = excluded.ui_release
$$;

select core.define_entity_type('history_event', 'core.history_event', 'Händelse', 'Händelser', '/handelse/:id', 'platform', '{summary,note}');
select core.define_entity_type('action_preview', 'core.action_preview', 'Action Preview', 'Action Preview', null, 'platform', '{}', false, 'R2.4');

-- Håller registret och sökindexet i takt med tabellen. Argument: entitetstyp, titelkolumn, brödtextkolumner.
create function core.tg_entity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := to_jsonb(new);
  v_title text;
  v_body text := '';
  i integer;
begin
  v_title := coalesce(nullif(j ->> tg_argv[1], ''), (select label_sv from core.entity_type where code = tg_argv[0]));
  for i in 2 .. tg_nargs - 1 loop
    v_body := v_body || ' ' || coalesce(j ->> tg_argv[i], '');
  end loop;
  insert into core.entity (id, site_id, entity_type, title, visibility, created_by, archived_at, updated_at)
  values ((j ->> 'id')::uuid, (j ->> 'site_id')::uuid, tg_argv[0], left(v_title, 300),
          coalesce((j ->> 'visibility')::core.visibility, 'internal'), (j ->> 'created_by')::uuid,
          (j ->> 'archived_at')::timestamptz, now())
  on conflict (id) do update set title = excluded.title, visibility = excluded.visibility,
    archived_at = excluded.archived_at, updated_at = now();
  if to_regclass('core.search_document') is not null then
    insert into core.search_document (entity_id, site_id, entity_type, title, body, visibility, created_by, archived_at, updated_at)
    values ((j ->> 'id')::uuid, (j ->> 'site_id')::uuid, tg_argv[0], left(v_title, 300), btrim(v_body),
            coalesce((j ->> 'visibility')::core.visibility, 'internal'), (j ->> 'created_by')::uuid,
            (j ->> 'archived_at')::timestamptz, now())
    on conflict (entity_id) do update set title = excluded.title, body = excluded.body,
      visibility = excluded.visibility, archived_at = excluded.archived_at, updated_at = now(),
      embedding = case when core.search_document.body is distinct from excluded.body
                         or core.search_document.title is distinct from excluded.title
                       then null else core.search_document.embedding end;
  end if;
  return null;
end $$;

-- Hård radering sker bara vid GDPR-radering (INV-08); då försvinner också registerraden.
create function core.tg_entity_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('core.search_document') is not null then
    delete from core.search_document where entity_id = old.id;
  end if;
  delete from core.history_event_link where entity_id = old.id;
  delete from core.entity where id = old.id;
  return null;
end $$;

alter table core.host_assignment add constraint host_assignment_entity_fk foreign key (entity_id) references core.entity (id);

-- ------------------------------------------------------------------ HistoryEvent (Händelse)
-- "Händelse" är historik; "Evenemang" (HostedEvent) är ett planerat tillfälle. Aldrig "Event" ensamt.
create table core.history_event (
  like core.entity_template including all,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  -- Tids- och platskontraktet (Designregel 4): platsreferens med precisionsnivå
  place_id uuid references core.entity (id),
  geom extensions.geometry(Geometry, 4326),
  location_precision core.location_precision not null default 'zone',
  summary text not null,
  note text,
  story_value boolean not null default false
);
create index history_event_site_time_idx on core.history_event (site_id, occurred_at desc);
create index history_event_place_idx on core.history_event (place_id);
create index history_event_type_idx on core.history_event (site_id, event_type);
select core.register_table('core.history_event', 'standard', 'history_event', 'summary', '{note}', p_audit => false);

create table core.history_event_link (
  like core.link_template including all,
  event_id uuid not null references core.history_event (id) on delete cascade,
  entity_id uuid not null references core.entity (id),
  entity_type text not null references core.entity_type (code),
  role text not null default 'subject',
  unique (event_id, entity_id, role)
);
create index history_event_link_entity_idx on core.history_event_link (entity_id);
select core.register_table('core.history_event_link', 'custom', p_audit => false);
create policy read on core.history_event_link for select to authenticated
  using (exists (select 1 from core.history_event e where e.id = event_id));

-- ------------------------------------------------------------------ AuditEntry (teknisk logg)
create table core.audit_entry (
  id bigint generated always as identity primary key,
  site_id uuid,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  command_id uuid,
  table_name text not null,
  row_id text,
  operation text not null,
  before jsonb,
  after jsonb,
  agent text,
  approved_by uuid
);
create index audit_entry_site_time_idx on core.audit_entry (site_id, occurred_at desc);
create index audit_entry_command_idx on core.audit_entry (command_id);
alter table core.audit_entry enable row level security;
revoke all on table core.audit_entry from public, anon, authenticated;
grant select on table core.audit_entry to authenticated;
create policy read on core.audit_entry for select to authenticated
  using (site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[]))));
insert into core.table_registry (table_name, policy_class, audited) values ('core.audit_entry', 'owner', false);

create function core.tg_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into core.audit_entry (site_id, actor_id, command_id, table_name, row_id, operation, before, after, agent, approved_by)
  values (
    coalesce((j ->> 'site_id')::uuid, case when tg_table_name = 'site' then (j ->> 'id')::uuid end,
             nullif(current_setting('vreta.site_id', true), '')::uuid),
    auth.uid(),
    nullif(current_setting('vreta.command_id', true), '')::uuid,
    tg_table_schema || '.' || tg_table_name,
    j ->> 'id',
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    nullif(current_setting('vreta.agent', true), ''),
    nullif(current_setting('vreta.approved_by', true), '')::uuid);
  return null;
end $$;

-- Tabellerna från 001 fick sin registrering innan audit fanns.
do $$
declare r record;
begin
  for r in select table_name from core.table_registry
           where table_name in ('core.site', 'core.site_private', 'core.membership', 'core.guest_link',
                                'core.host_assignment', 'core.code_value', 'core.feature_flag', 'core.site_setting')
  loop
    execute format('create trigger audit after insert or update or delete on %s for each row execute function core.tg_audit()', r.table_name);
    update core.table_registry set audited = true where table_name = r.table_name;
  end loop;
end $$;

-- ------------------------------------------------------------------ tillståndsmaskiner
-- Statusarna är fasta enum-värden; här ligger etiketter och tillåtna övergångar som data så att
-- servern kan validera och gränssnittet visa nästa steg utan egna regler.
create table core.state (
  machine text not null,
  state text not null,
  label_sv text not null,
  terminal boolean not null default false,
  sort integer not null default 100,
  primary key (machine, state)
);
create table core.state_transition (
  machine text not null,
  from_state text not null,
  to_state text not null,
  label_sv text,
  primary key (machine, from_state, to_state),
  foreign key (machine, from_state) references core.state (machine, state),
  foreign key (machine, to_state) references core.state (machine, state)
);
select core.register_table('core.state', 'global', p_audit => false);
select core.register_table('core.state_transition', 'global', p_audit => false);

-- ------------------------------------------------------------------ Domain API
create type core.command_status as enum ('accepted', 'rejected', 'superseded');
-- Offlineklasser enligt Designdokument 2.0 "Kommandon och offline".
create type core.offline_class as enum ('append', 'simple', 'invariant', 'sensitive');

create table core.command_catalog (
  command_type text not null,
  version integer not null default 1,
  handler text not null,
  label_sv text not null,
  context text not null,
  offline_class core.offline_class not null,
  allowed_roles core.member_role[] not null,
  feature text not null default 'core',
  enabled boolean not null default true,
  -- Det som går ut till en person eller publiceras kräver eget tryck i Action Preview
  requires_own_tap boolean not null default false,
  description text not null default '',
  primary key (command_type, version)
);
select core.register_table('core.command_catalog', 'global', p_audit => false);

create table core.domain_command (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  command_type text not null,
  version integer not null default 1,
  idempotency_key uuid,
  payload jsonb not null default '{}',
  issued_by uuid not null,
  -- online, offline (kommandojournalen), agent, action_preview, mcp, system
  origin text not null default 'online',
  client_time timestamptz,
  received_at timestamptz not null default now(),
  status core.command_status not null,
  rejection_reason text,
  result jsonb,
  agent text,
  approved_by uuid,
  superseded_by uuid references core.domain_command (id),
  resolved_at timestamptz,
  unique (site_id, idempotency_key)
);
create index domain_command_issuer_idx on core.domain_command (issued_by, status, received_at desc);
select core.register_table('core.domain_command', 'command', p_audit => false);

-- Action Preview (R2.4, tabellen från R2.0): samling föreslagna kommandon som godkänns helt eller delvis.
create type core.action_preview_status as enum ('proposed', 'approved', 'partially_approved', 'rejected', 'expired');
create table core.action_preview (
  like core.entity_template including all,
  title text not null,
  status core.action_preview_status not null default 'proposed',
  -- [{key, command_type, version, payload, label, effect, requires_own_tap}]
  commands jsonb not null default '[]',
  approved_keys text[] not null default '{}',
  results jsonb not null default '{}',
  decided_at timestamptz,
  thread_id uuid
);
alter table core.action_preview alter column visibility set default 'private';
select core.register_table('core.action_preview', 'private', 'action_preview', 'title');

-- ------------------------------------------------------------------ bakgrundsjobb
-- Postgres-kö. I Supabase körs core.process_jobs() varje minut av pg_cron; i demoläget av appen.
create type core.job_status as enum ('pending', 'running', 'done', 'failed');
create table core.job (
  id bigint generated always as identity primary key,
  site_id uuid references core.site (id),
  kind text not null,
  dedup_key text not null default '',
  payload jsonb not null default '{}',
  status core.job_status not null default 'pending',
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index job_pending_dedup_uq on core.job (kind, dedup_key) where status = 'pending';
alter table core.job enable row level security;
revoke all on table core.job from public, anon, authenticated;
grant select on table core.job to authenticated;
create policy read on core.job for select to authenticated
  using (site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[]))));
insert into core.table_registry (table_name, policy_class, audited) values ('core.job', 'owner', false);

create function core.enqueue(p_kind text, p_key text, p_payload jsonb default '{}', p_site uuid default null,
                             p_run_after timestamptz default now())
returns void language sql security definer set search_path = '' as $$
  insert into core.job (site_id, kind, dedup_key, payload, run_after)
  values (coalesce(p_site, nullif(current_setting('vreta.site_id', true), '')::uuid), p_kind, p_key, p_payload, p_run_after)
  on conflict (kind, dedup_key) where status = 'pending' do nothing
$$;

-- Ersätts av senare migreringar när fler jobbslag tillkommer.
create function core.run_job(p_job core.job) returns void
language plpgsql security definer set search_path = '' as $$
begin
  case p_job.kind
    when 'noop' then null;
    else raise exception 'unknown_job: %', p_job.kind;
  end case;
end $$;

create function core.process_jobs(p_max integer default 50, p_site uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_job core.job;
  v_n integer := 0;
begin
  loop
    exit when v_n >= p_max;
    select * into v_job from core.job
    where status = 'pending' and run_after <= now() and (p_site is null or site_id = p_site)
    order by id limit 1 for update skip locked;
    exit when not found;
    update core.job set status = 'running', started_at = now(), attempts = attempts + 1 where id = v_job.id;
    begin
      perform core.run_job(v_job);
      update core.job set status = 'done', finished_at = now() where id = v_job.id;
    exception when others then
      update core.job set status = case when attempts >= 3 then 'failed'::core.job_status else 'pending'::core.job_status end,
        last_error = sqlerrm, run_after = now() + interval '1 minute', started_at = null where id = v_job.id;
    end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Appen (demoläget) eller en inloggad medlem får köra sin egen plats kö.
create function api.process_jobs(p_max integer default 50) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_site uuid; v_n integer := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated: Logga in först'; end if;
  foreach v_site in array core.sites_with_role('{owner,helper,reader}') loop
    v_n := v_n + core.process_jobs(p_max, v_site);
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------------------ kommandokontext och hjälpare
create function core.ctx_site() returns uuid language sql stable set search_path = '' as $$
  select nullif(current_setting('vreta.site_id', true), '')::uuid $$;
create function core.ctx_role() returns core.member_role language sql stable set search_path = '' as $$
  select nullif(current_setting('vreta.role', true), '')::core.member_role $$;
create function core.ctx_command() returns uuid language sql stable set search_path = '' as $$
  select nullif(current_setting('vreta.command_id', true), '')::uuid $$;

-- Avvisning med kod och svensk förklaring: "kod: Text". Förslaget (JSON) visas i "Synk att lösa".
create function core.fail(p_code text, p_message text, p_suggestion jsonb default null) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%: %', p_code, p_message using hint = coalesce(p_suggestion::text, '');
end $$;

create function core.req(p jsonb, p_key text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p ->> p_key is null or btrim(p ->> p_key) = '' then
    perform core.fail('missing_field', format('Fältet %s saknas', p_key));
  end if;
  return p ->> p_key;
end $$;

create function core.req_uuid(p jsonb, p_key text) returns uuid
language sql immutable set search_path = '' as $$ select core.req(p, p_key)::uuid $$;

create function core.opt_uuid(p jsonb, p_key text) returns uuid
language sql immutable set search_path = '' as $$ select nullif(p ->> p_key, '')::uuid $$;

create function core.opt_ts(p jsonb, p_key text, p_default timestamptz default now()) returns timestamptz
language sql stable set search_path = '' as $$ select coalesce(nullif(p ->> p_key, '')::timestamptz, p_default) $$;

create function core.assert_role(p_roles core.member_role[], p_what text default 'detta') returns void
language plpgsql stable set search_path = '' as $$
begin
  if core.ctx_role() is null or not (core.ctx_role() = any (p_roles)) then
    perform core.fail('forbidden', format('Du har inte behörighet att %s', p_what));
  end if;
end $$;

-- Kontrollerar att en entitet finns på kommandots plats (och valfritt av rätt typ). Returnerar typen.
create function core.assert_entity(p_id uuid, p_types text[] default null) returns text
language plpgsql stable set search_path = '' as $$
declare v_type text;
begin
  if p_id is null then perform core.fail('missing_field', 'En koppling saknas'); end if;
  select entity_type into v_type from core.entity where id = p_id and site_id = core.ctx_site();
  if v_type is null then perform core.fail('not_found', 'Posten finns inte'); end if;
  if p_types is not null and not (v_type = any (p_types)) then
    perform core.fail('wrong_type', format('Fel slags post (%s)', v_type));
  end if;
  return v_type;
end $$;

create function core.state_label(p_machine text, p_state text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select label_sv from core.state where machine = p_machine and state = p_state), p_state) $$;

-- Validerar en övergång. Ägaren kan korrigera historik med en audit-loggad override (R1.1 5).
create function core.assert_transition(p_machine text, p_from text, p_to text, p_override_reason text default null) returns void
language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from core.state_transition where machine = p_machine and from_state = p_from and to_state = p_to) then
    return;
  end if;
  if p_override_reason is not null and btrim(p_override_reason) <> '' and core.ctx_role() = 'owner' then
    return;
  end if;
  perform core.fail('invalid_transition', format('Det går inte att gå från %s till %s',
    lower(core.state_label(p_machine, p_from)), lower(core.state_label(p_machine, p_to))));
end $$;

-- Skriver en HistoryEvent med länkar till alla berörda entiteter (INV-01). Platsen och dess
-- överordnade platser länkas också, så att samma händelse syns i objekt-, plats- och zonjournal.
create function core.record_history(
  p_event_type text,
  p_summary text,
  p_links jsonb default '[]',
  p_occurred_at timestamptz default null,
  p_place_id uuid default null,
  p_story_value boolean default false,
  p_note text default null,
  p_visibility core.visibility default 'internal',
  p_geom extensions.geometry default null,
  p_precision core.location_precision default 'zone'
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_link jsonb;
  v_place uuid;
begin
  insert into core.history_event (id, site_id, event_type, occurred_at, place_id, geom, location_precision,
                                  summary, note, story_value, visibility)
  values (v_id, core.ctx_site(), p_event_type, coalesce(p_occurred_at, now()), p_place_id, p_geom, p_precision,
          p_summary, p_note, p_story_value, p_visibility);
  for v_link in select * from jsonb_array_elements(coalesce(p_links, '[]')) loop
    if nullif(v_link ->> 'id', '') is not null then
      insert into core.history_event_link (site_id, event_id, entity_id, entity_type, role)
      select core.ctx_site(), v_id, e.id, e.entity_type, coalesce(v_link ->> 'role', 'subject')
      from core.entity e where e.id = (v_link ->> 'id')::uuid
      on conflict do nothing;
    end if;
  end loop;
  if p_place_id is not null then
    for v_place in select unnest(place.lineage(p_place_id)) loop
      insert into core.history_event_link (site_id, event_id, entity_id, entity_type, role)
      select core.ctx_site(), v_id, e.id, e.entity_type, case when e.id = p_place_id then 'place' else 'place_ancestor' end
      from core.entity e where e.id = v_place
      on conflict do nothing;
    end loop;
  end if;
  return v_id;
end $$;

create function core.feature_enabled(p_site uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from core.feature_flag where site_id = p_site and flag = p_feature), p_feature = 'core')
$$;

create function core.setting(p_site uuid, p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from core.site_setting where site_id = p_site and key = p_key
$$;

-- ------------------------------------------------------------------ kommandoutfördaren
-- Alla klienter (app, offlinejournal, Fråga Vreta, MCP, agenter) skriver här. Kommandot loggas med
-- idempotensnyckel; hanteraren skriver tillstånd + HistoryEvent + AuditEntry i samma transaktion.
-- Ett avvisat kommando sparas med orsak (och ett eventuellt förslag) så att "Synk att lösa" kan visa det.
create function api.run_command(
  p_type text,
  p_payload jsonb default '{}',
  p_idempotency_key uuid default null,
  p_version integer default 1,
  p_client_time timestamptz default null,
  p_site_id uuid default null,
  p_origin text default 'online',
  p_agent text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_cat core.command_catalog;
  v_site uuid;
  v_role core.member_role;
  v_cmd uuid := gen_random_uuid();
  v_prev core.domain_command;
  v_result jsonb;
  v_reason text;
  v_hint text;
  v_suggestion jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated: Logga in först' using errcode = '28000';
  end if;
  v_site := coalesce(p_site_id, nullif(p_payload ->> 'site_id', '')::uuid,
    (select (array_agg(site_id))[1] from core.membership where user_id = v_uid and revoked_at is null having count(*) = 1));
  if v_site is null then
    return jsonb_build_object('status', 'rejected', 'reason', 'no_site: Ingen plats vald');
  end if;

  if p_idempotency_key is not null then
    select * into v_prev from core.domain_command where site_id = v_site and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('status', v_prev.status, 'command_id', v_prev.id, 'result', v_prev.result,
                                'reason', v_prev.rejection_reason, 'duplicate', true);
    end if;
  end if;

  v_role := core.my_role(v_site);
  if v_role is null then
    raise exception 'forbidden: Du är inte medlem på platsen' using errcode = '42501';
  end if;

  insert into core.domain_command (id, site_id, command_type, version, idempotency_key, payload, issued_by,
                                   origin, client_time, status, agent)
  values (v_cmd, v_site, p_type, p_version, p_idempotency_key, coalesce(p_payload, '{}'), v_uid,
          coalesce(p_origin, 'online'), p_client_time, 'accepted', p_agent);

  select * into v_cat from core.command_catalog where command_type = p_type and version = p_version;
  if not found then
    v_reason := format('unknown_command: Okänt kommando %s v%s', p_type, p_version);
  elsif not (v_role = any (v_cat.allowed_roles)) then
    v_reason := format('forbidden: Du har inte behörighet att %s', lower(v_cat.label_sv));
  elsif not v_cat.enabled or not core.feature_enabled(v_site, v_cat.feature) then
    v_reason := format('feature_disabled: %s är inte påslaget här ännu', v_cat.label_sv);
  end if;
  if v_reason is not null then
    update core.domain_command set status = 'rejected', rejection_reason = v_reason where id = v_cmd;
    return jsonb_build_object('status', 'rejected', 'command_id', v_cmd, 'reason', v_reason);
  end if;

  perform set_config('vreta.command_id', v_cmd::text, true);
  perform set_config('vreta.site_id', v_site::text, true);
  perform set_config('vreta.role', v_role::text, true);
  perform set_config('vreta.agent', coalesce(p_agent, ''), true);

  begin
    execute format('select %s($1)', v_cat.handler) into v_result using coalesce(p_payload, '{}');
    set constraints all immediate;
  exception when others then
    get stacked diagnostics v_reason = message_text, v_hint = pg_exception_hint;
    if v_reason !~ '^[a-z_]+: ' then
      v_reason := 'invalid: ' || v_reason;
    end if;
    v_suggestion := case when v_hint like '{%' or v_hint like '[%' then v_hint::jsonb end;
    perform set_config('vreta.command_id', '', true);
    update core.domain_command set status = 'rejected', rejection_reason = v_reason,
      result = case when v_suggestion is not null then jsonb_build_object('suggestion', v_suggestion) end
    where id = v_cmd;
    return jsonb_build_object('status', 'rejected', 'command_id', v_cmd, 'reason', v_reason, 'suggestion', v_suggestion);
  end;

  update core.domain_command set result = v_result where id = v_cmd;
  perform core.enqueue('refresh_site', v_site::text, '{}', v_site);
  perform set_config('vreta.command_id', '', true);
  perform set_config('vreta.agent', '', true);
  return jsonb_build_object('status', 'accepted', 'command_id', v_cmd, 'result', v_result);
end $$;

-- ------------------------------------------------------------------ generiska kommandon
-- Enkla fält (titel, beskrivning, anteckning …): senaste skrivning vinner per fält (ADR-002, ADR-013).
create function cmd.update_fields(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'id');
  v_type text := core.assert_entity(v_id);
  v_et core.entity_type;
  v_key text;
  v_sets text := '';
  v_fields jsonb := coalesce(p -> 'fields', '{}');
begin
  select * into v_et from core.entity_type where code = v_type;
  for v_key in select jsonb_object_keys(v_fields) loop
    if not (v_key = any (v_et.simple_fields)) then
      perform core.fail('not_simple_field', format('Fältet %s ändras med ett eget kommando', v_key));
    end if;
    v_sets := v_sets || format(', %I = (jsonb_populate_record(null::%I.%I, $1)).%I', v_key, v_et.schema_name, v_et.table_name, v_key);
  end loop;
  if v_sets = '' then return jsonb_build_object('id', v_id, 'changed', 0); end if;
  if core.ctx_role() = 'helper' then
    -- Medhjälpare ändrar inte andras privata poster
    if exists (select 1 from core.entity where id = v_id and visibility = 'private' and created_by is distinct from auth.uid()) then
      perform core.fail('forbidden', 'Du kan inte ändra någon annans privata post');
    end if;
  end if;
  execute format('update %I.%I set updated_at = now()%s where id = $2', v_et.schema_name, v_et.table_name, v_sets)
    using v_fields, v_id;
  return jsonb_build_object('id', v_id, 'changed', (select count(*) from jsonb_object_keys(v_fields)));
end $$;

-- Arkivera i stället för att radera (INV-08). Medhjälpare bara egna poster.
create function cmd.archive_entity(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'id');
  v_type text := core.assert_entity(v_id);
  v_et core.entity_type;
  v_restore boolean := coalesce((p ->> 'restore')::boolean, false);
begin
  select * into v_et from core.entity_type where code = v_type;
  if core.ctx_role() = 'helper' and not exists (select 1 from core.entity where id = v_id and created_by = auth.uid()) then
    perform core.fail('forbidden', 'Medhjälpare kan bara arkivera egna poster');
  end if;
  execute format('update %I.%I set archived_at = %s where id = $1', v_et.schema_name, v_et.table_name,
                 case when v_restore then 'null' else 'now()' end) using v_id;
  perform core.record_history(case when v_restore then 'entity.restored' else 'entity.archived' end,
    format('%s %s', (select title from core.entity where id = v_id), case when v_restore then 'återställd' else 'arkiverad' end),
    jsonb_build_array(jsonb_build_object('id', v_id)));
  return jsonb_build_object('id', v_id, 'archived', not v_restore);
end $$;

-- Synlighet per post (R1.1 12.1). En post får aldrig högre synlighet än sin känsligaste del:
-- kontaktuppgifter och CRM-anteckningar kan inte bli publika (INV-13), personfoton följer samtycket (INV-15).
create function cmd.set_visibility(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'id');
  v_type text := core.assert_entity(v_id);
  v_vis core.visibility := core.req(p, 'visibility')::core.visibility;
  v_et core.entity_type;
begin
  select * into v_et from core.entity_type where code = v_type;
  if v_vis = 'public' and core.ctx_role() <> 'owner' then
    perform core.fail('forbidden', 'Bara ägaren kan göra något publikt');
  end if;
  if v_type in ('interaction') and v_vis <> 'private' then
    perform core.fail('privacy', 'Kontakthistorik är alltid privat');
  end if;
  if v_type = 'media' and exists (
      select 1 from core.media_link l join people.consent_policy c on c.person_id = l.entity_id
      where l.media_id = v_id and l.role in ('depicts', 'avatar') and c.image <> 'yes') and v_vis <> 'private' then
    perform core.fail('consent', 'Bilden visar en person som inte sagt ja till bild');
  end if;
  execute format('update %I.%I set visibility = $1 where id = $2', v_et.schema_name, v_et.table_name) using v_vis, v_id;
  return jsonb_build_object('id', v_id, 'visibility', v_vis);
end $$;

-- ------------------------------------------------------------------ plattformskommandon
create function cmd.set_feature_flag(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_flag text := core.req(p, 'flag');
  v_release text;
begin
  select attributes ->> 'release' into v_release from core.code_value where list_code = 'feature' and code = v_flag and site_id is null;
  if v_release is null then perform core.fail('not_found', 'Okänd funktion'); end if;
  insert into core.feature_flag (site_id, flag, enabled, release)
  values (core.ctx_site(), v_flag, coalesce((p ->> 'enabled')::boolean, true), v_release)
  on conflict (site_id, flag) do update set enabled = excluded.enabled;
  return jsonb_build_object('flag', v_flag, 'enabled', coalesce((p ->> 'enabled')::boolean, true));
end $$;

create function cmd.set_site_setting(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_key text := core.req(p, 'key');
begin
  if p -> 'value' is null then perform core.fail('missing_field', 'Värde saknas'); end if;
  insert into core.site_setting (site_id, key, value) values (core.ctx_site(), v_key, p -> 'value')
  on conflict (site_id, key) do update set value = excluded.value;
  return jsonb_build_object('key', v_key);
end $$;

create function cmd.upsert_code_value(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_list text := core.req(p, 'list_code');
  v_code text := coalesce(nullif(p ->> 'code', ''), regexp_replace(lower(core.req(p, 'label_sv')), '[^a-z0-9åäö]+', '_', 'g'));
  v_id uuid;
begin
  if not exists (select 1 from core.code_list where code = v_list and site_extensible) then
    perform core.fail('not_extensible', 'Listan kan inte utökas');
  end if;
  insert into core.code_value (list_code, site_id, code, label_sv, description, parent_code, sort, attributes)
  values (v_list, core.ctx_site(), v_code, core.req(p, 'label_sv'), coalesce(p ->> 'description', ''),
          p ->> 'parent_code', coalesce((p ->> 'sort')::integer, 500), coalesce(p -> 'attributes', '{}'))
  on conflict (list_code, site_id, code) do update set label_sv = excluded.label_sv, description = excluded.description,
    parent_code = excluded.parent_code, sort = excluded.sort, attributes = excluded.attributes, archived_at = null
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create function cmd.archive_code_value(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'id');
begin
  update core.code_value set archived_at = case when coalesce((p ->> 'restore')::boolean, false) then null else now() end
  where id = v_id and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Bara platsens egna värden kan arkiveras'); end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Gäst- och inbjudningslänkar. Nyckeln skapas här, visas en gång och sparas bara som hash.
create function cmd.create_guest_link(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
  v_role core.member_role := coalesce(nullif(p ->> 'role', ''), 'guest')::core.member_role;
begin
  if v_role = 'owner' then perform core.fail('forbidden', 'Ägarskap delas inte via länk'); end if;
  insert into core.guest_link (site_id, label, token_hash, role, expires_at)
  values (core.ctx_site(), core.req(p, 'label'), encode(extensions.digest(v_token, 'sha256'), 'hex'), v_role,
          nullif(p ->> 'expires_at', '')::timestamptz)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'role', v_role);
end $$;

create function cmd.close_guest_link(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'id');
begin
  update core.guest_link set closed_at = now() where id = v_id and site_id = core.ctx_site() and closed_at is null;
  if not found then perform core.fail('not_found', 'Länken finns inte eller är redan stängd'); end if;
  return jsonb_build_object('id', v_id, 'closed', true);
end $$;

create function cmd.set_member_role(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'membership_id');
  v_role core.member_role := core.req(p, 'role')::core.member_role;
  v_m core.membership;
begin
  select * into v_m from core.membership where id = v_id and site_id = core.ctx_site() and revoked_at is null;
  if not found then perform core.fail('not_found', 'Medlemmen finns inte'); end if;
  if v_m.user_id = auth.uid() then perform core.fail('forbidden', 'Du kan inte ändra din egen roll'); end if;
  if v_role in ('owner', 'guest') then perform core.fail('forbidden', 'Den rollen sätts inte här'); end if;
  if coalesce((p ->> 'revoke')::boolean, false) then
    update core.membership set revoked_at = now() where id = v_id;
  else
    update core.membership set role = v_role where id = v_id;
  end if;
  return jsonb_build_object('membership_id', v_id);
end $$;

create function cmd.set_display_name(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  update core.membership set display_name = left(core.req(p, 'display_name'), 80)
  where site_id = core.ctx_site() and user_id = auth.uid() and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- Löser en avvisad kommandorad i "Synk att lösa": markeras som ersatt (av ett nytt kommando eller avfärdad).
create function cmd.resolve_rejected_command(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'command_id');
begin
  update core.domain_command set status = 'superseded', resolved_at = now(),
    superseded_by = core.opt_uuid(p, 'replacement_command_id')
  where id = v_id and site_id = core.ctx_site() and status = 'rejected'
    and (issued_by = auth.uid() or core.ctx_role() = 'owner');
  if not found then perform core.fail('not_found', 'Kommandot finns inte bland det som ska lösas'); end if;
  return jsonb_build_object('command_id', v_id);
end $$;

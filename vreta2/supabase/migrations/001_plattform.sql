-- VRETA 2 · Migrering 001 · Plattform
-- Designdokument 2.0: "Datamodell och databas för fullversionen" och "Behörighet i databasen".
-- Skapar alla tolv scheman, gemensamma typer, platsen, medlemskap, gästlänkar, värdtilldelning,
-- kodlistor, feature flags och platsinställningar, samt maskineriet som varje tabell registreras med
-- (gemensamma fält, stämpling, radnivåsäkerhet med default deny).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ------------------------------------------------------------------ scheman
-- Ett schema per bounded context, plus rm (read models), pub (publika projektioner), commerce (reserverad),
-- api (Domain API: kommandon och frågor, det enda schemat som exponeras mot klienter) och cmd
-- (kommandohanterare, nås bara via api.run_command).
create schema if not exists core;
create schema if not exists place;
create schema if not exists life;
create schema if not exists people;
create schema if not exists resources;
create schema if not exists change;
create schema if not exists culture;
create schema if not exists hospitality;
create schema if not exists story;
create schema if not exists rm;
create schema if not exists pub;
create schema if not exists commerce;
create schema if not exists api;
create schema if not exists cmd;

-- Inga funktioner får kunna anropas av vem som helst bara för att de finns (NFR-019).
alter default privileges in schema core, place, life, people, resources, change, culture, hospitality,
  story, rm, pub, commerce, api, cmd revoke execute on functions from public;

grant usage on schema core, place, life, people, resources, change, culture, hospitality, story, rm, pub, api
  to authenticated;
grant usage on schema pub, api to anon;
revoke all on schema cmd, commerce from public;

-- ------------------------------------------------------------------ gemensamma typer
create type core.visibility as enum ('private', 'internal', 'shareable', 'public');
create type core.sensitivity as enum ('normal', 'sensitive_location', 'private_presence');
create type core.source_type as enum ('manual', 'ai_capture', 'marketplace_import', 'email_import', 'agent', 'system');
create type core.member_role as enum ('owner', 'helper', 'reader', 'guest', 'host');
create type core.consent_value as enum ('yes', 'no', 'ask');
create type core.reality_mode as enum ('now', 'plan', 'vision', 'removed');
create type core.location_precision as enum ('exact', 'zone', 'hidden');

-- ------------------------------------------------------------------ mallar för gemensamma fält
-- Designregel 2 (gemensamma fält, R1.1 utökade): varje kärntabell skapas med
--   create table x (like core.entity_template including all, ...)
-- så att fälten alltid heter och beter sig likadant. Mallarna innehåller aldrig data.
create table core.entity_template (
  id uuid not null default gen_random_uuid(),
  site_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  archived_at timestamptz,
  visibility core.visibility not null default 'internal',
  sensitivity core.sensitivity not null default 'normal',
  source_type core.source_type not null default 'manual',
  source_ref text,
  tags text[] not null default '{}',
  command_id uuid,
  primary key (id)
);

-- Länk- och raddetaljtabeller: bara identitet, plats, tid och kommandot som skrev raden.
create table core.link_template (
  id uuid not null default gen_random_uuid(),
  site_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  command_id uuid,
  primary key (id)
);

-- ------------------------------------------------------------------ platsen och medlemskap
create table core.site (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  description text not null default '',
  timezone text not null default 'Europe/Stockholm',
  boundary extensions.geometry(MultiPolygon, 4326),
  -- Ungefärlig koordinat (två decimaler) – det enda väderkällan får (Tredjepartstjänster 2.0)
  approx_lat numeric(6,2),
  approx_lon numeric(6,2),
  owner_organization_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  archived_at timestamptz,
  command_id uuid
);

-- Adressen är privat (R1.1 6.2) och ligger därför i en egen tabell som bara ägaren ser.
create table core.site_private (
  like core.link_template including all,
  address text,
  property_designation text,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (site_id)
);

create table core.membership (
  like core.link_template including all,
  user_id uuid not null,
  role core.member_role not null,
  display_name text not null default '',
  guest_link_id uuid,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index membership_active_uq on core.membership (site_id, user_id) where revoked_at is null;
create index membership_user_idx on core.membership (user_id) where revoked_at is null;

-- Gästlänk (R1.1, ADR-009): bara nyckelns hash sparas. Stängs länken förlorar alla gäster som kom in
-- via den åtkomsten direkt. Öppen fråga Q-16: samma mekanism används som inbjudningslänk för
-- medhjälpare, läsare och värdar (kolumnen role); en gästlänk har role = guest.
create table core.guest_link (
  like core.link_template including all,
  label text not null,
  token_hash text not null unique,
  role core.member_role not null default 'guest' check (role <> 'owner'),
  uses integer not null default 0,
  last_used_at timestamptz,
  closed_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table core.membership add constraint membership_guest_link_fk
  foreign key (guest_link_id) references core.guest_link (id);

-- Värd/programledare kopplad till evenemang, session eller tour (R2.6). entity_id pekar på
-- entitetsregistret (främmande nyckel läggs till i 002).
create table core.host_assignment (
  like core.link_template including all,
  membership_id uuid not null references core.membership (id),
  user_id uuid not null,
  entity_id uuid not null,
  starts_on date,
  ends_on date,
  revoked_at timestamptz
);
create index host_assignment_user_idx on core.host_assignment (user_id) where revoked_at is null;

-- ------------------------------------------------------------------ kodlistor, flaggor och inställningar
-- Designregel 6: typer, roller, bidragstyper, observationstyper m.m. är data. Statusar i
-- tillståndsmaskiner är däremot fasta enum-värden.
create table core.code_list (
  code text primary key,
  label_sv text not null,
  description text not null default '',
  site_extensible boolean not null default true
);

create table core.code_value (
  id uuid primary key default gen_random_uuid(),
  list_code text not null references core.code_list (code),
  site_id uuid,
  code text not null,
  label_sv text not null,
  description text not null default '',
  parent_code text,
  sort integer not null default 100,
  attributes jsonb not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  command_id uuid,
  unique nulls not distinct (list_code, site_id, code)
);
create index code_value_list_idx on core.code_value (list_code, site_id);

create table core.feature_flag (
  like core.link_template including all,
  flag text not null,
  enabled boolean not null default false,
  release text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (site_id, flag)
);

create table core.site_setting (
  like core.link_template including all,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (site_id, key)
);

-- ------------------------------------------------------------------ behörighetsfunktioner
-- Läser medlemskap förbi RLS (security definer) så att policyerna inte blir rekursiva.
-- En gäst är bara medlem så länge gästlänken är öppen.
create function core.sites_with_role(p_roles core.member_role[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m.site_id), '{}')
  from core.membership m
  left join core.guest_link g on g.id = m.guest_link_id
  where m.user_id = auth.uid()
    and m.revoked_at is null
    and m.role = any (p_roles)
    and (m.role <> 'guest' or (g.id is not null and g.closed_at is null
         and (g.expires_at is null or g.expires_at > now())))
$$;

create function core.my_role(p_site uuid) returns core.member_role
language sql stable security definer set search_path = '' as $$
  select m.role
  from core.membership m
  left join core.guest_link g on g.id = m.guest_link_id
  where m.site_id = p_site and m.user_id = auth.uid() and m.revoked_at is null
    and (m.role <> 'guest' or (g.id is not null and g.closed_at is null
         and (g.expires_at is null or g.expires_at > now())))
  order by array_position(array['owner','helper','reader','host','guest']::core.member_role[], m.role)
  limit 1
$$;

create function core.is_owner(p_site uuid) returns boolean
language sql stable set search_path = '' as $$ select core.my_role(p_site) = 'owner' $$;

create function core.is_staff(p_site uuid) returns boolean
language sql stable set search_path = '' as $$ select core.my_role(p_site) in ('owner', 'helper') $$;

-- Samma regel som policyklassen standard, för användning i frågor och projektioner.
create function core.can_read(p_site uuid, p_visibility core.visibility, p_created_by uuid) returns boolean
language sql stable set search_path = '' as $$
  select case core.my_role(p_site)
    when 'owner' then true
    when 'helper' then p_visibility <> 'private' or p_created_by = auth.uid()
    when 'reader' then p_visibility <> 'private'
    else false end
$$;

-- ------------------------------------------------------------------ registrering av tabeller
-- Varje tabell i de tolv schemana registreras här med en policyklass. Registreringen lägger till
-- primärnyckel, platsnyckel, stämpling, audit, entitetsregister, RLS och behörigheter. Testsviten
-- kontrollerar att ingen tabell saknas i registret (Designdokument 2.0: "varje tabell har RLS-test").
create table core.table_registry (
  table_name text primary key,
  policy_class text not null check (policy_class in (
    'standard', 'staff', 'private', 'owner', 'member', 'reference', 'global', 'self', 'command',
    'site', 'membership', 'host', 'presence', 'pub_public', 'pub_guest', 'rm', 'none', 'custom')),
  entity_type text,
  audited boolean not null default false,
  ui_release text not null default 'R2.0',
  registered_at timestamptz not null default now()
);

-- Sätter skapare, ändrare, tid och kommando. Skyddar id, plats och skapare mot ändring.
create function core.tg_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_cmd text := nullif(current_setting('vreta.command_id', true), '');
  v jsonb := '{}';
  j jsonb;
begin
  if tg_op = 'INSERT' then
    j := to_jsonb(new);
    if j ? 'created_by' and (j ->> 'created_by') is null then v := v || jsonb_build_object('created_by', v_uid); end if;
    if j ? 'updated_by' then v := v || jsonb_build_object('updated_by', coalesce(v_uid, (j ->> 'created_by')::uuid)); end if;
  else
    j := to_jsonb(old);
    v := jsonb_build_object('updated_at', now(), 'updated_by', v_uid);
    if j ? 'id' then v := v || jsonb_build_object('id', j -> 'id'); end if;
    if j ? 'site_id' then v := v || jsonb_build_object('site_id', j -> 'site_id'); end if;
    if j ? 'created_at' then v := v || jsonb_build_object('created_at', j -> 'created_at'); end if;
    if j ? 'created_by' then v := v || jsonb_build_object('created_by', j -> 'created_by'); end if;
  end if;
  if v_cmd is not null then v := v || jsonb_build_object('command_id', v_cmd); end if;
  new := jsonb_populate_record(new, v);
  return new;
end $$;

-- Uttryck för policyerna. (select …) gör att funktionerna räknas en gång per fråga, inte per rad.
create function core.policy_expr(p_class text) returns text
language sql immutable set search_path = '' as $$
  select case p_class
    when 'standard' then
      $p$site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
         or (visibility <> 'private' and site_id in (select unnest(core.sites_with_role('{owner,helper,reader}'::core.member_role[]))))
         or (created_by = (select auth.uid()) and site_id in (select unnest(core.sites_with_role('{helper}'::core.member_role[]))))$p$
    when 'rm' then
      $p$site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
         or (visibility <> 'private' and site_id in (select unnest(core.sites_with_role('{owner,helper,reader}'::core.member_role[]))))
         or (created_by = (select auth.uid()) and site_id in (select unnest(core.sites_with_role('{helper}'::core.member_role[]))))$p$
    when 'staff' then
      $p$site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
         or (site_id in (select unnest(core.sites_with_role('{helper}'::core.member_role[])))
             and (visibility <> 'private' or created_by = (select auth.uid())))$p$
    when 'private' then
      $p$site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
         or (created_by = (select auth.uid()) and site_id in (select unnest(core.sites_with_role('{helper,reader,host}'::core.member_role[]))))$p$
    when 'owner' then
      $p$site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))$p$
    when 'member' then
      $p$site_id in (select unnest(core.sites_with_role('{owner,helper,reader,host}'::core.member_role[])))$p$
    when 'reference' then
      $p$(site_id is null and cardinality((select core.sites_with_role('{owner,helper,reader,host}'::core.member_role[]))) > 0)
         or site_id in (select unnest(core.sites_with_role('{owner,helper,reader,host}'::core.member_role[])))$p$
    when 'global' then 'true'
    when 'self' then $p$created_by = (select auth.uid())$p$
    when 'command' then
      $p$issued_by = (select auth.uid()) or site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))$p$
    when 'site' then
      $p$id in (select unnest(core.sites_with_role('{owner,helper,reader,host,guest}'::core.member_role[])))$p$
    when 'membership' then
      $p$user_id = (select auth.uid()) or site_id in (select unnest(core.sites_with_role('{owner,helper,reader,host}'::core.member_role[])))$p$
    when 'host' then
      $p$site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[]))) or user_id = (select auth.uid())$p$
    when 'pub_public' then 'true'
    when 'pub_guest' then
      $p$site_id in (select unnest(core.sites_with_role('{owner,helper,reader,host,guest}'::core.member_role[])))$p$
    else null end
$$;

create function core.register_table(
  p_table regclass,
  p_class text,
  p_entity_type text default null,
  p_title_column text default null,
  p_body_columns text[] default '{}',
  p_ui_release text default 'R2.0',
  p_audit boolean default true
) returns void
language plpgsql set search_path = '' as $$
declare
  v_schema text;
  v_name text;
  v_cols text[];
  v_expr text;
  v_audit boolean;
begin
  select n.nspname, c.relname into v_schema, v_name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_table;
  select array_agg(attname::text) into v_cols
  from pg_attribute where attrelid = p_table and attnum > 0 and not attisdropped;

  if 'id' = any (v_cols) and not exists (select 1 from pg_constraint where conrelid = p_table and contype = 'p') then
    execute format('alter table %s add primary key (id)', p_table);
  end if;

  if 'site_id' = any (v_cols) and p_table <> 'core.site'::regclass
     and not exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
                     where k.conrelid = p_table and k.contype = 'f' and a.attname = 'site_id') then
    execute format('alter table %s add constraint %I foreign key (site_id) references core.site (id)', p_table, v_name || '_site_fk');
    execute format('create index if not exists %I on %s (site_id)', v_name || '_site_idx', p_table);
  end if;

  if 'updated_at' = any (v_cols) or 'created_by' = any (v_cols) or 'command_id' = any (v_cols) then
    execute format('create trigger stamp before insert or update on %s for each row execute function core.tg_stamp()', p_table);
  end if;

  v_audit := p_audit and p_class not in ('pub_public', 'pub_guest', 'rm', 'none') and to_regclass('core.audit_entry') is not null;
  if v_audit then
    execute format('create trigger audit after insert or update or delete on %s for each row execute function core.tg_audit()', p_table);
  end if;

  if p_entity_type is not null then
    execute format('create trigger entity after insert or update on %s for each row execute function core.tg_entity(%L, %L%s)',
      p_table, p_entity_type, coalesce(p_title_column, ''),
      coalesce((select string_agg(format(', %L', c), '') from unnest(p_body_columns) c), ''));
    execute format('create trigger entity_delete after delete on %s for each row execute function core.tg_entity_delete()', p_table);
  end if;

  -- Radnivåsäkerhet med default deny. Klienter skriver aldrig direkt: bara SELECT beviljas,
  -- all skrivning går via Domain API (api.run_command).
  execute format('alter table %s enable row level security', p_table);
  execute format('revoke all on table %s from public, anon, authenticated', p_table);

  v_expr := core.policy_expr(p_class);
  if p_class in ('pub_public') then
    execute format('grant select on table %s to anon, authenticated', p_table);
    execute format('create policy read on %s for select to anon, authenticated using (%s)', p_table, v_expr);
  elsif v_expr is not null then
    execute format('grant select on table %s to authenticated', p_table);
    execute format('create policy read on %s for select to authenticated using (%s)', p_table, v_expr);
  elsif p_class in ('custom', 'presence') then
    execute format('grant select on table %s to authenticated', p_table);
  end if;

  insert into core.table_registry (table_name, policy_class, entity_type, audited, ui_release)
  values (v_schema || '.' || v_name, p_class, p_entity_type, v_audit, p_ui_release)
  on conflict (table_name) do update set policy_class = excluded.policy_class, entity_type = excluded.entity_type,
    audited = excluded.audited, ui_release = excluded.ui_release;
end $$;

-- Mallarna: ingen åtkomst alls.
select core.register_table('core.entity_template', 'none');
select core.register_table('core.link_template', 'none');
select core.register_table('core.table_registry', 'global');
select core.register_table('core.site', 'site');
select core.register_table('core.site_private', 'owner');
select core.register_table('core.membership', 'membership');
select core.register_table('core.guest_link', 'owner');
select core.register_table('core.host_assignment', 'host');
select core.register_table('core.code_list', 'global');
select core.register_table('core.code_value', 'reference');
select core.register_table('core.feature_flag', 'member');
select core.register_table('core.site_setting', 'member');

-- ------------------------------------------------------------------ kodlistor (startvärden)
insert into core.code_list (code, label_sv, description, site_extensible) values
  ('zone_type', 'Områdestyp', 'Typer för områden på platsen, med typisk permakulturzon 0–5', true),
  ('structure_type', 'Byggnads- och anläggningstyp', 'Byggnader och anläggningar, med typisk permakulturzon', true),
  ('space_type', 'Rumstyp', 'Rum och platsdelar i byggnader eller på marken', true),
  ('place_group', 'Platsgrupp', 'Grupper för platstyper', false),
  ('external_place_kind', 'Slag av plats utanför', 'Loppis, gård, återvinningscentral …', true),
  ('person_role', 'Roll', 'Roller som människor har i relation till platsen', true),
  ('relation_kind', 'Relation', 'Relationer mellan människor', false),
  ('organization_kind', 'Organisationstyp', '', true),
  ('contribution_type', 'Bidragstyp', 'Vad någon bidragit med', true),
  ('reciprocity_type', 'Ömsesidighet', 'Vad platsen gett tillbaka', true),
  ('interaction_channel', 'Kontaktkanal', '', true),
  ('project_kind', 'Projektslag', '', true),
  ('need_kind', 'Behovsslag', 'Material, hjälp, transport, kunskap, maskin', false),
  ('observation_type', 'Observationstyp', 'Vatten, blomning, skada, skörd, art, lokalt väder …', true),
  ('behavior', 'Beteende', 'Observerat beteende hos djur', true),
  ('phenophase', 'Fenofas', 'Växters fenologi', true),
  ('plant_condition', 'Växttillstånd', '', true),
  ('plant_function', 'Växtfunktion', 'Ekologiska och kulturella funktioner', true),
  ('capability_kind', 'Kapacitet', 'Vad människor, fordon och maskiner kan bidra med', true),
  ('facility', 'Facilitet', 'Faciliteter i boende och lokaler', true),
  ('channel', 'Kanal', 'Marknadsplatser och sociala kanaler med kanaladapter i attributen', true),
  ('content_goal', 'Berättelsemål', '', false),
  ('map_layer', 'Kartlager', 'Lager på Vretakartan', true),
  ('vehicle_kind', 'Fordons- och maskinslag', '', true),
  ('habitat_kind', 'Habitat', 'Livsmiljöer', true),
  ('habitat_use', 'Habitatanvändning', '', true),
  ('ecological_relation', 'Ekologisk relation', '', true),
  ('activity_kind', 'Aktivitetsslag', '', true),
  ('event_kind', 'Evenemangsslag', '', true),
  ('venue_layout', 'Venue-konfiguration', 'Hur en plats används vid ett tillfälle', true),
  ('readiness_area', 'Beredskapsområde', 'Det som EventReadiness kontrollerar', true),
  ('stay_purpose', 'Vistelsens syfte', '', true),
  ('creative_role', 'Kreativ roll', '', true),
  ('feature', 'Funktion', 'Feature flags och den release där gränssnittet kommer', false),
  ('checklist_template', 'Checklistmall', 'Startmallar för hämtningar', true),
  ('default_category', 'Startkategori', 'Kategorier som en ny plats börjar med (ADR-007)', false);

-- Platsgrupper och platstyper. Typisk permakulturzon i attributes.pz.
insert into core.code_value (list_code, code, label_sv, sort) values
  ('place_group', 'household', 'Hushåll och vardag', 10),
  ('place_group', 'cultivation', 'Odling och mat', 20),
  ('place_group', 'animals', 'Djur och pollinatörer', 30),
  ('place_group', 'water', 'Vatten', 40),
  ('place_group', 'cycle', 'Kretslopp', 50),
  ('place_group', 'nature', 'Natur', 60),
  ('place_group', 'reuse', 'Återbruk och material', 70),
  ('place_group', 'craft', 'Hantverk och verkstad', 80),
  ('place_group', 'hosting', 'Gäster och samling', 90),
  ('place_group', 'access', 'Väg och angöring', 100);

insert into core.code_value (list_code, code, label_sv, parent_code, sort, attributes)
select 'zone_type', v.code, v.label, v.grp, v.sort, jsonb_build_object('pz', v.pz)
from (values
  ('house_garden', 'Husnära trädgård', 'household', 1, 1),
  ('patio', 'Uteplats', 'household', 2, 0),
  ('outdoor_kitchen', 'Utekök', 'household', 3, 1),
  ('dining_place', 'Matplats', 'household', 4, 1),
  ('play_area', 'Lekplats', 'household', 5, 1),
  ('kitchen_garden', 'Köksträdgård', 'cultivation', 10, 1),
  ('vegetable_field', 'Grönsaksland', 'cultivation', 11, 2),
  ('raised_beds', 'Odlingsbäddar', 'cultivation', 12, 1),
  ('herb_garden', 'Örtagård', 'cultivation', 13, 1),
  ('forest_garden', 'Skogsträdgård', 'cultivation', 14, 2),
  ('orchard', 'Fruktträdgård', 'cultivation', 15, 2),
  ('berry_garden', 'Bärodling', 'cultivation', 16, 2),
  ('perennial_bed', 'Perennrabatt', 'cultivation', 17, 1),
  ('planting_area', 'Plantering', 'cultivation', 18, 2),
  ('nursery_bed', 'Inplantering och plantskola', 'cultivation', 19, 1),
  ('hedge', 'Häck', 'cultivation', 20, 2),
  ('lawn', 'Gräsmatta', 'household', 21, 1),
  ('pasture', 'Bete', 'animals', 30, 3),
  ('hen_yard', 'Hönsgård', 'animals', 31, 1),
  ('bee_yard', 'Bigård', 'animals', 32, 2),
  ('pollinator_meadow', 'Pollinatöräng', 'animals', 33, 3),
  ('pond', 'Damm', 'water', 40, 2),
  ('swale', 'Svackdike', 'water', 41, 2),
  ('rain_garden', 'Regnbädd', 'water', 42, 1),
  ('infiltration_bed', 'Infiltrationsbädd', 'water', 43, 2),
  ('stream', 'Bäck', 'water', 44, 4),
  ('wetland', 'Våtmark', 'water', 45, 4),
  ('compost_area', 'Kompostplats', 'cycle', 50, 1),
  ('mulch_store', 'Täckmaterial', 'cycle', 51, 2),
  ('wood_store', 'Vedupplag', 'cycle', 52, 1),
  ('meadow', 'Äng', 'nature', 60, 3),
  ('woodland', 'Skog', 'nature', 61, 4),
  ('woodland_edge', 'Skogsbryn', 'nature', 62, 3),
  ('wild_zone', 'Vild natur', 'nature', 63, 5),
  ('stone_pile', 'Stenröse', 'nature', 64, 4),
  ('material_yard', 'Materialgård', 'reuse', 70, 2),
  ('storage_zone', 'Lagerzon', 'reuse', 71, 2),
  ('parking', 'Parkering', 'access', 80, 1),
  ('driveway', 'Infart', 'access', 81, 1),
  ('gathering_place', 'Samlingsplats', 'hosting', 90, 1),
  ('tent_site', 'Tältplats', 'hosting', 91, 2),
  ('event_meadow', 'Evenemangsäng', 'hosting', 92, 2)
) as v(code, label, grp, sort, pz);

insert into core.code_value (list_code, code, label_sv, parent_code, sort, attributes)
select 'structure_type', v.code, v.label, v.grp, v.sort, jsonb_build_object('pz', v.pz)
from (values
  ('residence', 'Bostadshus', 'household', 1, 0),
  ('guest_house', 'Gäststuga', 'hosting', 2, 1),
  ('orangery', 'Orangeri', 'cultivation', 3, 1),
  ('greenhouse', 'Växthus', 'cultivation', 4, 1),
  ('plant_nursery', 'Barnkammare för växter', 'cultivation', 5, 1),
  ('cold_frame', 'Drivbänk', 'cultivation', 6, 1),
  ('root_cellar', 'Jordkällare', 'cultivation', 7, 1),
  ('henhouse', 'Hönshus', 'animals', 10, 1),
  ('beehive', 'Bikupa', 'animals', 11, 2),
  ('insect_hotel', 'Insektshotell', 'animals', 12, 2),
  ('bird_box', 'Fågelholk', 'animals', 13, 2),
  ('stable', 'Stall', 'animals', 14, 2),
  ('pump_house', 'Pumphus', 'water', 20, 1),
  ('well', 'Brunn', 'water', 21, 1),
  ('rainwater_tank', 'Regnvattentank', 'water', 22, 1),
  ('treatment_plant', 'Reningsverk', 'water', 23, 1),
  ('jetty', 'Brygga', 'water', 24, 2),
  ('compost', 'Kompost', 'cycle', 30, 1),
  ('woodshed', 'Vedbod', 'cycle', 31, 1),
  ('storehouse', 'Förråd', 'reuse', 40, 1),
  ('barn', 'Lada', 'reuse', 41, 2),
  ('garage', 'Garage', 'reuse', 42, 1),
  ('machine_room', 'Maskinrum', 'reuse', 43, 1),
  ('carpentry', 'Snickeri', 'craft', 50, 1),
  ('ceramics_workshop', 'Keramikverkstad', 'craft', 51, 1),
  ('painting_studio', 'Målarateljé', 'craft', 52, 1),
  ('dairy', 'Mejeri', 'craft', 53, 1),
  ('brewery', 'Bryggeri', 'craft', 54, 1),
  ('workshop', 'Verkstad', 'craft', 55, 1),
  ('deck', 'Altan', 'household', 60, 0),
  ('pavilion', 'Paviljong', 'hosting', 61, 1),
  ('sauna', 'Bastu', 'hosting', 62, 1),
  ('outhouse', 'Utedass', 'hosting', 63, 1),
  ('tiny_house', 'Tiny house', 'hosting', 64, 1),
  ('road', 'Väg', 'access', 70, 1)
) as v(code, label, grp, sort, pz);

insert into core.code_value (list_code, code, label_sv, sort) values
  ('space_type', 'room', 'Rum', 1), ('space_type', 'kitchen', 'Kök', 2), ('space_type', 'toilet', 'Toalett', 3),
  ('space_type', 'guest_room', 'Gästrum', 4), ('space_type', 'loft', 'Loft', 5), ('space_type', 'workshop_room', 'Verkstadsrum', 6),
  ('space_type', 'storage_room', 'Förrådsrum', 7), ('space_type', 'cultivation_bench', 'Odlingsbänk', 8),
  ('space_type', 'wall', 'Vägg', 9), ('space_type', 'tent_pitch', 'Tältplats', 10), ('space_type', 'yard_part', 'Platsdel', 11),
  ('external_place_kind', 'flea_market', 'Loppis', 1), ('external_place_kind', 'farm', 'Gård', 2),
  ('external_place_kind', 'recycling_centre', 'Återvinningscentral', 3), ('external_place_kind', 'reuse_store', 'Återbruksbutik', 4),
  ('external_place_kind', 'nursery', 'Handelsträdgård', 5), ('external_place_kind', 'gravel_pit', 'Grustag', 6),
  ('external_place_kind', 'demolition_site', 'Rivning', 7), ('external_place_kind', 'home', 'Hemadress', 8),
  ('external_place_kind', 'other', 'Annan plats', 9),
  ('person_role', 'supplier', 'Leverantör', 1), ('person_role', 'giver', 'Givare', 2),
  ('person_role', 'cocreator', 'Medskapare', 3), ('person_role', 'craftsperson', 'Hantverkare', 4),
  ('person_role', 'knowledge_bearer', 'Kunskapsbärare', 5), ('person_role', 'transporter', 'Transportör', 6),
  ('person_role', 'buyer', 'Köpare', 7), ('person_role', 'recipient', 'Mottagare', 8),
  ('person_role', 'follower', 'Följare', 9), ('person_role', 'tipster', 'Tipsare', 10),
  ('person_role', 'artist', 'Konstnär', 11), ('person_role', 'host', 'Värd', 12), ('person_role', 'guest', 'Gäst', 13),
  ('relation_kind', 'family', 'Familj', 1), ('relation_kind', 'partner', 'Partner', 2), ('relation_kind', 'neighbor', 'Granne', 3),
  ('relation_kind', 'friend', 'Vän', 4), ('relation_kind', 'colleague', 'Kollega', 5), ('relation_kind', 'works_with', 'Arbetar ihop', 6),
  ('relation_kind', 'introduced', 'Tipsade oss om', 7),
  ('organization_kind', 'association', 'Förening', 1), ('organization_kind', 'company', 'Företag', 2),
  ('organization_kind', 'municipality', 'Kommun', 3), ('organization_kind', 'nursery', 'Handelsträdgård', 4),
  ('organization_kind', 'supplier', 'Leverantör', 5),
  ('contribution_type', 'material', 'Material', 1), ('contribution_type', 'time', 'Tid', 2),
  ('contribution_type', 'knowledge', 'Kunskap', 3), ('contribution_type', 'transport', 'Transport', 4),
  ('contribution_type', 'tools', 'Verktyg', 5), ('contribution_type', 'contacts', 'Kontakter', 6),
  ('contribution_type', 'food', 'Mat', 7), ('contribution_type', 'care', 'Omsorg', 8), ('contribution_type', 'tip', 'Tips', 9),
  ('reciprocity_type', 'plants', 'Plantor', 1), ('reciprocity_type', 'help', 'Hjälp', 2), ('reciprocity_type', 'food', 'Mat', 3),
  ('reciprocity_type', 'showing', 'Visning av resultatet', 4), ('reciprocity_type', 'material', 'Material', 5),
  ('interaction_channel', 'call', 'Samtal', 1), ('interaction_channel', 'message', 'Meddelande', 2),
  ('interaction_channel', 'meeting', 'Möte', 3), ('interaction_channel', 'email', 'Mejl', 4),
  ('interaction_channel', 'marketplace', 'Via annons', 5),
  ('project_kind', 'build', 'Bygge', 1), ('project_kind', 'planting', 'Plantering', 2), ('project_kind', 'renovation', 'Renovering', 3),
  ('project_kind', 'construction', 'Anläggning', 4), ('project_kind', 'cultivation', 'Odling', 5), ('project_kind', 'initiative', 'Initiativ', 6),
  ('need_kind', 'material', 'Material', 1), ('need_kind', 'help', 'Hjälp', 2), ('need_kind', 'transport', 'Transport', 3),
  ('need_kind', 'knowledge', 'Kunskap', 4), ('need_kind', 'machine', 'Maskin', 5),
  ('observation_type', 'water', 'Vatten', 1), ('observation_type', 'bloom', 'Blomning', 2), ('observation_type', 'damage', 'Skada', 3),
  ('observation_type', 'harvest', 'Skörd', 4), ('observation_type', 'construction', 'Byggnation', 5),
  ('observation_type', 'animal', 'Djur', 6), ('observation_type', 'plant', 'Växt', 7), ('observation_type', 'weather_local', 'Lokalt väder', 8),
  ('observation_type', 'species', 'Art', 9), ('observation_type', 'follow_up', 'Uppföljning', 10),
  ('behavior', 'seen', 'Sedd', 1), ('behavior', 'heard', 'Hörd', 2), ('behavior', 'territorial_song', 'Sjunger revir', 3),
  ('behavior', 'foraging', 'Födosöker', 4), ('behavior', 'bathing', 'Badar/dricker', 5), ('behavior', 'nest_building', 'Bygger bo', 6),
  ('behavior', 'brooding', 'Ruvar', 7), ('behavior', 'feeding_young', 'Matar ungar', 8), ('behavior', 'young_seen', 'Ungar observerade', 9),
  ('behavior', 'resting', 'Rastar', 10), ('behavior', 'wintering', 'Övervintrar', 11), ('behavior', 'flying_over', 'Flyger över', 12),
  ('phenophase', 'bud_break', 'Knoppsprickning', 1), ('phenophase', 'flowering', 'Blomning', 2), ('phenophase', 'fruit_set', 'Fruktsättning', 3),
  ('phenophase', 'ripening', 'Mognad', 4), ('phenophase', 'autumn_colour', 'Höstfärg', 5), ('phenophase', 'leaf_fall', 'Lövfällning', 6),
  ('phenophase', 'dormancy', 'Vila', 7),
  ('plant_condition', 'drought_stress', 'Torkstress', 1), ('plant_condition', 'frost_damage', 'Frostskada', 2),
  ('plant_condition', 'disease', 'Sjukdom', 3), ('plant_condition', 'recovery', 'Återhämtning', 4),
  ('plant_function', 'food', 'Mat', 1), ('plant_function', 'nectar_pollen', 'Nektar/pollen', 2), ('plant_function', 'host_plant', 'Värdväxt', 3),
  ('plant_function', 'shelter', 'Skydd', 4), ('plant_function', 'shade', 'Skugga', 5), ('plant_function', 'windbreak', 'Vindskydd', 6),
  ('plant_function', 'nitrogen_fixing', 'Kvävefixering', 7), ('plant_function', 'ground_cover', 'Jordtäckning', 8),
  ('plant_function', 'erosion', 'Erosionsskydd', 9), ('plant_function', 'water_management', 'Vattenhantering', 10),
  ('plant_function', 'medicinal_technical', 'Medicinsk/teknisk användning', 11), ('plant_function', 'dye_fibre', 'Färg/fiber', 12),
  ('plant_function', 'cultural', 'Kulturväxt', 13), ('plant_function', 'design', 'Gestaltning', 14),
  ('capability_kind', 'load_kg', 'Last', 1), ('capability_kind', 'tow_kg', 'Drag', 2), ('capability_kind', 'lift_kg', 'Lyft', 3),
  ('capability_kind', 'reach_m', 'Räckvidd', 4), ('capability_kind', 'implement', 'Redskap', 5), ('capability_kind', 'skill', 'Kunskap', 6),
  ('capability_kind', 'licence', 'Behörighet', 7),
  ('facility', 'wc', 'WC', 1), ('facility', 'shower', 'Dusch', 2), ('facility', 'kitchen', 'Kök', 3), ('facility', 'electricity', 'El', 4),
  ('facility', 'water', 'Vatten', 5), ('facility', 'heating', 'Värme', 6), ('facility', 'wifi', 'Wifi', 7), ('facility', 'accessible', 'Tillgänglig', 8),
  ('facility', 'dog_friendly', 'Hund välkommen', 9), ('facility', 'parking', 'Parkering', 10),
  ('content_goal', 'story', 'Berätta historien', 1), ('content_goal', 'before_after', 'Före/efter', 2), ('content_goal', 'thanks', 'Tacka', 3),
  ('content_goal', 'wanted', 'Efterlys', 4), ('content_goal', 'show_what_happened', 'Visa vad som hänt', 5),
  ('content_goal', 'weekly', 'Veckans Vreta', 6), ('content_goal', 'offer', 'Erbjudande', 7), ('content_goal', 'year_later', 'Ett år senare', 8),
  ('map_layer', 'basemap', 'Grundbild', 1), ('map_layer', 'boundary', 'Fastighetsgräns', 2), ('map_layer', 'structures', 'Byggnader och anläggningar', 3),
  ('map_layer', 'zones', 'Zoner', 4), ('map_layer', 'reuse_in_use', 'Återbruk i bruk', 5), ('map_layer', 'observations', 'Observationer och fotopunkter', 6),
  ('map_layer', 'storage', 'Lager', 7), ('map_layer', 'projects', 'Projekt', 8), ('map_layer', 'vegetation', 'Växtlighet och träd', 9),
  ('map_layer', 'water_utilities', 'Vatten och ledningar', 10), ('map_layer', 'paths', 'Gångar', 11),
  ('map_layer', 'life', 'LIFE', 20), ('map_layer', 'plants', 'PLANTS', 21), ('map_layer', 'art', 'ART', 22),
  ('map_layer', 'hosting', 'BOENDE', 23), ('map_layer', 'tour', 'TOUR', 24),
  ('vehicle_kind', 'car', 'Bil', 1), ('vehicle_kind', 'van', 'Skåpbil', 2), ('vehicle_kind', 'trailer', 'Släp', 3),
  ('vehicle_kind', 'truck_crane', 'Lastbil med kran', 4), ('vehicle_kind', 'wheel_loader', 'Hjullastare', 5),
  ('vehicle_kind', 'excavator', 'Grävmaskin', 6), ('vehicle_kind', 'tractor', 'Traktor', 7), ('vehicle_kind', 'mower', 'Gräsklippare', 8),
  ('vehicle_kind', 'tool', 'Maskin/verktyg', 9),
  ('habitat_kind', 'bird_box', 'Fågelholk', 1), ('habitat_kind', 'natural_nest', 'Naturligt bo', 2), ('habitat_kind', 'hollow_tree', 'Hålträd', 3),
  ('habitat_kind', 'dense_hedge', 'Tät häck', 4), ('habitat_kind', 'dead_wood', 'Död ved', 5), ('habitat_kind', 'stone_pile', 'Stenröse', 6),
  ('habitat_kind', 'pond_edge', 'Dammkant', 7), ('habitat_kind', 'reeds', 'Vass', 8), ('habitat_kind', 'insect_hotel', 'Insektshotell', 9),
  ('habitat_kind', 'winter_feeding', 'Vintermatning', 10),
  ('habitat_use', 'nesting', 'Häckar', 1), ('habitat_use', 'foraging', 'Födosöker', 2), ('habitat_use', 'shelter', 'Skydd', 3),
  ('habitat_use', 'wintering', 'Övervintrar', 4), ('habitat_use', 'breeding', 'Reproducerar sig', 5),
  ('ecological_relation', 'forages_on', 'Födosöker på', 1), ('ecological_relation', 'nests_in', 'Boar i', 2),
  ('ecological_relation', 'harvested_for', 'Skördas till', 3), ('ecological_relation', 'pollinates', 'Pollinerar', 4),
  ('activity_kind', 'masonry', 'Mura', 1), ('activity_kind', 'planting', 'Plantera', 2), ('activity_kind', 'harvest', 'Skörda', 3),
  ('activity_kind', 'cooking', 'Laga mat', 4), ('activity_kind', 'renovation', 'Renovera', 5), ('activity_kind', 'workday', 'Arbetsdag', 6),
  ('activity_kind', 'carpentry', 'Snickra', 7), ('activity_kind', 'painting', 'Måla', 8), ('activity_kind', 'watering', 'Vattna', 9),
  ('event_kind', 'retreat', 'Retreat', 1), ('event_kind', 'course', 'Kurs', 2), ('event_kind', 'workday', 'Arbetsdag', 3),
  ('event_kind', 'market', 'Marknad', 4), ('event_kind', 'party', 'Fest', 5), ('event_kind', 'harvest', 'Skörd', 6),
  ('event_kind', 'tour', 'Visning', 7), ('event_kind', 'art', 'Konst och hantverk', 8),
  ('venue_layout', 'open_air', 'Öppen himmel', 1), ('venue_layout', 'tent', 'Tält', 2), ('venue_layout', 'seated_workshop', 'Sittande workshop', 3),
  ('venue_layout', 'standing', 'Stående', 4), ('venue_layout', 'sleeping', 'Sovplatser', 5), ('venue_layout', 'dining', 'Måltid', 6),
  ('readiness_area', 'venue', 'Venue', 1), ('readiness_area', 'capacity', 'Kapacitet', 2), ('readiness_area', 'accommodation', 'Boende', 3),
  ('readiness_area', 'weather_plan_b', 'Väder och plan B', 4), ('readiness_area', 'program', 'Program', 5), ('readiness_area', 'material', 'Material', 6),
  ('readiness_area', 'staff', 'Ledare och personal', 7), ('readiness_area', 'meals', 'Måltider och café', 8), ('readiness_area', 'toilets', 'Toaletter', 9),
  ('readiness_area', 'water', 'Vatten', 10), ('readiness_area', 'accessibility', 'Tillgänglighet', 11), ('readiness_area', 'parking', 'Parkering och ankomst', 12),
  ('readiness_area', 'cleaning', 'Städning och avfall', 13), ('readiness_area', 'local_requirements', 'Lokala krav', 14),
  ('stay_purpose', 'friend', 'Vän', 1), ('stay_purpose', 'guest', 'Gäst', 2), ('stay_purpose', 'cocreator', 'Medskapare', 3),
  ('stay_purpose', 'volunteer', 'Volontär', 4), ('stay_purpose', 'course_participant', 'Kursdeltagare', 5),
  ('stay_purpose', 'craftsperson', 'Hantverkare', 6), ('stay_purpose', 'artist_in_residence', 'Artist-in-residence', 7),
  ('stay_purpose', 'long_term', 'Längre tids boende', 8),
  ('creative_role', 'artist', 'Konstnär', 1), ('creative_role', 'ceramicist', 'Keramiker', 2), ('creative_role', 'craftsperson', 'Hantverkare', 3),
  ('creative_role', 'curator', 'Curator', 4);

-- Kanaler med kanaladapter (R1.1 9.2). Gränserna är konfiguration och ska verifieras (Q-03).
insert into core.code_value (list_code, code, label_sv, sort, attributes) values
  ('channel', 'blocket', 'Blocket', 1, '{"kind":"marketplace","max_images":10,"title_max_length":50,"supports_price":true,"supports_free":true,"publish_modes":["manual","browser_agent"],"supports_status_sync":false,"share_text":false}'),
  ('channel', 'facebook_marketplace', 'Facebook Marketplace', 2, '{"kind":"marketplace","max_images":10,"title_max_length":100,"supports_price":true,"supports_free":true,"publish_modes":["manual","browser_agent"],"supports_status_sync":false,"share_text":false}'),
  ('channel', 'facebook_group', 'Facebookgrupp', 3, '{"kind":"marketplace","max_images":10,"title_max_length":100,"supports_price":true,"supports_free":true,"publish_modes":["manual"],"supports_status_sync":false,"share_text":false}'),
  ('channel', 'tiptapp', 'Tiptapp', 4, '{"kind":"marketplace","max_images":5,"title_max_length":60,"supports_price":true,"supports_free":true,"publish_modes":["manual"],"supports_status_sync":false,"share_text":true}'),
  ('channel', 'facebook', 'Facebook', 10, '{"kind":"social","max_images":10,"share_text":false}'),
  ('channel', 'instagram', 'Instagram', 11, '{"kind":"social","max_images":10,"share_text":false,"hashtags":true}'),
  ('channel', 'linkedin', 'LinkedIn', 12, '{"kind":"social","max_images":9,"share_text":true}'),
  ('channel', 'private_message', 'Privat meddelande', 13, '{"kind":"social","max_images":4,"share_text":true}');

-- Funktioner och den release där gränssnittet slås på (ADR-020). Schemat finns alltid från R2.0.
insert into core.code_value (list_code, code, label_sv, sort, attributes) values
  ('feature', 'core', 'Kärnan: fånga, saker, människor, platser, Fråga Vreta', 1, '{"release":"R2.0"}'),
  ('feature', 'guest_view', 'Gästvy via gästlänk', 2, '{"release":"R2.0"}'),
  ('feature', 'mcp', 'MCP-server', 3, '{"release":"R2.0"}'),
  ('feature', 'cockpit', 'Idag som cockpit, Vreta Pulse och årsbild', 10, '{"release":"R2.1"}'),
  ('feature', 'weather', 'Väder och vädersignaler', 11, '{"release":"R2.1"}'),
  ('feature', 'map_modes', 'Kartans fyra lägen och Vision Board', 20, '{"release":"R2.2"}'),
  ('feature', 'life', 'Livet på Vreta och växtlivet', 30, '{"release":"R2.3"}'),
  ('feature', 'canvas', 'Project Canvas, Moment och Activity', 40, '{"release":"R2.4"}'),
  ('feature', 'vehicles', 'Fordon och maskiner', 41, '{"release":"R2.4"}'),
  ('feature', 'copilot', 'Fråga Vreta som copilot med Action Preview', 42, '{"release":"R2.4"}'),
  ('feature', 'culture', 'Verk, installationer och Rundvandring', 50, '{"release":"R2.5"}'),
  ('feature', 'hospitality', 'Boende, evenemang och EventReadiness', 60, '{"release":"R2.6"}'),
  ('feature', 'live', 'VRETA Live och Bidra', 70, '{"release":"R2.7"}'),
  ('feature', 'commerce', 'Café och försäljning', 80, '{"release":"R3"}');

-- Checklistmallar för hämtning (R1.1 4.3).
insert into core.code_value (list_code, code, label_sv, sort, attributes) values
  ('checklist_template', 'large_windows', 'Stora fönster', 1, '{"items":["Filtar och hörnskydd","Spännband","Mät fönstren före lastning","Foto före, under och efter"]}'),
  ('checklist_template', 'plants', 'Växter', 2, '{"items":["Säckar","Vatten","Spade","Skugga i bilen","Foto före, under och efter"]}'),
  ('checklist_template', 'heavy', 'Tungt material', 3, '{"items":["Släp bokat","Bärhjälp","Kärra","Arbetshandskar","Foto före, under och efter"]}'),
  ('checklist_template', 'general', 'Allmän hämtning', 4, '{"items":["Kontanter eller Swish","Spännband","Filtar","Foto före, under och efter"]}');

-- Startkategorier (ADR-007). Emissionsfaktorn (kg CO₂e per kg) fylls i när källan valts (P1).
insert into core.code_value (list_code, code, label_sv, parent_code, sort) values
  ('default_category', 'building', 'Byggmaterial', null, 1),
  ('default_category', 'brick', 'Tegel', 'building', 2),
  ('default_category', 'stone', 'Sten', 'building', 3),
  ('default_category', 'timber', 'Virke', 'building', 4),
  ('default_category', 'windows', 'Fönster', 'building', 5),
  ('default_category', 'doors', 'Dörrar', 'building', 6),
  ('default_category', 'roofing', 'Tak', 'building', 7),
  ('default_category', 'tiles', 'Kakel och klinker', 'building', 8),
  ('default_category', 'insulation', 'Isolering', 'building', 9),
  ('default_category', 'fittings', 'Beslag och handtag', 'building', 10),
  ('default_category', 'plumbing', 'VVS', 'building', 11),
  ('default_category', 'radiators', 'Radiatorer', 'plumbing', 12),
  ('default_category', 'electrical', 'El och belysning', 'building', 13),
  ('default_category', 'garden', 'Trädgård', null, 20),
  ('default_category', 'plants', 'Växter', 'garden', 21),
  ('default_category', 'trees', 'Träd och buskar', 'plants', 22),
  ('default_category', 'perennials', 'Perenner', 'plants', 23),
  ('default_category', 'seeds', 'Frön', 'plants', 24),
  ('default_category', 'soil', 'Jord och täckmaterial', 'garden', 25),
  ('default_category', 'pots', 'Krukor', 'garden', 26),
  ('default_category', 'garden_tools', 'Trädgårdsredskap', 'garden', 27),
  ('default_category', 'furniture', 'Möbler', null, 30),
  ('default_category', 'outdoor_furniture', 'Utemöbler', 'furniture', 31),
  ('default_category', 'kitchen', 'Kök och hushåll', null, 40),
  ('default_category', 'textiles', 'Textil', null, 41),
  ('default_category', 'tools', 'Verktyg och maskiner', null, 50),
  ('default_category', 'vehicles', 'Fordon och släp', 'tools', 51),
  ('default_category', 'metal', 'Metall', null, 60),
  ('default_category', 'cast_iron', 'Gjutjärn', 'metal', 61),
  ('default_category', 'glass', 'Glas', null, 62),
  ('default_category', 'ceramics', 'Keramik', null, 63),
  ('default_category', 'art', 'Konst och hantverk', null, 64),
  ('default_category', 'lamps', 'Lampor', 'electrical', 65),
  ('default_category', 'other', 'Övrigt', null, 99);

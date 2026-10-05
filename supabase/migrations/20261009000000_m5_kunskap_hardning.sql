-- VRETA R1 · Milstolpe M5: kunskap och härdning
-- Trådar för Fråga Vreta, AI-kostnad per funktion, fulltextsök och index för prestanda.
-- Spec: docs/spec-r1.md avsnitt 11.3, 11.6, 13.2 (NFR-004, NFR-012, NFR-014).

-- ---------------------------------------------------------------- Fråga Vreta: trådar (privata)
create table ask_threads (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  title text not null default '',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index on ask_threads (created_by, updated_at desc);
create or replace function ask_threads_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger ask_threads_touch before update on ask_threads for each row execute function ask_threads_touch();

alter table ask_threads enable row level security;
-- Bara den som skapat tråden ser den – inte ens ägaren (11.6)
create policy ask_threads_own on ask_threads for all to authenticated
  using (created_by = auth.uid() and is_member(site_id))
  with check (created_by = auth.uid() and is_member(site_id));

-- ---------------------------------------------------------------- AI-kostnad (NFR-014)
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  function text not null,
  model text not null default '',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);
create index on ai_usage (site_id, created_at);
alter table ai_usage enable row level security;
create policy ai_usage_insert on ai_usage for insert to authenticated with check (is_member(site_id) and created_by = auth.uid());
create policy ai_usage_read on ai_usage for select to authenticated using (is_owner(site_id));

-- Månadstak per plats (valfritt). Edge-funktionerna nekar AI-anrop när taket är nått.
alter table sites add column if not exists ai_monthly_token_cap int;

create or replace function ai_tokens_this_month(p_site uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(input_tokens + output_tokens), 0) from ai_usage
   where site_id = p_site and created_at >= date_trunc('month', now());
$$;

-- ---------------------------------------------------------------- fulltextsök (11.3, FR-072)
-- Genererade kolumner håller indexet aktuellt direkt vid varje ändring.
alter table objects add column if not exists search tsvector generated always as (
  to_tsvector('swedish', coalesce(title,'') || ' ' || coalesce(category,'') || ' ' || coalesce(material,'') || ' ' || coalesce(description,''))) stored;
alter table persons add column if not exists search tsvector generated always as (to_tsvector('swedish', coalesce(name,''))) stored;
alter table events add column if not exists search tsvector generated always as (to_tsvector('swedish', coalesce(summary,'') || ' ' || coalesce(notes,''))) stored;
alter table observations add column if not exists search tsvector generated always as (to_tsvector('swedish', coalesce(text,''))) stored;
alter table listings add column if not exists search tsvector generated always as (to_tsvector('swedish', coalesce(title,'') || ' ' || coalesce(description,''))) stored;
alter table story_notes add column if not exists search tsvector generated always as (to_tsvector('swedish', coalesce(text,''))) stored;
create index on objects using gin (search);
create index on persons using gin (search);
create index on events using gin (search);
create index on observations using gin (search);
create index on listings using gin (search);
create index on story_notes using gin (search);

-- Prefixsökning per ord: "mässingshandtagen" hittar "Mässingshandtag".
create or replace function vreta_tsquery(q text) returns tsquery
language sql immutable as $$
  select nullif(string_agg(quote_literal(lexeme) || ':*', ' & '), '')::tsquery
    from unnest(to_tsvector('swedish', q)) as t(lexeme, positions, weights);
$$;

-- Sökning med användarens egna rättigheter (security invoker): RLS filtrerar varje tabell.
create or replace function search_vreta(q text, max_hits int default 20)
returns table (entity_type text, id uuid, title text, rank real)
language sql stable security invoker set search_path = public as $$
  with query as (select vreta_tsquery(q) as tq)
  select * from (
    select 'object'::text, o.id, o.title, ts_rank(o.search, query.tq) from objects o, query where query.tq is not null and o.search @@ query.tq and o.archived_at is null
    union all
    select 'person', p.id, p.name, ts_rank(p.search, query.tq) from persons p, query where query.tq is not null and p.search @@ query.tq and p.archived_at is null
    union all
    select 'event', e.id, e.summary, ts_rank(e.search, query.tq) from events e, query where query.tq is not null and e.search @@ query.tq
    union all
    select 'observation', ob.id, ob.text, ts_rank(ob.search, query.tq) from observations ob, query where query.tq is not null and ob.search @@ query.tq
    union all
    select 'listing', l.id, l.title, ts_rank(l.search, query.tq) from listings l, query where query.tq is not null and l.search @@ query.tq
  ) hits
  order by 4 desc
  limit max_hits;
$$;

-- ---------------------------------------------------------------- index för främmande nycklar och vanliga filter (NFR-004, NFR-012)
create index if not exists objects_site_status on objects (site_id, status) where archived_at is null;
create index if not exists objects_storage on objects (storage_location_id);
create index if not exists objects_zone on objects (zone_id);
create index if not exists acquisitions_object on acquisitions (object_id);
create index if not exists acquisitions_person on acquisitions (person_id);
create index if not exists events_site_time on events (site_id, occurred_at desc);
create index if not exists event_links_event on event_links (event_id);
create index if not exists story_notes_entity on story_notes (entity_type, entity_id);
create index if not exists content_items_source on content_items (source_type, source_id);
create index if not exists tasks_open on tasks (site_id, due) where status in ('open', 'in_progress');
create index if not exists interactions_person on interactions (person_id);
create index if not exists interactions_follow on interactions (site_id, follow_up) where follow_up is not null;
create index if not exists pickups_date on pickups (site_id, scheduled_date);
create index if not exists pickup_items_pickup on pickup_items (pickup_id);
create index if not exists checklist_items_pickup on checklist_items (pickup_id);
create index if not exists usage_events_object on usage_events (object_id);
create index if not exists observations_zone on observations (zone_id);
create index if not exists listings_object on listings (object_id);
create index if not exists channel_posts_listing on channel_posts (listing_id);
create index if not exists leads_listing on leads (listing_id, queue_position);
create index if not exists leads_new on leads (site_id) where status = 'new';
create index if not exists disposals_object on disposals (object_id);
create index if not exists disposals_person on disposals (person_id);
create index if not exists contributions_person on contributions (person_id, occurred_at desc);
create index if not exists reciprocity_person on reciprocity_entries (person_id);
create index if not exists audit_site_time on audit_entries (site_id, at desc);

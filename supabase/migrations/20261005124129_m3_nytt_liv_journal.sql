-- VRETA R1 · Milstolpe M3: nytt liv, partier, observationer, beslut och Vretakartan
-- Spec: docs/spec-r1.md avsnitt 4.5, 4.9, 5.1, 6.3, 7.6.

create extension if not exists postgis;

-- ---------------------------------------------------------------- geometri
-- Geometri lagras som GeoJSON i WGS 84 (jsonb, det klienten läser och skriver) med en
-- genererad PostGIS-kolumn för rumsliga frågor. Källprojektionen för grundbilder sparas separat.
alter table zones add column geom jsonb;
alter table zones add column geom_pg geometry generated always as
  (case when geom is null then null else st_setsrid(st_geomfromgeojson(geom::text), 4326) end) stored;
alter table structures add column geom jsonb;
alter table structures add column geom_pg geometry generated always as
  (case when geom is null then null else st_setsrid(st_geomfromgeojson(geom::text), 4326) end) stored;
create index on zones using gist (geom_pg);
create index on structures using gist (geom_pg);

-- Vilken zon ligger en punkt i? (AC-23, "Här"-knappen)
create or replace function zone_at(p_site uuid, p_lon double precision, p_lat double precision) returns uuid
language sql stable as $$
  select id from zones
   where site_id = p_site and archived_at is null and geom_pg is not null
     and st_contains(geom_pg, st_setsrid(st_makepoint(p_lon, p_lat), 4326))
   order by st_area(geom_pg) asc
   limit 1
$$;

-- ---------------------------------------------------------------- grundbilder och överlägg (7.6)
create table map_layers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('base', 'overlay')),
  name text not null,
  taken_on date,
  image_path text not null,            -- bucket maps (privat)
  corners jsonb not null,              -- [[lon,lat] övre vänster, övre höger, nedre höger, nedre vänster]
  source_crs text not null default '',
  opacity real not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (jsonb_array_length(corners) = 4)
);
insert into storage.buckets (id, name, public) values ('maps', 'maps', false) on conflict do nothing;

-- ---------------------------------------------------------------- partier (6.3, INV-11)
create table batch_allocations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  object_id uuid not null references objects(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  status object_status not null,
  storage_location_id uuid references storage_locations(id) on delete set null,
  zone_id uuid references zones(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alloc_in_use_has_place check (status <> 'in_use' or zone_id is not null or structure_id is not null)
);
create index on batch_allocations (object_id);

-- Summan av fördelningen ska alltid vara partiets totala kvantitet (kontrolleras vid commit).
create or replace function check_allocation_sum() returns trigger
language plpgsql as $$
declare v_obj uuid := coalesce(new.object_id, old.object_id);
begin
  if exists (select 1 from batch_allocations where object_id = v_obj)
     and (select sum(quantity) from batch_allocations where object_id = v_obj) <> (select quantity from objects where id = v_obj) then
    raise exception 'Fördelningen av partiet stämmer inte med totalen (INV-11)' using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger allocation_sum after insert or update or delete on batch_allocations
  deferrable initially deferred for each row execute function check_allocation_sum();

-- Partiets sammanfattade status: den största icke-avslutade delen, annars den största delen.
create or replace function batch_summary_status(p_object uuid) returns object_status
language sql stable as $$
  select status from batch_allocations where object_id = p_object
   order by (status in ('declined','lost','sold','donated','exchanged','discarded')) asc, quantity desc, updated_at desc
   limit 1
$$;

-- Partiets sammanfattning på objektet: status och plats från den största delen.
create or replace function sync_batch(p_object uuid) returns void
language sql as $$
  update objects o set status = a.status, zone_id = a.zone_id, structure_id = a.structure_id, storage_location_id = a.storage_location_id
    from (select * from batch_allocations where object_id = p_object
           order by (status in ('declined','lost','sold','donated','exchanged','discarded')) asc, quantity desc, updated_at desc limit 1) a
   where o.id = p_object
$$;

-- Statustriggern tillåter en härledd status för partier (ingen annan kan sätta den).
create or replace function objects_on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_override boolean := coalesce(current_setting('vreta.override', true), '') = 'on';
  v_derived boolean := new.is_batch and exists (select 1 from batch_allocations where object_id = new.id)
                       and new.status = batch_summary_status(new.id);
  v_event uuid;
begin
  if new.status is distinct from old.status then
    if not v_derived and not exists (select 1 from object_transitions where from_status = old.status and to_status = new.status) then
      if not (v_override and is_owner(new.site_id)) then
        raise exception 'Otillåten statusändring: % → %', old.status, new.status using errcode = 'check_violation';
      end if;
    end if;
    insert into events (site_id, event_type, summary, created_by)
      values (new.site_id, 'object.status_changed', format('%s: %s → %s', new.title, old.status, new.status), coalesce(auth.uid(), new.created_by))
      returning id into v_event;
    insert into event_links (site_id, event_id, entity_type, entity_id) values (new.site_id, v_event, 'object', new.id);
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
      values (new.site_id, auth.uid(), case when v_override then 'status_override' when v_derived then 'status_derived' else 'status_change' end,
              'object', new.id, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Skapa en första fördelning för ett parti om den saknas.
create or replace function ensure_allocations(p_object uuid) returns void
language sql as $$
  insert into batch_allocations (site_id, object_id, quantity, status, storage_location_id, zone_id, structure_id)
  select site_id, id, quantity, status, storage_location_id, zone_id, structure_id from objects
   where id = p_object and is_batch and not exists (select 1 from batch_allocations where object_id = p_object)
$$;

-- ---------------------------------------------------------------- nytt liv (4.5)
create type usage_type as enum ('installed','planted','built_in','renovated','reused','moved','removed','replanted','decommissioned');

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  object_id uuid not null references objects(id) on delete cascade,
  allocation_id uuid references batch_allocations(id) on delete set null,
  type usage_type not null,
  occurred_at timestamptz not null default now(),
  zone_id uuid references zones(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  quantity numeric,
  project text not null default '',
  note text not null default '',
  geom jsonb,                           -- punkt i WGS 84 om "Här" användes
  event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

-- Registrera nytt liv: hela objektet eller en del av ett parti (AC-04, AC-05).
-- p_input: { type, zone_id, structure_id, quantity, project, note, occurred_at, geom, from_allocation_id }
create or replace function record_usage(p_object uuid, p_input jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  o objects%rowtype;
  v_type usage_type := (p_input->>'type')::usage_type;
  v_zone uuid := nullif(p_input->>'zone_id','')::uuid;
  v_struct uuid := nullif(p_input->>'structure_id','')::uuid;
  v_qty numeric := nullif(p_input->>'quantity','')::numeric;
  v_from uuid := nullif(p_input->>'from_allocation_id','')::uuid;
  v_src batch_allocations%rowtype;
  v_alloc uuid;
  v_event uuid;
  v_place text;
  v_verb text;
begin
  select * into o from objects where id = p_object;
  if o.id is null then raise exception 'Objektet finns inte'; end if;
  if not is_writer(o.site_id) then raise exception 'Saknar rätt att registrera' using errcode = 'insufficient_privilege'; end if;
  if v_type <> 'removed' and v_zone is null and v_struct is null then
    raise exception 'Nytt liv kräver plats (zon eller byggnad)' using errcode = 'check_violation';
  end if;

  if v_type <> 'removed' and o.is_batch and v_qty is not null and v_qty < o.quantity then
    perform ensure_allocations(p_object);
    if v_from is null then
      select * into v_src from batch_allocations where object_id = p_object
         and status in ('collected','stored','processing','in_use','listed') order by (status = 'stored') desc, quantity desc limit 1;
    else
      select * into v_src from batch_allocations where id = v_from and object_id = p_object;
    end if;
    if v_src.id is null or v_src.quantity < v_qty then
      raise exception 'Det finns inte % % att använda', v_qty, o.unit using errcode = 'check_violation';
    end if;
    if not exists (select 1 from object_transitions where from_status = v_src.status and to_status = 'in_use') then
      raise exception 'Delen kan inte användas från status %', v_src.status using errcode = 'check_violation';
    end if;
    if v_src.quantity = v_qty then
      update batch_allocations set status = 'in_use', zone_id = v_zone, structure_id = v_struct, storage_location_id = null, updated_at = now()
       where id = v_src.id returning id into v_alloc;
    else
      update batch_allocations set quantity = quantity - v_qty, updated_at = now() where id = v_src.id;
      insert into batch_allocations (site_id, object_id, quantity, status, zone_id, structure_id)
      values (o.site_id, p_object, v_qty, 'in_use', v_zone, v_struct) returning id into v_alloc;
    end if;
    perform sync_batch(p_object);
  elsif v_type = 'removed' then
    null; -- demontering hanteras av store_object / changeStatus
  else
    update objects set status = 'in_use', zone_id = v_zone, structure_id = v_struct, storage_location_id = null where id = p_object;
    update batch_allocations set status = 'in_use', zone_id = v_zone, structure_id = v_struct, storage_location_id = null, updated_at = now()
     where object_id = p_object;
  end if;

  select coalesce((select name from zones where id = v_zone), (select name from structures where id = v_struct), '') into v_place;
  v_verb := case v_type when 'installed' then 'Installerad' when 'planted' then 'Planterad' when 'built_in' then 'Inbyggd'
    when 'renovated' then 'Renoverad' when 'reused' then 'Återanvänd' when 'moved' then 'Flyttad' when 'removed' then 'Demonterad'
    when 'replanted' then 'Omplanterad' else 'Tagen ur bruk' end;

  insert into events (site_id, event_type, occurred_at, summary, notes, story_worthy)
  values (o.site_id, 'usage.' || v_type, coalesce(nullif(p_input->>'occurred_at','')::timestamptz, now()),
          format('%s: %s%s%s', v_verb, case when v_qty is not null and o.is_batch then v_qty || ' ' || o.unit || ' ' else '' end,
                 lower(o.title), case when v_place <> '' then ' – ' || v_place else '' end),
          coalesce(p_input->>'note',''), true)
  returning id into v_event;
  insert into event_links (site_id, event_id, entity_type, entity_id) values (o.site_id, v_event, 'object', p_object);
  if v_zone is not null then insert into event_links (site_id, event_id, entity_type, entity_id, role) values (o.site_id, v_event, 'zone', v_zone, 'place'); end if;
  if v_struct is not null then insert into event_links (site_id, event_id, entity_type, entity_id, role) values (o.site_id, v_event, 'structure', v_struct, 'place'); end if;

  insert into usage_events (site_id, object_id, allocation_id, type, occurred_at, zone_id, structure_id, quantity, project, note, geom, event_id)
  values (o.site_id, p_object, v_alloc, v_type, coalesce(nullif(p_input->>'occurred_at','')::timestamptz, now()), v_zone, v_struct, v_qty,
          coalesce(p_input->>'project',''), coalesce(p_input->>'note',''), p_input->'geom', v_event);
  return v_event;
end $$;

-- Flytta en del av ett parti till lager (demontering eller ompackning).
create or replace function store_allocation(p_allocation uuid, p_quantity numeric, p_location uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare a batch_allocations%rowtype; o objects%rowtype;
begin
  select * into a from batch_allocations where id = p_allocation;
  select * into o from objects where id = a.object_id;
  if not is_writer(o.site_id) then raise exception 'Saknar rätt att registrera' using errcode = 'insufficient_privilege'; end if;
  if p_quantity > a.quantity then raise exception 'För stort antal' using errcode = 'check_violation'; end if;
  if not exists (select 1 from object_transitions where from_status = a.status and to_status = 'stored') and a.status <> 'stored' then
    raise exception 'Delen kan inte läggas i lager från status %', a.status using errcode = 'check_violation';
  end if;
  if p_quantity = a.quantity then
    update batch_allocations set status = 'stored', storage_location_id = p_location, zone_id = null, structure_id = null, updated_at = now() where id = a.id;
  else
    update batch_allocations set quantity = quantity - p_quantity, updated_at = now() where id = a.id;
    insert into batch_allocations (site_id, object_id, quantity, status, storage_location_id)
    values (a.site_id, a.object_id, p_quantity, 'stored', p_location);
  end if;
  perform sync_batch(o.id);
end $$;

-- ---------------------------------------------------------------- observationer och beslut (4.9)
create table observations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null,                   -- vatten, blomning, skada, skörd, djurliv, byggnation, väder, annat
  text text not null,
  zone_id uuid references zones(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  object_id uuid references objects(id) on delete set null,
  geom jsonb,
  follow_up date,
  visibility visibility not null default 'shareable',
  event_id uuid references events(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  question text not null,
  options text not null default '',
  choice text not null,
  rationale text not null default '',
  outcome text not null default '',
  zone_id uuid references zones(id) on delete set null,
  object_id uuid references objects(id) on delete set null,
  visibility visibility not null default 'internal',
  event_id uuid references events(id) on delete set null,
  decided_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Observation och beslut skapar en händelse som syns i plats-, zon- och objektjournal (INV-01).
create or replace function journal_link() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_event uuid;
  v_type text;
  v_summary text;
  v_notes text := '';
  v_vis visibility;
  v_at timestamptz;
  v_story boolean;
  v_zone uuid;
  v_object uuid;
  r jsonb := to_jsonb(new);
begin
  if tg_table_name = 'observations' then
    v_type := 'observation.' || (r->>'kind'); v_summary := r->>'text'; v_at := (r->>'occurred_at')::timestamptz; v_story := true;
  else
    v_type := 'decision'; v_summary := format('Beslut: %s – %s', r->>'question', r->>'choice');
    v_notes := coalesce(r->>'rationale', ''); v_at := (r->>'decided_on')::timestamptz; v_story := false;
  end if;
  v_vis := (r->>'visibility')::visibility;
  v_zone := nullif(r->>'zone_id', '')::uuid;
  v_object := nullif(r->>'object_id', '')::uuid;
  insert into events (site_id, event_type, summary, notes, visibility, story_worthy, occurred_at)
  values (new.site_id, v_type, v_summary, v_notes, v_vis, v_story, coalesce(v_at, now()))
  returning id into v_event;
  insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, v_event, 'site', new.site_id, 'place');
  if v_zone is not null then insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, v_event, 'zone', v_zone, 'place'); end if;
  if v_object is not null then insert into event_links (site_id, event_id, entity_type, entity_id) values (new.site_id, v_event, 'object', v_object); end if;
  new.event_id := v_event;
  return new;
end $$;
create trigger observations_journal before insert on observations for each row execute function journal_link();
create trigger decisions_journal before insert on decisions for each row execute function journal_link();

-- Platsjournal: händelser med platslänk för upptäckter, hämtningar och statusbyten också.
create or replace function link_site_on_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type = 'object' and not exists (
      select 1 from event_links where event_id = new.event_id and entity_type = 'site') then
    insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, new.event_id, 'site', new.site_id, 'place');
  end if;
  return new;
end $$;
create trigger event_links_site after insert on event_links for each row execute function link_site_on_event();

-- ---------------------------------------------------------------- RLS
alter table map_layers enable row level security;
alter table batch_allocations enable row level security;
alter table usage_events enable row level security;
alter table observations enable row level security;
alter table decisions enable row level security;

create policy map_layers_read on map_layers for select to authenticated using (is_member(site_id));
create policy map_layers_write on map_layers for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));
create policy allocations_read on batch_allocations for select to authenticated using (is_member(site_id));
create policy allocations_write on batch_allocations for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));
create policy usage_read on usage_events for select to authenticated using (is_member(site_id));
create policy usage_insert on usage_events for insert to authenticated with check (is_writer(site_id));
create policy observations_read on observations for select to authenticated
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by)));
create policy observations_insert on observations for insert to authenticated with check (is_writer(site_id));
create policy observations_update on observations for update to authenticated using (is_writer(site_id));
create policy decisions_read on decisions for select to authenticated
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by)));
create policy decisions_insert on decisions for insert to authenticated with check (is_writer(site_id));
create policy decisions_update on decisions for update to authenticated using (is_writer(site_id));

-- Kartor visar fastighetens läge: bara medlemmar läser, skrivare laddar upp (12.6).
create policy maps_read on storage.objects for select to authenticated
  using (bucket_id = 'maps' and is_member(((storage.foldername(name))[1])::uuid));
create policy maps_write on storage.objects for insert to authenticated
  with check (bucket_id = 'maps' and is_writer(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------- partier och statusbyten på hela objektet
-- Har partiet en enda del följer den med objektets status och plats. Har det flera delar
-- ändras status per del (record_usage, store_allocation), aldrig direkt på objektet.
create or replace function objects_sync_allocations() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if new.is_batch and (new.status, new.zone_id, new.structure_id, new.storage_location_id)
       is distinct from (old.status, old.zone_id, old.structure_id, old.storage_location_id) then
    select count(*) into v_count from batch_allocations where object_id = new.id;
    if v_count = 1 then
      update batch_allocations set status = new.status, zone_id = new.zone_id, structure_id = new.structure_id,
             storage_location_id = new.storage_location_id, updated_at = now()
       where object_id = new.id;
    elsif v_count > 1 and new.status is distinct from batch_summary_status(new.id) then
      raise exception 'Partiet är uppdelat – ändra status per del' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger objects_allocations after update on objects for each row execute function objects_sync_allocations();

-- Lägg i lager: för ett uppdelat parti flyttas alla delar som kan lagras.
create or replace function store_object(p_object uuid, p_location uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_status object_status; v_multi boolean;
begin
  select status, is_batch and (select count(*) from batch_allocations where object_id = p_object) > 1
    into v_status, v_multi from objects where id = p_object;
  if v_multi then
    update batch_allocations set status = 'stored', storage_location_id = p_location, zone_id = null, structure_id = null, updated_at = now()
     where object_id = p_object and status in ('collected','stored','processing','in_use','listed','lent');
    perform sync_batch(p_object);
  elsif v_status = 'stored' then
    update objects set storage_location_id = p_location where id = p_object;
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, after)
      select site_id, auth.uid(), 'moved_in_storage', 'object', id, jsonb_build_object('storage_location_id', p_location) from objects where id = p_object;
  else
    update objects set status = 'stored', storage_location_id = p_location, zone_id = null, structure_id = null where id = p_object;
  end if;
end $$;

-- VRETA R1 · M7: behov i projekt och projektytor på Vretakartan
-- Ett projekt har behov ("1 500 tegel"). Behovet fylls av saker eller bidrag (NeedFulfillment), och hur
-- långt det kommit räknas fram ur summan ("1 020 av 1 500 tegel"). Ett behov kan efterlysas med en annons.
-- Spec: docs/spec-r1.md avsnitt 6.4 (FR-057).

-- ---------------------------------------------------------------- projektytor
alter table projects add column geom jsonb;
alter table projects add column geom_pg geometry generated always as
  (case when geom is null then null else st_setsrid(st_geomfromgeojson(geom::text), 4326) end) stored;
create index on projects using gist (geom_pg);

-- ---------------------------------------------------------------- behov
create type need_status as enum ('open', 'dropped');

create table needs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  quantity numeric check (quantity is null or quantity > 0),   -- tomt = "några", uppfylls av första bidraget
  unit text not null default 'st',
  notes text not null default '',
  status need_status not null default 'open',
  listing_id uuid references listings(id) on delete set null,  -- efterlysning
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index needs_project_idx on needs (project_id);

create table need_fulfillments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  need_id uuid not null references needs(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  object_id uuid references objects(id) on delete set null,
  contribution_id uuid references contributions(id) on delete set null,
  note text not null default '',
  occurred_at timestamptz not null default now(),
  event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);
create index need_fulfillments_need_idx on need_fulfillments (need_id);

-- Hur långt ett behov kommit: summan av det som fyllts
create or replace function need_fulfilled(p_need uuid) returns numeric
language sql stable as $$ select coalesce(sum(quantity), 0) from need_fulfillments where need_id = p_need $$;

-- Varje uppfyllelse blir en händelse i projektets journal: "Tegel till orangeriet: 250 av 1 500 st"
create or replace function need_fulfillments_journal() returns trigger
language plpgsql security invoker set search_path = public as $$
declare n needs%rowtype; v_total numeric; v_event uuid; v_from text;
begin
  select * into n from needs where id = new.need_id;
  if n.site_id <> new.site_id then raise exception 'Behovet hör till en annan plats' using errcode = 'check_violation'; end if;
  v_total := need_fulfilled(n.id) + new.quantity;
  select coalesce((select title from objects where id = new.object_id),
                  (select p.name from contributions c join persons p on p.id = c.person_id where c.id = new.contribution_id), '') into v_from;
  insert into events (site_id, event_type, summary, notes, story_worthy, occurred_at)
  values (new.site_id, case when n.quantity is not null and v_total >= n.quantity then 'need.covered' else 'need.fulfilled' end,
          format('%s: %s%s', n.title,
                 case when n.quantity is null then trim(to_char(v_total, 'FM999999990.##')) || ' ' || n.unit
                      else trim(to_char(v_total, 'FM999999990.##')) || ' av ' || trim(to_char(n.quantity, 'FM999999990.##')) || ' ' || n.unit end,
                 case when v_from <> '' then ' – ' || v_from else '' end),
          new.note, n.quantity is not null and v_total >= n.quantity, new.occurred_at)
  returning id into v_event;
  insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, v_event, 'project', n.project_id, 'project');
  insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, v_event, 'site', new.site_id, 'place');
  if new.object_id is not null then insert into event_links (site_id, event_id, entity_type, entity_id) values (new.site_id, v_event, 'object', new.object_id); end if;
  new.event_id := v_event;
  return new;
end $$;
create trigger need_fulfillments_journal before insert on need_fulfillments for each row execute function need_fulfillments_journal();

create or replace function needs_touch() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger needs_touch before update on needs for each row execute function needs_touch();

-- ---------------------------------------------------------------- radnivåsäkerhet
alter table needs enable row level security;
alter table need_fulfillments enable row level security;
create policy needs_read on needs for select to authenticated using (is_member(site_id));
create policy needs_insert on needs for insert to authenticated with check (is_writer(site_id));
create policy needs_update on needs for update to authenticated using (is_writer(site_id));
create policy need_fulfillments_read on need_fulfillments for select to authenticated using (is_member(site_id));
create policy need_fulfillments_insert on need_fulfillments for insert to authenticated with check (is_writer(site_id));
-- Felregistreringar kan tas bort; händelsen ligger kvar i journalen
create policy need_fulfillments_delete on need_fulfillments for delete to authenticated using (is_writer(site_id));

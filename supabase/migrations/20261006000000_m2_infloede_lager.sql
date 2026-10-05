-- VRETA R1 · Milstolpe M2: inflöde och lager
-- Organisationer, kontakthistorik, anskaffningsflöde, hämtningar med checklistor,
-- lagerplatser med QR. Spec: docs/spec-r1.md avsnitt 4.2–4.4, 5.2–5.3, 10.

create type pickup_status as enum ('planned', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type receipt_status as enum ('received', 'partial', 'deviation');

-- ---------------------------------------------------------------- organisationer
create table organizations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  kind text not null default '',
  locality text not null default '',
  roles text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table organization_private (
  organization_id uuid primary key references organizations(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  contact text not null default '',
  notes text not null default '',
  created_by uuid not null default auth.uid()
);
alter table persons add column organization_id uuid references organizations(id) on delete set null;
alter table persons add column how_we_met text not null default '';
alter table acquisitions add column organization_id uuid references organizations(id) on delete set null;

-- ---------------------------------------------------------------- kontakthistorik (alltid privat, 10.3)
create table interactions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  person_id uuid references persons(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  channel text not null check (channel in ('samtal','meddelande','mote','mejl','annat')),
  occurred_at timestamptz not null default now(),
  summary text not null,
  follow_up date,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (person_id is not null or organization_id is not null)
);

-- ---------------------------------------------------------------- anskaffningsflöde (5.2)
create table acquisition_transitions (
  from_status acquisition_status not null,
  to_status acquisition_status not null,
  primary key (from_status, to_status)
);
insert into acquisition_transitions values
  ('lead','contacted'),('lead','negotiating'),('lead','agreed'),('lead','declined'),('lead','lost'),
  ('contacted','negotiating'),('contacted','agreed'),('contacted','declined'),('contacted','lost'),
  ('negotiating','agreed'),('negotiating','declined'),('negotiating','lost'),
  ('agreed','received'),('agreed','declined'),('agreed','lost'),
  ('received','settled');

create or replace function acquisitions_on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if not exists (select 1 from acquisition_transitions where from_status = old.status and to_status = new.status) then
      raise exception 'Otillåten ändring av anskaffning: % → %', old.status, new.status using errcode = 'check_violation';
    end if;
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
    values (new.site_id, auth.uid(), 'acquisition_status', 'acquisition', new.id,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger acquisitions_status before update on acquisitions for each row execute function acquisitions_on_status_change();

-- ---------------------------------------------------------------- lagerplatser (4.4)
create table storage_locations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  parent_id uuid references storage_locations(id) on delete restrict,
  structure_id uuid references structures(id) on delete set null,
  name text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
alter table objects add column storage_location_id uuid references storage_locations(id) on delete set null;

-- Sökväg som text, t.ex. "Garaget → Vänster vägg → Hylla 3"
create or replace function storage_path(p_location uuid) returns text
language sql stable as $$
  with recursive up as (
    select id, parent_id, name, 0 as depth from storage_locations where id = p_location
    union all
    select s.id, s.parent_id, s.name, up.depth + 1 from storage_locations s join up on s.id = up.parent_id
  )
  select string_agg(name, ' → ' order by depth desc) from up
$$;

-- Lägg i lager: status stored + lagerplats, en transaktion (statustriggern skapar händelse och audit).
create or replace function store_object(p_object uuid, p_location uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_status object_status;
begin
  select status into v_status from objects where id = p_object;
  if v_status = 'stored' then
    update objects set storage_location_id = p_location where id = p_object;
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, after)
      select site_id, auth.uid(), 'moved_in_storage', 'object', id, jsonb_build_object('storage_location_id', p_location) from objects where id = p_object;
  else
    update objects set status = 'stored', storage_location_id = p_location, zone_id = null, structure_id = null where id = p_object;
  end if;
end $$;

-- ---------------------------------------------------------------- hämtningar (4.3, 5.3)
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  items text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table pickups (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  acquisition_id uuid references acquisitions(id) on delete set null,
  person_id uuid references persons(id) on delete set null,
  title text not null,
  scheduled_date date,
  window_from time,
  window_to time,
  resources text[] not null default '{}',
  status pickup_status not null default 'planned',
  safety_note text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
-- Adressen är privat (6.2)
create table pickup_private (
  pickup_id uuid primary key references pickups(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  address text not null default '',
  created_by uuid not null default auth.uid()
);
create table pickup_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  pickup_id uuid not null references pickups(id) on delete cascade,
  object_id uuid not null references objects(id) on delete cascade,
  receipt receipt_status,
  note text not null default '',
  unique (pickup_id, object_id)
);
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  pickup_id uuid not null references pickups(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  position int not null default 0
);

create table pickup_transitions (from_status pickup_status, to_status pickup_status, primary key (from_status, to_status));
insert into pickup_transitions values
  ('planned','confirmed'),('planned','in_progress'),('planned','cancelled'),
  ('confirmed','in_progress'),('confirmed','cancelled'),
  ('in_progress','completed');

create or replace function pickups_on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if not exists (select 1 from pickup_transitions where from_status = old.status and to_status = new.status) then
      raise exception 'Otillåten ändring av hämtning: % → %', old.status, new.status using errcode = 'check_violation';
    end if;
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
    values (new.site_id, auth.uid(), 'pickup_status', 'pickup', new.id, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger pickups_status before update on pickups for each row execute function pickups_on_status_change();

-- Skapa hämtning från en överenskommen anskaffning (FR-013)
create or replace function create_pickup(p_site uuid, p_input jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_pickup uuid;
  v_items text[];
  v_obj uuid;
  i int := 0;
  lbl text;
begin
  if not is_writer(p_site) then raise exception 'Saknar rätt att registrera' using errcode = 'insufficient_privilege'; end if;
  insert into pickups (site_id, acquisition_id, person_id, title, scheduled_date, window_from, window_to, resources, safety_note)
  values (p_site, nullif(p_input->>'acquisition_id','')::uuid, nullif(p_input->>'person_id','')::uuid, p_input->>'title',
          nullif(p_input->>'scheduled_date','')::date, nullif(p_input->>'window_from','')::time, nullif(p_input->>'window_to','')::time,
          coalesce(array(select jsonb_array_elements_text(p_input->'resources')), '{}'), coalesce(p_input->>'safety_note',''))
  returning id into v_pickup;
  insert into pickup_private (pickup_id, site_id, address) values (v_pickup, p_site, coalesce(p_input->>'address',''));
  for v_obj in select (jsonb_array_elements_text(coalesce(p_input->'object_ids','[]'::jsonb)))::uuid loop
    insert into pickup_items (site_id, pickup_id, object_id) values (p_site, v_pickup, v_obj);
    update objects set status = 'pickup_planned' where id = v_obj and status in ('reserved');
  end loop;
  select items into v_items from checklist_templates where id = nullif(p_input->>'template_id','')::uuid;
  foreach lbl in array coalesce(v_items, '{}') loop
    insert into checklist_items (site_id, pickup_id, label, position) values (p_site, v_pickup, lbl, i);
    i := i + 1;
  end loop;
  return v_pickup;
end $$;

-- Avsluta hämtning (AC-03): kvittering per objekt, status, händelse och lagerplats i en transaktion.
-- p_receipts: [{object_id, receipt, note}]
create or replace function complete_pickup(p_pickup uuid, p_receipts jsonb, p_location uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_site uuid;
  v_title text;
  v_person uuid;
  v_acq uuid;
  v_event uuid;
  r jsonb;
  v_obj uuid;
  v_status object_status;
begin
  select site_id, title, person_id, acquisition_id into v_site, v_title, v_person, v_acq from pickups where id = p_pickup;
  if v_site is null then raise exception 'Hämtningen finns inte'; end if;
  if not is_writer(v_site) then raise exception 'Saknar rätt att registrera' using errcode = 'insufficient_privilege'; end if;

  for r in select * from jsonb_array_elements(p_receipts) loop
    update pickup_items set receipt = (r->>'receipt')::receipt_status, note = coalesce(r->>'note','')
     where pickup_id = p_pickup and object_id = (r->>'object_id')::uuid;
  end loop;
  if exists (select 1 from pickup_items where pickup_id = p_pickup and receipt is null) then
    raise exception 'Alla objekt måste kvitteras innan hämtningen avslutas' using errcode = 'check_violation';
  end if;

  update pickups set status = 'in_progress' where id = p_pickup and status in ('planned','confirmed');
  update pickups set status = 'completed', completed_at = now() where id = p_pickup;

  insert into events (site_id, event_type, summary, story_worthy)
  values (v_site, 'pickup.completed', format('Hämtning klar: %s', v_title), true) returning id into v_event;
  insert into event_links (site_id, event_id, entity_type, entity_id) values (v_site, v_event, 'pickup', p_pickup);
  if v_person is not null then
    insert into event_links (site_id, event_id, entity_type, entity_id, role) values (v_site, v_event, 'person', v_person, 'counterpart');
  end if;

  for v_obj in select object_id from pickup_items where pickup_id = p_pickup and receipt in ('received','partial') loop
    insert into event_links (site_id, event_id, entity_type, entity_id) values (v_site, v_event, 'object', v_obj);
    select status into v_status from objects where id = v_obj;
    if v_status in ('discovered','contacted','reserved','pickup_planned') then
      update objects set status = 'collected' where id = v_obj;
    end if;
    if p_location is not null then perform store_object(v_obj, p_location); end if;
  end loop;

  if v_acq is not null then
    update acquisitions set status = 'agreed' where id = v_acq and status in ('lead','contacted','negotiating');
    update acquisitions set status = 'received' where id = v_acq and status = 'agreed';
  end if;
end $$;

-- ---------------------------------------------------------------- standardmallar för checklistor
create or replace function default_checklists(p_site uuid) returns void
language sql security definer set search_path = public as $$
  insert into checklist_templates (site_id, name, items, created_by)
  select p_site, t.name, t.items, (select created_by from sites where id = p_site) from (values
    ('Stora byggnadsdelar', array['Släp','Spännband','Filtar och skydd','Bärhjälp','Handskar','Kofot och skruvdragare']),
    ('Fönster och glas', array['Släp eller skåpbil','Filtar mellan fönstren','Spännband','Bärhjälp','Handskar']),
    ('Växter', array['Säckar eller hinkar','Spade','Vatten','Presenning','Handskar']),
    ('Småsaker', array['Lådor','Tidningspapper','Märkpenna'])
  ) as t(name, items)
  where not exists (select 1 from checklist_templates where site_id = p_site)
$$;
create or replace function sites_after_insert() returns trigger language plpgsql as $$
begin perform default_checklists(new.id); return new; end $$;
create trigger sites_default_checklists after insert on sites for each row execute function sites_after_insert();
select default_checklists(id) from sites;

-- ---------------------------------------------------------------- RLS
alter table organizations enable row level security;
alter table organization_private enable row level security;
alter table interactions enable row level security;
alter table acquisition_transitions enable row level security;
alter table storage_locations enable row level security;
alter table checklist_templates enable row level security;
alter table pickups enable row level security;
alter table pickup_private enable row level security;
alter table pickup_items enable row level security;
alter table checklist_items enable row level security;
alter table pickup_transitions enable row level security;

create policy acq_tr_read on acquisition_transitions for select to authenticated using (true);
create policy pickup_tr_read on pickup_transitions for select to authenticated using (true);

create policy organizations_read on organizations for select to authenticated using (is_member(site_id));
create policy organizations_insert on organizations for insert to authenticated with check (is_writer(site_id));
create policy organizations_update on organizations for update to authenticated using (is_writer(site_id));
create policy organization_private_read on organization_private for select to authenticated using (sees_private(site_id, created_by));
create policy organization_private_insert on organization_private for insert to authenticated with check (is_writer(site_id));
create policy organization_private_update on organization_private for update to authenticated using (sees_private(site_id, created_by));

create policy interactions_read on interactions for select to authenticated using (sees_private(site_id, created_by));
create policy interactions_insert on interactions for insert to authenticated with check (is_writer(site_id));
create policy interactions_update on interactions for update to authenticated using (sees_private(site_id, created_by));

create policy storage_locations_read on storage_locations for select to authenticated using (is_member(site_id));
create policy storage_locations_insert on storage_locations for insert to authenticated with check (is_writer(site_id));
create policy storage_locations_update on storage_locations for update to authenticated using (is_writer(site_id));

create policy checklist_templates_read on checklist_templates for select to authenticated using (is_member(site_id));
create policy checklist_templates_write on checklist_templates for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));

create policy pickups_read on pickups for select to authenticated using (is_member(site_id));
create policy pickups_insert on pickups for insert to authenticated with check (is_writer(site_id));
create policy pickups_update on pickups for update to authenticated using (is_writer(site_id));
create policy pickup_private_read on pickup_private for select to authenticated using (is_writer(site_id));
create policy pickup_private_insert on pickup_private for insert to authenticated with check (is_writer(site_id));
create policy pickup_private_update on pickup_private for update to authenticated using (is_writer(site_id));
create policy pickup_items_read on pickup_items for select to authenticated using (is_member(site_id));
create policy pickup_items_write on pickup_items for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));
create policy checklist_items_read on checklist_items for select to authenticated using (is_member(site_id));
create policy checklist_items_write on checklist_items for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));

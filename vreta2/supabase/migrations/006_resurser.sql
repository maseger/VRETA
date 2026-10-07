-- VRETA 2 · Migrering 006 · Resurser (Resources & Circularity)
-- Varje sak har en resa (Designdokument 2.0, tillgång 2): fynd → anskaffning → hämtning → lager →
-- nytt liv → utflöde. Partier fördelas på rader med egen status och plats (INV-11). Fordon och maskiner
-- är resurser med kapacitet (R2.4). Priser och adresser ligger i privata tabeller.

create type resources.object_status as enum (
  'discovered', 'contacted', 'reserved', 'pickup_planned', 'collected', 'stored', 'processing', 'in_use',
  'listed', 'reserved_out', 'lent', 'declined', 'lost', 'sold', 'donated', 'exchanged', 'discarded');
create type resources.health_status as enum ('establishing', 'healthy', 'struggling', 'dead');
create type resources.acquisition_type as enum ('purchase', 'gift', 'exchange', 'loan', 'work_trade');
create type resources.acquisition_status as enum ('lead', 'contacted', 'negotiating', 'agreed', 'received', 'settled', 'declined', 'lost');
create type resources.pickup_status as enum ('planned', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type resources.receipt_status as enum ('received', 'partial', 'deviation');
create type resources.listing_type as enum ('sell', 'give', 'exchange', 'lend', 'wanted', 'help_wanted');
create type resources.listing_status as enum ('draft', 'ready', 'published', 'agreed', 'completed', 'archived', 'withdrawn');
create type resources.channel_post_status as enum ('not_posted', 'posted', 'removed');
create type resources.lead_status as enum ('new', 'replied', 'viewing_booked', 'agreed', 'completed', 'no_show', 'lost', 'rejected');
create type resources.disposal_type as enum ('sold', 'donated', 'exchanged', 'lent', 'discarded');
create type resources.usage_type as enum ('mounted', 'planted', 'installed', 'built_in', 'renovated', 'moved', 'dismantled');
create type resources.vehicle_status as enum ('available', 'in_use', 'maintenance', 'out_of_service', 'retired');
create type resources.reservation_status as enum ('requested', 'confirmed', 'cancelled', 'completed');

select core.define_entity_type('category', 'resources.category', 'Kategori', 'Kategorier', null, 'resources', '{name,co2e_per_kg,default_unit}');
select core.define_entity_type('object', 'resources.object', 'Sak', 'Saker', '/objekt/:id', 'resources',
  '{title,description,material,dimensions,weight_kg,age_period,condition,species_variety,story_why}');
select core.define_entity_type('acquisition', 'resources.acquisition', 'Anskaffning', 'Inköp', '/inkop/:id', 'resources', '{source_url,note}');
select core.define_entity_type('disposal', 'resources.disposal', 'Avslut', 'Avslut', null, 'resources', '{note}');
select core.define_entity_type('listing', 'resources.listing', 'Annons', 'Annonser', '/annons/:id', 'resources', '{title,description,price,price_rationale,condition}');
select core.define_entity_type('lead', 'resources.lead', 'Intressent', 'Intressenter', null, 'resources', '{message,bid}');
select core.define_entity_type('pickup', 'resources.pickup', 'Hämtning', 'Hämtningar', '/hamtning/:id', 'resources', '{note,title}');
select core.define_entity_type('checklist_template', 'resources.checklist_template', 'Checklistmall', 'Checklistmallar', null, 'resources', '{name}');
select core.define_entity_type('usage_event', 'resources.usage_event', 'Nytt liv', 'Nytt liv', null, 'resources', '{note}');
select core.define_entity_type('vehicle_machine', 'resources.vehicle_machine', 'Fordon/maskin', 'Fordon och maskiner', '/fordon/:id', 'resources', '{name,description,availability_note}', false, 'R2.4');
select core.define_entity_type('vehicle_maintenance', 'resources.vehicle_maintenance', 'Underhåll', 'Underhåll', null, 'resources', '{note}', false, 'R2.4');
select core.define_entity_type('resource_reservation', 'resources.resource_reservation', 'Bokning', 'Bokningar', null, 'resources', '{note}', false, 'R2.4');

-- ------------------------------------------------------------------ tabeller
create table resources.category (
  like core.entity_template including all,
  code text,
  name text not null,
  parent_id uuid references resources.category (id),
  co2e_per_kg numeric,
  default_unit text,
  -- Mappning till kanalernas kategorilistor (R1.1 9.2)
  channel_mapping jsonb not null default '{}',
  unique (site_id, code)
);
select core.register_table('resources.category', 'standard', 'category', 'name');

create table resources.vehicle_machine (
  like core.entity_template including all,
  name text not null,
  kind_code text not null,
  -- Vreta, en person eller en organisation – så att leverantörers maskiner kan registreras
  owner_kind text not null default 'site' check (owner_kind in ('site', 'person', 'organization')),
  owner_person_id uuid references people.person (id),
  owner_organization_id uuid references people.organization (id),
  place_id uuid references core.entity (id),
  status resources.vehicle_status not null default 'available',
  availability_note text,
  description text,
  object_id uuid,
  project_id uuid
);
select core.register_table('resources.vehicle_machine', 'standard', 'vehicle_machine', 'name', '{description,kind_code}', 'R2.4');

create table resources.object (
  like core.entity_template including all,
  title text not null,
  category_id uuid references resources.category (id),
  description text,
  material text,
  dimensions text,
  weight_kg numeric,
  age_period text,
  condition smallint check (condition between 1 and 5),
  status resources.object_status not null default 'discovered',
  status_since timestamptz not null default now(),
  living_material boolean not null default false,
  species_variety text,
  health_status resources.health_status,
  -- Aktuell plats, denormaliserad och uppdaterad i samma transaktion som händelsen (R1.1 6.4)
  place_id uuid references core.entity (id),
  project_id uuid,
  vehicle_machine_id uuid references resources.vehicle_machine (id),
  story_why text,
  -- INV-05: ett objekt i bruk har datum och plats
  constraint object_in_use_has_place check (status <> 'in_use' or place_id is not null)
);
create index object_site_status_idx on resources.object (site_id, status);
create index object_title_trgm on resources.object using gin (title extensions.gin_trgm_ops);
select core.register_table('resources.object', 'standard', 'object', 'title', '{description,material,species_variety,story_why}');
alter table resources.vehicle_machine add constraint vehicle_object_fk foreign key (object_id) references resources.object (id);

create table resources.object_private (
  like core.link_template including all,
  object_id uuid not null unique references resources.object (id),
  estimated_value numeric,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('resources.object_private', 'private');

-- Ett parti är ett objekt med kvantitet (R1.1 6.3). Kvantiteten fördelas på batch_allocation.
create table resources.object_batch (
  like core.link_template including all,
  object_id uuid not null unique references resources.object (id),
  total_quantity numeric not null check (total_quantity > 0),
  unit text not null default 'st',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('resources.object_batch', 'custom');
create policy read on resources.object_batch for select to authenticated
  using (exists (select 1 from resources.object o where o.id = object_id));

create table resources.batch_allocation (
  like core.link_template including all,
  object_id uuid not null references resources.object_batch (object_id),
  quantity numeric not null check (quantity > 0),
  status resources.object_status not null,
  status_since timestamptz not null default now(),
  place_id uuid references core.entity (id),
  project_id uuid,
  health_status resources.health_status,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint allocation_in_use_has_place check (status <> 'in_use' or place_id is not null)
);
create index batch_allocation_object_idx on resources.batch_allocation (object_id);
select core.register_table('resources.batch_allocation', 'custom');
create policy read on resources.batch_allocation for select to authenticated
  using (exists (select 1 from resources.object o where o.id = object_id));

-- INV-11: summan av kvantiteterna i ett partis fördelning är alltid lika med partiets totala kvantitet.
-- Kontrolleras vid commit (och direkt efter varje kommando, se api.run_command).
create function resources.tg_check_batch_sum() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_object uuid := coalesce((to_jsonb(new) ->> 'object_id')::uuid, (to_jsonb(old) ->> 'object_id')::uuid);
  v_total numeric;
  v_sum numeric;
begin
  select total_quantity into v_total from resources.object_batch where object_id = v_object;
  if v_total is null then return null; end if;
  select coalesce(sum(quantity), 0) into v_sum from resources.batch_allocation where object_id = v_object;
  if v_sum <> v_total then
    raise exception 'batch_sum: Partiets fördelning (%) stämmer inte med totalen (%)', v_sum, v_total;
  end if;
  return null;
end $$;
create constraint trigger batch_sum after insert or update or delete on resources.batch_allocation
  deferrable initially deferred for each row execute function resources.tg_check_batch_sum();
create constraint trigger batch_sum after insert or update on resources.object_batch
  deferrable initially deferred for each row execute function resources.tg_check_batch_sum();

create table resources.acquisition (
  like core.entity_template including all,
  object_id uuid not null references resources.object (id),
  type resources.acquisition_type not null default 'purchase',
  status resources.acquisition_status not null default 'lead',
  counterpart_person_id uuid references people.person (id),
  counterpart_organization_id uuid references people.organization (id),
  external_place_id uuid references place.external_place (id),
  tipster_person_id uuid references people.person (id),
  quantity numeric,
  source_url text,
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  agreed_at timestamptz,
  received_at timestamptz,
  settled_at timestamptz,
  note text
);
create index acquisition_object_idx on resources.acquisition (object_id);
create index acquisition_person_idx on resources.acquisition (counterpart_person_id);
select core.register_table('resources.acquisition', 'standard', 'acquisition', null, '{source_url,note}');

-- Pris, betalsätt och kvitto är privata (R1.1 12.1).
create table resources.acquisition_private (
  like core.link_template including all,
  acquisition_id uuid not null unique references resources.acquisition (id),
  price numeric,
  currency text not null default 'SEK',
  payment_method text,
  receipt_media_id uuid references core.media (id),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('resources.acquisition_private', 'private');

create table resources.listing (
  like core.entity_template including all,
  type resources.listing_type not null,
  status resources.listing_status not null default 'draft',
  object_id uuid references resources.object (id),
  need_id uuid,
  title text not null,
  description text,
  price numeric,
  price_rationale text,
  quantity numeric,
  locality_id uuid references place.locality (id),
  condition smallint check (condition between 1 and 5),
  published_at timestamptz,
  agreed_at timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz
);
create index listing_object_idx on resources.listing (object_id);
select core.register_table('resources.listing', 'standard', 'listing', 'title', '{description}');

create table resources.channel_post (
  like core.link_template including all,
  listing_id uuid not null references resources.listing (id),
  channel_code text not null,
  title text,
  body text,
  media_ids uuid[] not null default '{}',
  external_url text,
  status resources.channel_post_status not null default 'not_posted',
  publish_mode text not null default 'manual' check (publish_mode in ('manual', 'browser_agent', 'api')),
  posted_at timestamptz,
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (listing_id, channel_code)
);
select core.register_table('resources.channel_post', 'custom');
create policy read on resources.channel_post for select to authenticated
  using (exists (select 1 from resources.listing l where l.id = listing_id));

create table resources.lead (
  like core.entity_template including all,
  listing_id uuid not null references resources.listing (id),
  person_id uuid references people.person (id),
  queue_position integer not null,
  status resources.lead_status not null default 'new',
  bid numeric,
  message text,
  viewing_at timestamptz,
  address_shared_at timestamptz
);
create index lead_listing_idx on resources.lead (listing_id, queue_position);
select core.register_table('resources.lead', 'standard', 'lead', 'message');

create table resources.disposal (
  like core.entity_template including all,
  object_id uuid not null references resources.object (id),
  quantity numeric,
  type resources.disposal_type not null,
  counterpart_person_id uuid references people.person (id),
  counterpart_organization_id uuid references people.organization (id),
  external_place_id uuid references place.external_place (id),
  listing_id uuid references resources.listing (id),
  lead_id uuid references resources.lead (id),
  occurred_at timestamptz not null default now(),
  note text
);
create index disposal_object_idx on resources.disposal (object_id);
select core.register_table('resources.disposal', 'standard', 'disposal', null, '{note}');

create table resources.disposal_private (
  like core.link_template including all,
  disposal_id uuid not null unique references resources.disposal (id),
  price numeric,
  currency text not null default 'SEK',
  payment_method text,
  note text
);
select core.register_table('resources.disposal_private', 'private');

create table resources.checklist_template (
  like core.entity_template including all,
  name text not null,
  items jsonb not null default '[]'
);
select core.register_table('resources.checklist_template', 'standard', 'checklist_template', 'name');

create table resources.pickup (
  like core.entity_template including all,
  title text not null default 'Hämtning',
  status resources.pickup_status not null default 'planned',
  scheduled_on date,
  window_start timestamptz,
  window_end timestamptz,
  contact_person_id uuid references people.person (id),
  external_place_id uuid references place.external_place (id),
  acquisition_id uuid references resources.acquisition (id),
  -- Förare och fordon i stället för fritext (2.0)
  driver_person_id uuid references people.person (id),
  driver_user_id uuid,
  checklist_name text,
  note text,
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);
create index pickup_site_status_idx on resources.pickup (site_id, status, scheduled_on);
select core.register_table('resources.pickup', 'standard', 'pickup', 'title', '{note}');

-- Från-adressen är privat (R1.1 6.2).
create table resources.pickup_private (
  like core.link_template including all,
  pickup_id uuid not null unique references resources.pickup (id),
  from_address text,
  exact_point extensions.geometry(Point, 4326),
  contact_phone text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('resources.pickup_private', 'private');

create table resources.pickup_item (
  like core.link_template including all,
  pickup_id uuid not null references resources.pickup (id),
  object_id uuid not null references resources.object (id),
  quantity numeric,
  receipt_status resources.receipt_status,
  receipt_note text,
  unique (pickup_id, object_id)
);
select core.register_table('resources.pickup_item', 'custom');
create policy read on resources.pickup_item for select to authenticated
  using (exists (select 1 from resources.pickup x where x.id = pickup_id));

create table resources.pickup_resource (
  like core.link_template including all,
  pickup_id uuid not null references resources.pickup (id),
  vehicle_machine_id uuid references resources.vehicle_machine (id),
  person_id uuid references people.person (id),
  label text not null
);
select core.register_table('resources.pickup_resource', 'custom');
create policy read on resources.pickup_resource for select to authenticated
  using (exists (select 1 from resources.pickup x where x.id = pickup_id));

create table resources.checklist_item (
  like core.link_template including all,
  pickup_id uuid not null references resources.pickup (id),
  text text not null,
  ordinal integer not null default 0,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('resources.checklist_item', 'custom');
create policy read on resources.checklist_item for select to authenticated
  using (exists (select 1 from resources.pickup x where x.id = pickup_id));

-- Nytt liv. Målet kan vara en plats, ett fordon, en aktivitet eller en växtpost (2.0).
create table resources.usage_event (
  like core.entity_template including all,
  object_id uuid not null references resources.object (id),
  allocation_id uuid references resources.batch_allocation (id),
  type resources.usage_type not null,
  occurred_at timestamptz not null,
  place_id uuid references core.entity (id),
  project_id uuid,
  quantity numeric,
  note text,
  target_vehicle_id uuid references resources.vehicle_machine (id),
  target_activity_id uuid,
  target_plant_entity_id uuid references core.entity (id),
  history_event_id uuid references core.history_event (id),
  constraint usage_has_place check (type = 'dismantled' or place_id is not null or target_vehicle_id is not null)
);
create index usage_event_object_idx on resources.usage_event (object_id);
select core.register_table('resources.usage_event', 'standard', 'usage_event', null, '{note}');

create table resources.vehicle_maintenance (
  like core.entity_template including all,
  vehicle_id uuid not null references resources.vehicle_machine (id),
  performed_on date not null,
  kind text not null,
  note text,
  next_due_on date
);
select core.register_table('resources.vehicle_maintenance', 'standard', 'vehicle_maintenance', 'kind', '{note}', 'R2.4');

create table resources.vehicle_authorization (
  like core.entity_template including all,
  vehicle_id uuid not null references resources.vehicle_machine (id),
  person_id uuid references people.person (id),
  user_id uuid,
  valid_from date,
  valid_to date,
  note text,
  check (person_id is not null or user_id is not null)
);
select core.register_table('resources.vehicle_authorization', 'standard', p_ui_release => 'R2.4');

create table resources.resource_reservation (
  like core.entity_template including all,
  vehicle_id uuid not null references resources.vehicle_machine (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  purpose_entity_id uuid references core.entity (id),
  status resources.reservation_status not null default 'confirmed',
  note text,
  check (ends_at > starts_at)
);
create index reservation_vehicle_idx on resources.resource_reservation (vehicle_id, starts_at);
select core.register_table('resources.resource_reservation', 'standard', 'resource_reservation', 'note', '{}', 'R2.4');

-- ------------------------------------------------------------------ tillståndsmaskiner (R1.1 avsnitt 5)
insert into core.state (machine, state, label_sv, terminal, sort) values
  ('object', 'discovered', 'Upptäckt', false, 1), ('object', 'contacted', 'Kontaktad', false, 2),
  ('object', 'reserved', 'Reserverad', false, 3), ('object', 'pickup_planned', 'Hämtning planerad', false, 4),
  ('object', 'collected', 'Hämtad', false, 5), ('object', 'stored', 'I lager', false, 6),
  ('object', 'processing', 'Renoveras', false, 7), ('object', 'in_use', 'I bruk', false, 8),
  ('object', 'listed', 'Utannonserad', false, 9), ('object', 'reserved_out', 'Reserverad för köpare', false, 10),
  ('object', 'lent', 'Utlånad', false, 11), ('object', 'declined', 'Avstått', true, 12), ('object', 'lost', 'Missat', true, 13),
  ('object', 'sold', 'Såld', true, 14), ('object', 'donated', 'Skänkt', true, 15), ('object', 'exchanged', 'Bytt', true, 16),
  ('object', 'discarded', 'Kasserad', true, 17),
  ('acquisition', 'lead', 'Fynd', false, 1), ('acquisition', 'contacted', 'Kontaktad', false, 2),
  ('acquisition', 'negotiating', 'Förhandlar', false, 3), ('acquisition', 'agreed', 'Överenskommet', false, 4),
  ('acquisition', 'received', 'Mottaget', false, 5), ('acquisition', 'settled', 'Klart', true, 6),
  ('acquisition', 'declined', 'Avstått', true, 7), ('acquisition', 'lost', 'Missat', true, 8),
  ('pickup', 'planned', 'Planerad', false, 1), ('pickup', 'confirmed', 'Bekräftad', false, 2),
  ('pickup', 'in_progress', 'Pågår', false, 3), ('pickup', 'completed', 'Klar', true, 4), ('pickup', 'cancelled', 'Inställd', true, 5),
  ('listing', 'draft', 'Utkast', false, 1), ('listing', 'ready', 'Klar att publicera', false, 2),
  ('listing', 'published', 'Publicerad', false, 3), ('listing', 'agreed', 'Överenskommen', false, 4),
  ('listing', 'completed', 'Avslutad', false, 5), ('listing', 'archived', 'Arkiverad', true, 6),
  ('listing', 'withdrawn', 'Återkallad', true, 7),
  ('lead', 'new', 'Ny', false, 1), ('lead', 'replied', 'Svarat', false, 2), ('lead', 'viewing_booked', 'Visning bokad', false, 3),
  ('lead', 'agreed', 'Överenskommet', false, 4), ('lead', 'completed', 'Klar', true, 5), ('lead', 'no_show', 'Kom inte', true, 6),
  ('lead', 'lost', 'Föll bort', true, 7), ('lead', 'rejected', 'Nej tack', true, 8);

insert into core.state_transition (machine, from_state, to_state, label_sv) values
  ('object', 'discovered', 'contacted', null), ('object', 'discovered', 'reserved', null), ('object', 'discovered', 'collected', 'genväg: köpt och hämtat direkt'),
  ('object', 'discovered', 'declined', null), ('object', 'discovered', 'lost', null),
  ('object', 'contacted', 'reserved', null), ('object', 'contacted', 'collected', null), ('object', 'contacted', 'declined', null), ('object', 'contacted', 'lost', null),
  ('object', 'reserved', 'pickup_planned', null), ('object', 'reserved', 'collected', null), ('object', 'reserved', 'declined', null), ('object', 'reserved', 'lost', null),
  ('object', 'pickup_planned', 'collected', null), ('object', 'pickup_planned', 'reserved', null), ('object', 'pickup_planned', 'lost', null),
  ('object', 'collected', 'stored', null), ('object', 'collected', 'processing', null), ('object', 'collected', 'in_use', null), ('object', 'collected', 'listed', null),
  ('object', 'stored', 'processing', null), ('object', 'stored', 'in_use', null), ('object', 'stored', 'listed', null), ('object', 'stored', 'discarded', null),
  ('object', 'stored', 'stored', 'flyttad i lagret'),
  ('object', 'processing', 'stored', null), ('object', 'processing', 'in_use', null), ('object', 'processing', 'listed', null), ('object', 'processing', 'discarded', null),
  ('object', 'in_use', 'stored', 'demonterad'), ('object', 'in_use', 'processing', null), ('object', 'in_use', 'in_use', 'flyttad'),
  ('object', 'in_use', 'listed', null), ('object', 'in_use', 'discarded', null),
  ('object', 'listed', 'stored', 'annons stängd'), ('object', 'listed', 'reserved_out', null), ('object', 'listed', 'in_use', null),
  ('object', 'reserved_out', 'listed', null), ('object', 'reserved_out', 'sold', null), ('object', 'reserved_out', 'donated', null),
  ('object', 'reserved_out', 'exchanged', null), ('object', 'reserved_out', 'lent', null),
  ('object', 'lent', 'stored', null), ('object', 'lent', 'in_use', null),
  -- Genvägar där verkligheten hoppar över annonsen: skänka eller sälja direkt ur lager eller bruk (Kedja B steg 4)
  ('object', 'stored', 'sold', 'genväg: direkt avslut'), ('object', 'stored', 'donated', 'genväg: direkt avslut'),
  ('object', 'stored', 'exchanged', 'genväg: direkt avslut'), ('object', 'stored', 'lent', 'genväg: utlånad direkt'),
  ('object', 'in_use', 'donated', 'genväg: direkt avslut'), ('object', 'in_use', 'sold', 'genväg: direkt avslut'),
  ('object', 'collected', 'donated', 'genväg: direkt avslut'),
  ('acquisition', 'lead', 'contacted', null), ('acquisition', 'lead', 'negotiating', null), ('acquisition', 'lead', 'agreed', null),
  ('acquisition', 'lead', 'received', 'genväg: köpt och hämtat direkt'),
  ('acquisition', 'contacted', 'negotiating', null), ('acquisition', 'contacted', 'agreed', null),
  ('acquisition', 'negotiating', 'agreed', null), ('acquisition', 'agreed', 'received', null), ('acquisition', 'received', 'settled', null),
  ('acquisition', 'lead', 'declined', null), ('acquisition', 'contacted', 'declined', null), ('acquisition', 'negotiating', 'declined', null),
  ('acquisition', 'agreed', 'declined', null), ('acquisition', 'received', 'declined', null),
  ('acquisition', 'lead', 'lost', null), ('acquisition', 'contacted', 'lost', null), ('acquisition', 'negotiating', 'lost', null),
  ('acquisition', 'agreed', 'lost', null), ('acquisition', 'received', 'lost', null),
  ('pickup', 'planned', 'confirmed', null), ('pickup', 'confirmed', 'in_progress', null), ('pickup', 'in_progress', 'completed', null),
  ('pickup', 'planned', 'in_progress', null), ('pickup', 'planned', 'completed', null), ('pickup', 'confirmed', 'completed', null),
  ('pickup', 'planned', 'cancelled', null), ('pickup', 'confirmed', 'cancelled', null),
  ('listing', 'draft', 'ready', null), ('listing', 'ready', 'published', null), ('listing', 'draft', 'published', null),
  ('listing', 'published', 'ready', 'nedtagen för ändring'), ('listing', 'published', 'agreed', null), ('listing', 'agreed', 'published', 'köpet gick inte igenom'),
  ('listing', 'agreed', 'completed', null), ('listing', 'completed', 'archived', null), ('listing', 'published', 'completed', null),
  ('listing', 'draft', 'withdrawn', null), ('listing', 'ready', 'withdrawn', null), ('listing', 'published', 'withdrawn', null),
  ('listing', 'agreed', 'withdrawn', null),
  ('lead', 'new', 'replied', null), ('lead', 'replied', 'viewing_booked', null), ('lead', 'viewing_booked', 'agreed', null),
  ('lead', 'agreed', 'completed', null), ('lead', 'new', 'viewing_booked', null), ('lead', 'new', 'agreed', null), ('lead', 'replied', 'agreed', null),
  ('lead', 'new', 'no_show', null), ('lead', 'replied', 'no_show', null), ('lead', 'viewing_booked', 'no_show', null), ('lead', 'agreed', 'no_show', null),
  ('lead', 'new', 'lost', null), ('lead', 'replied', 'lost', null), ('lead', 'viewing_booked', 'lost', null), ('lead', 'agreed', 'lost', null),
  ('lead', 'new', 'rejected', null), ('lead', 'replied', 'rejected', null), ('lead', 'viewing_booked', 'rejected', null), ('lead', 'agreed', 'rejected', null);

-- ------------------------------------------------------------------ objektets resa: hjälpare
create function resources.is_batch(p_object uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from resources.object_batch where object_id = p_object) $$;

-- Partiets visade status är en sammanfattning; objektets status sätts till den största icke-terminala raden.
create function resources.refresh_batch_object(p_object uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row resources.batch_allocation;
begin
  select * into v_row from resources.batch_allocation a
  where a.object_id = p_object
  order by (select terminal from core.state where machine = 'object' and state = a.status::text), a.quantity desc, a.created_at
  limit 1;
  if found then
    update resources.object set status = v_row.status, place_id = v_row.place_id,
      status_since = greatest(status_since, v_row.status_since)
    where id = p_object and (status is distinct from v_row.status or place_id is distinct from v_row.place_id);
  end if;
end $$;

-- Slår ihop identiska fördelningsrader som inget refererar, så att partiet inte splittras i onödan.
create function resources.compact_allocations(p_object uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select (array_agg(a.id order by a.created_at))[1] as keep_id, array_agg(a.id order by a.created_at) as ids, sum(a.quantity) as qty
    from resources.batch_allocation a
    where a.object_id = p_object
      and not exists (select 1 from resources.usage_event u where u.allocation_id = a.id)
    group by a.status, a.place_id, a.project_id, a.health_status
    having count(*) > 1
  loop
    delete from resources.batch_allocation where id = any (r.ids) and id <> r.keep_id;
    update resources.batch_allocation set quantity = r.qty where id = r.keep_id;
  end loop;
end $$;

-- Väljer raden som en handling gäller och delar den om bara en del av kvantiteten berörs.
-- Returnerar null för objekt som inte är partier. Kvantiteten kontrolleras mot läget nu, inte mot
-- det klienten trodde offline (Designdokument 2.0: "servern validerar varje kommando mot aktuellt läge").
create function resources.take_allocation(p_object uuid, p_alloc uuid, p_qty numeric, p_from resources.object_status[] default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_row resources.batch_allocation;
  v_new uuid;
  v_choices jsonb;
begin
  if not resources.is_batch(p_object) then return null; end if;
  if p_alloc is not null then
    select * into v_row from resources.batch_allocation where id = p_alloc and object_id = p_object for update;
    if not found then perform core.fail('not_found', 'Raden i partiet finns inte längre'); end if;
  else
    select jsonb_agg(jsonb_build_object('allocation_id', a.id, 'quantity', a.quantity, 'status', a.status,
                                        'place', (select title from core.entity where id = a.place_id)))
      into v_choices
    from resources.batch_allocation a
    where a.object_id = p_object and (p_from is null or a.status = any (p_from));
    if coalesce(jsonb_array_length(v_choices), 0) = 0 then
      perform core.fail('nothing_available', 'Det finns inget i partiet som kan hanteras så just nu');
    elsif jsonb_array_length(v_choices) > 1 then
      -- Ta från raden med mest kvar om kvantiteten räcker, annars be användaren välja
      select * into v_row from resources.batch_allocation a
      where a.object_id = p_object and (p_from is null or a.status = any (p_from)) and a.quantity >= coalesce(p_qty, 0)
      order by a.quantity desc limit 1 for update;
      if not found then
        perform core.fail('choose_allocation', 'Välj vilken del av partiet det gäller', jsonb_build_object('choices', v_choices));
      end if;
    else
      select * into v_row from resources.batch_allocation a
      where a.object_id = p_object and (p_from is null or a.status = any (p_from)) for update;
    end if;
  end if;
  if p_from is not null and not (v_row.status = any (p_from)) then
    perform core.fail('invalid_transition', format('Den delen av partiet är %s', lower(core.state_label('object', v_row.status::text))));
  end if;
  if p_qty is null or p_qty = v_row.quantity then
    return v_row.id;
  end if;
  if p_qty <= 0 then perform core.fail('invalid_quantity', 'Antalet måste vara större än noll'); end if;
  if p_qty > v_row.quantity then
    perform core.fail('quantity_exceeded', format('Det finns bara %s kvar där – inte %s', v_row.quantity, p_qty),
      jsonb_build_object('quantity', v_row.quantity, 'allocation_id', v_row.id));
  end if;
  update resources.batch_allocation set quantity = quantity - p_qty where id = v_row.id;
  insert into resources.batch_allocation (site_id, object_id, quantity, status, status_since, place_id, project_id, health_status, note)
  values (v_row.site_id, p_object, p_qty, v_row.status, v_row.status_since, v_row.place_id, v_row.project_id, v_row.health_status, v_row.note)
  returning id into v_new;
  return v_new;
end $$;

-- Byter status på ett helt objekt eller en partirad och validerar mot tillståndsmaskinen.
create function resources.set_status(p_object uuid, p_alloc uuid, p_to resources.object_status, p_override text default null,
                                     p_at timestamptz default null, p_place uuid default null, p_keep_place boolean default true)
returns resources.object_status
language plpgsql security definer set search_path = '' as $$
declare v_from resources.object_status;
begin
  if p_alloc is null then
    select status into v_from from resources.object where id = p_object for update;
    perform core.assert_transition('object', v_from::text, p_to::text, p_override);
    update resources.object set status = p_to, status_since = coalesce(p_at, now()),
      place_id = case when p_place is not null then p_place when p_keep_place then place_id end
    where id = p_object;
  else
    select status into v_from from resources.batch_allocation where id = p_alloc for update;
    perform core.assert_transition('object', v_from::text, p_to::text, p_override);
    update resources.batch_allocation set status = p_to, status_since = coalesce(p_at, now()),
      place_id = case when p_place is not null then p_place when p_keep_place then place_id end
    where id = p_alloc;
    perform resources.refresh_batch_object(p_object);
  end if;
  return v_from;
end $$;

create function resources.object_label(p_object uuid, p_qty numeric default null) returns text
language sql stable set search_path = '' as $$
  select case when b.object_id is not null then
           format('%s %s %s', trim(to_char(coalesce(p_qty, b.total_quantity), 'FM999999990.##')), b.unit, lower(o.title))
         else o.title end
  from resources.object o left join resources.object_batch b on b.object_id = o.id where o.id = p_object
$$;

create function resources.category_id(p jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid := core.opt_uuid(p, 'category_id');
begin
  if v_id is null and nullif(p ->> 'category', '') is not null then
    select id into v_id from resources.category
    where site_id = core.ctx_site() and (code = p ->> 'category' or lower(name) = lower(p ->> 'category')) limit 1;
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ kommandon: objekt och partier
-- Skapar ett objekt eller ett parti (antal > 1 eller enhet given). Startstatus discovered om inget annat anges.
create function cmd.create_object(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_qty numeric := (p ->> 'quantity')::numeric;
  v_unit text := nullif(p ->> 'unit', '');
  v_status resources.object_status := coalesce(nullif(p ->> 'status', ''), 'discovered')::resources.object_status;
  v_place uuid := core.opt_uuid(p, 'place_id');
  v_media uuid;
  v_at timestamptz := core.opt_ts(p, 'occurred_at');
  i integer := 0;
begin
  if v_place is not null then perform place.assert_place(v_place); end if;
  if v_status not in ('discovered', 'contacted', 'reserved', 'collected', 'stored', 'in_use', 'processing') then
    perform core.fail('invalid', 'Ett nytt objekt börjar som upptäckt, hämtat, i lager eller i bruk');
  end if;
  if v_status = 'in_use' and v_place is null then
    perform core.fail('missing_place', 'Ett objekt i bruk måste ha en plats (INV-05)');
  end if;
  insert into resources.object (id, site_id, title, category_id, description, material, dimensions, weight_kg, age_period, condition,
                                status, status_since, living_material, species_variety, health_status, place_id, story_why, visibility, source_type)
  values (v_id, core.ctx_site(), btrim(core.req(p, 'title')), resources.category_id(p), p ->> 'description', p ->> 'material',
          p ->> 'dimensions', (p ->> 'weight_kg')::numeric, p ->> 'age_period', (p ->> 'condition')::smallint, v_status, v_at,
          coalesce((p ->> 'living_material')::boolean, false), p ->> 'species_variety',
          (nullif(p ->> 'health_status', ''))::resources.health_status, v_place, nullif(p ->> 'story_why', ''),
          coalesce(nullif(p ->> 'visibility', ''), 'internal')::core.visibility,
          coalesce(nullif(p ->> 'source_type', ''), 'manual')::core.source_type);
  if (v_qty is not null and v_qty <> 1) or v_unit is not null then
    if coalesce(v_qty, 0) <= 0 then perform core.fail('invalid_quantity', 'Ange hur många'); end if;
    insert into resources.object_batch (site_id, object_id, total_quantity, unit) values (core.ctx_site(), v_id, v_qty, coalesce(v_unit, 'st'));
    insert into resources.batch_allocation (site_id, object_id, quantity, status, status_since, place_id, health_status)
    values (core.ctx_site(), v_id, v_qty, v_status, v_at, v_place, (nullif(p ->> 'health_status', ''))::resources.health_status);
  end if;
  if nullif(p ->> 'estimated_value', '') is not null then
    insert into resources.object_private (site_id, object_id, estimated_value) values (core.ctx_site(), v_id, (p ->> 'estimated_value')::numeric);
  end if;
  for v_media in select (jsonb_array_elements_text(coalesce(p -> 'media_ids', '[]')))::uuid loop
    perform core.assert_entity(v_media, '{media}');
    insert into core.media_link (site_id, media_id, entity_id, role, sort) values (core.ctx_site(), v_media, v_id, 'photo', i);
    i := i + 1;
  end loop;
  if nullif(p ->> 'story_why', '') is not null then
    insert into story.story_note (site_id, entity_id, kind, text) values (core.ctx_site(), v_id, 'why', p ->> 'story_why');
  end if;
  perform core.record_history('object.' || v_status::text,
    case v_status when 'discovered' then 'Upptäckt: ' else 'Registrerad: ' end || resources.object_label(v_id),
    jsonb_build_array(jsonb_build_object('id', v_id)), v_at, v_place, coalesce((p ->> 'story_value')::boolean, false));
  return jsonb_build_object('object_id', v_id);
end $$;

-- Statusbyte enligt tillståndsmaskinen för det som inte har ett eget flöde (kontaktad, avstått, renoveras …).
create function cmd.change_object_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'object_id');
  v_to resources.object_status := core.req(p, 'status')::resources.object_status;
  v_alloc uuid;
  v_from resources.object_status;
  v_at timestamptz := core.opt_ts(p, 'occurred_at');
begin
  perform core.assert_entity(v_id, '{object}');
  if v_to in ('in_use', 'sold', 'donated', 'exchanged', 'lent', 'collected') then
    perform core.fail('use_flow', 'Det statusbytet görs med sitt eget flöde (nytt liv, hämtning eller avslut)');
  end if;
  v_alloc := resources.take_allocation(v_id, core.opt_uuid(p, 'allocation_id'), (p ->> 'quantity')::numeric);
  v_from := resources.set_status(v_id, v_alloc, v_to, p ->> 'override_reason', v_at);
  perform core.record_history('object.status_changed',
    format('%s: %s → %s', resources.object_label(v_id, (p ->> 'quantity')::numeric), core.state_label('object', v_from::text),
           core.state_label('object', v_to::text)),
    jsonb_build_array(jsonb_build_object('id', v_id)), v_at, p_note => coalesce(p ->> 'note', p ->> 'override_reason'));
  return jsonb_build_object('object_id', v_id, 'from', v_from, 'to', v_to);
end $$;

-- Lagra eller flytta (MoveObject). "Flytta 40 tegel från pall A till Orangeriet" sparas som avsikt och
-- valideras mot läget när kommandot når servern.
create function cmd.move_object(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'object_id');
  v_to_place uuid := core.req_uuid(p, 'to_place_id');
  v_place_type text;
  v_alloc uuid;
  v_status resources.object_status;
  v_new resources.object_status;
  v_at timestamptz := core.opt_ts(p, 'occurred_at');
  v_qty numeric := (p ->> 'quantity')::numeric;
  v_from_place uuid := core.opt_uuid(p, 'from_place_id');
begin
  perform core.assert_entity(v_id, '{object}');
  v_place_type := place.assert_place(v_to_place);
  if v_from_place is not null and core.opt_uuid(p, 'allocation_id') is null and resources.is_batch(v_id) then
    select id into v_alloc from resources.batch_allocation where object_id = v_id and place_id = v_from_place
      and status in ('collected', 'stored', 'processing', 'in_use', 'listed', 'lent') order by quantity desc limit 1;
    if v_alloc is null then
      perform core.fail('not_there', format('Det finns inget av partiet på %s längre', (select title from core.entity where id = v_from_place)));
    end if;
  end if;
  v_alloc := resources.take_allocation(v_id, coalesce(core.opt_uuid(p, 'allocation_id'), v_alloc), v_qty,
                                       '{collected,stored,processing,in_use,listed,lent}');
  if v_alloc is null then select status into v_status from resources.object where id = v_id;
  else select status into v_status from resources.batch_allocation where id = v_alloc; end if;
  -- Till en lagerplats → I lager. Till en plats i bruk (i bruk sedan tidigare) → flyttad.
  v_new := case when v_place_type = 'storage_location' or v_status <> 'in_use' then 'stored' else 'in_use' end;
  perform resources.set_status(v_id, v_alloc, v_new, p ->> 'override_reason', v_at, v_to_place);
  if v_alloc is not null then perform resources.compact_allocations(v_id); perform resources.refresh_batch_object(v_id); end if;
  -- Flytt mellan lagerplatser loggas (audit) men blir ingen journalhändelse om inte användaren vill (R1.1 4.4)
  if v_status <> 'stored' or coalesce((p ->> 'journal')::boolean, false) then
    perform core.record_history(case when v_new = 'stored' then 'object.stored' else 'object.moved' end,
      format('%s %s %s', resources.object_label(v_id, v_qty), case when v_new = 'stored' then 'lagrad på' else 'flyttad till' end,
             place.path_label(v_to_place)),
      jsonb_build_array(jsonb_build_object('id', v_id)), v_at, v_to_place);
  end if;
  return jsonb_build_object('object_id', v_id, 'status', v_new, 'place', place.path_label(v_to_place));
end $$;

-- Nytt liv (UseObject/UseBatch): monterad, planterad, installerad, inbyggd, renoverad, flyttad.
-- Plats och datum krävs (INV-05). En och samma händelse syns i objekt-, plats-, zon- och projektjournal (AC-05).
create function cmd.use_object(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'object_id');
  v_type resources.usage_type := core.req(p, 'type')::resources.usage_type;
  v_place uuid := core.opt_uuid(p, 'place_id');
  v_at timestamptz := nullif(p ->> 'occurred_at', '')::timestamptz;
  v_qty numeric := (p ->> 'quantity')::numeric;
  v_project uuid := core.opt_uuid(p, 'project_id');
  v_alloc uuid;
  v_usage uuid := gen_random_uuid();
  v_event uuid;
  v_need uuid := core.opt_uuid(p, 'need_id');
  v_living boolean;
  v_label text;
  v_media uuid;
begin
  perform core.assert_entity(v_id, '{object}');
  if v_type = 'dismantled' then perform core.fail('use_flow', 'Demontering görs med Demontera'); end if;
  if v_at is null then perform core.fail('missing_field', 'Ange datum för det nya livet'); end if;
  if v_place is null and core.opt_uuid(p, 'target_vehicle_id') is null then
    perform core.fail('missing_place', 'Ange var saken kommit till användning (INV-05)');
  end if;
  if v_place is not null then perform place.assert_place(v_place, '{zone,structure,space,external_place}'); end if;
  if v_project is null and nullif(p ->> 'project_name', '') is not null then
    v_project := change.ensure_project(p ->> 'project_name', v_place);
  elsif v_project is not null then
    perform core.assert_entity(v_project, '{project}');
  end if;
  v_alloc := resources.take_allocation(v_id, core.opt_uuid(p, 'allocation_id'), v_qty, '{collected,stored,processing,in_use,listed,lent}');
  perform resources.set_status(v_id, v_alloc, 'in_use', p ->> 'override_reason', v_at,
    coalesce(v_place, (select place_id from resources.vehicle_machine where id = core.opt_uuid(p, 'target_vehicle_id'))));
  select living_material into v_living from resources.object where id = v_id;
  if v_alloc is not null then
    update resources.batch_allocation set project_id = v_project,
      health_status = case when v_living and v_type = 'planted' then 'establishing' else health_status end
    where id = v_alloc;
    perform resources.refresh_batch_object(v_id);
  else
    update resources.object set project_id = coalesce(v_project, project_id),
      health_status = case when v_living and v_type = 'planted' then 'establishing' else health_status end
    where id = v_id;
  end if;
  v_label := resources.object_label(v_id, v_qty);
  v_event := core.record_history('usage.' || v_type::text,
    format('%s %s %s', v_label,
      case v_type when 'mounted' then 'monterad i' when 'planted' then 'planterad i' when 'installed' then 'installerad i'
                  when 'built_in' then 'inbyggd i' when 'renovated' then 'renoverad i' else 'flyttad till' end,
      coalesce(place.path_label(v_place), (select name from resources.vehicle_machine where id = core.opt_uuid(p, 'target_vehicle_id')))),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_project, 'role', 'project'),
                      jsonb_build_object('id', core.opt_uuid(p, 'target_vehicle_id'), 'role', 'target')),
    v_at, v_place, true, p ->> 'note');
  insert into resources.usage_event (id, site_id, object_id, allocation_id, type, occurred_at, place_id, project_id, quantity, note,
                                     target_vehicle_id, target_activity_id, history_event_id)
  values (v_usage, core.ctx_site(), v_id, v_alloc, v_type, v_at, v_place, v_project, v_qty, p ->> 'note',
          core.opt_uuid(p, 'target_vehicle_id'), core.opt_uuid(p, 'target_activity_id'), v_event);
  insert into core.history_event_link (site_id, event_id, entity_id, entity_type, role)
  values (core.ctx_site(), v_event, v_usage, 'usage_event', 'record');
  for v_media in select (jsonb_array_elements_text(coalesce(p -> 'media_ids', '[]')))::uuid loop
    perform core.assert_entity(v_media, '{media}');
    insert into core.media_link (site_id, media_id, entity_id, role) values (core.ctx_site(), v_media, v_id, 'after') on conflict do nothing;
    insert into core.media_link (site_id, media_id, entity_id, role) values (core.ctx_site(), v_media, v_event, 'photo') on conflict do nothing;
  end loop;
  -- Behovet fylls av saker som används i projektet (R1.1 4.10). Utan angivet behov väljs ett öppet behov
  -- i projektet med samma enhet eller kategori.
  if v_project is not null then
    if v_need is null then
      select n.id into v_need from change.need n
      left join resources.object_batch b on b.object_id = v_id
      left join resources.object o on o.id = v_id
      where n.project_id = v_project and n.status = 'open' and n.kind_code = 'material' and not change.need_is_met(n.id)
        and (n.category_id = o.category_id or (b.unit is not null and n.unit = b.unit and o.title ilike '%' || split_part(n.title, ' ', 1) || '%'))
      order by n.created_at limit 1;
    end if;
    if v_need is not null then
      if exists (select 1 from change.need_fulfillment f where f.need_id = v_need and f.object_id = v_id and f.source_kind = 'acquisition') then
        -- Saken räknades redan mot behovet när den anskaffades; användningen registreras inte två gånger (AC-27)
        update change.need_fulfillment set usage_event_id = coalesce(usage_event_id, v_usage)
        where need_id = v_need and object_id = v_id and source_kind = 'acquisition';
      else
        perform change.fulfill_need(v_need, coalesce(v_qty, (select quantity from resources.batch_allocation where id = v_alloc), 1),
                                    'usage', p_usage => v_usage, p_object => v_id);
      end if;
    end if;
  end if;
  -- Växter: uppföljning om tre månader (R1.1 4.5)
  if v_living and v_type = 'planted' then
    insert into core.task (site_id, title, kind, due_at, subject_entity_id)
    values (core.ctx_site(), format('Följ upp %s – hur etablerar de sig?', v_label), 'follow_up_plant',
            v_at + make_interval(days => coalesce((core.setting(core.ctx_site(), 'follow_up_plants_days') #>> '{}')::integer, 90)), v_id);
  end if;
  return jsonb_build_object('object_id', v_id, 'usage_event_id', v_usage, 'history_event_id', v_event, 'need_id', v_need,
                            'allocation_id', v_alloc, 'project_id', v_project);
end $$;

-- Demontera: från i bruk tillbaka till lager (eller renovering). Tidigare liv ligger kvar i tidslinjen (FR-020).
create function cmd.dismantle_object(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'object_id');
  v_to uuid := core.opt_uuid(p, 'to_place_id');
  v_alloc uuid;
  v_from_place uuid;
  v_at timestamptz := core.opt_ts(p, 'occurred_at');
  v_qty numeric := (p ->> 'quantity')::numeric;
  v_usage uuid := gen_random_uuid();
  v_event uuid;
begin
  perform core.assert_entity(v_id, '{object}');
  if v_to is not null then perform place.assert_place(v_to); end if;
  v_alloc := resources.take_allocation(v_id, core.opt_uuid(p, 'allocation_id'), v_qty, '{in_use}');
  select coalesce((select place_id from resources.batch_allocation where id = v_alloc), (select place_id from resources.object where id = v_id)) into v_from_place;
  perform resources.set_status(v_id, v_alloc, case when coalesce((p ->> 'to_processing')::boolean, false) then 'processing' else 'stored' end,
                               null, v_at, v_to, v_to is null);
  if v_alloc is not null then update resources.batch_allocation set project_id = null where id = v_alloc; perform resources.compact_allocations(v_id); perform resources.refresh_batch_object(v_id); end if;
  v_event := core.record_history('usage.dismantled', format('%s demonterad från %s', resources.object_label(v_id, v_qty), place.path_label(v_from_place)),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_to, 'role', 'to')), v_at, v_from_place, false, p ->> 'note');
  insert into resources.usage_event (id, site_id, object_id, allocation_id, type, occurred_at, place_id, quantity, note, history_event_id)
  values (v_usage, core.ctx_site(), v_id, v_alloc, 'dismantled', v_at, v_from_place, v_qty, p ->> 'note', v_event);
  return jsonb_build_object('object_id', v_id, 'usage_event_id', v_usage);
end $$;

create function cmd.split_allocation(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_alloc uuid := core.req_uuid(p, 'allocation_id');
  v_object uuid;
  v_new uuid;
begin
  select object_id into v_object from resources.batch_allocation where id = v_alloc and site_id = core.ctx_site();
  if v_object is null then perform core.fail('not_found', 'Raden i partiet finns inte'); end if;
  v_new := resources.take_allocation(v_object, v_alloc, (core.req(p, 'quantity'))::numeric);
  return jsonb_build_object('allocation_id', v_new);
end $$;

-- Ändrar partiets totala kvantitet (t.ex. efter räkning). Skillnaden läggs på eller dras från en rad.
create function cmd.adjust_batch_quantity(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'object_id');
  v_total numeric := (core.req(p, 'total_quantity'))::numeric;
  v_old numeric;
  v_alloc uuid := core.opt_uuid(p, 'allocation_id');
begin
  select total_quantity into v_old from resources.object_batch where object_id = v_id and site_id = core.ctx_site() for update;
  if v_old is null then perform core.fail('not_a_batch', 'Objektet är inget parti'); end if;
  if v_alloc is null then select id into v_alloc from resources.batch_allocation where object_id = v_id order by quantity desc limit 1; end if;
  if (select quantity from resources.batch_allocation where id = v_alloc) + (v_total - v_old) <= 0 then
    perform core.fail('invalid_quantity', 'Raden räcker inte för den ändringen');
  end if;
  update resources.object_batch set total_quantity = v_total, unit = coalesce(nullif(p ->> 'unit', ''), unit) where object_id = v_id;
  update resources.batch_allocation set quantity = quantity + (v_total - v_old) where id = v_alloc;
  return jsonb_build_object('object_id', v_id, 'total_quantity', v_total);
end $$;

create function cmd.set_health_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'object_id');
  v_h resources.health_status := core.req(p, 'health_status')::resources.health_status;
begin
  perform core.assert_entity(v_id, '{object}');
  if core.opt_uuid(p, 'allocation_id') is not null then
    update resources.batch_allocation set health_status = v_h where id = core.opt_uuid(p, 'allocation_id') and object_id = v_id;
  else
    update resources.object set health_status = v_h where id = v_id;
    update resources.batch_allocation set health_status = v_h where object_id = v_id and status = 'in_use';
  end if;
  perform core.record_history('object.health', format('%s: %s', resources.object_label(v_id),
    case v_h when 'establishing' then 'etablerar sig' when 'healthy' then 'frisk' when 'struggling' then 'kämpar' else 'död' end),
    jsonb_build_array(jsonb_build_object('id', v_id)), core.opt_ts(p, 'occurred_at'), p_note => p ->> 'note');
  return jsonb_build_object('object_id', v_id, 'health_status', v_h);
end $$;

create function cmd.set_object_private(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'object_id');
begin
  perform core.assert_entity(v_id, '{object}');
  insert into resources.object_private (site_id, object_id, estimated_value, note)
  values (core.ctx_site(), v_id, (p ->> 'estimated_value')::numeric, p ->> 'note')
  on conflict (object_id) do update set estimated_value = coalesce(excluded.estimated_value, resources.object_private.estimated_value),
    note = coalesce(excluded.note, resources.object_private.note);
  return jsonb_build_object('object_id', v_id);
end $$;

create function cmd.set_object_category(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'object_id'); v_cat uuid := resources.category_id(p);
begin
  perform core.assert_entity(v_id, '{object}');
  update resources.object set category_id = v_cat where id = v_id;
  return jsonb_build_object('object_id', v_id, 'category_id', v_cat);
end $$;

-- ------------------------------------------------------------------ kommandon: anskaffning
create function cmd.create_acquisition(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_object uuid := core.req_uuid(p, 'object_id');
  v_type resources.acquisition_type := coalesce(nullif(p ->> 'type', ''), 'purchase')::resources.acquisition_type;
  v_status resources.acquisition_status := coalesce(nullif(p ->> 'status', ''), 'lead')::resources.acquisition_status;
  v_person uuid := core.opt_uuid(p, 'counterpart_person_id');
  v_place uuid := core.opt_uuid(p, 'external_place_id');
  v_tipster uuid := core.opt_uuid(p, 'tipster_person_id');
begin
  perform core.assert_entity(v_object, '{object}');
  if v_person is null and nullif(p ->> 'counterpart_name', '') is not null then
    v_person := people.create_person(p ->> 'counterpart_name', p ->> 'counterpart_locality');
  elsif v_person is not null then
    perform core.assert_entity(v_person, '{person}');
  end if;
  if v_place is null and nullif(p ->> 'external_place_name', '') is not null then
    v_place := (cmd.create_place(jsonb_build_object('kind', 'external_place', 'name', p ->> 'external_place_name',
                                                     'locality', p ->> 'counterpart_locality')) ->> 'id')::uuid;
  elsif v_place is not null then
    perform core.assert_entity(v_place, '{external_place}');
  end if;
  if v_tipster is not null then perform core.assert_entity(v_tipster, '{person}'); end if;
  insert into resources.acquisition (id, site_id, object_id, type, status, counterpart_person_id, counterpart_organization_id,
                                     external_place_id, tipster_person_id, quantity, source_url, pickup_window_start, pickup_window_end,
                                     agreed_at, received_at, note, source_type)
  values (v_id, core.ctx_site(), v_object, v_type, v_status, v_person, core.opt_uuid(p, 'counterpart_organization_id'), v_place, v_tipster,
          (p ->> 'quantity')::numeric, nullif(p ->> 'source_url', ''), core.opt_ts(p, 'pickup_window_start', null),
          core.opt_ts(p, 'pickup_window_end', null),
          case when v_status in ('agreed', 'received', 'settled') then core.opt_ts(p, 'occurred_at') end,
          case when v_status in ('received', 'settled') then core.opt_ts(p, 'occurred_at') end, p ->> 'note',
          coalesce(nullif(p ->> 'source_type', ''), 'manual')::core.source_type);
  if p ? 'price' or p ? 'payment_method' then
    insert into resources.acquisition_private (site_id, acquisition_id, price, payment_method)
    values (core.ctx_site(), v_id, (nullif(p ->> 'price', ''))::numeric, nullif(p ->> 'payment_method', ''));
  end if;
  if v_person is not null then
    perform people.add_role(v_person, case v_type when 'gift' then 'giver' else 'supplier' end);
  end if;
  if v_tipster is not null then
    perform people.add_role(v_tipster, 'tipster');
    if v_person is not null and v_tipster <> v_person then
      insert into people.person_relation (site_id, person_id, other_person_id, kind_code)
      values (core.ctx_site(), v_tipster, v_person, 'introduced') on conflict do nothing;
    end if;
  end if;
  perform core.record_history('acquisition.' || v_status::text,
    format('%s %s %s', resources.object_label(v_object),
      case v_type when 'gift' then 'som gåva från' when 'exchange' then 'i byte med' when 'loan' then 'lånas av'
                  when 'work_trade' then 'mot arbete hos' else 'från' end,
      coalesce((select display_name from people.person where id = v_person), (select name from place.external_place where id = v_place), 'okänd')),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_object, 'role', 'object'),
                      jsonb_build_object('id', v_person, 'role', 'counterpart'), jsonb_build_object('id', v_tipster, 'role', 'tipster'),
                      jsonb_build_object('id', v_place, 'role', 'from_place')),
    core.opt_ts(p, 'occurred_at'), v_place);
  return jsonb_build_object('acquisition_id', v_id, 'person_id', v_person, 'external_place_id', v_place);
end $$;

-- Dialogen: kontaktad → förhandlar → överenskommet → mottaget → klart (R1.1 4.2). Vid överenskommelse
-- reserveras objektet och appen föreslår en hämtning (FR-013).
create function cmd.advance_acquisition(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'acquisition_id');
  v_to resources.acquisition_status := core.req(p, 'status')::resources.acquisition_status;
  v_acq resources.acquisition;
  v_obj_status resources.object_status;
  v_at timestamptz := core.opt_ts(p, 'occurred_at');
begin
  select * into v_acq from resources.acquisition where id = v_id and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Anskaffningen finns inte'); end if;
  perform core.assert_transition('acquisition', v_acq.status::text, v_to::text, p ->> 'override_reason');
  update resources.acquisition set status = v_to,
    agreed_at = case when v_to = 'agreed' then v_at else agreed_at end,
    received_at = case when v_to = 'received' then v_at else received_at end,
    settled_at = case when v_to = 'settled' then v_at else settled_at end,
    pickup_window_start = coalesce(core.opt_ts(p, 'pickup_window_start', null), pickup_window_start),
    pickup_window_end = coalesce(core.opt_ts(p, 'pickup_window_end', null), pickup_window_end)
  where id = v_id;
  if p ? 'price' or p ? 'payment_method' or p ? 'receipt_media_id' then
    insert into resources.acquisition_private (site_id, acquisition_id, price, payment_method, receipt_media_id)
    values (core.ctx_site(), v_id, (nullif(p ->> 'price', ''))::numeric, nullif(p ->> 'payment_method', ''), core.opt_uuid(p, 'receipt_media_id'))
    on conflict (acquisition_id) do update set
      price = coalesce(excluded.price, resources.acquisition_private.price),
      payment_method = coalesce(excluded.payment_method, resources.acquisition_private.payment_method),
      receipt_media_id = coalesce(excluded.receipt_media_id, resources.acquisition_private.receipt_media_id);
  end if;
  select status into v_obj_status from resources.object where id = v_acq.object_id;
  if v_to = 'contacted' and v_obj_status = 'discovered' then
    perform resources.set_status(v_acq.object_id, null, 'contacted', null, v_at);
    update resources.batch_allocation set status = 'contacted' where object_id = v_acq.object_id and status = 'discovered';
  elsif v_to in ('negotiating', 'agreed') and v_obj_status in ('discovered', 'contacted') then
    if resources.is_batch(v_acq.object_id) then
      update resources.batch_allocation set status = 'reserved', status_since = v_at where object_id = v_acq.object_id and status in ('discovered', 'contacted');
      perform resources.refresh_batch_object(v_acq.object_id);
    else
      perform resources.set_status(v_acq.object_id, null, 'reserved', null, v_at);
    end if;
  elsif v_to in ('declined', 'lost') and v_obj_status in ('discovered', 'contacted', 'reserved', 'pickup_planned') then
    if resources.is_batch(v_acq.object_id) then
      update resources.batch_allocation set status = v_to::text::resources.object_status, status_since = v_at
      where object_id = v_acq.object_id and status in ('discovered', 'contacted', 'reserved', 'pickup_planned');
      perform resources.refresh_batch_object(v_acq.object_id);
    else
      perform resources.set_status(v_acq.object_id, null, v_to::text::resources.object_status, null, v_at);
    end if;
  end if;
  perform core.record_history('acquisition.' || v_to::text,
    format('%s: %s', resources.object_label(v_acq.object_id), core.state_label('acquisition', v_to::text)),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_acq.object_id, 'role', 'object'),
                      jsonb_build_object('id', v_acq.counterpart_person_id, 'role', 'counterpart')), v_at, p_note => p ->> 'note');
  return jsonb_build_object('acquisition_id', v_id, 'status', v_to,
    'suggest_pickup', v_to = 'agreed' and not exists (select 1 from resources.pickup where acquisition_id = v_id and status <> 'cancelled'));
end $$;

-- ------------------------------------------------------------------ kommandon: hämtning
create function cmd.plan_pickup(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_acq resources.acquisition;
  v_item jsonb;
  v_object uuid;
  v_status resources.object_status;
  v_text text;
  v_res jsonb;
  v_items jsonb := coalesce(p -> 'items', '[]');
  v_tpl jsonb;
  i integer := 0;
begin
  if core.opt_uuid(p, 'acquisition_id') is not null then
    select * into v_acq from resources.acquisition where id = core.opt_uuid(p, 'acquisition_id') and site_id = core.ctx_site();
    if not found then perform core.fail('not_found', 'Anskaffningen finns inte'); end if;
    if jsonb_array_length(v_items) = 0 then
      v_items := jsonb_build_array(jsonb_build_object('object_id', v_acq.object_id, 'quantity', v_acq.quantity));
    end if;
  end if;
  if jsonb_array_length(v_items) = 0 then perform core.fail('missing_field', 'Vad ska hämtas?'); end if;
  insert into resources.pickup (id, site_id, title, status, scheduled_on, window_start, window_end, contact_person_id, external_place_id,
                                acquisition_id, driver_person_id, driver_user_id, checklist_name, note)
  values (v_id, core.ctx_site(),
          coalesce(nullif(p ->> 'title', ''), 'Hämtning' || coalesce(' · ' || (select l.name from place.external_place x join place.locality l on l.id = x.locality_id
                   where x.id = coalesce(core.opt_uuid(p, 'external_place_id'), v_acq.external_place_id)),
                   ' · ' || (select l.name from people.person pe join place.locality l on l.id = pe.locality_id
                   where pe.id = coalesce(core.opt_uuid(p, 'contact_person_id'), v_acq.counterpart_person_id)), '')),
          'planned', (nullif(p ->> 'scheduled_on', ''))::date, core.opt_ts(p, 'window_start', v_acq.pickup_window_start),
          core.opt_ts(p, 'window_end', v_acq.pickup_window_end), coalesce(core.opt_uuid(p, 'contact_person_id'), v_acq.counterpart_person_id),
          coalesce(core.opt_uuid(p, 'external_place_id'), v_acq.external_place_id), v_acq.id, core.opt_uuid(p, 'driver_person_id'),
          coalesce(core.opt_uuid(p, 'driver_user_id'), auth.uid()), p ->> 'checklist_name', p ->> 'note');
  if nullif(p ->> 'from_address', '') is not null or nullif(p ->> 'contact_phone', '') is not null then
    insert into resources.pickup_private (site_id, pickup_id, from_address, contact_phone)
    values (core.ctx_site(), v_id, nullif(p ->> 'from_address', ''), nullif(p ->> 'contact_phone', ''));
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_object := (v_item ->> 'object_id')::uuid;
    perform core.assert_entity(v_object, '{object}');
    insert into resources.pickup_item (site_id, pickup_id, object_id, quantity) values (core.ctx_site(), v_id, v_object, (v_item ->> 'quantity')::numeric);
    select status into v_status from resources.object where id = v_object;
    if v_status in ('discovered', 'contacted') then
      if resources.is_batch(v_object) then
        update resources.batch_allocation set status = 'pickup_planned' where object_id = v_object and status in ('discovered', 'contacted', 'reserved');
        perform resources.refresh_batch_object(v_object);
      else
        perform resources.set_status(v_object, null, 'reserved');
        perform resources.set_status(v_object, null, 'pickup_planned');
      end if;
    elsif v_status = 'reserved' then
      if resources.is_batch(v_object) then
        update resources.batch_allocation set status = 'pickup_planned' where object_id = v_object and status = 'reserved';
        perform resources.refresh_batch_object(v_object);
      else
        perform resources.set_status(v_object, null, 'pickup_planned');
      end if;
    end if;
  end loop;
  -- Checklista från mall (kodlista eller platsens egen mall) och/eller egna rader
  if nullif(p ->> 'checklist_template', '') is not null then
    select coalesce((select items from resources.checklist_template where site_id = core.ctx_site() and (id::text = p ->> 'checklist_template' or name = p ->> 'checklist_template') limit 1),
                    (select attributes -> 'items' from core.code_value where list_code = 'checklist_template' and code = p ->> 'checklist_template' and site_id is null))
      into v_tpl;
    update resources.pickup set checklist_name = coalesce(checklist_name,
      (select label_sv from core.code_value where list_code = 'checklist_template' and code = p ->> 'checklist_template' and site_id is null),
      (select name from resources.checklist_template where site_id = core.ctx_site() and id::text = p ->> 'checklist_template')) where id = v_id;
    for v_text in select jsonb_array_elements_text(coalesce(v_tpl, '[]')) loop
      insert into resources.checklist_item (site_id, pickup_id, text, ordinal) values (core.ctx_site(), v_id, v_text, i);
      i := i + 1;
    end loop;
  end if;
  for v_text in select jsonb_array_elements_text(coalesce(p -> 'checklist', '[]')) loop
    insert into resources.checklist_item (site_id, pickup_id, text, ordinal) values (core.ctx_site(), v_id, v_text, i);
    i := i + 1;
  end loop;
  for v_res in select * from jsonb_array_elements(coalesce(p -> 'resources', '[]')) loop
    insert into resources.pickup_resource (site_id, pickup_id, vehicle_machine_id, person_id, label)
    values (core.ctx_site(), v_id, core.opt_uuid(v_res, 'vehicle_machine_id'), core.opt_uuid(v_res, 'person_id'),
            coalesce(nullif(v_res ->> 'label', ''), (select name from resources.vehicle_machine where id = core.opt_uuid(v_res, 'vehicle_machine_id')), 'Resurs'));
  end loop;
  perform core.record_history('pickup.planned', format('%s planerad %s', (select title from resources.pickup where id = v_id),
    coalesce(to_char((nullif(p ->> 'scheduled_on', ''))::date, 'YYYY-MM-DD'), '')),
    jsonb_build_array(jsonb_build_object('id', v_id)) ||
    (select coalesce(jsonb_agg(jsonb_build_object('id', object_id, 'role', 'object')), '[]') from resources.pickup_item where pickup_id = v_id) ||
    jsonb_build_array(jsonb_build_object('id', (select contact_person_id from resources.pickup where id = v_id), 'role', 'contact')),
    p_place_id => (select external_place_id from resources.pickup where id = v_id));
  return jsonb_build_object('pickup_id', v_id);
end $$;

create function cmd.set_pickup_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'pickup_id');
  v_to resources.pickup_status := core.req(p, 'status')::resources.pickup_status;
  v_from resources.pickup_status;
  r record;
begin
  select status into v_from from resources.pickup where id = v_id and site_id = core.ctx_site() for update;
  if v_from is null then perform core.fail('not_found', 'Hämtningen finns inte'); end if;
  if v_to = 'completed' then perform core.fail('use_flow', 'Avsluta hämtningen med mottagning per objekt'); end if;
  perform core.assert_transition('pickup', v_from::text, v_to::text, p ->> 'override_reason');
  update resources.pickup set status = v_to,
    confirmed_at = case when v_to = 'confirmed' then now() else confirmed_at end,
    started_at = case when v_to = 'in_progress' then now() else started_at end,
    cancelled_at = case when v_to = 'cancelled' then now() else cancelled_at end
  where id = v_id;
  if v_to = 'cancelled' then
    for r in select i.object_id from resources.pickup_item i where i.pickup_id = v_id loop
      update resources.batch_allocation set status = 'reserved' where object_id = r.object_id and status = 'pickup_planned';
      if resources.is_batch(r.object_id) then perform resources.refresh_batch_object(r.object_id);
      elsif (select status from resources.object where id = r.object_id) = 'pickup_planned' then
        perform resources.set_status(r.object_id, null, 'reserved');
      end if;
    end loop;
    perform core.record_history('pickup.cancelled', format('%s inställd', (select title from resources.pickup where id = v_id)),
      jsonb_build_array(jsonb_build_object('id', v_id)), p_note => p ->> 'note');
  end if;
  return jsonb_build_object('pickup_id', v_id, 'status', v_to);
end $$;

-- Bocka av en rad i checklistan – också offline (FR-015). Senaste avbockning vinner.
create function cmd.check_checklist_item(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'item_id'); v_checked boolean := coalesce((p ->> 'checked')::boolean, true);
begin
  update resources.checklist_item set checked = v_checked, checked_at = case when v_checked then core.opt_ts(p, 'occurred_at') end,
    checked_by = case when v_checked then auth.uid() end
  where id = v_id and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Raden finns inte'); end if;
  return jsonb_build_object('item_id', v_id, 'checked', v_checked);
end $$;

create function cmd.add_checklist_item(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_pickup uuid := core.req_uuid(p, 'pickup_id'); v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
begin
  perform core.assert_entity(v_pickup, '{pickup}');
  insert into resources.checklist_item (id, site_id, pickup_id, text, ordinal)
  values (v_id, core.ctx_site(), v_pickup, core.req(p, 'text'),
          (select coalesce(max(ordinal) + 1, 0) from resources.checklist_item where pickup_id = v_pickup))
  on conflict (id) do nothing;
  return jsonb_build_object('item_id', v_id);
end $$;

-- Avsluta hämtningen (AC-03): mottagning per objekt, objekten blir hämtade, en händelse skapas,
-- anskaffningen blir mottagen och appen frågar direkt om lagerplats – utan dubbelregistrering.
create function cmd.complete_pickup(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'pickup_id');
  v_pickup resources.pickup;
  v_item resources.pickup_item;
  v_receipt jsonb;
  v_rs resources.receipt_status;
  v_at timestamptz := core.opt_ts(p, 'occurred_at');
  v_collected uuid[] := '{}';
  v_store uuid := core.opt_uuid(p, 'storage_location_id');
  v_obj uuid;
  v_status resources.object_status;
begin
  select * into v_pickup from resources.pickup where id = v_id and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Hämtningen finns inte'); end if;
  if v_pickup.status = 'completed' then
    -- Samma avslut två gånger (t.ex. från två telefoner) ger ingen dubbelregistrering
    return jsonb_build_object('pickup_id', v_id, 'already_completed', true);
  end if;
  perform core.assert_transition('pickup', v_pickup.status::text, 'completed');
  for v_item in select * from resources.pickup_item where pickup_id = v_id loop
    select r into v_receipt from jsonb_array_elements(coalesce(p -> 'receipts', '[]')) r
    where (r ->> 'object_id')::uuid = v_item.object_id or (r ->> 'pickup_item_id')::uuid = v_item.id limit 1;
    v_rs := coalesce(nullif(v_receipt ->> 'receipt_status', ''), 'received')::resources.receipt_status;
    update resources.pickup_item set receipt_status = v_rs, receipt_note = v_receipt ->> 'note',
      quantity = coalesce((v_receipt ->> 'quantity')::numeric, quantity) where id = v_item.id;
    if v_rs in ('received', 'partial') then
      if resources.is_batch(v_item.object_id) then
        update resources.batch_allocation set status = 'collected', status_since = v_at
        where object_id = v_item.object_id and status in ('discovered', 'contacted', 'reserved', 'pickup_planned');
        perform resources.refresh_batch_object(v_item.object_id);
      else
        select status into v_status from resources.object where id = v_item.object_id;
        if v_status in ('discovered', 'contacted', 'reserved', 'pickup_planned') then
          perform resources.set_status(v_item.object_id, null, 'collected', null, v_at);
        end if;
      end if;
      v_collected := v_collected || v_item.object_id;
    end if;
  end loop;
  update resources.pickup set status = 'completed', completed_at = v_at where id = v_id;
  if v_pickup.acquisition_id is not null and cardinality(v_collected) > 0 then
    update resources.acquisition set status = 'received', received_at = v_at
    where id = v_pickup.acquisition_id and status in ('lead', 'contacted', 'negotiating', 'agreed');
  end if;
  perform core.record_history('pickup.completed', format('%s klar: %s', v_pickup.title,
      (select string_agg(resources.object_label(x), ', ') from unnest(v_collected) x)),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_pickup.contact_person_id, 'role', 'contact'),
                      jsonb_build_object('id', v_pickup.acquisition_id, 'role', 'acquisition')) ||
    (select coalesce(jsonb_agg(jsonb_build_object('id', x, 'role', 'object')), '[]') from unnest(v_collected) x),
    v_at, v_pickup.external_place_id, coalesce((p ->> 'story_value')::boolean, false), p ->> 'note');
  -- Valfritt: lagra allt direkt på en plats
  if v_store is not null then
    foreach v_obj in array v_collected loop
      perform cmd.move_object(jsonb_build_object('object_id', v_obj, 'to_place_id', v_store, 'occurred_at', v_at));
    end loop;
  end if;
  return jsonb_build_object('pickup_id', v_id, 'collected_object_ids', to_jsonb(v_collected), 'ask_storage', v_store is null and cardinality(v_collected) > 0);
end $$;

create function cmd.upsert_checklist_template(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
begin
  insert into resources.checklist_template (id, site_id, name, items) values (v_id, core.ctx_site(), core.req(p, 'name'), coalesce(p -> 'items', '[]'))
  on conflict (id) do update set name = excluded.name, items = excluded.items;
  return jsonb_build_object('id', v_id);
end $$;

-- ------------------------------------------------------------------ kommandon: annonser och utflöde
create function cmd.create_listing(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_type resources.listing_type := core.req(p, 'type')::resources.listing_type;
  v_object uuid := core.opt_uuid(p, 'object_id');
  v_need uuid := core.opt_uuid(p, 'need_id');
  v_channel text;
  v_status resources.object_status;
begin
  if v_object is not null then
    perform core.assert_entity(v_object, '{object}');
    select status into v_status from resources.object where id = v_object;
    if v_type in ('sell', 'give', 'exchange', 'lend') and v_status not in ('collected', 'stored', 'processing', 'in_use', 'listed') then
      perform core.fail('invalid_transition', format('Saken är %s och kan inte läggas ut än', lower(core.state_label('object', v_status::text))));
    end if;
  end if;
  if v_need is not null then perform core.assert_entity(v_need, '{need}'); end if;
  if v_type in ('sell', 'give', 'exchange', 'lend') and v_object is null then
    perform core.fail('missing_field', 'Vilken sak ska läggas ut?');
  end if;
  insert into resources.listing (id, site_id, type, object_id, need_id, title, description, price, price_rationale, quantity, locality_id, condition, visibility)
  values (v_id, core.ctx_site(), v_type, v_object, v_need,
          coalesce(nullif(p ->> 'title', ''), (select title from resources.object where id = v_object), (select title from change.need where id = v_need), 'Efterlysning'),
          p ->> 'description', (nullif(p ->> 'price', ''))::numeric, p ->> 'price_rationale', (p ->> 'quantity')::numeric,
          coalesce(core.opt_uuid(p, 'locality_id'), place.ensure_locality(p ->> 'locality')),
          coalesce((p ->> 'condition')::smallint, (select condition from resources.object where id = v_object)),
          case when v_type in ('wanted', 'help_wanted') then 'shareable' else 'internal' end::core.visibility);
  for v_channel in select jsonb_array_elements_text(coalesce(p -> 'channels', '["blocket","facebook_marketplace"]')) loop
    insert into resources.channel_post (site_id, listing_id, channel_code) values (core.ctx_site(), v_id, v_channel) on conflict do nothing;
  end loop;
  perform core.record_history('listing.created', format('Annons (utkast): %s', (select title from resources.listing where id = v_id)),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_object, 'role', 'object'), jsonb_build_object('id', v_need, 'role', 'need')));
  return jsonb_build_object('listing_id', v_id);
end $$;

-- Annonspaketets text per kanal (från Marketplace Agent eller mallarna). Innehållet har redan gått
-- genom integritetsfiltret i serverfunktionen; här kontrolleras att inga privata uppgifter finns med.
create function cmd.save_channel_post(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_listing uuid := core.req_uuid(p, 'listing_id');
  v_channel text := core.req(p, 'channel_code');
  v_media uuid;
begin
  perform core.assert_entity(v_listing, '{listing}');
  for v_media in select (jsonb_array_elements_text(coalesce(p -> 'media_ids', '[]')))::uuid loop
    if (select visibility from core.media where id = v_media) = 'private' then
      perform core.fail('privacy', 'En vald bild är privat och kan inte användas i en annons');
    end if;
  end loop;
  insert into resources.channel_post (site_id, listing_id, channel_code, title, body, media_ids)
  values (core.ctx_site(), v_listing, v_channel, p ->> 'title', p ->> 'body',
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'media_ids') x), '{}'))
  on conflict (listing_id, channel_code) do update set title = excluded.title, body = excluded.body, media_ids = excluded.media_ids;
  return jsonb_build_object('listing_id', v_listing, 'channel_code', v_channel);
end $$;

create function resources.listing_objects_to(p_listing uuid, p_to resources.object_status, p_from resources.object_status[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l resources.listing; v_alloc uuid; v_status resources.object_status;
begin
  select * into v_l from resources.listing where id = p_listing;
  if v_l.object_id is null then return; end if;
  if resources.is_batch(v_l.object_id) then
    v_alloc := (select id from resources.batch_allocation where object_id = v_l.object_id and status = any (p_from)
                and (v_l.quantity is null or quantity >= v_l.quantity) order by quantity desc limit 1);
    if v_alloc is null then return; end if;
    v_alloc := resources.take_allocation(v_l.object_id, v_alloc, v_l.quantity, p_from);
    perform resources.set_status(v_l.object_id, v_alloc, p_to);
  else
    select status into v_status from resources.object where id = v_l.object_id;
    if v_status = any (p_from) then perform resources.set_status(v_l.object_id, null, p_to); end if;
  end if;
end $$;

create function cmd.set_listing_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'listing_id');
  v_to resources.listing_status := core.req(p, 'status')::resources.listing_status;
  v_from resources.listing_status;
begin
  select status into v_from from resources.listing where id = v_id and site_id = core.ctx_site() for update;
  if v_from is null then perform core.fail('not_found', 'Annonsen finns inte'); end if;
  if v_to in ('agreed', 'completed') then perform core.fail('use_flow', 'Överenskommelse och avslut görs från intressentkön'); end if;
  if v_to = 'published' and core.ctx_role() <> 'owner' then perform core.fail('forbidden', 'Bara ägaren publicerar externt (INV-04)'); end if;
  perform core.assert_transition('listing', v_from::text, v_to::text, p ->> 'override_reason');
  update resources.listing set status = v_to,
    published_at = case when v_to = 'published' then coalesce(published_at, now()) else published_at end,
    withdrawn_at = case when v_to = 'withdrawn' then now() else withdrawn_at end
  where id = v_id;
  if v_to = 'published' then
    perform resources.listing_objects_to(v_id, 'listed', '{collected,stored,processing,in_use}');
  elsif v_to = 'withdrawn' then
    perform resources.listing_objects_to(v_id, 'stored', '{listed}');
    insert into core.task (site_id, title, kind, due_at, subject_entity_id)
    select core.ctx_site(), format('Ta ner annonsen på %s', (select label_sv from core.code_value where list_code = 'channel' and code = c.channel_code and site_id is null)),
           'remove_listing', now(), v_id
    from resources.channel_post c where c.listing_id = v_id and c.status = 'posted';
  end if;
  perform core.record_history('listing.' || v_to::text, format('Annons %s: %s', lower(core.state_label('listing', v_to::text)),
    (select title from resources.listing where id = v_id)), jsonb_build_array(jsonb_build_object('id', v_id)));
  return jsonb_build_object('listing_id', v_id, 'status', v_to);
end $$;

-- Extern publicering kräver uttrycklig bekräftelse av ägaren (INV-04) – även när en agent gör jobbet.
create function cmd.mark_channel_posted(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_listing uuid := core.req_uuid(p, 'listing_id');
  v_channel text := core.req(p, 'channel_code');
  v_status resources.listing_status;
begin
  perform core.assert_entity(v_listing, '{listing}');
  insert into resources.channel_post (site_id, listing_id, channel_code, external_url, status, publish_mode, posted_at)
  values (core.ctx_site(), v_listing, v_channel, nullif(p ->> 'external_url', ''), 'posted',
          coalesce(nullif(p ->> 'publish_mode', ''), 'manual'), now())
  on conflict (listing_id, channel_code) do update set external_url = coalesce(excluded.external_url, resources.channel_post.external_url),
    status = 'posted', publish_mode = excluded.publish_mode, posted_at = now(), removed_at = null;
  select status into v_status from resources.listing where id = v_listing;
  if v_status in ('draft', 'ready') then
    perform cmd.set_listing_status(jsonb_build_object('listing_id', v_listing, 'status', 'published'));
  end if;
  return jsonb_build_object('listing_id', v_listing, 'channel_code', v_channel);
end $$;

create function cmd.mark_channel_removed(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_listing uuid := core.req_uuid(p, 'listing_id'); v_channel text := core.req(p, 'channel_code');
begin
  update resources.channel_post set status = 'removed', removed_at = now()
  where listing_id = v_listing and channel_code = v_channel and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Annonsen finns inte i den kanalen'); end if;
  update core.task set status = 'done', done_at = now()
  where subject_entity_id = v_listing and kind = 'remove_listing' and status = 'open'
    and title like '%' || (select label_sv from core.code_value where list_code = 'channel' and code = v_channel and site_id is null);
  return jsonb_build_object('listing_id', v_listing, 'channel_code', v_channel);
end $$;

create function cmd.log_lead(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_listing uuid := core.req_uuid(p, 'listing_id');
  v_person uuid := core.opt_uuid(p, 'person_id');
  v_id uuid := gen_random_uuid();
begin
  perform core.assert_entity(v_listing, '{listing}');
  if v_person is null then
    v_person := people.create_person(coalesce(nullif(p ->> 'person_name', ''), 'Intressent'), p ->> 'locality', 'Via annons');
  else
    perform core.assert_entity(v_person, '{person}');
  end if;
  if (select type from resources.listing where id = v_listing) in ('wanted', 'help_wanted') then
    perform people.add_role(v_person, 'follower');
  end if;
  insert into resources.lead (id, site_id, listing_id, person_id, queue_position, bid, message)
  values (v_id, core.ctx_site(), v_listing, v_person,
          (select coalesce(max(queue_position), 0) + 1 from resources.lead where listing_id = v_listing),
          (nullif(p ->> 'bid', ''))::numeric, p ->> 'message');
  if nullif(p ->> 'message', '') is not null then
    insert into people.interaction (site_id, person_id, channel_code, summary, body)
    values (core.ctx_site(), v_person, 'marketplace', format('Intresse för %s', (select title from resources.listing where id = v_listing)), p ->> 'message');
  end if;
  return jsonb_build_object('lead_id', v_id, 'person_id', v_person);
end $$;

-- Intressentkön (R1.1 5.5). När en överenskommen intressent faller bort föreslås nästa i kön.
create function cmd.set_lead_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'lead_id');
  v_to resources.lead_status := core.req(p, 'status')::resources.lead_status;
  v_lead resources.lead;
  v_next uuid;
begin
  select * into v_lead from resources.lead where id = v_id and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Intressenten finns inte'); end if;
  if v_to = 'completed' then perform core.fail('use_flow', 'Avsluta med överlämning (sålt, skänkt, bytt eller utlånat)'); end if;
  perform core.assert_transition('lead', v_lead.status::text, v_to::text, p ->> 'override_reason');
  if v_to = 'agreed' and exists (select 1 from resources.lead where listing_id = v_lead.listing_id and status = 'agreed' and id <> v_id) then
    perform core.fail('already_agreed', 'Någon annan i kön har redan en överenskommelse');
  end if;
  update resources.lead set status = v_to, viewing_at = coalesce(core.opt_ts(p, 'viewing_at', null), viewing_at),
    address_shared_at = case when v_to = 'agreed' then now() else address_shared_at end
  where id = v_id;
  if v_to = 'agreed' then
    update resources.listing set status = 'agreed', agreed_at = now() where id = v_lead.listing_id and status = 'published';
    perform resources.listing_objects_to(v_lead.listing_id, 'reserved_out', '{listed}');
  elsif v_lead.status = 'agreed' and v_to in ('no_show', 'lost', 'rejected') then
    update resources.listing set status = 'published' where id = v_lead.listing_id and status = 'agreed';
    perform resources.listing_objects_to(v_lead.listing_id, 'listed', '{reserved_out}');
  end if;
  if v_to in ('no_show', 'lost', 'rejected') then
    select id into v_next from resources.lead where listing_id = v_lead.listing_id and status in ('new', 'replied', 'viewing_booked')
    order by queue_position limit 1;
  end if;
  return jsonb_build_object('lead_id', v_id, 'status', v_to, 'suggest_next_lead_id', v_next);
end $$;

-- Överlämning (AC-08): objektets status, köpare i CRM, pris (privat), annonsen stängs och en påminnelse
-- om nedtagning skapas för varje kanal där annonsen ligger ute.
create function cmd.complete_disposal(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_object uuid := core.req_uuid(p, 'object_id');
  v_type resources.disposal_type := core.req(p, 'type')::resources.disposal_type;
  v_listing uuid := core.opt_uuid(p, 'listing_id');
  v_lead uuid := core.opt_uuid(p, 'lead_id');
  v_person uuid := core.opt_uuid(p, 'counterpart_person_id');
  v_qty numeric := (p ->> 'quantity')::numeric;
  v_alloc uuid;
  v_id uuid := gen_random_uuid();
  v_at timestamptz := core.opt_ts(p, 'occurred_at');
  v_to resources.object_status := (case v_type when 'sold' then 'sold' when 'donated' then 'donated' when 'exchanged' then 'exchanged'
                                   when 'lent' then 'lent' else 'discarded' end)::resources.object_status;
  v_from_statuses resources.object_status[];
begin
  perform core.assert_entity(v_object, '{object}');
  if v_lead is not null then
    select person_id, listing_id into v_person, v_listing from resources.lead where id = v_lead and site_id = core.ctx_site();
  end if;
  if v_person is null and nullif(p ->> 'counterpart_name', '') is not null then
    v_person := people.create_person(p ->> 'counterpart_name', p ->> 'counterpart_locality');
  end if;
  if v_listing is not null and v_qty is null then select quantity into v_qty from resources.listing where id = v_listing; end if;
  v_from_statuses := case when v_type = 'discarded' then '{stored,processing,in_use}'::resources.object_status[]
                          else '{reserved_out,listed,stored,in_use,collected}'::resources.object_status[] end;
  -- Prioritera raden som är reserverad för köparen
  v_alloc := resources.take_allocation(v_object,
    coalesce(core.opt_uuid(p, 'allocation_id'),
      (select id from resources.batch_allocation where object_id = v_object and status = 'reserved_out' and (v_qty is null or quantity >= v_qty) order by quantity desc limit 1),
      (select id from resources.batch_allocation where object_id = v_object and status = 'listed' and (v_qty is null or quantity >= v_qty) order by quantity desc limit 1)),
    v_qty, v_from_statuses);
  -- Från annonserad hoppar vi över "reserverad för köpare" när överlämningen sker direkt
  if (select coalesce((select status from resources.batch_allocation where id = v_alloc), (select status from resources.object where id = v_object))) = 'listed'
     and v_type <> 'discarded' then
    perform resources.set_status(v_object, v_alloc, 'reserved_out', null, v_at);
  end if;
  perform resources.set_status(v_object, v_alloc, v_to, p ->> 'override_reason', v_at, null, v_type = 'lent');
  insert into resources.disposal (id, site_id, object_id, quantity, type, counterpart_person_id, counterpart_organization_id,
                                  external_place_id, listing_id, lead_id, occurred_at, note)
  values (v_id, core.ctx_site(), v_object, v_qty, v_type, v_person, core.opt_uuid(p, 'counterpart_organization_id'),
          core.opt_uuid(p, 'external_place_id'), v_listing, v_lead, v_at, p ->> 'note');
  if p ? 'price' or p ? 'payment_method' then
    insert into resources.disposal_private (site_id, disposal_id, price, payment_method)
    values (core.ctx_site(), v_id, (nullif(p ->> 'price', ''))::numeric, nullif(p ->> 'payment_method', ''));
  end if;
  if v_person is not null then
    perform people.add_role(v_person, case v_type when 'sold' then 'buyer' else 'recipient' end);
  end if;
  if v_lead is not null then update resources.lead set status = 'completed' where id = v_lead; end if;
  if v_listing is not null then
    update resources.listing set status = 'completed', completed_at = v_at where id = v_listing and status in ('published', 'agreed', 'ready');
    update resources.lead set status = 'lost' where listing_id = v_listing and status in ('new', 'replied', 'viewing_booked');
    insert into core.task (site_id, title, kind, due_at, subject_entity_id)
    select core.ctx_site(), format('Ta ner annonsen på %s', (select label_sv from core.code_value where list_code = 'channel' and code = c.channel_code and site_id is null)),
           'remove_listing', now(), v_listing
    from resources.channel_post c where c.listing_id = v_listing and c.status = 'posted';
  end if;
  perform core.record_history('disposal.' || v_type::text,
    format('%s %s%s', resources.object_label(v_object, v_qty),
      case v_type when 'sold' then 'såld' when 'donated' then 'skänkt' when 'exchanged' then 'bytt' when 'lent' then 'utlånad' else 'kasserad' end,
      coalesce(' till ' || (select display_name from people.person where id = v_person), '')),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_object, 'role', 'object'),
                      jsonb_build_object('id', v_person, 'role', 'counterpart'), jsonb_build_object('id', v_listing, 'role', 'listing')),
    v_at, core.opt_uuid(p, 'external_place_id'), v_type <> 'discarded', p ->> 'note');
  return jsonb_build_object('disposal_id', v_id, 'person_id', v_person,
    'remove_from_channels', (select coalesce(jsonb_agg(channel_code), '[]') from resources.channel_post where listing_id = v_listing and status = 'posted'));
end $$;

-- ------------------------------------------------------------------ kommandon: fordon och maskiner (R2.4)
create function cmd.create_vehicle(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_cap jsonb;
begin
  insert into resources.vehicle_machine (id, site_id, name, kind_code, owner_kind, owner_person_id, owner_organization_id, place_id, description, object_id)
  values (v_id, core.ctx_site(), core.req(p, 'name'), core.req(p, 'kind_code'),
          case when core.opt_uuid(p, 'owner_person_id') is not null then 'person'
               when core.opt_uuid(p, 'owner_organization_id') is not null then 'organization' else 'site' end,
          core.opt_uuid(p, 'owner_person_id'), core.opt_uuid(p, 'owner_organization_id'), core.opt_uuid(p, 'place_id'),
          p ->> 'description', core.opt_uuid(p, 'object_id'));
  for v_cap in select * from jsonb_array_elements(coalesce(p -> 'capabilities', '[]')) loop
    insert into people.capability (site_id, holder_entity_id, kind_code, value, unit, note)
    values (core.ctx_site(), v_id, v_cap ->> 'kind_code', (v_cap ->> 'value')::numeric, v_cap ->> 'unit', v_cap ->> 'note');
  end loop;
  return jsonb_build_object('vehicle_id', v_id);
end $$;

-- Bokning till hämtning eller aktivitet. Krockar avvisas med förslag på ledig tid.
create function cmd.reserve_resource(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_vehicle uuid := core.req_uuid(p, 'vehicle_id');
  v_from timestamptz := core.req(p, 'starts_at')::timestamptz;
  v_to timestamptz := core.req(p, 'ends_at')::timestamptz;
  v_clash resources.resource_reservation;
  v_id uuid := gen_random_uuid();
begin
  perform core.assert_entity(v_vehicle, '{vehicle_machine}');
  select * into v_clash from resources.resource_reservation where vehicle_id = v_vehicle and status in ('requested', 'confirmed')
    and tstzrange(starts_at, ends_at) && tstzrange(v_from, v_to) limit 1;
  if found then
    perform core.fail('reservation_clash', format('%s är redan bokad %s–%s', (select name from resources.vehicle_machine where id = v_vehicle),
      to_char(v_clash.starts_at, 'YYYY-MM-DD HH24:MI'), to_char(v_clash.ends_at, 'HH24:MI')),
      jsonb_build_object('starts_at', v_clash.ends_at, 'ends_at', v_clash.ends_at + (v_to - v_from)));
  end if;
  insert into resources.resource_reservation (id, site_id, vehicle_id, starts_at, ends_at, purpose_entity_id, note)
  values (v_id, core.ctx_site(), v_vehicle, v_from, v_to, core.opt_uuid(p, 'purpose_entity_id'), p ->> 'note');
  if (select entity_type from core.entity where id = core.opt_uuid(p, 'purpose_entity_id')) = 'pickup' then
    insert into resources.pickup_resource (site_id, pickup_id, vehicle_machine_id, label)
    values (core.ctx_site(), core.opt_uuid(p, 'purpose_entity_id'), v_vehicle, (select name from resources.vehicle_machine where id = v_vehicle));
  end if;
  return jsonb_build_object('reservation_id', v_id);
end $$;

create function cmd.record_maintenance(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_vehicle uuid := core.req_uuid(p, 'vehicle_id'); v_id uuid := gen_random_uuid();
begin
  perform core.assert_entity(v_vehicle, '{vehicle_machine}');
  insert into resources.vehicle_maintenance (id, site_id, vehicle_id, performed_on, kind, note, next_due_on)
  values (v_id, core.ctx_site(), v_vehicle, coalesce((p ->> 'performed_on')::date, current_date), core.req(p, 'kind'), p ->> 'note', (p ->> 'next_due_on')::date);
  return jsonb_build_object('maintenance_id', v_id);
end $$;

create function cmd.authorize_driver(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_vehicle uuid := core.req_uuid(p, 'vehicle_id'); v_id uuid := gen_random_uuid();
begin
  perform core.assert_entity(v_vehicle, '{vehicle_machine}');
  insert into resources.vehicle_authorization (id, site_id, vehicle_id, person_id, user_id, valid_from, valid_to, note)
  values (v_id, core.ctx_site(), v_vehicle, core.opt_uuid(p, 'person_id'), core.opt_uuid(p, 'user_id'), (p ->> 'valid_from')::date, (p ->> 'valid_to')::date, p ->> 'note');
  return jsonb_build_object('authorization_id', v_id);
end $$;

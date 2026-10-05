-- VRETA R1 · Milstolpe M1: grund och fångst
-- Tabeller, tillståndsmaskin, audit, händelser och radnivåsäkerhet (RLS).
-- Spec: docs/spec-r1.md avsnitt 5, 6, 12.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- typer
create type visibility as enum ('private', 'internal', 'shareable', 'public');
create type member_role as enum ('owner', 'contributor', 'viewer');
create type place_status as enum ('existing', 'planned', 'removed');
create type object_status as enum (
  'discovered','contacted','reserved','pickup_planned','collected','stored','processing',
  'in_use','listed','reserved_out','lent','declined','lost','sold','donated','exchanged','discarded');
create type consent as enum ('yes', 'no', 'ask');
create type acquisition_type as enum ('purchase','gift','exchange','loan','work_trade');
create type acquisition_status as enum ('lead','contacted','negotiating','agreed','received','settled','declined','lost');

-- ---------------------------------------------------------------- plats och medlemmar
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table site_members (
  site_id uuid not null references sites(id) on delete cascade,
  user_id uuid not null,
  role member_role not null,
  name text not null default '',
  primary key (site_id, user_id)
);

create or replace function member_role_for(p_site uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from site_members where site_id = p_site and user_id = auth.uid()
$$;

create or replace function is_member(p_site uuid) returns boolean
language sql stable as $$ select member_role_for(p_site) is not null $$;

create or replace function is_writer(p_site uuid) returns boolean
language sql stable as $$ select member_role_for(p_site) in ('owner','contributor') $$;

create or replace function is_owner(p_site uuid) returns boolean
language sql stable as $$ select member_role_for(p_site) = 'owner' $$;

-- Används av edge-funktionerna: får användaren registrera på någon plats?
create or replace function can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from site_members where user_id = auth.uid() and role in ('owner','contributor'))
$$;

-- ---------------------------------------------------------------- gemensamma kolumner
-- id, site_id, created_at, created_by, updated_at, archived_at på alla kärntabeller.

create table zones (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  kind text not null default '',
  status place_status not null default 'existing',
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table structures (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  zone_id uuid references zones(id) on delete set null,
  name text not null,
  kind text not null default '',
  status place_status not null default 'existing',
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table objects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  title text not null,
  category text not null default 'Övrigt',
  description text not null default '',
  material text not null default '',
  dimensions text not null default '',
  era text not null default '',
  condition smallint check (condition between 1 and 5),
  is_batch boolean not null default false,
  quantity numeric not null default 1 check (quantity > 0),
  unit text not null default 'st',
  status object_status not null default 'discovered',
  visibility visibility not null default 'shareable',
  source_type text not null default 'manual',
  zone_id uuid references zones(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  cover_media_id uuid,
  field_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- INV-05: i bruk kräver plats
  constraint in_use_has_place check (status <> 'in_use' or zone_id is not null or structure_id is not null)
);

create table persons (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  locality text not null default '',
  roles text[] not null default '{}',
  consent_name consent not null default 'ask',
  consent_image consent not null default 'ask',
  consent_contribution consent not null default 'ask',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- INV-13: kontaktuppgifter och CRM-anteckningar är alltid privata och ligger separat.
create table person_private (
  person_id uuid primary key references persons(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  contact text not null default '',
  notes text not null default '',
  created_by uuid not null default auth.uid()
);

create table acquisitions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  object_id uuid not null references objects(id) on delete cascade,
  person_id uuid references persons(id) on delete set null,
  type acquisition_type not null,
  status acquisition_status not null default 'lead',
  source_url text not null default '',
  deadline date,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Priser och betalsätt är privata (12.1).
create table acquisition_private (
  acquisition_id uuid primary key references acquisitions(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  price numeric,
  payment_method text not null default '',
  created_by uuid not null default auth.uid()
);

create table media (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('image','audio')),
  original_path text not null,          -- bucket media-original (privat)
  clean_path text,                      -- bucket media-clean (utan EXIF, INV-07)
  mime text not null,
  width int,
  height int,
  caption text not null default '',
  role text not null default 'general' check (role in ('general','before','during','after')),
  has_people boolean not null default false,
  visibility visibility not null default 'shareable',
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index on media (entity_type, entity_id);

create table captures (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  input jsonb not null,
  sync_state text not null default 'synced',
  proposal_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table proposals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  capture_id uuid not null references captures(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','partially_accepted','rejected','expired')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  summary text not null,
  notes text not null default '',
  story_worthy boolean not null default false,
  visibility visibility not null default 'shareable',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table event_links (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  role text not null default 'subject'
);
create index on event_links (entity_type, entity_id);

create table story_notes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  kind text not null check (kind in ('why','quote','moment')),
  text text not null,
  quote_consent boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  goal text not null,
  source_type text not null,
  source_id uuid not null,
  status text not null default 'draft' check (status in ('idea','draft','review','approved','shared','archived','rejected')),
  variants jsonb not null default '[]'::jsonb,
  sources text[] not null default '{}',
  warnings text[] not null default '{}',
  approved_by uuid,
  shared_url text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  title text not null,
  due date,
  status text not null default 'open' check (status in ('open','in_progress','done','snoozed','cancelled')),
  entity_type text not null default '',
  entity_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table audit_entries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb
);

-- ---------------------------------------------------------------- tillståndsmaskin (5.1)
create table object_transitions (
  from_status object_status not null,
  to_status object_status not null,
  primary key (from_status, to_status)
);
insert into object_transitions values
  ('discovered','contacted'),('discovered','reserved'),('discovered','collected'),('discovered','declined'),('discovered','lost'),
  ('contacted','reserved'),('contacted','collected'),('contacted','declined'),('contacted','lost'),
  ('reserved','pickup_planned'),('reserved','collected'),('reserved','declined'),('reserved','lost'),
  ('pickup_planned','collected'),('pickup_planned','reserved'),('pickup_planned','lost'),
  ('collected','stored'),('collected','processing'),('collected','in_use'),('collected','listed'),
  ('stored','processing'),('stored','in_use'),('stored','listed'),('stored','discarded'),
  ('processing','stored'),('processing','in_use'),('processing','listed'),('processing','discarded'),
  ('in_use','stored'),('in_use','processing'),('in_use','in_use'),('in_use','listed'),('in_use','discarded'),
  ('listed','stored'),('listed','reserved_out'),('listed','in_use'),
  ('reserved_out','listed'),('reserved_out','sold'),('reserved_out','donated'),('reserved_out','exchanged'),('reserved_out','lent'),
  ('lent','stored'),('lent','in_use');

-- Statusbyte: validera, skapa händelse + länk, logga. Ägaren kan korrigera historik
-- genom att sätta vreta.override = 'on' i transaktionen (loggas som override).
create or replace function objects_on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_override boolean := coalesce(current_setting('vreta.override', true), '') = 'on';
  v_event uuid;
begin
  if new.status is distinct from old.status then
    if not exists (select 1 from object_transitions where from_status = old.status and to_status = new.status) then
      if not (v_override and is_owner(new.site_id)) then
        raise exception 'Otillåten statusändring: % → %', old.status, new.status using errcode = 'check_violation';
      end if;
    end if;
    insert into events (site_id, event_type, summary, created_by)
      values (new.site_id, 'object.status_changed', format('%s: %s → %s', new.title, old.status, new.status), coalesce(auth.uid(), new.created_by))
      returning id into v_event;
    insert into event_links (site_id, event_id, entity_type, entity_id) values (new.site_id, v_event, 'object', new.id);
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
      values (new.site_id, auth.uid(), case when v_override then 'status_override' else 'status_change' end,
              'object', new.id, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger objects_status before update on objects
  for each row execute function objects_on_status_change();

-- Samtyckesändringar loggas alltid (INV-09).
create or replace function persons_on_consent_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.consent_name, new.consent_image, new.consent_contribution)
     is distinct from (old.consent_name, old.consent_image, old.consent_contribution) then
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
    values (new.site_id, auth.uid(), 'consent_change', 'person', new.id,
      jsonb_build_object('name', old.consent_name, 'image', old.consent_image, 'contribution', old.consent_contribution),
      jsonb_build_object('name', new.consent_name, 'image', new.consent_image, 'contribution', new.consent_contribution));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger persons_consent before update on persons for each row execute function persons_on_consent_change();

-- Samtycke får bara ändras av ägaren (12.4).
create or replace function persons_guard_consent() returns trigger
language plpgsql as $$
begin
  if (new.consent_name, new.consent_image, new.consent_contribution)
     is distinct from (old.consent_name, old.consent_image, old.consent_contribution)
     and not is_owner(new.site_id) then
    raise exception 'Bara ägaren kan ändra samtycke' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger persons_consent_guard before update on persons for each row execute function persons_guard_consent();

-- Delning och godkännande av innehåll loggas; bara ägaren får godkänna/dela (INV-04).
create or replace function content_on_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved','shared') and new.status is distinct from old.status then
    if not is_owner(new.site_id) then
      raise exception 'Bara ägaren kan godkänna och dela' using errcode = 'insufficient_privilege';
    end if;
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
    values (new.site_id, auth.uid(), 'content_' || new.status, 'content', new.id,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'shared_url', new.shared_url, 'variants', new.variants));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger content_change before update on content_items for each row execute function content_on_change();

-- ---------------------------------------------------------------- skapa från förslag (atomiskt)
-- p_input: { capture_id, proposal_id, object: {...}|null, person: {...}|null,
--            acquisition: {...}|null, task: {...}|null, why: text|null, media_ids: [uuid] }
create or replace function create_from_proposal(p_site uuid, p_input jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_object uuid;
  v_person uuid;
  v_acq uuid;
  v_event uuid;
  o jsonb := p_input->'object';
  p jsonb := p_input->'person';
  a jsonb := p_input->'acquisition';
  t jsonb := p_input->'task';
begin
  if not is_writer(p_site) then
    raise exception 'Saknar rätt att registrera' using errcode = 'insufficient_privilege';
  end if;

  insert into objects (site_id, title, category, description, material, dimensions, quantity, unit, is_batch,
                       condition, source_type, field_meta)
  values (p_site, o->>'title', coalesce(o->>'category','Övrigt'), coalesce(o->>'description',''),
          coalesce(o->>'material',''), coalesce(o->>'dimensions',''), coalesce((o->>'quantity')::numeric, 1),
          coalesce(o->>'unit','st'), coalesce((o->>'quantity')::numeric, 1) > 1,
          nullif(o->>'condition','')::smallint, 'ai_capture', coalesce(o->'field_meta','{}'::jsonb))
  returning id into v_object;

  if p is not null and p <> 'null'::jsonb then
    if p->>'existing_person_id' is not null then
      v_person := (p->>'existing_person_id')::uuid;
    else
      insert into persons (site_id, name, locality, roles)
      values (p_site, p->>'name', coalesce(p->>'locality',''),
              array[case when a->>'type' = 'gift' then 'Givare' else 'Leverantör' end])
      returning id into v_person;
      insert into person_private (person_id, site_id) values (v_person, p_site);
    end if;
  end if;

  if a is not null and a <> 'null'::jsonb then
    insert into acquisitions (site_id, object_id, person_id, type, status, deadline, source_url)
    values (p_site, v_object, v_person, (a->>'type')::acquisition_type, 'lead',
            nullif(a->>'deadline','')::date, coalesce(a->>'source_url',''))
    returning id into v_acq;
    insert into acquisition_private (acquisition_id, site_id, price)
    values (v_acq, p_site, nullif(a->>'price','')::numeric);
  end if;

  if t is not null and t <> 'null'::jsonb then
    insert into tasks (site_id, title, due, entity_type, entity_id)
    values (p_site, t->>'title', nullif(t->>'due','')::date, 'object', v_object);
  end if;

  if coalesce(p_input->>'why','') <> '' then
    insert into story_notes (site_id, entity_type, entity_id, kind, text)
    values (p_site, 'object', v_object, 'why', p_input->>'why');
  end if;

  update media set entity_type = 'object', entity_id = v_object
   where site_id = p_site and id in (select (jsonb_array_elements_text(coalesce(p_input->'media_ids','[]'::jsonb)))::uuid);
  update objects set cover_media_id = (select (p_input->'media_ids'->>0)::uuid) where id = v_object;

  insert into events (site_id, event_type, summary, story_worthy)
  values (p_site, 'object.discovered', format('Upptäckt: %s', o->>'title'), true)
  returning id into v_event;
  insert into event_links (site_id, event_id, entity_type, entity_id) values (p_site, v_event, 'object', v_object);
  if v_person is not null then
    insert into event_links (site_id, event_id, entity_type, entity_id, role) values (p_site, v_event, 'person', v_person, 'counterpart');
  end if;

  update proposals set status = coalesce(p_input->>'proposal_status', 'accepted'), updated_at = now()
   where id = (p_input->>'proposal_id')::uuid;

  insert into audit_entries (site_id, actor, action, entity_type, entity_id, after)
  values (p_site, auth.uid(), 'create_from_proposal', 'object', v_object, p_input);

  return v_object;
end $$;

-- ---------------------------------------------------------------- RLS
alter table sites enable row level security;
alter table site_members enable row level security;
alter table zones enable row level security;
alter table structures enable row level security;
alter table objects enable row level security;
alter table persons enable row level security;
alter table person_private enable row level security;
alter table acquisitions enable row level security;
alter table acquisition_private enable row level security;
alter table media enable row level security;
alter table captures enable row level security;
alter table proposals enable row level security;
alter table events enable row level security;
alter table event_links enable row level security;
alter table story_notes enable row level security;
alter table content_items enable row level security;
alter table tasks enable row level security;
alter table audit_entries enable row level security;
alter table object_transitions enable row level security;

create policy read_transitions on object_transitions for select to authenticated using (true);

create policy sites_read on sites for select to authenticated using (is_member(id));
create policy sites_owner_write on sites for update to authenticated using (is_owner(id));

create policy members_read on site_members for select to authenticated using (is_member(site_id));
create policy members_owner_write on site_members for all to authenticated using (is_owner(site_id)) with check (is_owner(site_id));

-- Privata rader (visibility = 'private') syns bara för ägaren och den som skapade dem (12.4).
create or replace function sees_private(p_site uuid, p_creator uuid) returns boolean
language sql stable as $$ select is_owner(p_site) or p_creator = auth.uid() $$;

create policy zones_read on zones for select to authenticated using (is_member(site_id));
create policy zones_insert on zones for insert to authenticated with check (is_writer(site_id));
create policy zones_update on zones for update to authenticated using (is_writer(site_id));

create policy structures_read on structures for select to authenticated using (is_member(site_id));
create policy structures_insert on structures for insert to authenticated with check (is_writer(site_id));
create policy structures_update on structures for update to authenticated using (is_writer(site_id));

create policy objects_read on objects for select to authenticated
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by)));
create policy objects_insert on objects for insert to authenticated with check (is_writer(site_id));
create policy objects_update on objects for update to authenticated
  using (is_writer(site_id) and (visibility <> 'private' or sees_private(site_id, created_by)));

create policy persons_read on persons for select to authenticated using (is_member(site_id));
create policy persons_insert on persons for insert to authenticated with check (is_writer(site_id));
create policy persons_update on persons for update to authenticated using (is_writer(site_id));

create policy person_private_read on person_private for select to authenticated using (sees_private(site_id, created_by));
create policy person_private_insert on person_private for insert to authenticated with check (is_writer(site_id));
create policy person_private_update on person_private for update to authenticated using (sees_private(site_id, created_by));

create policy acquisitions_read on acquisitions for select to authenticated using (is_member(site_id));
create policy acquisitions_insert on acquisitions for insert to authenticated with check (is_writer(site_id));
create policy acquisitions_update on acquisitions for update to authenticated using (is_writer(site_id));

create policy acquisition_private_read on acquisition_private for select to authenticated using (sees_private(site_id, created_by));
create policy acquisition_private_insert on acquisition_private for insert to authenticated with check (is_writer(site_id));
create policy acquisition_private_update on acquisition_private for update to authenticated using (sees_private(site_id, created_by));

create policy media_read on media for select to authenticated
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by)));
create policy media_insert on media for insert to authenticated with check (is_writer(site_id));
create policy media_update on media for update to authenticated using (is_writer(site_id));

create policy captures_read on captures for select to authenticated using (sees_private(site_id, created_by));
create policy captures_insert on captures for insert to authenticated with check (is_writer(site_id));
create policy captures_update on captures for update to authenticated using (sees_private(site_id, created_by));

create policy proposals_read on proposals for select to authenticated using (sees_private(site_id, created_by));
create policy proposals_insert on proposals for insert to authenticated with check (is_writer(site_id));
create policy proposals_update on proposals for update to authenticated using (sees_private(site_id, created_by));

create policy events_read on events for select to authenticated
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by)));
create policy events_insert on events for insert to authenticated with check (is_writer(site_id));

create policy event_links_read on event_links for select to authenticated using (is_member(site_id));
create policy event_links_insert on event_links for insert to authenticated with check (is_writer(site_id));

create policy story_notes_read on story_notes for select to authenticated using (is_member(site_id));
create policy story_notes_insert on story_notes for insert to authenticated with check (is_writer(site_id));
create policy story_notes_update on story_notes for update to authenticated using (is_writer(site_id));

create policy content_read on content_items for select to authenticated using (is_member(site_id));
create policy content_insert on content_items for insert to authenticated with check (is_writer(site_id));
create policy content_update on content_items for update to authenticated using (is_writer(site_id));

create policy tasks_read on tasks for select to authenticated using (is_member(site_id));
create policy tasks_insert on tasks for insert to authenticated with check (is_writer(site_id));
create policy tasks_update on tasks for update to authenticated using (is_writer(site_id));

create policy audit_read on audit_entries for select to authenticated using (is_owner(site_id));
create policy audit_insert on audit_entries for insert to authenticated
  with check (is_writer(site_id) and actor = auth.uid());

-- ---------------------------------------------------------------- första platsen
-- En inloggad användare utan medlemskap kan skapa sin första plats och bli ägare.
create or replace function bootstrap_site(p_name text, p_member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_site uuid;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  if exists (select 1 from site_members where user_id = auth.uid()) then
    raise exception 'Användaren har redan en plats';
  end if;
  insert into sites (name, created_by) values (p_name, auth.uid()) returning id into v_site;
  insert into site_members (site_id, user_id, role, name) values (v_site, auth.uid(), 'owner', p_member_name);
  return v_site;
end $$;

-- ---------------------------------------------------------------- lagring (Supabase Storage)
-- Sökväg: <site_id>/<media_id>.<ext>. Original med EXIF i privat bucket, rensade kopior separat.
insert into storage.buckets (id, name, public) values ('media-original', 'media-original', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('media-clean', 'media-clean', false) on conflict do nothing;

create policy media_clean_read on storage.objects for select to authenticated
  using (bucket_id = 'media-clean' and is_member(((storage.foldername(name))[1])::uuid));
create policy media_clean_write on storage.objects for insert to authenticated
  with check (bucket_id = 'media-clean' and is_writer(((storage.foldername(name))[1])::uuid));
create policy media_original_read on storage.objects for select to authenticated
  using (bucket_id = 'media-original' and (is_owner(((storage.foldername(name))[1])::uuid) or owner = auth.uid()));
create policy media_original_write on storage.objects for insert to authenticated
  with check (bucket_id = 'media-original' and is_writer(((storage.foldername(name))[1])::uuid));

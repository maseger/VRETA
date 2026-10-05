-- VRETA R1 · Milstolpe M4: utflöde och CRM
-- Annonser med kanalposter, intressenter, utflöde (försäljning, gåva, byte), bidrag,
-- ömsesidighet och samtycke per inlägg. Spec: docs/spec-r1.md avsnitt 4.6–4.8, 5.4–5.5, 9, 10, 12.

create type listing_type as enum ('sell', 'give', 'exchange', 'lend', 'wanted', 'help_wanted');
create type listing_status as enum ('draft', 'ready', 'published', 'agreed', 'completed', 'archived', 'withdrawn');
create type lead_status as enum ('new', 'replied', 'viewing_booked', 'agreed', 'completed', 'no_show', 'lost', 'rejected');
create type disposal_type as enum ('sold', 'donated', 'exchanged', 'discarded', 'lent');

-- ---------------------------------------------------------------- annonser (5.4, 9)
create table listings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  object_id uuid references objects(id) on delete set null,
  allocation_id uuid references batch_allocations(id) on delete set null,
  type listing_type not null,
  title text not null,
  description text not null default '',
  price numeric,                       -- annonserat pris (publikt i annonsen)
  quantity numeric,
  locality text not null default '',   -- ort, aldrig exakt adress (INV-12)
  status listing_status not null default 'draft',
  image_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table channel_posts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  channel text not null,               -- blocket, facebook_marketplace, …
  title text not null default '',
  text text not null default '',
  external_url text not null default '',
  status text not null default 'not_posted' check (status in ('not_posted', 'posted', 'removed')),
  publish_mode text not null default 'manual' check (publish_mode in ('manual', 'browser_agent', 'api')),
  posted_at timestamptz,
  removed_at timestamptz,
  unique (listing_id, channel)
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  person_id uuid references persons(id) on delete set null,
  channel text not null default '',
  queue_position int not null default 1,
  bid numeric,
  message text not null default '',     -- privat (meddelanden innehåller personuppgifter)
  status lead_status not null default 'new',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table listing_transitions (from_status listing_status, to_status listing_status, primary key (from_status, to_status));
insert into listing_transitions values
  ('draft','ready'),('draft','withdrawn'),
  ('ready','published'),('ready','draft'),('ready','withdrawn'),
  ('published','ready'),('published','agreed'),('published','withdrawn'),
  ('agreed','published'),('agreed','completed'),('agreed','withdrawn'),
  ('completed','archived'),('withdrawn','archived');

create table lead_transitions (from_status lead_status, to_status lead_status, primary key (from_status, to_status));
insert into lead_transitions values
  ('new','replied'),('new','viewing_booked'),('new','agreed'),('new','lost'),('new','rejected'),
  ('replied','viewing_booked'),('replied','agreed'),('replied','lost'),('replied','rejected'),
  ('viewing_booked','agreed'),('viewing_booked','no_show'),('viewing_booked','lost'),('viewing_booked','rejected'),
  ('agreed','completed'),('agreed','no_show'),('agreed','lost');

create or replace function check_status_transition() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if new.status is not distinct from old.status then
    new.updated_at := now();
    return new;
  end if;
  if tg_table_name = 'listings' then
    select exists (select 1 from listing_transitions where from_status = old.status and to_status = new.status) into v_ok;
  else
    select exists (select 1 from lead_transitions where from_status = old.status and to_status = new.status) into v_ok;
  end if;
  if not v_ok then
    raise exception 'Otillåten ändring: % → %', old.status, new.status using errcode = 'check_violation';
  end if;
  insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
  values (new.site_id, auth.uid(), tg_table_name || '_status', tg_table_name, new.id, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  new.updated_at := now();
  return new;
end $$;
create trigger listings_status before update on listings for each row execute function check_status_transition();
create trigger leads_status before update on leads for each row execute function check_status_transition();

-- ---------------------------------------------------------------- utflöde (Disposal)
create table disposals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  object_id uuid not null references objects(id) on delete cascade,
  allocation_id uuid references batch_allocations(id) on delete set null,
  listing_id uuid references listings(id) on delete set null,
  person_id uuid references persons(id) on delete set null,
  type disposal_type not null,
  quantity numeric,
  occurred_at timestamptz not null default now(),
  event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);
-- Försäljningspris och betalsätt är privata (12.1)
create table disposal_private (
  disposal_id uuid primary key references disposals(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  price numeric,
  payment_method text not null default '',
  created_by uuid not null default auth.uid()
);

-- Sätter status på det som annonsen gäller: en del av ett parti eller hela objektet.
create or replace function set_listing_target_status(p_listing uuid, p_status object_status) returns void
language plpgsql security invoker set search_path = public as $$
declare l listings%rowtype;
begin
  select * into l from listings where id = p_listing;
  if l.allocation_id is not null then
    if not exists (select 1 from object_transitions t join batch_allocations a on a.status = t.from_status
                    where a.id = l.allocation_id and t.to_status = p_status) then
      raise exception 'Delen kan inte få status %', p_status using errcode = 'check_violation';
    end if;
    update batch_allocations set status = p_status, updated_at = now(),
           storage_location_id = case when p_status in ('sold','donated','exchanged','discarded','lent') then null else storage_location_id end
     where id = l.allocation_id;
    perform sync_batch(l.object_id);
  elsif l.object_id is not null then
    update objects set status = p_status where id = l.object_id;
  end if;
end $$;

-- Publicera i en kanal (manuellt eller via agent): spara länk, annonsen och objektet blir utannonserade.
-- För ett parti flyttas annonsens antal till en egen del med status 'listed'.
create or replace function publish_channel(p_listing uuid, p_channel text, p_url text, p_mode text default 'manual') returns void
language plpgsql security invoker set search_path = public as $$
declare
  l listings%rowtype;
  o objects%rowtype;
  v_src batch_allocations%rowtype;
  v_alloc uuid;
begin
  select * into l from listings where id = p_listing;
  if not is_writer(l.site_id) then raise exception 'Saknar rätt' using errcode = 'insufficient_privilege'; end if;
  insert into channel_posts (site_id, listing_id, channel, external_url, status, publish_mode, posted_at)
  values (l.site_id, p_listing, p_channel, coalesce(p_url, ''), 'posted', p_mode, now())
  on conflict (listing_id, channel) do update set external_url = excluded.external_url, status = 'posted', publish_mode = excluded.publish_mode, posted_at = now(), removed_at = null;
  insert into audit_entries (site_id, actor, action, entity_type, entity_id, after)
  values (l.site_id, auth.uid(), 'channel_posted', 'listing', p_listing, jsonb_build_object('channel', p_channel, 'url', p_url, 'mode', p_mode));

  if l.status in ('draft', 'ready') then
    if l.status = 'draft' then update listings set status = 'ready' where id = p_listing; end if;
    update listings set status = 'published' where id = p_listing;
    if l.object_id is not null and l.type in ('sell', 'give', 'exchange', 'lend') then
      select * into o from objects where id = l.object_id;
      if o.is_batch and l.quantity is not null and l.quantity < o.quantity and l.allocation_id is null then
        perform ensure_allocations(o.id);
        select * into v_src from batch_allocations where object_id = o.id and status in ('collected','stored','processing')
         order by (status = 'stored') desc, quantity desc limit 1;
        if v_src.id is null or v_src.quantity < l.quantity then
          raise exception 'Det finns inte % % i lager att annonsera', l.quantity, o.unit using errcode = 'check_violation';
        end if;
        if v_src.quantity = l.quantity then
          update batch_allocations set status = 'listed', updated_at = now() where id = v_src.id returning id into v_alloc;
        else
          update batch_allocations set quantity = quantity - l.quantity, updated_at = now() where id = v_src.id;
          insert into batch_allocations (site_id, object_id, quantity, status, storage_location_id)
          values (o.site_id, o.id, l.quantity, 'listed', v_src.storage_location_id) returning id into v_alloc;
        end if;
        update listings set allocation_id = v_alloc where id = p_listing;
        perform sync_batch(o.id);
      elsif o.status <> 'listed' then
        perform set_listing_target_status(p_listing, 'listed');
      end if;
    end if;
  end if;
end $$;

create or replace function remove_channel(p_listing uuid, p_channel text) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update channel_posts set status = 'removed', removed_at = now() where listing_id = p_listing and channel = p_channel;
  -- Påminnelsen om att ta ner annonsen i kanalen är klar
  update tasks set status = 'done', updated_at = now()
   where entity_type = 'listing' and entity_id = p_listing and status = 'open' and title like '% på ' || p_channel;
  insert into audit_entries (site_id, actor, action, entity_type, entity_id, after)
  select site_id, auth.uid(), 'channel_removed', 'listing', id, jsonb_build_object('channel', p_channel) from listings where id = p_listing;
end $$;

-- Dra tillbaka annonsen: det utannonserade går tillbaka till lager och påminnelser skapas.
create or replace function withdraw_listing(p_listing uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare l listings%rowtype; v_target object_status;
begin
  select * into l from listings where id = p_listing;
  if l.allocation_id is not null then select status into v_target from batch_allocations where id = l.allocation_id;
  elsif l.object_id is not null then select status into v_target from objects where id = l.object_id; end if;
  update listings set status = 'withdrawn' where id = p_listing;
  if v_target = 'listed' then perform set_listing_target_status(p_listing, 'stored'); end if;
  insert into tasks (site_id, title, entity_type, entity_id, due)
  select l.site_id, format('Ta ner annonsen ”%s” på %s', l.title, cp.channel), 'listing', p_listing, current_date
    from channel_posts cp where cp.listing_id = p_listing and cp.status = 'posted';
end $$;

-- Ny intressent hamnar sist i kön
create or replace function leads_queue() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.queue_position := coalesce((select max(queue_position) from leads where listing_id = new.listing_id), 0) + 1;
  return new;
end $$;
create trigger leads_queue before insert on leads for each row execute function leads_queue();

-- Överenskommelse med en intressent: objektet reserveras för köparen.
create or replace function agree_lead(p_lead uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_listing uuid;
begin
  select listing_id into v_listing from leads where id = p_lead;
  update leads set status = 'agreed' where id = p_lead;
  update listings set status = 'agreed' where id = v_listing and status = 'published';
  perform set_listing_target_status(v_listing, 'reserved_out');
end $$;

-- Intressenten kom inte eller drog sig ur: tillbaka till publicerad, nästa i kön föreslås i appen.
create or replace function release_lead(p_lead uuid, p_status lead_status) returns void
language plpgsql security invoker set search_path = public as $$
declare v_listing uuid;
begin
  select listing_id into v_listing from leads where id = p_lead;
  update leads set status = p_status where id = p_lead;
  if not exists (select 1 from leads where listing_id = v_listing and status = 'agreed') then
    update listings set status = 'published' where id = v_listing and status = 'agreed';
    perform set_listing_target_status(v_listing, 'listed');
  end if;
end $$;

-- Avsluta affären (AC-08): utflöde, status, köpare i CRM, händelse – i en transaktion.
-- p_input: { lead_id, type, price, payment_method, person_id }
create or replace function complete_disposal(p_listing uuid, p_input jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  l listings%rowtype;
  v_lead leads%rowtype;
  v_type disposal_type := coalesce(nullif(p_input->>'type',''), case (select type from listings where id = p_listing)
                          when 'give' then 'donated' when 'exchange' then 'exchanged' when 'lend' then 'lent' else 'sold' end)::disposal_type;
  v_person uuid;
  v_disposal uuid;
  v_event uuid;
  v_title text;
  v_role text := case v_type when 'sold' then 'Köpare' when 'donated' then 'Mottagare' when 'exchanged' then 'Köpare' else 'Mottagare' end;
begin
  select * into l from listings where id = p_listing;
  if not is_writer(l.site_id) then raise exception 'Saknar rätt' using errcode = 'insufficient_privilege'; end if;
  if l.status <> 'agreed' then raise exception 'Annonsen måste ha en överenskommen intressent' using errcode = 'check_violation'; end if;
  select * into v_lead from leads where listing_id = p_listing and status = 'agreed'
    and (p_input->>'lead_id' is null or id = (p_input->>'lead_id')::uuid) limit 1;
  v_person := coalesce(v_lead.person_id, nullif(p_input->>'person_id','')::uuid);

  perform set_listing_target_status(p_listing, v_type::text::object_status);
  update listings set status = 'completed' where id = p_listing;
  if v_lead.id is not null then update leads set status = 'completed' where id = v_lead.id; end if;
  update leads set status = 'lost' where listing_id = p_listing and status in ('new','replied','viewing_booked');

  if v_person is not null then
    update persons set roles = array(select distinct unnest(roles || array[v_role])) where id = v_person;
  end if;

  select title into v_title from objects where id = l.object_id;
  insert into events (site_id, event_type, summary, story_worthy)
  values (l.site_id, 'disposal.' || v_type,
          format('%s: %s%s', case v_type when 'sold' then 'Såld' when 'donated' then 'Skänkt' when 'exchanged' then 'Bytt' when 'lent' then 'Utlånad' else 'Kasserad' end,
                 case when l.quantity is not null then l.quantity || ' st ' else '' end, lower(coalesce(v_title, l.title))), true)
  returning id into v_event;
  if l.object_id is not null then insert into event_links (site_id, event_id, entity_type, entity_id) values (l.site_id, v_event, 'object', l.object_id); end if;
  if v_person is not null then insert into event_links (site_id, event_id, entity_type, entity_id, role) values (l.site_id, v_event, 'person', v_person, 'counterpart'); end if;
  insert into event_links (site_id, event_id, entity_type, entity_id, role) values (l.site_id, v_event, 'listing', p_listing, 'source');

  insert into disposals (site_id, object_id, allocation_id, listing_id, person_id, type, quantity, event_id)
  values (l.site_id, l.object_id, l.allocation_id, p_listing, v_person, v_type, l.quantity, v_event) returning id into v_disposal;
  insert into disposal_private (disposal_id, site_id, price, payment_method)
  values (v_disposal, l.site_id, nullif(p_input->>'price','')::numeric, coalesce(p_input->>'payment_method',''));

  -- Påminn om att ta ner annonsen i alla kanaler där den ligger ute (4.6 steg 7)
  insert into tasks (site_id, title, entity_type, entity_id, due)
  select l.site_id, format('Ta ner annonsen ”%s” på %s', l.title, cp.channel), 'listing', p_listing, current_date
    from channel_posts cp where cp.listing_id = p_listing and cp.status = 'posted';

  insert into audit_entries (site_id, actor, action, entity_type, entity_id, after)
  values (l.site_id, auth.uid(), 'disposal', 'listing', p_listing, jsonb_build_object('type', v_type, 'disposal_id', v_disposal));
  return v_disposal;
end $$;

-- ---------------------------------------------------------------- bidrag och ömsesidighet (4.8, 10.6)
create type contribution_kind as enum ('material', 'tid', 'kunskap', 'maskin', 'transport', 'kontakter', 'mat', 'ekonomiskt', 'omsorg');

create table contributions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  person_id uuid not null references persons(id) on delete cascade,
  kind contribution_kind not null,
  description text not null,
  hours numeric,
  object_id uuid references objects(id) on delete set null,
  zone_id uuid references zones(id) on delete set null,
  project text not null default '',
  occurred_at timestamptz not null default now(),
  thanked_at timestamptz,
  visibility visibility not null default 'shareable',
  event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

create table reciprocity_entries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  person_id uuid not null references persons(id) on delete cascade,
  description text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

create or replace function contributions_journal() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_event uuid; v_name text; v_role text;
begin
  select name into v_name from persons where id = new.person_id;
  v_role := case new.kind when 'material' then 'Givare' when 'tid' then 'Medskapare' when 'kunskap' then 'Kunskapsbärare'
                          when 'transport' then 'Transportör' when 'maskin' then 'Medskapare' else 'Medskapare' end;
  update persons set roles = array(select distinct unnest(roles || array[v_role])) where id = new.person_id;
  insert into events (site_id, event_type, summary, visibility, story_worthy, occurred_at)
  values (new.site_id, 'contribution.' || new.kind, format('Bidrag från %s: %s', v_name, new.description), new.visibility, true, new.occurred_at)
  returning id into v_event;
  insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, v_event, 'person', new.person_id, 'contributor');
  insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, v_event, 'site', new.site_id, 'place');
  if new.object_id is not null then insert into event_links (site_id, event_id, entity_type, entity_id) values (new.site_id, v_event, 'object', new.object_id); end if;
  if new.zone_id is not null then insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, v_event, 'zone', new.zone_id, 'place'); end if;
  new.event_id := v_event;
  return new;
end $$;
create trigger contributions_journal before insert on contributions for each row execute function contributions_journal();

-- Samtycke för ett enskilt inlägg när personen har "fråga varje gång" (12.2)
create table content_consents (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,
  person_id uuid not null references persons(id) on delete cascade,
  name_ok boolean not null default false,
  image_ok boolean not null default false,
  contribution_ok boolean not null default false,
  how text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  unique (content_id, person_id)
);
create or replace function content_consents_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(new.site_id) then raise exception 'Bara ägaren kan registrera samtycke' using errcode = 'insufficient_privilege'; end if;
  insert into audit_entries (site_id, actor, action, entity_type, entity_id, after)
  values (new.site_id, auth.uid(), 'content_consent', 'person', new.person_id, to_jsonb(new));
  return new;
end $$;
create trigger content_consents_audit after insert or update on content_consents for each row execute function content_consents_audit();

-- ---------------------------------------------------------------- RLS
alter table listings enable row level security;
alter table channel_posts enable row level security;
alter table leads enable row level security;
alter table listing_transitions enable row level security;
alter table lead_transitions enable row level security;
alter table disposals enable row level security;
alter table disposal_private enable row level security;
alter table contributions enable row level security;
alter table reciprocity_entries enable row level security;
alter table content_consents enable row level security;

create policy listing_tr_read on listing_transitions for select to authenticated using (true);
create policy lead_tr_read on lead_transitions for select to authenticated using (true);
create policy listings_read on listings for select to authenticated using (is_member(site_id));
create policy listings_write on listings for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));
create policy channel_posts_read on channel_posts for select to authenticated using (is_member(site_id));
create policy channel_posts_write on channel_posts for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));
-- Intressenter och deras meddelanden: bara skrivare (läsare ser inte köpare)
create policy leads_read on leads for select to authenticated using (is_writer(site_id));
create policy leads_write on leads for all to authenticated using (is_writer(site_id)) with check (is_writer(site_id));
create policy disposals_read on disposals for select to authenticated using (is_member(site_id));
create policy disposals_insert on disposals for insert to authenticated with check (is_writer(site_id));
create policy disposal_private_read on disposal_private for select to authenticated using (sees_private(site_id, created_by));
create policy disposal_private_insert on disposal_private for insert to authenticated with check (is_writer(site_id));
create policy contributions_read on contributions for select to authenticated
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by)));
create policy contributions_insert on contributions for insert to authenticated with check (is_writer(site_id));
create policy contributions_update on contributions for update to authenticated using (is_writer(site_id));
create policy reciprocity_read on reciprocity_entries for select to authenticated using (is_member(site_id));
create policy reciprocity_insert on reciprocity_entries for insert to authenticated with check (is_writer(site_id));
create policy content_consents_read on content_consents for select to authenticated using (is_member(site_id));
create policy content_consents_write on content_consents for all to authenticated using (is_owner(site_id)) with check (is_owner(site_id));

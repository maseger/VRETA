-- VRETA 2 · Migrering 005 · Människor (People & Community)
-- Människor är aktörer, inte kontakter: roller, bidrag, relationer, samtycke och ömsesidighet.
-- Kontaktuppgifter och anteckningar ligger i privata tabeller (INV-13). Residency är alltid privat.

select core.define_entity_type('person', 'people.person', 'Person', 'Människor', '/person/:id', 'people', '{display_name,nickname,how_we_met}');
select core.define_entity_type('organization', 'people.organization', 'Organisation', 'Organisationer', '/organisation/:id', 'people', '{name,description,kind_code}');
select core.define_entity_type('interaction', 'people.interaction', 'Kontakt', 'Kontakthistorik', null, 'people', '{summary,body}');
select core.define_entity_type('contribution', 'people.contribution', 'Bidrag', 'Bidrag', null, 'people', '{description}');
select core.define_entity_type('reciprocity_entry', 'people.reciprocity_entry', 'Ömsesidighet', 'Ömsesidighet', null, 'people', '{description}');
select core.define_entity_type('residency', 'people.residency', 'Boende på platsen', 'Boende på platsen', null, 'people', '{note}', false, 'R2.6');
select core.define_entity_type('capability', 'people.capability', 'Kapacitet', 'Kapaciteter', null, 'people', '{note}', false, 'R2.4');

create table people.person (
  like core.entity_template including all,
  display_name text not null,
  nickname text,
  locality_id uuid references place.locality (id),
  how_we_met text,
  -- Länkar till Facebook/Instagram sparas bara med samtycke eller om personen själv delat dem (R1.1 10.5)
  social_profiles jsonb not null default '{}',
  -- Satt när personen raderats på begäran; historiken visar "Tidigare kontakt" (R1.1 12.5)
  erased_at timestamptz
);
create index person_name_trgm on people.person using gin (display_name extensions.gin_trgm_ops);
select core.register_table('people.person', 'standard', 'person', 'display_name', '{nickname,how_we_met}');

create table people.person_private (
  like core.link_template including all,
  person_id uuid not null unique references people.person (id),
  phone text,
  email text,
  address text,
  notes text,
  reliability_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('people.person_private', 'private');

create table people.organization (
  like core.entity_template including all,
  name text not null,
  kind_code text,
  locality_id uuid references place.locality (id),
  description text
);
select core.register_table('people.organization', 'standard', 'organization', 'name', '{description,kind_code}');
alter table core.site add constraint site_owner_org_fk foreign key (owner_organization_id) references people.organization (id);

create table people.organization_private (
  like core.link_template including all,
  organization_id uuid not null unique references people.organization (id),
  phone text,
  email text,
  address text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('people.organization_private', 'private');

create table people.person_organization (
  like core.link_template including all,
  person_id uuid not null references people.person (id),
  organization_id uuid not null references people.organization (id),
  role_title text,
  visibility core.visibility not null default 'internal',
  unique (person_id, organization_id)
);
select core.register_table('people.person_organization', 'staff');

create table people.person_role (
  like core.link_template including all,
  person_id uuid not null references people.person (id),
  role_code text not null,
  -- auto (från anskaffning, bidrag, avslut, tips) eller manual
  source text not null default 'manual',
  visibility core.visibility not null default 'internal',
  unique (person_id, role_code)
);
select core.register_table('people.person_role', 'standard');

-- Relationer mellan människor (R1.1 10.8): syns bara för ägare och medhjälpare. "introduced" är riktad:
-- person_id tipsade oss om other_person_id.
create table people.person_relation (
  like core.link_template including all,
  person_id uuid not null references people.person (id),
  other_person_id uuid not null references people.person (id),
  kind_code text not null,
  note text,
  visibility core.visibility not null default 'internal',
  check (person_id <> other_person_id)
);
create unique index person_relation_uq on people.person_relation
  (kind_code, least(person_id, other_person_id), greatest(person_id, other_person_id)) where kind_code <> 'introduced';
create unique index person_relation_directed_uq on people.person_relation (kind_code, person_id, other_person_id) where kind_code = 'introduced';
select core.register_table('people.person_relation', 'staff');

-- Kontakthistorik är alltid privat (R1.1 10.3).
create table people.interaction (
  like core.entity_template including all,
  person_id uuid references people.person (id),
  organization_id uuid references people.organization (id),
  channel_code text not null default 'message',
  occurred_at timestamptz not null default now(),
  summary text not null,
  body text,
  check (person_id is not null or organization_id is not null)
);
alter table people.interaction alter column visibility set default 'private';
alter table people.interaction add constraint interaction_always_private check (visibility = 'private');
select core.register_table('people.interaction', 'private', 'interaction', 'summary', '{body}');

-- Bidrag: material, tid, kunskap, transport, verktyg, kontakter, mat, omsorg. Kan kopplas till projekt,
-- aktivitet, evenemang och vistelse (främmande nycklar läggs till i 007 och 010).
create table people.contribution (
  like core.entity_template including all,
  person_id uuid references people.person (id),
  organization_id uuid references people.organization (id),
  type_code text not null,
  description text not null default '',
  amount numeric,
  unit text,
  hours numeric,
  occurred_at timestamptz not null default now(),
  subject_entity_id uuid references core.entity (id),
  project_id uuid,
  activity_id uuid,
  hosted_event_id uuid,
  stay_id uuid,
  thanked_at timestamptz,
  check (person_id is not null or organization_id is not null)
);
create index contribution_person_idx on people.contribution (person_id);
select core.register_table('people.contribution', 'standard', 'contribution', 'description');

create table people.reciprocity_entry (
  like core.entity_template including all,
  person_id uuid not null references people.person (id),
  type_code text not null,
  description text not null default '',
  occurred_at timestamptz not null default now()
);
select core.register_table('people.reciprocity_entry', 'standard', 'reciprocity_entry', 'description');

-- Samtycke per person (R1.1 12.2): namn, bild och bidrag – ja, nej eller fråga varje gång.
create table people.consent_policy (
  like core.link_template including all,
  person_id uuid not null unique references people.person (id),
  name core.consent_value not null default 'ask',
  image core.consent_value not null default 'ask',
  contribution core.consent_value not null default 'ask',
  given_at timestamptz,
  -- muntligt, meddelande, formulär
  given_how text,
  note text,
  visibility core.visibility not null default 'internal',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('people.consent_policy', 'standard');

-- Samtycke för ett enskilt inlägg (R1.1 12.2: "Fråga varje gång" sparas på just det inlägget).
create table people.content_consent (
  like core.link_template including all,
  content_item_id uuid not null,
  person_id uuid not null references people.person (id),
  aspect text not null check (aspect in ('name', 'image', 'contribution', 'quote')),
  value core.consent_value not null,
  given_at timestamptz not null default now(),
  given_how text,
  visibility core.visibility not null default 'internal',
  unique (content_item_id, person_id, aspect)
);
select core.register_table('people.content_consent', 'standard');

-- Människa som bor på platsen (R2.6). Alltid privat: bara ägaren ser vem som bor här.
create table people.residency (
  like core.entity_template including all,
  person_id uuid not null references people.person (id),
  place_id uuid references core.entity (id),
  period_start date not null,
  period_end date,
  kind text not null default 'resident',
  note text
);
alter table people.residency alter column visibility set default 'private';
alter table people.residency alter column sensitivity set default 'private_presence';
alter table people.residency add constraint residency_always_private check (visibility = 'private');
select core.register_table('people.residency', 'owner', 'residency', null, '{}', 'R2.6');

-- Vad en person, organisation, ett fordon eller en maskin kan bidra med (R2.4).
create table people.capability (
  like core.entity_template including all,
  holder_entity_id uuid not null references core.entity (id),
  kind_code text not null,
  value numeric,
  unit text,
  note text
);
create index capability_holder_idx on people.capability (holder_entity_id);
select core.register_table('people.capability', 'standard', 'capability', 'kind_code', '{note}', 'R2.4');

alter table core.media add constraint media_photographer_fk foreign key (photographer_person_id) references people.person (id);
alter table core.rights_record add constraint rights_creator_fk foreign key (creator_person_id) references people.person (id);

-- ------------------------------------------------------------------ regler
-- INV-15: ett foto på en person får aldrig högre synlighet än bildsamtycket. Privat tills personen sagt ja,
-- därefter internt; ändras samtycket ändras fotots synlighet med. Visar bilden flera personer gäller den strängaste.
create function people.apply_image_consent(p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update core.media m set visibility = case
      when exists (select 1 from core.media_link l2 left join people.consent_policy c2 on c2.person_id = l2.entity_id
                   where l2.media_id = m.id and l2.role in ('depicts', 'avatar') and coalesce(c2.image, 'ask') <> 'yes')
        then 'private'::core.visibility
      when m.visibility = 'private' then 'internal'::core.visibility
      else m.visibility end
  where m.id in (select media_id from core.media_link where entity_id = p_person and role in ('depicts', 'avatar'));
end $$;

create function people.add_role(p_person uuid, p_role text, p_source text default 'auto') returns void
language sql security definer set search_path = '' as $$
  insert into people.person_role (site_id, person_id, role_code, source)
  select site_id, id, p_role, p_source from people.person where id = p_person
  on conflict (person_id, role_code) do nothing
$$;

-- Hittar eller skapar en person med namn (för fångst och snabbregistrering). Matchar inte automatiskt
-- på bara förnamn – Linking Agent och granskningen föreslår dubbletter i stället.
create function people.create_person(p_name text, p_locality text default null, p_how text default null) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into people.person (id, site_id, display_name, locality_id, how_we_met)
  values (v_id, core.ctx_site(), btrim(p_name), place.ensure_locality(p_locality), p_how);
  insert into people.consent_policy (site_id, person_id) values (core.ctx_site(), v_id);
  return v_id;
end $$;

-- ------------------------------------------------------------------ kommandon
create function cmd.create_person(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_role text;
  v_media uuid := core.opt_uuid(p, 'photo_media_id');
begin
  v_id := people.create_person(core.req(p, 'display_name'), p ->> 'locality', p ->> 'how_we_met');
  if core.opt_uuid(p, 'locality_id') is not null then
    perform core.assert_entity(core.opt_uuid(p, 'locality_id'), '{locality}');
    update people.person set locality_id = core.opt_uuid(p, 'locality_id') where id = v_id;
  end if;
  update people.person set nickname = p ->> 'nickname' where id = v_id and p ? 'nickname';
  for v_role in select jsonb_array_elements_text(coalesce(p -> 'roles', '[]')) loop
    perform people.add_role(v_id, v_role, 'manual');
  end loop;
  if p ? 'phone' or p ? 'email' or p ? 'address' or p ? 'notes' then
    insert into people.person_private (site_id, person_id, phone, email, address, notes)
    values (core.ctx_site(), v_id, p ->> 'phone', p ->> 'email', p ->> 'address', p ->> 'notes');
  end if;
  if core.opt_uuid(p, 'organization_id') is not null then
    perform core.assert_entity(core.opt_uuid(p, 'organization_id'), '{organization}');
    insert into people.person_organization (site_id, person_id, organization_id) values (core.ctx_site(), v_id, core.opt_uuid(p, 'organization_id'));
  end if;
  if v_media is not null then
    perform core.assert_entity(v_media, '{media}');
    insert into core.media_link (site_id, media_id, entity_id, role) values (core.ctx_site(), v_media, v_id, 'avatar');
    perform people.apply_image_consent(v_id);
  end if;
  perform core.record_history('person.created', format('Ny kontakt: %s', p ->> 'display_name'),
    jsonb_build_array(jsonb_build_object('id', v_id)), core.opt_ts(p, 'occurred_at'));
  return jsonb_build_object('person_id', v_id);
end $$;

-- Namn och ort kan ändras direkt på personkortet (R1.1 FR-087).
create function cmd.update_person(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'person_id');
begin
  perform core.assert_entity(v_id, '{person}');
  update people.person set
    display_name = coalesce(nullif(btrim(p ->> 'display_name'), ''), display_name),
    nickname = case when p ? 'nickname' then nullif(p ->> 'nickname', '') else nickname end,
    how_we_met = case when p ? 'how_we_met' then nullif(p ->> 'how_we_met', '') else how_we_met end,
    locality_id = case when p ? 'locality' then place.ensure_locality(p ->> 'locality') else locality_id end,
    social_profiles = coalesce(p -> 'social_profiles', social_profiles)
  where id = v_id and erased_at is null;
  return jsonb_build_object('person_id', v_id);
end $$;

-- Foto på personen när den skapas och senare (R1.1 FR-086). Ett nytt foto ersätter det gamla, som arkiveras.
create function cmd.set_person_photo(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'person_id');
  v_media uuid := core.opt_uuid(p, 'media_id');
  v_old uuid;
begin
  perform core.assert_entity(v_id, '{person}');
  for v_old in select media_id from core.media_link where entity_id = v_id and role = 'avatar' loop
    delete from core.media_link where media_id = v_old and entity_id = v_id and role = 'avatar';
    update core.media set archived_at = now(), visibility = 'private' where id = v_old;
  end loop;
  if v_media is not null then
    perform core.assert_entity(v_media, '{media}');
    insert into core.media_link (site_id, media_id, entity_id, role) values (core.ctx_site(), v_media, v_id, 'avatar')
    on conflict do nothing;
    update core.media set has_people = true where id = v_media;
    perform people.apply_image_consent(v_id);
  end if;
  return jsonb_build_object('person_id', v_id, 'media_id', v_media);
end $$;

-- Ändra samtycke: bara ägaren, kräver nät (känsligt). Fotots synlighet följer med (INV-15). Återkallas
-- ett ja markeras delade inlägg där personen förekommer så att de kan tas ner (R1.1 12.2).
create function cmd.change_consent(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'person_id');
  v_old people.consent_policy;
  v_new people.consent_policy;
  v_item record;
begin
  perform core.assert_entity(v_id, '{person}');
  select * into v_old from people.consent_policy where person_id = v_id;
  if not found then
    insert into people.consent_policy (site_id, person_id) values (core.ctx_site(), v_id) returning * into v_old;
  end if;
  update people.consent_policy set
    name = coalesce(nullif(p ->> 'name', ''), name::text)::core.consent_value,
    image = coalesce(nullif(p ->> 'image', ''), image::text)::core.consent_value,
    contribution = coalesce(nullif(p ->> 'contribution', ''), contribution::text)::core.consent_value,
    given_at = coalesce(core.opt_ts(p, 'given_at', null), now()),
    given_how = coalesce(nullif(p ->> 'given_how', ''), given_how),
    note = coalesce(p ->> 'note', note)
  where person_id = v_id returning * into v_new;
  perform people.apply_image_consent(v_id);
  perform core.record_history('person.consent_changed',
    format('Samtycke: namn %s · bild %s · bidrag %s', v_new.name, v_new.image, v_new.contribution),
    jsonb_build_array(jsonb_build_object('id', v_id)), p_visibility => 'internal');
  if (v_old.name = 'yes' and v_new.name <> 'yes') or (v_old.image = 'yes' and v_new.image <> 'yes')
     or (v_old.contribution = 'yes' and v_new.contribution <> 'yes') then
    for v_item in
      select c.id, c.title from story.content_item c
      where c.site_id = core.ctx_site() and c.status = 'shared' and v_id = any (c.person_ids)
    loop
      insert into core.task (site_id, title, kind, due_at, subject_entity_id)
      values (core.ctx_site(), format('Samtycke återkallat – se över "%s"', v_item.title), 'consent_revoked', now(), v_item.id);
    end loop;
  end if;
  return jsonb_build_object('person_id', v_id, 'name', v_new.name, 'image', v_new.image, 'contribution', v_new.contribution);
end $$;

create function cmd.set_person_role(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'person_id');
  v_role text := core.req(p, 'role_code');
begin
  perform core.assert_entity(v_id, '{person}');
  if coalesce((p ->> 'remove')::boolean, false) then
    delete from people.person_role where person_id = v_id and role_code = v_role;
  else
    perform people.add_role(v_id, v_role, 'manual');
  end if;
  return jsonb_build_object('person_id', v_id, 'role_code', v_role);
end $$;

create function cmd.set_person_private(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'person_id');
begin
  perform core.assert_entity(v_id, '{person}');
  insert into people.person_private (site_id, person_id, phone, email, address, notes, reliability_note)
  values (core.ctx_site(), v_id, p ->> 'phone', p ->> 'email', p ->> 'address', p ->> 'notes', p ->> 'reliability_note')
  on conflict (person_id) do update set
    phone = case when p ? 'phone' then excluded.phone else people.person_private.phone end,
    email = case when p ? 'email' then excluded.email else people.person_private.email end,
    address = case when p ? 'address' then excluded.address else people.person_private.address end,
    notes = case when p ? 'notes' then excluded.notes else people.person_private.notes end,
    reliability_note = case when p ? 'reliability_note' then excluded.reliability_note else people.person_private.reliability_note end;
  return jsonb_build_object('person_id', v_id);
end $$;

create function cmd.log_interaction(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_person uuid := core.opt_uuid(p, 'person_id');
  v_org uuid := core.opt_uuid(p, 'organization_id');
begin
  if v_person is not null then perform core.assert_entity(v_person, '{person}'); end if;
  if v_org is not null then perform core.assert_entity(v_org, '{organization}'); end if;
  insert into people.interaction (id, site_id, person_id, organization_id, channel_code, occurred_at, summary, body)
  values (v_id, core.ctx_site(), v_person, v_org, coalesce(nullif(p ->> 'channel_code', ''), 'message'),
          core.opt_ts(p, 'occurred_at'), core.req(p, 'summary'), p ->> 'body');
  if nullif(p ->> 'follow_up_at', '') is not null then
    insert into core.task (site_id, title, kind, due_at, subject_entity_id, visibility)
    values (core.ctx_site(), coalesce(nullif(p ->> 'follow_up_title', ''), 'Följ upp ' || (select display_name from people.person where id = v_person)),
            'follow_up', core.opt_ts(p, 'follow_up_at'), coalesce(v_person, v_org), 'internal');
  end if;
  return jsonb_build_object('interaction_id', v_id);
end $$;

-- Bidrag (R1.1 4.8). Rollen sätts automatiskt (FR-029).
create function cmd.record_contribution(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_person uuid := core.opt_uuid(p, 'person_id');
  v_type text := core.req(p, 'type_code');
  v_subject uuid := core.opt_uuid(p, 'subject_entity_id');
  v_project uuid := core.opt_uuid(p, 'project_id');
  v_name text;
begin
  if v_person is null and nullif(p ->> 'person_name', '') is not null then
    v_person := people.create_person(p ->> 'person_name', p ->> 'locality');
  end if;
  if v_person is null and core.opt_uuid(p, 'organization_id') is null then
    perform core.fail('missing_field', 'Vem bidrog?');
  end if;
  if v_person is not null then perform core.assert_entity(v_person, '{person}'); end if;
  if v_subject is not null then perform core.assert_entity(v_subject); end if;
  if v_project is not null then perform core.assert_entity(v_project, '{project}'); end if;
  insert into people.contribution (id, site_id, person_id, organization_id, type_code, description, amount, unit, hours,
                                   occurred_at, subject_entity_id, project_id, activity_id, hosted_event_id, stay_id)
  values (v_id, core.ctx_site(), v_person, core.opt_uuid(p, 'organization_id'), v_type, coalesce(p ->> 'description', ''),
          (p ->> 'amount')::numeric, p ->> 'unit', (p ->> 'hours')::numeric, core.opt_ts(p, 'occurred_at'), v_subject, v_project,
          core.opt_uuid(p, 'activity_id'), core.opt_uuid(p, 'hosted_event_id'), core.opt_uuid(p, 'stay_id'));
  if v_person is not null then
    perform people.add_role(v_person, case v_type
      when 'transport' then 'transporter' when 'knowledge' then 'knowledge_bearer' when 'tip' then 'tipster'
      when 'material' then 'giver' else 'cocreator' end);
  end if;
  select display_name into v_name from people.person where id = v_person;
  perform core.record_history('contribution.recorded',
    format('%s bidrog: %s', coalesce(v_name, 'Någon'), coalesce(nullif(p ->> 'description', ''),
      (select label_sv from core.code_value where list_code = 'contribution_type' and code = v_type and site_id is null))),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_person, 'role', 'contributor'),
                      jsonb_build_object('id', v_subject, 'role', 'about'), jsonb_build_object('id', v_project, 'role', 'project')),
    core.opt_ts(p, 'occurred_at'), core.opt_uuid(p, 'place_id'), coalesce((p ->> 'story_value')::boolean, false));
  if v_project is not null and core.opt_uuid(p, 'need_id') is not null then
    perform change.fulfill_need(core.opt_uuid(p, 'need_id'), coalesce((p ->> 'need_quantity')::numeric, (p ->> 'amount')::numeric),
                                'contribution', p_contribution => v_id);
  end if;
  return jsonb_build_object('contribution_id', v_id, 'person_id', v_person);
end $$;

create function cmd.record_reciprocity(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_person uuid := core.req_uuid(p, 'person_id');
begin
  perform core.assert_entity(v_person, '{person}');
  insert into people.reciprocity_entry (id, site_id, person_id, type_code, description, occurred_at)
  values (v_id, core.ctx_site(), v_person, core.req(p, 'type_code'), coalesce(p ->> 'description', ''), core.opt_ts(p, 'occurred_at'));
  perform core.record_history('reciprocity.recorded',
    format('Vreta gav %s: %s', (select display_name from people.person where id = v_person), coalesce(p ->> 'description', p ->> 'type_code')),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_person, 'role', 'recipient')), core.opt_ts(p, 'occurred_at'));
  return jsonb_build_object('reciprocity_id', v_id);
end $$;

-- Markerar bidrag som tackade (efter ett tack-inlägg eller privat tack).
create function cmd.mark_thanked(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_person uuid := core.req_uuid(p, 'person_id'); v_n integer;
begin
  perform core.assert_entity(v_person, '{person}');
  update people.contribution set thanked_at = now() where person_id = v_person and thanked_at is null and site_id = core.ctx_site();
  get diagnostics v_n = row_count;
  perform core.record_history('person.thanked', format('Tack till %s', (select display_name from people.person where id = v_person)),
    jsonb_build_array(jsonb_build_object('id', v_person)), p_story_value => false);
  return jsonb_build_object('person_id', v_person, 'contributions', v_n);
end $$;

create function cmd.set_person_relation(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_a uuid := core.req_uuid(p, 'person_id');
  v_b uuid := core.req_uuid(p, 'other_person_id');
  v_kind text := core.req(p, 'kind_code');
begin
  perform core.assert_entity(v_a, '{person}');
  perform core.assert_entity(v_b, '{person}');
  if v_a = v_b then perform core.fail('invalid', 'En person kan inte ha en relation till sig själv'); end if;
  if coalesce((p ->> 'remove')::boolean, false) then
    delete from people.person_relation where kind_code = v_kind and
      ((person_id = v_a and other_person_id = v_b) or (kind_code <> 'introduced' and person_id = v_b and other_person_id = v_a));
  else
    insert into people.person_relation (site_id, person_id, other_person_id, kind_code, note)
    values (core.ctx_site(), v_a, v_b, v_kind, p ->> 'note') on conflict do nothing;
    if v_kind = 'introduced' then perform people.add_role(v_a, 'tipster'); end if;
  end if;
  return jsonb_build_object('person_id', v_a, 'other_person_id', v_b);
end $$;

create function cmd.create_organization(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into people.organization (id, site_id, name, kind_code, locality_id, description)
  values (v_id, core.ctx_site(), core.req(p, 'name'), p ->> 'kind_code', place.ensure_locality(p ->> 'locality'), p ->> 'description');
  if p ? 'phone' or p ? 'email' or p ? 'address' then
    insert into people.organization_private (site_id, organization_id, phone, email, address)
    values (core.ctx_site(), v_id, p ->> 'phone', p ->> 'email', p ->> 'address');
  end if;
  return jsonb_build_object('organization_id', v_id);
end $$;

create function cmd.link_person_organization(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_person uuid := core.req_uuid(p, 'person_id');
  v_org uuid := core.req_uuid(p, 'organization_id');
begin
  perform core.assert_entity(v_person, '{person}');
  perform core.assert_entity(v_org, '{organization}');
  if coalesce((p ->> 'remove')::boolean, false) then
    delete from people.person_organization where person_id = v_person and organization_id = v_org;
  else
    insert into people.person_organization (site_id, person_id, organization_id, role_title)
    values (core.ctx_site(), v_person, v_org, p ->> 'role_title')
    on conflict (person_id, organization_id) do update set role_title = excluded.role_title;
  end if;
  return jsonb_build_object('person_id', v_person, 'organization_id', v_org);
end $$;

create function cmd.set_capability(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_holder uuid := core.req_uuid(p, 'holder_entity_id');
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
begin
  perform core.assert_entity(v_holder, '{person,organization,vehicle_machine}');
  insert into people.capability (id, site_id, holder_entity_id, kind_code, value, unit, note)
  values (v_id, core.ctx_site(), v_holder, core.req(p, 'kind_code'), (p ->> 'value')::numeric, p ->> 'unit', p ->> 'note')
  on conflict (id) do update set kind_code = excluded.kind_code, value = excluded.value, unit = excluded.unit, note = excluded.note;
  return jsonb_build_object('capability_id', v_id);
end $$;

-- GDPR-radering på begäran (R1.1 12.5): personuppgifterna tas bort, historiken behålls med "Tidigare kontakt".
create function cmd.erase_person(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'person_id');
  v_media uuid;
begin
  perform core.assert_entity(v_id, '{person}');
  delete from people.person_private where person_id = v_id;
  delete from people.interaction where person_id = v_id;
  delete from people.person_relation where person_id = v_id or other_person_id = v_id;
  delete from people.person_organization where person_id = v_id;
  for v_media in select media_id from core.media_link where entity_id = v_id and role in ('avatar', 'depicts') loop
    delete from core.media_link where media_id = v_media and entity_id = v_id;
    update core.media set visibility = 'private', archived_at = now() where id = v_media;
  end loop;
  update people.person set display_name = 'Tidigare kontakt', nickname = null, how_we_met = null, social_profiles = '{}',
    locality_id = null, erased_at = now(), archived_at = now()
  where id = v_id;
  update people.consent_policy set name = 'no', image = 'no', contribution = 'no', note = 'Raderad på begäran' where person_id = v_id;
  return jsonb_build_object('person_id', v_id, 'erased', true);
end $$;

-- VRETA 2 · Migrering 010 · Värdskap och program (Hospitality & Program)
-- Plats är den fysiska verkligheten, boende är erbjudandet, vistelse det som händer. Evenemang med
-- sessioner, registreringar, venue-konfigurationer med plan B och EventReadiness. Vistelser,
-- förfrågningar, registreringar och närvaro är privata: bara ägaren och – för det egna evenemanget –
-- tilldelad värd ser dem. Gränssnitt i R2.6.

create type hospitality.stay_request_status as enum ('requested', 'approved', 'declined', 'withdrawn');
create type hospitality.stay_status as enum ('planned', 'checked_in', 'completed', 'cancelled');
create type hospitality.availability_kind as enum ('available', 'reserved', 'blocked_private', 'event');
create type hospitality.event_status as enum ('draft', 'planned', 'confirmed', 'ongoing', 'completed', 'cancelled');
create type hospitality.registration_status as enum ('requested', 'confirmed', 'waitlisted', 'cancelled');
create type hospitality.readiness_status as enum ('missing', 'in_progress', 'ready', 'not_applicable');
create type hospitality.weather_dependency as enum ('none', 'low', 'high');

select core.define_entity_type('accommodation', 'hospitality.accommodation', 'Boende', 'Boenden', '/boende/:id', 'hospitality', '{name,public_description,rules,access_info,accessibility}', false, 'R2.6');
select core.define_entity_type('availability_block', 'hospitality.availability_block', 'Tillgänglighet', 'Tillgänglighet', null, 'hospitality', '{note}', false, 'R2.6');
select core.define_entity_type('stay_request', 'hospitality.stay_request', 'Förfrågan om boende', 'Förfrågningar', null, 'hospitality', '{message}', false, 'R2.6');
select core.define_entity_type('stay', 'hospitality.stay', 'Vistelse', 'Vistelser', null, 'hospitality', '{note}', false, 'R2.6');
select core.define_entity_type('program_offering', 'hospitality.program_offering', 'Programformat', 'Programformat', null, 'hospitality', '{title,description}', false, 'R2.6');
select core.define_entity_type('hosted_event', 'hospitality.hosted_event', 'Evenemang', 'Evenemang', '/evenemang/:id', 'hospitality', '{title,public_description}', false, 'R2.6');
select core.define_entity_type('session', 'hospitality.session', 'Programdel', 'Programdelar', null, 'hospitality', '{title}', false, 'R2.6');
select core.define_entity_type('registration', 'hospitality.registration', 'Anmälan', 'Anmälningar', null, 'hospitality', '{special_needs}', false, 'R2.6');
select core.define_entity_type('venue_configuration', 'hospitality.venue_configuration', 'Venue-konfiguration', 'Venue-konfigurationer', null, 'hospitality', '{name,capacity_basis}', false, 'R2.6');

create table hospitality.accommodation (
  like core.entity_template including all,
  space_id uuid not null references place.space (id),
  name text not null,
  capacity integer not null check (capacity > 0),
  beds integer,
  season_from text,
  season_to text,
  rules text,
  accessibility text,
  access_info text,
  public_description text,
  active boolean not null default true,
  offered_from date,
  offered_to date
);
select core.register_table('hospitality.accommodation', 'standard', 'accommodation', 'name', '{public_description}', 'R2.6');

create table hospitality.accommodation_facility (
  like core.link_template including all,
  accommodation_id uuid not null references hospitality.accommodation (id),
  facility_code text not null,
  visibility core.visibility not null default 'internal',
  unique (accommodation_id, facility_code)
);
select core.register_table('hospitality.accommodation_facility', 'standard', p_ui_release => 'R2.6');

create table hospitality.program_offering (
  like core.entity_template including all,
  title text not null,
  kind_code text,
  description text,
  default_days integer,
  default_capacity integer
);
select core.register_table('hospitality.program_offering', 'standard', 'program_offering', 'title', '{description}', 'R2.6');

-- Kapacitet är en egenskap av konfigurationen, inte bara av fastigheten.
create table hospitality.venue_configuration (
  like core.entity_template including all,
  place_id uuid not null references core.entity (id),
  name text not null,
  layout_code text not null,
  capacity_target integer,
  -- Vilken kapacitetsgrund som används – designmål, aldrig juridiska besked
  capacity_basis text,
  requires_external_validation boolean not null default true,
  facilities text[] not null default '{}',
  weather_suitability text not null default 'any' check (weather_suitability in ('any', 'dry_only', 'sheltered'))
);
select core.register_table('hospitality.venue_configuration', 'standard', 'venue_configuration', 'name', '{capacity_basis}', 'R2.6');

-- Konfigurerbara designmål (12/80/40) per scenario.
create table hospitality.capacity_rule (
  like core.entity_template including all,
  scenario_code text not null,
  capacity_target integer not null,
  basis text not null,
  requires_external_validation boolean not null default true,
  unique (site_id, scenario_code)
);
select core.register_table('hospitality.capacity_rule', 'standard', p_ui_release => 'R2.6');

create table hospitality.hosted_event (
  like core.entity_template including all,
  program_offering_id uuid references hospitality.program_offering (id),
  title text not null,
  kind_code text,
  status hospitality.event_status not null default 'draft',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  place_id uuid references core.entity (id),
  capacity_target integer,
  weather_dependency hospitality.weather_dependency not null default 'none',
  venue_configuration_id uuid references hospitality.venue_configuration (id),
  plan_b_venue_configuration_id uuid references hospitality.venue_configuration (id),
  public_description text,
  publish_publicly boolean not null default false,
  check (ends_at >= starts_at)
);
select core.register_table('hospitality.hosted_event', 'custom', 'hosted_event', 'title', '{public_description}', 'R2.6');

create table hospitality.session (
  like core.entity_template including all,
  hosted_event_id uuid not null references hospitality.hosted_event (id),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  place_id uuid references core.entity (id),
  leader_person_id uuid references people.person (id),
  capacity integer,
  venue_configuration_id uuid references hospitality.venue_configuration (id),
  alt_venue_configuration_id uuid references hospitality.venue_configuration (id),
  weather_dependency hospitality.weather_dependency not null default 'none'
);
select core.register_table('hospitality.session', 'custom', 'session', 'title', '{}', 'R2.6');

create table hospitality.availability_block (
  like core.entity_template including all,
  accommodation_id uuid not null references hospitality.accommodation (id),
  starts_on date not null,
  ends_on date not null,
  kind hospitality.availability_kind not null,
  hosted_event_id uuid references hospitality.hosted_event (id),
  note text,
  check (ends_on >= starts_on)
);
select core.register_table('hospitality.availability_block', 'standard', 'availability_block', null, '{note}', 'R2.6');

create table hospitality.stay_request (
  like core.entity_template including all,
  accommodation_id uuid references hospitality.accommodation (id),
  person_id uuid references people.person (id),
  requester_name text,
  requester_contact text,
  starts_on date not null,
  ends_on date not null,
  party_size integer not null default 1,
  message text,
  status hospitality.stay_request_status not null default 'requested',
  decided_at timestamptz,
  decided_by uuid,
  contribute_submission_id uuid
);
alter table hospitality.stay_request alter column visibility set default 'private';
alter table hospitality.stay_request alter column sensitivity set default 'private_presence';
select core.register_table('hospitality.stay_request', 'owner', 'stay_request', 'requester_name', '{message}', 'R2.6');

create table hospitality.registration (
  like core.entity_template including all,
  hosted_event_id uuid not null references hospitality.hosted_event (id),
  person_id uuid references people.person (id),
  party_size integer not null default 1,
  status hospitality.registration_status not null default 'requested',
  special_needs text,
  stay_id uuid,
  session_ids uuid[] not null default '{}',
  consent_note text
);
alter table hospitality.registration alter column visibility set default 'private';
alter table hospitality.registration alter column sensitivity set default 'private_presence';
select core.register_table('hospitality.registration', 'presence', 'registration', null, '{}', 'R2.6');

create table hospitality.stay (
  like core.entity_template including all,
  accommodation_id uuid references hospitality.accommodation (id),
  person_id uuid references people.person (id),
  starts_on date not null,
  ends_on date not null,
  status hospitality.stay_status not null default 'planned',
  purpose_code text,
  stay_request_id uuid references hospitality.stay_request (id),
  hosted_event_id uuid references hospitality.hosted_event (id),
  registration_id uuid references hospitality.registration (id),
  checked_in_at timestamptz,
  note text,
  check (ends_on >= starts_on)
);
alter table hospitality.stay alter column visibility set default 'private';
alter table hospitality.stay alter column sensitivity set default 'private_presence';
select core.register_table('hospitality.stay', 'presence', 'stay', null, '{note}', 'R2.6');
alter table hospitality.registration add constraint registration_stay_fk foreign key (stay_id) references hospitality.stay (id);

create table hospitality.stay_guest (
  like core.link_template including all,
  stay_id uuid not null references hospitality.stay (id),
  person_id uuid references people.person (id),
  name text
);
select core.register_table('hospitality.stay_guest', 'presence', p_ui_release => 'R2.6');

create table hospitality.attendance (
  like core.link_template including all,
  hosted_event_id uuid not null references hospitality.hosted_event (id),
  registration_id uuid references hospitality.registration (id),
  session_id uuid references hospitality.session (id),
  person_id uuid references people.person (id),
  attended boolean not null default true,
  recorded_at timestamptz not null default now()
);
select core.register_table('hospitality.attendance', 'presence', p_ui_release => 'R2.6');

create table hospitality.readiness_requirement (
  like core.entity_template including all,
  event_kind_code text,
  area_code text not null,
  description text not null,
  required boolean not null default true
);
select core.register_table('hospitality.readiness_requirement', 'standard', p_ui_release => 'R2.6');

create table hospitality.readiness_check (
  like core.entity_template including all,
  hosted_event_id uuid not null references hospitality.hosted_event (id),
  requirement_id uuid references hospitality.readiness_requirement (id),
  area_code text not null,
  status hospitality.readiness_status not null default 'missing',
  note text,
  evidence_entity_id uuid references core.entity (id),
  unique (hosted_event_id, area_code, requirement_id)
);
select core.register_table('hospitality.readiness_check', 'custom', p_ui_release => 'R2.6');

alter table people.contribution add constraint contribution_event_fk foreign key (hosted_event_id) references hospitality.hosted_event (id);
alter table people.contribution add constraint contribution_stay_fk foreign key (stay_id) references hospitality.stay (id);
alter table change.activity add constraint activity_event_fk foreign key (hosted_event_id) references hospitality.hosted_event (id);

-- ------------------------------------------------------------------ värdens åtkomst
-- Rollen host ser bara det som host_assignment ger (Designdokument 2.0, Behörighet i databasen).
create function core.my_host_entities() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(h.entity_id), '{}') from core.host_assignment h
  join core.membership m on m.id = h.membership_id and m.revoked_at is null
  where h.user_id = auth.uid() and h.revoked_at is null
    and (h.ends_on is null or h.ends_on >= current_date)
$$;

-- Evenemang som värden når: tilldelade evenemang och evenemang med en tilldelad session.
create function core.my_host_events() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct e), '{}') from (
    select unnest(core.my_host_entities()) as e
    union select s.hosted_event_id from hospitality.session s where s.id = any (core.my_host_entities())
  ) x where exists (select 1 from hospitality.hosted_event h where h.id = x.e)
$$;

create policy read on hospitality.hosted_event for select to authenticated using (
  (site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[]))))
  or (visibility <> 'private' and site_id in (select unnest(core.sites_with_role('{owner,helper,reader}'::core.member_role[]))))
  or id in (select unnest(core.my_host_events())));
create policy read on hospitality.session for select to authenticated using (
  (site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[]))))
  or (visibility <> 'private' and site_id in (select unnest(core.sites_with_role('{owner,helper,reader}'::core.member_role[]))))
  or hosted_event_id in (select unnest(core.my_host_events())));
create policy read on hospitality.readiness_check for select to authenticated using (
  (site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[]))))
  or (visibility <> 'private' and site_id in (select unnest(core.sites_with_role('{owner,helper,reader}'::core.member_role[]))))
  or hosted_event_id in (select unnest(core.my_host_events())));
-- Privata oavsett roll utom för ägaren och, för det egna evenemanget, tilldelad värd.
create policy read on hospitality.registration for select to authenticated using (
  site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
  or hosted_event_id in (select unnest(core.my_host_events())));
create policy read on hospitality.attendance for select to authenticated using (
  site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
  or hosted_event_id in (select unnest(core.my_host_events())));
create policy read on hospitality.stay for select to authenticated using (
  site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
  or hosted_event_id in (select unnest(core.my_host_events())));
create policy read on hospitality.stay_guest for select to authenticated using (
  site_id in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
  or stay_id in (select s.id from hospitality.stay s));

insert into core.state (machine, state, label_sv, terminal, sort) values
  ('stay_request', 'requested', 'Förfrågan', false, 1), ('stay_request', 'approved', 'Godkänd', true, 2),
  ('stay_request', 'declined', 'Avböjd', true, 3), ('stay_request', 'withdrawn', 'Återtagen', true, 4),
  ('stay', 'planned', 'Planerad', false, 1), ('stay', 'checked_in', 'Incheckad', false, 2), ('stay', 'completed', 'Avslutad', true, 3),
  ('stay', 'cancelled', 'Inställd', true, 4),
  ('hosted_event', 'draft', 'Utkast', false, 1), ('hosted_event', 'planned', 'Planerat', false, 2), ('hosted_event', 'confirmed', 'Bekräftat', false, 3),
  ('hosted_event', 'ongoing', 'Pågår', false, 4), ('hosted_event', 'completed', 'Genomfört', true, 5), ('hosted_event', 'cancelled', 'Inställt', true, 6),
  ('registration', 'requested', 'Anmäld', false, 1), ('registration', 'confirmed', 'Bekräftad', false, 2),
  ('registration', 'waitlisted', 'Reserv', false, 3), ('registration', 'cancelled', 'Avbokad', true, 4);
insert into core.state_transition (machine, from_state, to_state) values
  ('stay_request', 'requested', 'approved'), ('stay_request', 'requested', 'declined'), ('stay_request', 'requested', 'withdrawn'),
  ('stay', 'planned', 'checked_in'), ('stay', 'checked_in', 'completed'), ('stay', 'planned', 'cancelled'), ('stay', 'planned', 'completed'),
  ('hosted_event', 'draft', 'planned'), ('hosted_event', 'planned', 'confirmed'), ('hosted_event', 'confirmed', 'ongoing'),
  ('hosted_event', 'ongoing', 'completed'), ('hosted_event', 'planned', 'ongoing'), ('hosted_event', 'draft', 'cancelled'),
  ('hosted_event', 'planned', 'cancelled'), ('hosted_event', 'confirmed', 'cancelled'),
  ('registration', 'requested', 'confirmed'), ('registration', 'requested', 'waitlisted'), ('registration', 'waitlisted', 'confirmed'),
  ('registration', 'requested', 'cancelled'), ('registration', 'confirmed', 'cancelled'), ('registration', 'waitlisted', 'cancelled');

-- ------------------------------------------------------------------ kommandon
create function cmd.create_accommodation(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_f text;
begin
  perform core.assert_entity(core.req_uuid(p, 'space_id'), '{space}');
  insert into hospitality.accommodation (id, site_id, space_id, name, capacity, beds, season_from, season_to, rules, accessibility, access_info, public_description, offered_from)
  values (v_id, core.ctx_site(), core.req_uuid(p, 'space_id'), core.req(p, 'name'), (core.req(p, 'capacity'))::integer, (p ->> 'beds')::integer,
          p ->> 'season_from', p ->> 'season_to', p ->> 'rules', p ->> 'accessibility', p ->> 'access_info', p ->> 'public_description',
          coalesce((p ->> 'offered_from')::date, current_date));
  for v_f in select jsonb_array_elements_text(coalesce(p -> 'facilities', '[]')) loop
    insert into hospitality.accommodation_facility (site_id, accommodation_id, facility_code) values (core.ctx_site(), v_id, v_f);
  end loop;
  perform core.record_history('hospitality.offered', format('Nytt boende: %s', p ->> 'name'), jsonb_build_array(jsonb_build_object('id', v_id)),
                              p_place_id => core.req_uuid(p, 'space_id'));
  return jsonb_build_object('accommodation_id', v_id);
end $$;

create function cmd.set_availability(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_acc uuid := core.req_uuid(p, 'accommodation_id');
begin
  perform core.assert_entity(v_acc, '{accommodation}');
  insert into hospitality.availability_block (id, site_id, accommodation_id, starts_on, ends_on, kind, hosted_event_id, note)
  values (v_id, core.ctx_site(), v_acc, (core.req(p, 'starts_on'))::date, (core.req(p, 'ends_on'))::date,
          core.req(p, 'kind')::hospitality.availability_kind, core.opt_uuid(p, 'hosted_event_id'), p ->> 'note');
  return jsonb_build_object('availability_block_id', v_id);
end $$;

-- Ägaren godkänner eller avböjer (ApproveStay). Godkänd förfrågan blir en privat vistelse och blockerar boendet.
create function cmd.decide_stay_request(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_req hospitality.stay_request;
  v_to hospitality.stay_request_status := core.req(p, 'status')::hospitality.stay_request_status;
  v_stay uuid;
  v_person uuid;
begin
  select * into v_req from hospitality.stay_request where id = core.req_uuid(p, 'stay_request_id') and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Förfrågan finns inte'); end if;
  perform core.assert_transition('stay_request', v_req.status::text, v_to::text);
  update hospitality.stay_request set status = v_to, decided_at = now(), decided_by = auth.uid() where id = v_req.id;
  if v_to = 'approved' then
    if v_req.accommodation_id is null then perform core.fail('missing_field', 'Välj boende innan förfrågan godkänns'); end if;
    if exists (select 1 from hospitality.availability_block b where b.accommodation_id = v_req.accommodation_id and b.kind <> 'available'
               and daterange(b.starts_on, b.ends_on, '[]') && daterange(v_req.starts_on, v_req.ends_on, '[]')) then
      perform core.fail('unavailable', 'Boendet är inte ledigt de datumen');
    end if;
    v_person := coalesce(v_req.person_id, people.create_person(coalesce(v_req.requester_name, 'Gäst'), null, 'Bo på Vreta'));
    if v_req.requester_contact is not null then
      insert into people.person_private (site_id, person_id, email) values (core.ctx_site(), v_person, v_req.requester_contact)
      on conflict (person_id) do nothing;
    end if;
    insert into hospitality.stay (site_id, accommodation_id, person_id, starts_on, ends_on, purpose_code, stay_request_id)
    values (core.ctx_site(), v_req.accommodation_id, v_person, v_req.starts_on, v_req.ends_on, coalesce(nullif(p ->> 'purpose_code', ''), 'guest'), v_req.id)
    returning id into v_stay;
    insert into hospitality.availability_block (site_id, accommodation_id, starts_on, ends_on, kind, visibility)
    values (core.ctx_site(), v_req.accommodation_id, v_req.starts_on, v_req.ends_on, 'reserved', 'internal');
    perform people.add_role(v_person, 'guest');
  end if;
  return jsonb_build_object('stay_request_id', v_req.id, 'status', v_to, 'stay_id', v_stay);
end $$;

create function cmd.set_stay_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'stay_id'); v_to hospitality.stay_status := core.req(p, 'status')::hospitality.stay_status; v_from hospitality.stay_status;
begin
  select status into v_from from hospitality.stay where id = v_id and site_id = core.ctx_site() for update;
  if v_from is null then perform core.fail('not_found', 'Vistelsen finns inte'); end if;
  perform core.assert_transition('stay', v_from::text, v_to::text);
  update hospitality.stay set status = v_to, checked_in_at = case when v_to = 'checked_in' then now() else checked_in_at end where id = v_id;
  return jsonb_build_object('stay_id', v_id, 'status', v_to);
end $$;

create function cmd.create_hosted_event(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_req hospitality.readiness_requirement; v_area record;
begin
  insert into hospitality.hosted_event (id, site_id, program_offering_id, title, kind_code, status, starts_at, ends_at, place_id, capacity_target,
                                        weather_dependency, venue_configuration_id, plan_b_venue_configuration_id, public_description, publish_publicly)
  values (v_id, core.ctx_site(), core.opt_uuid(p, 'program_offering_id'), core.req(p, 'title'), p ->> 'kind_code', 'planned',
          core.req(p, 'starts_at')::timestamptz, core.req(p, 'ends_at')::timestamptz, core.opt_uuid(p, 'place_id'), (p ->> 'capacity_target')::integer,
          coalesce(nullif(p ->> 'weather_dependency', ''), 'none')::hospitality.weather_dependency, core.opt_uuid(p, 'venue_configuration_id'),
          core.opt_uuid(p, 'plan_b_venue_configuration_id'), p ->> 'public_description', coalesce((p ->> 'publish_publicly')::boolean, false));
  -- Beredskapslistan: platsens egna krav för evenemangsslaget, annars alla områden i kodlistan
  for v_area in select code from core.code_value where list_code = 'readiness_area' and site_id is null order by sort loop
    insert into hospitality.readiness_check (site_id, hosted_event_id, area_code, requirement_id)
    values (core.ctx_site(), v_id, v_area.code,
            (select id from hospitality.readiness_requirement r where r.site_id = core.ctx_site() and r.area_code = v_area.code
               and (r.event_kind_code is null or r.event_kind_code = p ->> 'kind_code') limit 1));
  end loop;
  perform core.record_history('hospitality.event_planned', format('Evenemang planerat: %s', p ->> 'title'), jsonb_build_array(jsonb_build_object('id', v_id)),
                              p_place_id => core.opt_uuid(p, 'place_id'));
  return jsonb_build_object('hosted_event_id', v_id);
end $$;

create function cmd.add_session(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  perform core.assert_entity(core.req_uuid(p, 'hosted_event_id'), '{hosted_event}');
  insert into hospitality.session (id, site_id, hosted_event_id, title, starts_at, ends_at, place_id, leader_person_id, capacity,
                                   venue_configuration_id, alt_venue_configuration_id, weather_dependency)
  values (v_id, core.ctx_site(), core.req_uuid(p, 'hosted_event_id'), core.req(p, 'title'), core.req(p, 'starts_at')::timestamptz,
          core.req(p, 'ends_at')::timestamptz, core.opt_uuid(p, 'place_id'), core.opt_uuid(p, 'leader_person_id'), (p ->> 'capacity')::integer,
          core.opt_uuid(p, 'venue_configuration_id'), core.opt_uuid(p, 'alt_venue_configuration_id'),
          coalesce(nullif(p ->> 'weather_dependency', ''), 'none')::hospitality.weather_dependency);
  return jsonb_build_object('session_id', v_id);
end $$;

create function cmd.add_venue_configuration(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  perform place.assert_place(core.req_uuid(p, 'place_id'));
  insert into hospitality.venue_configuration (id, site_id, place_id, name, layout_code, capacity_target, capacity_basis, requires_external_validation, facilities, weather_suitability)
  values (v_id, core.ctx_site(), core.req_uuid(p, 'place_id'), core.req(p, 'name'), core.req(p, 'layout_code'), (p ->> 'capacity_target')::integer,
          coalesce(p ->> 'capacity_basis', 'Designmål'), coalesce((p ->> 'requires_external_validation')::boolean, true),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'facilities') x), '{}'),
          coalesce(nullif(p ->> 'weather_suitability', ''), 'any'));
  return jsonb_build_object('venue_configuration_id', v_id);
end $$;

create function cmd.register_participant(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_person uuid := core.opt_uuid(p, 'person_id');
begin
  perform core.assert_entity(core.req_uuid(p, 'hosted_event_id'), '{hosted_event}');
  if v_person is null then v_person := people.create_person(core.req(p, 'person_name'), null, 'Anmälan'); end if;
  insert into hospitality.registration (id, site_id, hosted_event_id, person_id, party_size, status, special_needs, stay_id, session_ids)
  values (v_id, core.ctx_site(), core.req_uuid(p, 'hosted_event_id'), v_person, coalesce((p ->> 'party_size')::integer, 1),
          coalesce(nullif(p ->> 'status', ''), 'confirmed')::hospitality.registration_status, p ->> 'special_needs', core.opt_uuid(p, 'stay_id'),
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'session_ids') x), '{}'));
  return jsonb_build_object('registration_id', v_id, 'person_id', v_person);
end $$;

-- Värden får registrera närvaro för sitt eget evenemang.
create function cmd.record_attendance(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_event uuid := core.req_uuid(p, 'hosted_event_id'); v_id uuid := gen_random_uuid();
begin
  if core.ctx_role() = 'host' and not (v_event = any (core.my_host_events())) then
    perform core.fail('forbidden', 'Du är inte värd för det evenemanget');
  end if;
  insert into hospitality.attendance (id, site_id, hosted_event_id, registration_id, session_id, person_id, attended)
  values (v_id, core.ctx_site(), v_event, core.opt_uuid(p, 'registration_id'), core.opt_uuid(p, 'session_id'), core.opt_uuid(p, 'person_id'),
          coalesce((p ->> 'attended')::boolean, true));
  return jsonb_build_object('attendance_id', v_id);
end $$;

create function cmd.set_readiness_check(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_event uuid := core.req_uuid(p, 'hosted_event_id');
begin
  if core.ctx_role() = 'host' and not (v_event = any (core.my_host_events())) then
    perform core.fail('forbidden', 'Du är inte värd för det evenemanget');
  end if;
  update hospitality.readiness_check set status = core.req(p, 'status')::hospitality.readiness_status, note = coalesce(p ->> 'note', note),
    evidence_entity_id = coalesce(core.opt_uuid(p, 'evidence_entity_id'), evidence_entity_id)
  where hosted_event_id = v_event and area_code = core.req(p, 'area_code') and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Beredskapsposten finns inte'); end if;
  return jsonb_build_object('hosted_event_id', v_event, 'area_code', p ->> 'area_code');
end $$;

create function cmd.assign_host(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_m core.membership; v_id uuid := gen_random_uuid();
begin
  select * into v_m from core.membership where id = core.req_uuid(p, 'membership_id') and site_id = core.ctx_site() and revoked_at is null;
  if not found then perform core.fail('not_found', 'Medlemmen finns inte'); end if;
  perform core.assert_entity(core.req_uuid(p, 'entity_id'), '{hosted_event,session,tour}');
  insert into core.host_assignment (id, site_id, membership_id, user_id, entity_id, starts_on, ends_on)
  values (v_id, core.ctx_site(), v_m.id, v_m.user_id, core.req_uuid(p, 'entity_id'), (p ->> 'starts_on')::date, (p ->> 'ends_on')::date);
  return jsonb_build_object('host_assignment_id', v_id);
end $$;

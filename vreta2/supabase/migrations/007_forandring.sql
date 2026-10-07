-- VRETA 2 · Migrering 007 · Förändring (Change & Vision)
-- Projektträd (initiativ → projekt → delprojekt), behov med uppfyllelse som räknas fram och aldrig lagras,
-- Moment och Activity, beslut, visioner och målbilder. Knyter NU, PLAN och VISION till händelser,
-- resurser och platser.

create type change.project_status as enum ('idea', 'planned', 'active', 'paused', 'done');
create type change.need_status as enum ('open', 'dropped');
create type change.activity_status as enum ('planned', 'ongoing', 'completed', 'cancelled');
create type change.vision_status as enum ('active', 'chosen', 'abandoned', 'archived');
create type change.alternative_status as enum ('proposed', 'chosen', 'abandoned');
create type change.asset_kind as enum ('inspiration', 'sketch', 'reference', 'moodboard', 'photo_now');

select core.define_entity_type('project', 'change.project', 'Projekt', 'Projekt', '/projekt/:id', 'change', '{name,description,kind_code}');
select core.define_entity_type('need', 'change.need', 'Behov', 'Behov', null, 'change', '{title,note,quantity,unit}');
select core.define_entity_type('need_fulfillment', 'change.need_fulfillment', 'Uppfyllelse', 'Uppfyllelser', null, 'change', '{note}');
select core.define_entity_type('moment', 'change.moment', 'Moment', 'Moment', '/moment/:id', 'change', '{title,note}', false, 'R2.4');
select core.define_entity_type('activity', 'change.activity', 'Aktivitet', 'Aktiviteter', '/aktivitet/:id', 'change', '{title,note}', false, 'R2.4');
select core.define_entity_type('decision', 'change.decision', 'Beslut', 'Beslut', '/beslut/:id', 'change', '{question,background,choice,rationale,later_outcome}');
select core.define_entity_type('vision_board', 'change.vision_board', 'Vision Board', 'Vision Boards', '/vision-board/:id', 'change', '{title,description}', false, 'R2.2');
select core.define_entity_type('vision', 'change.vision', 'Vision', 'Visioner', '/vision/:id', 'change', '{title,statement}', false, 'R2.2');
select core.define_entity_type('vision_asset', 'change.vision_asset', 'Visionsbild', 'Visionsbilder', null, 'change', '{why_relevant,source}', false, 'R2.2');
select core.define_entity_type('vision_alternative', 'change.vision_alternative', 'Designalternativ', 'Designalternativ', null, 'change', '{title,description}', false, 'R2.2');
select core.define_entity_type('target_state', 'change.target_state', 'Målbild', 'Målbilder', null, 'change', '{title,description}', false, 'R2.2');

create table change.project (
  like core.entity_template including all,
  name text not null,
  kind_code text,
  status change.project_status not null default 'idea',
  parent_id uuid references change.project (id),
  place_id uuid references core.entity (id),
  geom extensions.geometry(Geometry, 4326),
  description text,
  started_on date,
  finished_on date
);
create index project_parent_idx on change.project (parent_id);
create unique index project_name_uq on change.project (site_id, lower(name)) where archived_at is null;
select core.register_table('change.project', 'standard', 'project', 'name', '{description}');

create table change.need (
  like core.entity_template including all,
  project_id uuid not null references change.project (id),
  title text not null,
  kind_code text not null default 'material',
  quantity numeric check (quantity is null or quantity > 0),
  unit text,
  category_id uuid references resources.category (id),
  status change.need_status not null default 'open',
  note text
);
create index need_project_idx on change.need (project_id);
select core.register_table('change.need', 'standard', 'need', 'title', '{note}');

-- Uppfyllelsegraden räknas fram ur dessa rader och lagras aldrig (R1.1 4.10).
create table change.need_fulfillment (
  like core.entity_template including all,
  need_id uuid not null references change.need (id),
  quantity numeric,
  source_kind text not null check (source_kind in ('usage', 'contribution', 'acquisition', 'activity', 'none')),
  usage_event_id uuid references resources.usage_event (id),
  contribution_id uuid references people.contribution (id),
  acquisition_id uuid references resources.acquisition (id),
  object_id uuid references resources.object (id),
  activity_id uuid,
  occurred_at timestamptz not null default now(),
  note text
);
create index need_fulfillment_need_idx on change.need_fulfillment (need_id);
select core.register_table('change.need_fulfillment', 'standard', 'need_fulfillment', null, '{note}');

-- Projektets avsikt att gynna eller risk att störa livsmiljöer och arter (R2.3).
create table change.project_habitat_intent (
  like core.entity_template including all,
  project_id uuid not null references change.project (id),
  target_entity_id uuid references core.entity (id),
  taxon_id uuid,
  intent text not null check (intent in ('benefit', 'risk')),
  note text
);
select core.register_table('change.project_habitat_intent', 'standard', p_ui_release => 'R2.3');

-- Moment: ett snabbt fångat ögonblick – foto, röst, plats, människor (R2.4).
create table change.moment (
  like core.entity_template including all,
  title text not null,
  note text,
  occurred_at timestamptz not null default now(),
  place_id uuid references core.entity (id),
  geom extensions.geometry(Point, 4326),
  location_precision core.location_precision not null default 'zone',
  story_value boolean not null default false,
  capture_id uuid references core.capture (id)
);
select core.register_table('change.moment', 'standard', 'moment', 'title', '{note}', 'R2.4');

-- Activity: något som görs över tid – mura, plantera, skörda, laga mat, renovera (R2.4).
create table change.activity (
  like core.entity_template including all,
  title text not null,
  kind_code text,
  status change.activity_status not null default 'planned',
  started_at timestamptz,
  ended_at timestamptz,
  place_id uuid references core.entity (id),
  project_id uuid references change.project (id),
  hosted_event_id uuid,
  note text
);
select core.register_table('change.activity', 'standard', 'activity', 'title', '{note}', 'R2.4');

create table change.activity_participant (
  like core.link_template including all,
  activity_id uuid not null references change.activity (id),
  person_id uuid references people.person (id),
  user_id uuid,
  hours numeric,
  role text,
  visibility core.visibility not null default 'internal',
  check (person_id is not null or user_id is not null)
);
select core.register_table('change.activity_participant', 'standard', p_ui_release => 'R2.4');

create table change.activity_resource (
  like core.link_template including all,
  activity_id uuid not null references change.activity (id),
  vehicle_machine_id uuid references resources.vehicle_machine (id),
  object_id uuid references resources.object (id),
  quantity numeric,
  note text,
  visibility core.visibility not null default 'internal'
);
select core.register_table('change.activity_resource', 'standard', p_ui_release => 'R2.4');

create table change.decision (
  like core.entity_template including all,
  question text not null,
  background text,
  alternatives jsonb not null default '[]',
  choice text,
  rationale text,
  decided_at timestamptz not null default now(),
  later_outcome text,
  project_id uuid references change.project (id),
  place_id uuid references core.entity (id),
  vision_alternative_id uuid
);
select core.register_table('change.decision', 'standard', 'decision', 'question', '{background,choice,rationale,later_outcome}');

-- Visioner och målbilder (R2.2): inspiration → vision → målbild → alternativ → beslut → plan.
-- Inspirationsbilder är aldrig foton från Vreta och bär källa och rättighet.
create table change.vision_board (
  like core.entity_template including all,
  title text not null,
  subject_entity_id uuid references core.entity (id),
  description text
);
select core.register_table('change.vision_board', 'standard', 'vision_board', 'title', '{description}', 'R2.2');

create table change.vision (
  like core.entity_template including all,
  vision_board_id uuid references change.vision_board (id),
  subject_entity_id uuid references core.entity (id),
  title text not null,
  statement text,
  status change.vision_status not null default 'active',
  archived_reason text
);
select core.register_table('change.vision', 'standard', 'vision', 'title', '{statement}', 'R2.2');
alter table change.project add column vision_id uuid references change.vision (id);

create table change.vision_asset (
  like core.entity_template including all,
  vision_id uuid references change.vision (id),
  vision_board_id uuid references change.vision_board (id),
  media_id uuid references core.media (id),
  kind change.asset_kind not null default 'inspiration',
  source text,
  creator text,
  link text,
  rights_record_id uuid references core.rights_record (id),
  why_relevant text
);
select core.register_table('change.vision_asset', 'standard', 'vision_asset', 'why_relevant', '{source,creator}', 'R2.2');

create table change.vision_alternative (
  like core.entity_template including all,
  vision_id uuid not null references change.vision (id),
  title text not null,
  description text,
  status change.alternative_status not null default 'proposed',
  decision_id uuid references change.decision (id)
);
select core.register_table('change.vision_alternative', 'standard', 'vision_alternative', 'title', '{description}', 'R2.2');
alter table change.decision add constraint decision_alternative_fk foreign key (vision_alternative_id) references change.vision_alternative (id);

create table change.target_state (
  like core.entity_template including all,
  vision_id uuid references change.vision (id),
  subject_entity_id uuid references core.entity (id),
  title text not null,
  description text,
  target_date date
);
select core.register_table('change.target_state', 'standard', 'target_state', 'title', '{description}', 'R2.2');

create table change.target_state_criterion (
  like core.link_template including all,
  target_state_id uuid not null references change.target_state (id),
  description text not null,
  metric text,
  target_value numeric,
  unit text,
  met_at timestamptz,
  visibility core.visibility not null default 'internal'
);
select core.register_table('change.target_state_criterion', 'standard', p_ui_release => 'R2.2');

-- Främmande nycklar från tidigare scheman till projekt, behov och aktiviteter.
alter table resources.object add constraint object_project_fk foreign key (project_id) references change.project (id);
alter table resources.batch_allocation add constraint allocation_project_fk foreign key (project_id) references change.project (id);
alter table resources.usage_event add constraint usage_project_fk foreign key (project_id) references change.project (id);
alter table resources.usage_event add constraint usage_activity_fk foreign key (target_activity_id) references change.activity (id);
alter table resources.listing add constraint listing_need_fk foreign key (need_id) references change.need (id);
alter table resources.vehicle_machine add constraint vehicle_project_fk foreign key (project_id) references change.project (id);
alter table people.contribution add constraint contribution_project_fk foreign key (project_id) references change.project (id);
alter table people.contribution add constraint contribution_activity_fk foreign key (activity_id) references change.activity (id);
alter table change.need_fulfillment add constraint fulfillment_activity_fk foreign key (activity_id) references change.activity (id);

insert into core.state (machine, state, label_sv, terminal, sort) values
  ('project', 'idea', 'Idé', false, 3), ('project', 'planned', 'Planerat', false, 2), ('project', 'active', 'Pågår', false, 1),
  ('project', 'paused', 'Vilar', false, 4), ('project', 'done', 'Klart', false, 5),
  ('need', 'open', 'Öppet', false, 1), ('need', 'dropped', 'Struket', true, 2),
  ('activity', 'planned', 'Planerad', false, 1), ('activity', 'ongoing', 'Pågår', false, 2),
  ('activity', 'completed', 'Klar', true, 3), ('activity', 'cancelled', 'Inställd', true, 4);
-- Projektets status väljs fritt bland de fem (R1.1 5.9).
insert into core.state_transition (machine, from_state, to_state)
select 'project', a.s, b.s from unnest(array['idea','planned','active','paused','done']) a(s), unnest(array['idea','planned','active','paused','done']) b(s) where a.s <> b.s;
insert into core.state_transition (machine, from_state, to_state) values
  ('need', 'open', 'dropped'), ('need', 'dropped', 'open'),
  ('activity', 'planned', 'ongoing'), ('activity', 'ongoing', 'completed'), ('activity', 'planned', 'completed'),
  ('activity', 'planned', 'cancelled'), ('activity', 'ongoing', 'cancelled');

-- ------------------------------------------------------------------ hjälpare
create function change.need_fulfilled_quantity(p_need uuid) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(coalesce(quantity, 0)), 0) from change.need_fulfillment where need_id = p_need and archived_at is null
$$;

-- Ett behov utan antal räcker med första bidraget (R1.1 4.10).
create function change.need_is_met(p_need uuid) returns boolean
language sql stable set search_path = '' as $$
  select case when n.quantity is null then exists (select 1 from change.need_fulfillment f where f.need_id = n.id and f.archived_at is null)
              else change.need_fulfilled_quantity(n.id) >= n.quantity end
  from change.need n where n.id = p_need
$$;

-- "1 020 av 1 500 tegel"
create function change.need_progress_label(p_need uuid) returns text
language sql stable set search_path = '' as $$
  select case when n.quantity is null then case when change.need_is_met(n.id) then 'Uppfyllt' else 'Inget ännu' end
    else format('%s av %s%s', trim(to_char(change.need_fulfilled_quantity(n.id), 'FM999G999G990.##')),
                trim(to_char(n.quantity, 'FM999G999G990.##')), coalesce(' ' || n.unit, '')) end
  from change.need n where n.id = p_need
$$;

-- Ett nytt projektnamn i ett formulär blir en riktig projektpost (FR-078).
create function change.ensure_project(p_name text, p_place uuid default null) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  select id into v_id from change.project where site_id = core.ctx_site() and lower(name) = lower(btrim(p_name)) and archived_at is null;
  if v_id is null then
    insert into change.project (site_id, name, status, place_id) values (core.ctx_site(), btrim(p_name), 'active', p_place) returning id into v_id;
    perform core.record_history('project.created', format('Nytt projekt: %s', btrim(p_name)), jsonb_build_array(jsonb_build_object('id', v_id)),
                                p_place_id => p_place);
  end if;
  return v_id;
end $$;

-- Varje uppfyllelse blir en händelse i projektjournalen; när behovet blir fyllt är händelsen värd att berätta.
create function change.fulfill_need(p_need uuid, p_qty numeric, p_kind text, p_usage uuid default null, p_contribution uuid default null,
                                    p_object uuid default null, p_acquisition uuid default null, p_note text default null,
                                    p_activity uuid default null) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_need change.need;
  v_was_met boolean;
  v_now_met boolean;
begin
  select * into v_need from change.need where id = p_need and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Behovet finns inte'); end if;
  if v_need.status = 'dropped' then perform core.fail('need_dropped', 'Behovet är struket'); end if;
  v_was_met := change.need_is_met(p_need);
  insert into change.need_fulfillment (id, site_id, need_id, quantity, source_kind, usage_event_id, contribution_id, object_id, acquisition_id, activity_id, note)
  values (v_id, core.ctx_site(), p_need, p_qty, p_kind, p_usage, p_contribution, p_object, p_acquisition, p_activity, p_note);
  v_now_met := change.need_is_met(p_need);
  perform core.record_history('need.fulfilled',
    format('%s: %s', v_need.title, change.need_progress_label(p_need)),
    jsonb_build_array(jsonb_build_object('id', v_need.id), jsonb_build_object('id', v_need.project_id, 'role', 'project'),
                      jsonb_build_object('id', v_id, 'role', 'record'), jsonb_build_object('id', p_object, 'role', 'object'),
                      jsonb_build_object('id', p_contribution, 'role', 'contribution')),
    p_story_value => v_now_met and not v_was_met);
  return v_id;
end $$;

-- ------------------------------------------------------------------ kommandon
create function cmd.create_project(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_place uuid := core.opt_uuid(p, 'place_id');
  v_parent uuid := core.opt_uuid(p, 'parent_id');
begin
  if v_place is not null then perform place.assert_place(v_place); end if;
  if v_parent is not null then perform core.assert_entity(v_parent, '{project}'); end if;
  if exists (select 1 from change.project where site_id = core.ctx_site() and lower(name) = lower(btrim(core.req(p, 'name'))) and archived_at is null) then
    perform core.fail('duplicate', 'Det finns redan ett projekt med det namnet',
      jsonb_build_object('project_id', (select id from change.project where site_id = core.ctx_site() and lower(name) = lower(btrim(p ->> 'name')) and archived_at is null)));
  end if;
  insert into change.project (id, site_id, name, kind_code, status, parent_id, place_id, geom, description, started_on)
  values (v_id, core.ctx_site(), btrim(p ->> 'name'), p ->> 'kind_code', coalesce(nullif(p ->> 'status', ''), 'idea')::change.project_status,
          v_parent, v_place, place.geom_from_geojson(p -> 'geometry'), p ->> 'description', (p ->> 'started_on')::date);
  perform core.record_history('project.created', format('Nytt projekt: %s', p ->> 'name'),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_parent, 'role', 'parent')), p_place_id => v_place);
  return jsonb_build_object('project_id', v_id);
end $$;

create function cmd.set_project_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'project_id');
  v_to change.project_status := core.req(p, 'status')::change.project_status;
  v_from change.project_status;
begin
  select status into v_from from change.project where id = v_id and site_id = core.ctx_site() for update;
  if v_from is null then perform core.fail('not_found', 'Projektet finns inte'); end if;
  if v_from = v_to then return jsonb_build_object('project_id', v_id, 'status', v_to); end if;
  update change.project set status = v_to,
    started_on = case when v_to = 'active' then coalesce(started_on, current_date) else started_on end,
    finished_on = case when v_to = 'done' then current_date else finished_on end
  where id = v_id;
  perform core.record_history('project.status', format('%s: %s', (select name from change.project where id = v_id), core.state_label('project', v_to::text)),
    jsonb_build_array(jsonb_build_object('id', v_id)), p_story_value => v_to = 'done');
  return jsonb_build_object('project_id', v_id, 'status', v_to);
end $$;

create function cmd.set_project_place(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'project_id'); v_place uuid := core.opt_uuid(p, 'place_id');
begin
  perform core.assert_entity(v_id, '{project}');
  if v_place is not null then perform place.assert_place(v_place); end if;
  update change.project set place_id = v_place, parent_id = case when p ? 'parent_id' then core.opt_uuid(p, 'parent_id') else parent_id end where id = v_id;
  return jsonb_build_object('project_id', v_id);
end $$;

create function cmd.add_need(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid()); v_project uuid := core.req_uuid(p, 'project_id');
begin
  perform core.assert_entity(v_project, '{project}');
  insert into change.need (id, site_id, project_id, title, kind_code, quantity, unit, category_id, note)
  values (v_id, core.ctx_site(), v_project, core.req(p, 'title'), coalesce(nullif(p ->> 'kind_code', ''), 'material'),
          (nullif(p ->> 'quantity', ''))::numeric, nullif(p ->> 'unit', ''), resources.category_id(p), p ->> 'note');
  perform core.record_history('need.added', format('Behov: %s%s', p ->> 'title',
      coalesce(' (' || trim(to_char((nullif(p ->> 'quantity', ''))::numeric, 'FM999G999G990.##')) || coalesce(' ' || nullif(p ->> 'unit', ''), '') || ')', '')),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_project, 'role', 'project')));
  return jsonb_build_object('need_id', v_id);
end $$;

create function cmd.set_need_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'need_id');
  v_to change.need_status := core.req(p, 'status')::change.need_status;
  v_from change.need_status;
begin
  select status into v_from from change.need where id = v_id and site_id = core.ctx_site();
  if v_from is null then perform core.fail('not_found', 'Behovet finns inte'); end if;
  perform core.assert_transition('need', v_from::text, v_to::text);
  update change.need set status = v_to where id = v_id;
  return jsonb_build_object('need_id', v_id, 'status', v_to);
end $$;

-- Fyll ett behov utan att det går via nytt liv eller bidrag (t.ex. sten från egna marken).
create function cmd.fulfill_need(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_need uuid := core.req_uuid(p, 'need_id'); v_id uuid;
begin
  v_id := change.fulfill_need(v_need, (nullif(p ->> 'quantity', ''))::numeric, coalesce(nullif(p ->> 'source_kind', ''), 'none'),
                              p_object => core.opt_uuid(p, 'object_id'), p_acquisition => core.opt_uuid(p, 'acquisition_id'), p_note => p ->> 'note');
  return jsonb_build_object('need_fulfillment_id', v_id, 'progress', change.need_progress_label(v_need));
end $$;

create function cmd.record_decision(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_place uuid := core.opt_uuid(p, 'place_id');
  v_project uuid := core.opt_uuid(p, 'project_id');
begin
  if v_place is not null then perform place.assert_place(v_place); end if;
  if v_project is not null then perform core.assert_entity(v_project, '{project}'); end if;
  insert into change.decision (id, site_id, question, background, alternatives, choice, rationale, decided_at, project_id, place_id)
  values (v_id, core.ctx_site(), core.req(p, 'question'), p ->> 'background', coalesce(p -> 'alternatives', '[]'), p ->> 'choice',
          p ->> 'rationale', core.opt_ts(p, 'decided_at'), v_project, v_place);
  perform core.record_history('decision.recorded', format('Beslut: %s', p ->> 'question'),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_project, 'role', 'project')),
    core.opt_ts(p, 'decided_at'), v_place, false, p ->> 'choice');
  return jsonb_build_object('decision_id', v_id);
end $$;

-- Moment: append-only och tillåtet offline. AI föreslår kopplingar senare.
create function cmd.record_moment(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_place uuid := core.opt_uuid(p, 'place_id');
  v_geom extensions.geometry := place.geom_from_geojson(p -> 'geometry');
  v_media uuid;
  v_person uuid;
  v_event uuid;
begin
  if exists (select 1 from change.moment where id = v_id) then return jsonb_build_object('moment_id', v_id, 'existing', true); end if;
  if v_place is null and v_geom is not null then
    v_place := place.zone_at(core.ctx_site(), extensions.st_x(v_geom), extensions.st_y(v_geom));
  end if;
  insert into change.moment (id, site_id, title, note, occurred_at, place_id, geom, story_value, capture_id)
  values (v_id, core.ctx_site(), coalesce(nullif(p ->> 'title', ''), 'Ett ögonblick'), p ->> 'note', core.opt_ts(p, 'occurred_at'),
          v_place, v_geom, coalesce((p ->> 'story_value')::boolean, true), core.opt_uuid(p, 'capture_id'));
  for v_media in select (jsonb_array_elements_text(coalesce(p -> 'media_ids', '[]')))::uuid loop
    insert into core.media_link (site_id, media_id, entity_id, role) values (core.ctx_site(), v_media, v_id, 'photo') on conflict do nothing;
  end loop;
  v_event := core.record_history('moment.recorded', coalesce(nullif(p ->> 'title', ''), 'Ett ögonblick'),
    jsonb_build_array(jsonb_build_object('id', v_id)) ||
    coalesce((select jsonb_agg(jsonb_build_object('id', x, 'role', 'person')) from jsonb_array_elements_text(p -> 'person_ids') x), '[]'),
    core.opt_ts(p, 'occurred_at'), v_place, coalesce((p ->> 'story_value')::boolean, true), p ->> 'note', p_geom => v_geom);
  return jsonb_build_object('moment_id', v_id, 'history_event_id', v_event);
end $$;

create function cmd.start_activity(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid()); v_person text;
begin
  insert into change.activity (id, site_id, title, kind_code, status, started_at, place_id, project_id, hosted_event_id, note)
  values (v_id, core.ctx_site(), core.req(p, 'title'), p ->> 'kind_code',
          case when coalesce((p ->> 'planned')::boolean, false) then 'planned' else 'ongoing' end::change.activity_status,
          core.opt_ts(p, 'started_at'), core.opt_uuid(p, 'place_id'), core.opt_uuid(p, 'project_id'), core.opt_uuid(p, 'hosted_event_id'), p ->> 'note');
  for v_person in select jsonb_array_elements_text(coalesce(p -> 'person_ids', '[]')) loop
    insert into change.activity_participant (site_id, activity_id, person_id) values (core.ctx_site(), v_id, v_person::uuid);
  end loop;
  return jsonb_build_object('activity_id', v_id);
end $$;

-- Avsluta aktivitet: deltagare blir bidrag, material blir nytt liv och behov uppfylls – i ett steg.
create function cmd.complete_activity(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'activity_id');
  v_a change.activity;
  v_part jsonb;
  v_mat jsonb;
  v_event uuid;
begin
  select * into v_a from change.activity where id = v_id and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Aktiviteten finns inte'); end if;
  perform core.assert_transition('activity', v_a.status::text, 'completed');
  update change.activity set status = 'completed', ended_at = core.opt_ts(p, 'ended_at') where id = v_id;
  for v_part in select * from jsonb_array_elements(coalesce(p -> 'participants', '[]')) loop
    insert into change.activity_participant (site_id, activity_id, person_id, hours)
    values (core.ctx_site(), v_id, core.opt_uuid(v_part, 'person_id'), (v_part ->> 'hours')::numeric);
    perform cmd.record_contribution(jsonb_build_object('person_id', v_part ->> 'person_id', 'type_code', coalesce(v_part ->> 'type_code', 'time'),
      'hours', v_part ->> 'hours', 'description', coalesce(v_part ->> 'description', v_a.title), 'project_id', v_a.project_id,
      'activity_id', v_id, 'occurred_at', core.opt_ts(p, 'ended_at')));
  end loop;
  for v_mat in select * from jsonb_array_elements(coalesce(p -> 'materials', '[]')) loop
    perform cmd.use_object(jsonb_build_object('object_id', v_mat ->> 'object_id', 'quantity', v_mat ->> 'quantity',
      'type', coalesce(v_mat ->> 'type', 'built_in'), 'place_id', coalesce(v_mat ->> 'place_id', v_a.place_id::text),
      'occurred_at', core.opt_ts(p, 'ended_at'), 'project_id', v_a.project_id, 'need_id', v_mat ->> 'need_id', 'target_activity_id', v_id));
  end loop;
  v_event := core.record_history('activity.completed', coalesce(nullif(p ->> 'summary', ''), v_a.title || ' klar'),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_a.project_id, 'role', 'project')),
    core.opt_ts(p, 'ended_at'), v_a.place_id, true, p ->> 'note');
  return jsonb_build_object('activity_id', v_id, 'history_event_id', v_event);
end $$;

-- Visioner (R2.2)
create function cmd.create_vision(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_board uuid := core.opt_uuid(p, 'vision_board_id'); v_id uuid := gen_random_uuid(); v_subject uuid := core.opt_uuid(p, 'subject_entity_id');
begin
  if v_subject is not null then perform core.assert_entity(v_subject); end if;
  if v_board is null then
    select id into v_board from change.vision_board where site_id = core.ctx_site() and subject_entity_id is not distinct from v_subject and archived_at is null limit 1;
    if v_board is null then
      v_board := gen_random_uuid();
      insert into change.vision_board (id, site_id, title, subject_entity_id)
      values (v_board, core.ctx_site(), coalesce((select title from core.entity where id = v_subject), 'Vision'), v_subject);
    end if;
  end if;
  insert into change.vision (id, site_id, vision_board_id, subject_entity_id, title, statement)
  values (v_id, core.ctx_site(), v_board, v_subject, core.req(p, 'title'), p ->> 'statement');
  return jsonb_build_object('vision_id', v_id, 'vision_board_id', v_board);
end $$;

create function cmd.add_vision_asset(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_rights uuid; v_kind change.asset_kind := coalesce(nullif(p ->> 'kind', ''), 'inspiration')::change.asset_kind;
begin
  if v_kind = 'inspiration' and nullif(p ->> 'source', '') is null then
    perform core.fail('missing_field', 'En inspirationsbild behöver källa – den är inte ett foto från Vreta');
  end if;
  insert into core.rights_record (site_id, subject_entity_id, creator_name, source, source_url, rights_status, may_publish)
  values (core.ctx_site(), core.opt_uuid(p, 'media_id'), p ->> 'creator', p ->> 'source', p ->> 'link',
          coalesce(nullif(p ->> 'rights_status', ''), 'unknown')::core.rights_status, coalesce((p ->> 'may_publish')::boolean, false))
  returning id into v_rights;
  insert into change.vision_asset (id, site_id, vision_id, vision_board_id, media_id, kind, source, creator, link, rights_record_id, why_relevant)
  values (v_id, core.ctx_site(), core.opt_uuid(p, 'vision_id'), core.opt_uuid(p, 'vision_board_id'), core.opt_uuid(p, 'media_id'), v_kind,
          p ->> 'source', p ->> 'creator', p ->> 'link', v_rights, p ->> 'why_relevant');
  return jsonb_build_object('vision_asset_id', v_id);
end $$;

create function cmd.add_vision_alternative(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_vision uuid := core.req_uuid(p, 'vision_id');
begin
  perform core.assert_entity(v_vision, '{vision}');
  insert into change.vision_alternative (id, site_id, vision_id, title, description) values (v_id, core.ctx_site(), v_vision, core.req(p, 'title'), p ->> 'description');
  return jsonb_build_object('vision_alternative_id', v_id);
end $$;

-- Ett valt alternativ länkas till ett beslut med motiv och blir plan/projekt; övriga arkiveras.
create function cmd.choose_vision_alternative(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_alt change.vision_alternative;
  v_decision uuid := gen_random_uuid();
  v_project uuid;
begin
  select * into v_alt from change.vision_alternative where id = core.req_uuid(p, 'vision_alternative_id') and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Alternativet finns inte'); end if;
  insert into change.decision (id, site_id, question, choice, rationale, vision_alternative_id, alternatives)
  values (v_decision, core.ctx_site(), format('Val av alternativ för %s', (select title from change.vision where id = v_alt.vision_id)),
          v_alt.title, core.req(p, 'rationale'), v_alt.id,
          (select coalesce(jsonb_agg(title), '[]') from change.vision_alternative where vision_id = v_alt.vision_id));
  update change.vision_alternative set status = 'abandoned' where vision_id = v_alt.vision_id and id <> v_alt.id and status = 'proposed';
  update change.vision_alternative set status = 'chosen', decision_id = v_decision where id = v_alt.id;
  update change.vision set status = 'chosen' where id = v_alt.vision_id;
  if coalesce((p ->> 'create_project')::boolean, true) then
    v_project := change.ensure_project(coalesce(nullif(p ->> 'project_name', ''), v_alt.title),
                                       (select subject_entity_id from change.vision where id = v_alt.vision_id));
    update change.project set vision_id = v_alt.vision_id, status = 'planned' where id = v_project and status = 'idea';
  end if;
  perform core.record_history('vision.decided', format('Beslut: %s', v_alt.title),
    jsonb_build_array(jsonb_build_object('id', v_decision), jsonb_build_object('id', v_alt.vision_id, 'role', 'vision'),
                      jsonb_build_object('id', v_project, 'role', 'project')), p_story_value => true);
  return jsonb_build_object('decision_id', v_decision, 'project_id', v_project);
end $$;

create function cmd.set_target_state(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid()); v_c jsonb;
begin
  insert into change.target_state (id, site_id, vision_id, subject_entity_id, title, description, target_date)
  values (v_id, core.ctx_site(), core.opt_uuid(p, 'vision_id'), core.opt_uuid(p, 'subject_entity_id'), core.req(p, 'title'),
          p ->> 'description', (p ->> 'target_date')::date)
  on conflict (id) do update set title = excluded.title, description = excluded.description, target_date = excluded.target_date;
  for v_c in select * from jsonb_array_elements(coalesce(p -> 'criteria', '[]')) loop
    insert into change.target_state_criterion (site_id, target_state_id, description, metric, target_value, unit)
    values (core.ctx_site(), v_id, v_c ->> 'description', v_c ->> 'metric', (v_c ->> 'target_value')::numeric, v_c ->> 'unit');
  end loop;
  return jsonb_build_object('target_state_id', v_id);
end $$;

create function cmd.set_habitat_intent(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_project uuid := core.req_uuid(p, 'project_id');
begin
  perform core.assert_entity(v_project, '{project}');
  insert into change.project_habitat_intent (id, site_id, project_id, target_entity_id, taxon_id, intent, note)
  values (v_id, core.ctx_site(), v_project, core.opt_uuid(p, 'target_entity_id'), core.opt_uuid(p, 'taxon_id'), core.req(p, 'intent'), p ->> 'note');
  return jsonb_build_object('intent_id', v_id);
end $$;

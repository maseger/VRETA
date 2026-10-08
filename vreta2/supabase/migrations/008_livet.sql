-- VRETA 2 · Migrering 008 · Livet (Life & Ecology)
-- Observation är inte närvaro: en observation blir aldrig automatiskt en invånare eller verifierad artdata.
-- Djur, grupper, artnärvaro, habitat, växtindivider, planteringar och observerade ekologiska relationer.
-- Gränssnitt i R2.3; observationer i platsjournalen redan i R2.0.

create type life.certainty as enum ('certain', 'probable', 'uncertain');
create type life.presence_pattern as enum ('visitor', 'recurring', 'seasonal_resident', 'wintering', 'established', 'former');
create type life.reproduction_status as enum ('unknown', 'none_observed', 'indicated', 'confirmed');
create type life.presence_basis as enum ('rule', 'approval');
create type life.living_status as enum ('alive', 'removed', 'dead', 'rehomed');

select core.define_entity_type('taxon', 'life.taxon', 'Art', 'Arter', '/art/:id', 'life', '{swedish_name}', false, 'R2.3');
select core.define_entity_type('observation', 'life.observation', 'Observation', 'Observationer', '/observation/:id', 'life', '{description}');
select core.define_entity_type('animal_individual', 'life.animal_individual', 'Djur', 'Djur', '/djur/:id', 'life', '{name,description,breed}', false, 'R2.3');
select core.define_entity_type('resident_group', 'life.resident_group', 'Grupp', 'Grupper', '/grupp/:id', 'life', '{name,estimated_count}', false, 'R2.3');
select core.define_entity_type('species_presence', 'life.species_presence', 'Artnärvaro', 'Artnärvaro', null, 'life', '{}', false, 'R2.3');
select core.define_entity_type('habitat_feature', 'life.habitat_feature', 'Livsmiljö', 'Livsmiljöer', '/habitat/:id', 'life', '{name,description}', false, 'R2.3');
select core.define_entity_type('plant_individual', 'life.plant_individual', 'Växt', 'Växter', '/vaxt/:id', 'life', '{name,cultivar,description}', false, 'R2.3');
select core.define_entity_type('planting', 'life.planting', 'Plantering', 'Planteringar', '/plantering/:id', 'life', '{name,description}', false, 'R2.3');
select core.define_entity_type('plant_presence', 'life.plant_presence', 'Spontan flora', 'Spontan flora', null, 'life', '{}', false, 'R2.3');
select core.define_entity_type('ecological_relation', 'life.ecological_relation', 'Ekologisk relation', 'Ekologiska relationer', null, 'life', '{note}', false, 'R2.3');

-- Taxa med extern referens till en svensk artdatabas (ADR-019, Q-11). Globala referensposter har site_id null.
create table life.taxon (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references core.site (id),
  scientific_name text not null,
  swedish_name text,
  rank text not null default 'species',
  organism_group text,
  parent_id uuid references life.taxon (id),
  external_source text,
  external_ref text,
  default_sensitivity core.sensitivity not null default 'normal',
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  command_id uuid,
  unique nulls not distinct (site_id, scientific_name)
);
select core.register_table('life.taxon', 'reference', p_ui_release => 'R2.3');

create table life.observation (
  like core.entity_template including all,
  kind_code text not null default 'plant',
  occurred_at timestamptz not null default now(),
  place_id uuid references core.entity (id),
  geom extensions.geometry(Point, 4326),
  location_precision core.location_precision not null default 'zone',
  description text not null default '',
  follow_up_on date,
  taxon_id uuid references life.taxon (id),
  -- Ett förslag på art från AI sparas som osäkert tills någon verifierar det
  taxon_suggestion text,
  count integer,
  behavior_codes text[] not null default '{}',
  certainty life.certainty,
  verified boolean not null default false,
  verified_by uuid,
  phenophase_code text,
  condition_code text,
  subject_entity_id uuid references core.entity (id),
  history_event_id uuid references core.history_event (id)
);
create index observation_site_time_idx on life.observation (site_id, occurred_at desc);
create index observation_taxon_idx on life.observation (taxon_id);
select core.register_table('life.observation', 'standard', 'observation', 'description', '{taxon_suggestion,kind_code}');

create table life.animal_individual (
  like core.entity_template including all,
  name text not null,
  taxon_id uuid references life.taxon (id),
  breed text,
  status life.living_status not null default 'alive',
  born_on date,
  place_id uuid references core.entity (id),
  description text
);
select core.register_table('life.animal_individual', 'standard', 'animal_individual', 'name', '{description,breed}', 'R2.3');

create table life.resident_group (
  like core.entity_template including all,
  name text not null,
  taxon_id uuid references life.taxon (id),
  kind text not null default 'flock' check (kind in ('flock', 'colony', 'hive', 'herd', 'other')),
  estimated_count integer,
  place_id uuid references core.entity (id),
  status life.living_status not null default 'alive',
  description text
);
select core.register_table('life.resident_group', 'standard', 'resident_group', 'name', '{description}', 'R2.3');

create table life.care_relation (
  like core.link_template including all,
  animal_id uuid references life.animal_individual (id),
  group_id uuid references life.resident_group (id),
  person_id uuid not null references people.person (id),
  role text not null default 'caretaker',
  visibility core.visibility not null default 'internal',
  check (animal_id is not null or group_id is not null)
);
select core.register_table('life.care_relation', 'standard', p_ui_release => 'R2.3');

-- Artnärvaro: härleds eller godkänns separat från observationerna. Närvaromönster och reproduktion är
-- två skilda egenskaper (en fågel kan vara säsongsinvånare och häcka).
create table life.species_presence (
  like core.entity_template including all,
  taxon_id uuid not null references life.taxon (id),
  place_id uuid references core.entity (id),
  presence_pattern life.presence_pattern not null,
  reproduction_status life.reproduction_status not null default 'unknown',
  period_start date,
  period_end date,
  basis life.presence_basis not null,
  supporting_observation_count integer not null default 0,
  confirmed_by uuid,
  confirmed_at timestamptz,
  note text
);
create unique index species_presence_uq on life.species_presence (site_id, taxon_id, place_id) where archived_at is null;
select core.register_table('life.species_presence', 'standard', 'species_presence', null, '{note}', 'R2.3');

create table life.habitat_feature (
  like core.entity_template including all,
  name text not null,
  kind_code text not null,
  place_id uuid references core.entity (id),
  -- Länkar till ett befintligt objekt eller en zon i stället för att duplicera saken
  object_id uuid references resources.object (id),
  geom extensions.geometry(Geometry, 4326),
  active boolean not null default true,
  description text
);
select core.register_table('life.habitat_feature', 'standard', 'habitat_feature', 'name', '{description,kind_code}', 'R2.3');

create table life.habitat_use (
  like core.entity_template including all,
  habitat_feature_id uuid not null references life.habitat_feature (id),
  taxon_id uuid references life.taxon (id),
  group_id uuid references life.resident_group (id),
  use_code text not null,
  period_start date,
  period_end date,
  observation_id uuid references life.observation (id)
);
select core.register_table('life.habitat_use', 'standard', p_ui_release => 'R2.3');

-- Växter: en sak kan komma in som parti; när den planteras blir den en levande del av platsen med
-- proveniens tillbaka till partiet. Livscykeln är händelser, hälsa och plats är tillstånd.
create table life.plant_individual (
  like core.entity_template including all,
  name text not null,
  taxon_id uuid references life.taxon (id),
  cultivar text,
  planted_on date,
  place_id uuid references core.entity (id),
  geom extensions.geometry(Point, 4326),
  health_status resources.health_status,
  status life.living_status not null default 'alive',
  origin_object_id uuid references resources.object (id),
  origin_usage_event_id uuid references resources.usage_event (id),
  description text
);
select core.register_table('life.plant_individual', 'standard', 'plant_individual', 'name', '{cultivar,description}', 'R2.3');

create table life.planting (
  like core.entity_template including all,
  name text not null,
  kind text not null default 'area' check (kind in ('point', 'line', 'area')),
  place_id uuid references core.entity (id),
  geom extensions.geometry(Geometry, 4326),
  planted_on date,
  plant_count integer,
  density text,
  health_status resources.health_status,
  status life.living_status not null default 'alive',
  origin_object_id uuid references resources.object (id),
  origin_usage_event_id uuid references resources.usage_event (id),
  description text
);
select core.register_table('life.planting', 'standard', 'planting', 'name', '{description}', 'R2.3');

create table life.planting_member (
  like core.link_template including all,
  planting_id uuid not null references life.planting (id),
  taxon_id uuid references life.taxon (id),
  cultivar text,
  count integer,
  visibility core.visibility not null default 'internal'
);
select core.register_table('life.planting_member', 'standard', p_ui_release => 'R2.3');

create table life.plant_presence (
  like core.entity_template including all,
  taxon_id uuid not null references life.taxon (id),
  place_id uuid references core.entity (id),
  abundance text,
  period_start date,
  period_end date,
  basis life.presence_basis not null default 'approval',
  note text
);
select core.register_table('life.plant_presence', 'standard', 'plant_presence', null, '{note}', 'R2.3');

create table life.plant_function_link (
  like core.link_template including all,
  plant_entity_id uuid references core.entity (id),
  taxon_id uuid references life.taxon (id),
  function_code text not null,
  note text,
  visibility core.visibility not null default 'internal',
  check (plant_entity_id is not null or taxon_id is not null)
);
select core.register_table('life.plant_function_link', 'standard', p_ui_release => 'R2.3');

-- Faktiskt observerade relationer ("humlor födosöker här"), inte en teoretisk artdatabas.
create table life.ecological_relation (
  like core.entity_template including all,
  subject_taxon_id uuid references life.taxon (id),
  relation_code text not null,
  object_entity_id uuid references core.entity (id),
  observation_id uuid references life.observation (id),
  note text
);
select core.register_table('life.ecological_relation', 'standard', 'ecological_relation', 'relation_code', '{note}', 'R2.3');

alter table change.project_habitat_intent add constraint habitat_intent_taxon_fk foreign key (taxon_id) references life.taxon (id);

-- Några vanliga arter som startreferens. Artdatabasen väljs i Q-11.
insert into life.taxon (scientific_name, swedish_name, rank, organism_group, default_sensitivity) values
  ('Parus major', 'Talgoxe', 'species', 'bird', 'normal'),
  ('Erithacus rubecula', 'Rödhake', 'species', 'bird', 'normal'),
  ('Motacilla alba', 'Sädesärla', 'species', 'bird', 'normal'),
  ('Cyanistes caeruleus', 'Blåmes', 'species', 'bird', 'normal'),
  ('Turdus merula', 'Koltrast', 'species', 'bird', 'normal'),
  ('Accipiter nisus', 'Sparvhök', 'species', 'bird', 'sensitive_location'),
  ('Rana temporaria', 'Vanlig groda', 'species', 'amphibian', 'normal'),
  ('Lissotriton vulgaris', 'Mindre vattensalamander', 'species', 'amphibian', 'sensitive_location'),
  ('Natrix natrix', 'Snok', 'species', 'reptile', 'normal'),
  ('Bombus terrestris', 'Jordhumla', 'species', 'insect', 'normal'),
  ('Apis mellifera', 'Honungsbi', 'species', 'insect', 'normal'),
  ('Gallus gallus domesticus', 'Höna', 'species', 'bird', 'normal'),
  ('Capra hircus', 'Get', 'species', 'mammal', 'normal'),
  ('Rhododendron', 'Rhododendron', 'genus', 'plant', 'normal'),
  ('Malus domestica', 'Äpple', 'species', 'plant', 'normal'),
  ('Quercus robur', 'Ek', 'species', 'plant', 'normal'),
  ('Anemone nemorosa', 'Vitsippa', 'species', 'plant', 'normal'),
  ('Salix caprea', 'Sälg', 'species', 'plant', 'normal'),
  ('Urtica dioica', 'Brännässla', 'species', 'plant', 'normal'),
  ('Vitis vinifera', 'Vinranka', 'species', 'plant', 'normal');

-- ------------------------------------------------------------------ kommandon
-- Observation (append-only, tillåten offline). Platsjournalen i R2.0; art, beteende och fenologi i R2.3.
-- Känsliga arter får zonprecision som standard (INV, Nya integritetsregler 2.0).
create function cmd.record_observation(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_place uuid := core.opt_uuid(p, 'place_id');
  v_geom extensions.geometry := place.geom_from_geojson(p -> 'geometry');
  v_taxon uuid := core.opt_uuid(p, 'taxon_id');
  v_sens core.sensitivity := 'normal';
  v_event uuid;
  v_media uuid;
  v_type text := coalesce(nullif(p ->> 'kind_code', ''), case when core.opt_uuid(p, 'taxon_id') is not null then 'species' else 'plant' end);
begin
  if exists (select 1 from life.observation where id = v_id) then return jsonb_build_object('observation_id', v_id, 'existing', true); end if;
  if v_place is null and v_geom is not null then v_place := place.zone_at(core.ctx_site(), extensions.st_x(v_geom), extensions.st_y(v_geom)); end if;
  if v_place is not null then perform place.assert_place(v_place); end if;
  if v_taxon is not null then
    select default_sensitivity into v_sens from life.taxon where id = v_taxon;
  end if;
  insert into life.observation (id, site_id, kind_code, occurred_at, place_id, geom, location_precision, description, follow_up_on, taxon_id,
                                taxon_suggestion, count, behavior_codes, certainty, verified, phenophase_code, condition_code, subject_entity_id,
                                sensitivity, visibility)
  values (v_id, core.ctx_site(), v_type, core.opt_ts(p, 'occurred_at'), v_place, v_geom,
          case when v_sens = 'sensitive_location' then 'zone' else coalesce(nullif(p ->> 'location_precision', ''), case when v_geom is null then 'zone' else 'exact' end) end::core.location_precision,
          coalesce(p ->> 'description', ''), (p ->> 'follow_up_on')::date, v_taxon, p ->> 'taxon_suggestion', (p ->> 'count')::integer,
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'behavior_codes') x), '{}'),
          (nullif(p ->> 'certainty', ''))::life.certainty,
          -- En AI-föreslagen eller osäker art blir aldrig verifierad automatiskt (INV-02)
          false, p ->> 'phenophase_code', p ->> 'condition_code', core.opt_uuid(p, 'subject_entity_id'), v_sens,
          coalesce(nullif(p ->> 'visibility', ''), 'internal')::core.visibility);
  for v_media in select (jsonb_array_elements_text(coalesce(p -> 'media_ids', '[]')))::uuid loop
    insert into core.media_link (site_id, media_id, entity_id, role) values (core.ctx_site(), v_media, v_id, 'photo') on conflict do nothing;
  end loop;
  v_event := core.record_history('observation.' || v_type,
    coalesce(nullif(p ->> 'summary', ''), nullif(left(p ->> 'description', 120), ''),
             (select coalesce(swedish_name, scientific_name) from life.taxon where id = v_taxon), 'Observation'),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', core.opt_uuid(p, 'subject_entity_id'), 'role', 'about'),
                      jsonb_build_object('id', core.opt_uuid(p, 'project_id'), 'role', 'project')),
    core.opt_ts(p, 'occurred_at'), v_place, coalesce((p ->> 'story_value')::boolean, false), null, 'internal',
    case when v_sens = 'sensitive_location' then null else v_geom end);
  update life.observation set history_event_id = v_event where id = v_id;
  if (p ->> 'follow_up_on') is not null then
    insert into core.task (site_id, title, kind, due_at, subject_entity_id)
    values (core.ctx_site(), 'Följ upp: ' || left(coalesce(nullif(p ->> 'description', ''), 'observation'), 60), 'follow_up', (p ->> 'follow_up_on')::date, v_id);
  end if;
  return jsonb_build_object('observation_id', v_id, 'history_event_id', v_event, 'place_id', v_place);
end $$;

-- Verifiera en artbestämning (R2.3). Görs av en människa; AI:s förslag är aldrig verifierat.
create function cmd.verify_observation(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'observation_id');
begin
  update life.observation set taxon_id = coalesce(core.opt_uuid(p, 'taxon_id'), taxon_id),
    certainty = coalesce(nullif(p ->> 'certainty', ''), 'certain')::life.certainty, verified = true, verified_by = auth.uid()
  where id = v_id and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Observationen finns inte'); end if;
  return jsonb_build_object('observation_id', v_id);
end $$;

-- Etablerad närvaro och häckning är slutsatser som kräver stöd och godkännande (ConfirmSpeciesPresence).
create function cmd.confirm_species_presence(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_taxon uuid := core.req_uuid(p, 'taxon_id');
  v_place uuid := core.opt_uuid(p, 'place_id');
  v_count integer;
  v_id uuid;
begin
  select count(*) into v_count from life.observation o
  where o.site_id = core.ctx_site() and o.taxon_id = v_taxon and o.verified and o.archived_at is null
    and (v_place is null or o.place_id = v_place or v_place = any (place.lineage(o.place_id)));
  if v_count = 0 then
    perform core.fail('no_evidence', 'Det finns ingen verifierad observation som stödjer närvaron');
  end if;
  insert into life.species_presence (site_id, taxon_id, place_id, presence_pattern, reproduction_status, period_start, period_end,
                                     basis, supporting_observation_count, confirmed_by, confirmed_at, note,
                                     sensitivity)
  values (core.ctx_site(), v_taxon, v_place, core.req(p, 'presence_pattern')::life.presence_pattern,
          coalesce(nullif(p ->> 'reproduction_status', ''), 'unknown')::life.reproduction_status, (p ->> 'period_start')::date,
          (p ->> 'period_end')::date, 'approval', v_count, auth.uid(), now(), p ->> 'note',
          (select default_sensitivity from life.taxon where id = v_taxon))
  on conflict (site_id, taxon_id, place_id) where archived_at is null do update set
    presence_pattern = excluded.presence_pattern, reproduction_status = excluded.reproduction_status,
    supporting_observation_count = excluded.supporting_observation_count, confirmed_by = excluded.confirmed_by,
    confirmed_at = excluded.confirmed_at, note = coalesce(excluded.note, life.species_presence.note)
  returning id into v_id;
  perform core.record_history('life.presence_confirmed', format('%s: %s',
      (select coalesce(swedish_name, scientific_name) from life.taxon where id = v_taxon), p ->> 'presence_pattern'),
    jsonb_build_array(jsonb_build_object('id', v_id)), p_place_id => v_place, p_story_value => true);
  return jsonb_build_object('species_presence_id', v_id, 'supporting_observations', v_count);
end $$;

create function cmd.upsert_taxon(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into life.taxon (site_id, scientific_name, swedish_name, rank, organism_group, external_source, external_ref, default_sensitivity)
  values (core.ctx_site(), core.req(p, 'scientific_name'), p ->> 'swedish_name', coalesce(nullif(p ->> 'rank', ''), 'species'),
          p ->> 'organism_group', p ->> 'external_source', p ->> 'external_ref', coalesce(nullif(p ->> 'default_sensitivity', ''), 'normal')::core.sensitivity)
  on conflict (site_id, scientific_name) do update set swedish_name = excluded.swedish_name, organism_group = excluded.organism_group,
    external_ref = coalesce(excluded.external_ref, life.taxon.external_ref), default_sensitivity = excluded.default_sensitivity
  returning id into v_id;
  return jsonb_build_object('taxon_id', v_id);
end $$;

create function cmd.create_animal(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_kind text := coalesce(nullif(p ->> 'kind', ''), 'individual');
begin
  if v_kind = 'individual' then
    insert into life.animal_individual (id, site_id, name, taxon_id, breed, born_on, place_id, description)
    values (v_id, core.ctx_site(), core.req(p, 'name'), core.opt_uuid(p, 'taxon_id'), p ->> 'breed', (p ->> 'born_on')::date, core.opt_uuid(p, 'place_id'), p ->> 'description');
  else
    insert into life.resident_group (id, site_id, name, taxon_id, kind, estimated_count, place_id, description)
    values (v_id, core.ctx_site(), core.req(p, 'name'), core.opt_uuid(p, 'taxon_id'), v_kind, (p ->> 'estimated_count')::integer, core.opt_uuid(p, 'place_id'), p ->> 'description');
  end if;
  if core.opt_uuid(p, 'caretaker_person_id') is not null then
    insert into life.care_relation (site_id, animal_id, group_id, person_id)
    values (core.ctx_site(), case when v_kind = 'individual' then v_id end, case when v_kind <> 'individual' then v_id end, core.opt_uuid(p, 'caretaker_person_id'));
  end if;
  perform core.record_history('life.animal_added', format('Välkommen %s', p ->> 'name'), jsonb_build_array(jsonb_build_object('id', v_id)),
                              p_place_id => core.opt_uuid(p, 'place_id'), p_story_value => true);
  return jsonb_build_object('id', v_id);
end $$;

create function cmd.create_habitat_feature(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into life.habitat_feature (id, site_id, name, kind_code, place_id, object_id, geom, description, sensitivity)
  values (v_id, core.ctx_site(), core.req(p, 'name'), core.req(p, 'kind_code'), core.opt_uuid(p, 'place_id'), core.opt_uuid(p, 'object_id'),
          place.geom_from_geojson(p -> 'geometry'), p ->> 'description', coalesce(nullif(p ->> 'sensitivity', ''), 'normal')::core.sensitivity);
  return jsonb_build_object('habitat_feature_id', v_id);
end $$;

create function cmd.record_habitat_use(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  perform core.assert_entity(core.req_uuid(p, 'habitat_feature_id'), '{habitat_feature}');
  insert into life.habitat_use (id, site_id, habitat_feature_id, taxon_id, group_id, use_code, period_start, period_end, observation_id)
  values (v_id, core.ctx_site(), core.req_uuid(p, 'habitat_feature_id'), core.opt_uuid(p, 'taxon_id'), core.opt_uuid(p, 'group_id'),
          core.req(p, 'use_code'), (p ->> 'period_start')::date, (p ->> 'period_end')::date, core.opt_uuid(p, 'observation_id'));
  return jsonb_build_object('habitat_use_id', v_id);
end $$;

-- Plantering från ett växtparti (PlantFromBatch, R2.3): nytt liv på partiet och en växtpost med proveniens.
create function cmd.plant_from_batch(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_object uuid := core.req_uuid(p, 'object_id');
  v_usage jsonb;
  v_id uuid := gen_random_uuid();
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'planting');
  v_qty numeric := (p ->> 'quantity')::numeric;
  v_name text;
  v_taxon uuid := core.opt_uuid(p, 'taxon_id');
begin
  v_usage := cmd.use_object(p || jsonb_build_object('type', 'planted'));
  select coalesce(nullif(p ->> 'name', ''), title), coalesce(v_taxon, (select t.id from life.taxon t where t.swedish_name ilike o.species_variety or t.scientific_name ilike o.species_variety limit 1))
    into v_name, v_taxon from resources.object o where o.id = v_object;
  if v_kind = 'individual' then
    insert into life.plant_individual (id, site_id, name, taxon_id, cultivar, planted_on, place_id, geom, health_status, origin_object_id, origin_usage_event_id)
    values (v_id, core.ctx_site(), v_name, v_taxon, p ->> 'cultivar', (p ->> 'occurred_at')::date, core.opt_uuid(p, 'place_id'),
            place.geom_from_geojson(p -> 'geometry'), 'establishing', v_object, (v_usage ->> 'usage_event_id')::uuid);
  else
    insert into life.planting (id, site_id, name, kind, place_id, geom, planted_on, plant_count, health_status, origin_object_id, origin_usage_event_id)
    values (v_id, core.ctx_site(), v_name, coalesce(nullif(p ->> 'shape', ''), 'area'), core.opt_uuid(p, 'place_id'), place.geom_from_geojson(p -> 'geometry'),
            (p ->> 'occurred_at')::date, v_qty::integer, 'establishing', v_object, (v_usage ->> 'usage_event_id')::uuid);
    insert into life.planting_member (site_id, planting_id, taxon_id, cultivar, count)
    values (core.ctx_site(), v_id, v_taxon, p ->> 'cultivar', v_qty::integer);
  end if;
  update resources.usage_event set target_plant_entity_id = v_id where id = (v_usage ->> 'usage_event_id')::uuid;
  insert into core.history_event_link (site_id, event_id, entity_id, entity_type, role)
  values (core.ctx_site(), (v_usage ->> 'history_event_id')::uuid, v_id, case when v_kind = 'individual' then 'plant_individual' else 'planting' end, 'plant');
  return v_usage || jsonb_build_object('plant_entity_id', v_id);
end $$;

create function cmd.record_ecological_relation(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into life.ecological_relation (id, site_id, subject_taxon_id, relation_code, object_entity_id, observation_id, note)
  values (v_id, core.ctx_site(), core.opt_uuid(p, 'subject_taxon_id'), core.req(p, 'relation_code'), core.opt_uuid(p, 'object_entity_id'),
          core.opt_uuid(p, 'observation_id'), p ->> 'note');
  return jsonb_build_object('ecological_relation_id', v_id);
end $$;

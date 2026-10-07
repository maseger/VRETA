-- VRETA 2 · Migrering 009 · Kultur (Culture & Creative)
-- Verket har skapare och proveniens, installationen en plats och en period, initiativet ett syfte.
-- De tre länkas men är aldrig samma post, och konst är aldrig en vanlig lagerartikel. Gränssnitt i R2.5.

create type culture.ownership as enum ('vreta', 'on_loan', 'creator', 'other');
create type culture.placement_status as enum ('planned', 'installed', 'removed', 'returned');

select core.define_entity_type('creative_work', 'culture.creative_work', 'Verk', 'Verk', '/verk/:id', 'culture', '{title,medium,dimensions,description}', false, 'R2.5');
select core.define_entity_type('display_placement', 'culture.display_placement', 'Installation', 'Installationer', null, 'culture', '{note}', false, 'R2.5');
select core.define_entity_type('creative_initiative', 'culture.creative_initiative', 'Kreativt initiativ', 'Kreativa initiativ', '/initiativ/:id', 'culture', '{title,description}', false, 'R2.5');

create table culture.creative_work (
  like core.entity_template including all,
  title text not null,
  medium text,
  dimensions text,
  created_on date,
  description text,
  -- Ägande, placering och säljbarhet hålls isär
  ownership culture.ownership not null default 'vreta',
  in_storage boolean not null default false,
  for_sale boolean not null default false,
  rights_record_id uuid references core.rights_record (id)
);
select core.register_table('culture.creative_work', 'standard', 'creative_work', 'title', '{medium,description}', 'R2.5');

create table culture.creative_work_creator (
  like core.link_template including all,
  work_id uuid not null references culture.creative_work (id),
  person_id uuid references people.person (id),
  organization_id uuid references people.organization (id),
  role_code text not null default 'artist',
  visibility core.visibility not null default 'internal',
  check (person_id is not null or organization_id is not null)
);
select core.register_table('culture.creative_work_creator', 'standard', p_ui_release => 'R2.5');

-- Materialproveniens: återbrukade objekt som blev en del av verket.
create table culture.creative_work_material (
  like core.link_template including all,
  work_id uuid not null references culture.creative_work (id),
  object_id uuid not null references resources.object (id),
  quantity numeric,
  note text,
  visibility core.visibility not null default 'internal'
);
select core.register_table('culture.creative_work_material', 'standard', p_ui_release => 'R2.5');

create table culture.display_placement (
  like core.entity_template including all,
  work_id uuid not null references culture.creative_work (id),
  place_id uuid references core.entity (id),
  geom extensions.geometry(Point, 4326),
  starts_on date,
  ends_on date,
  permanent boolean not null default false,
  status culture.placement_status not null default 'planned',
  return_due date,
  note text
);
select core.register_table('culture.display_placement', 'standard', 'display_placement', null, '{note}', 'R2.5');

create table culture.creative_initiative (
  like core.entity_template including all,
  title text not null,
  kind text not null default 'exhibition' check (kind in ('exhibition', 'art_trail', 'residency', 'workshop', 'collective_project', 'other')),
  starts_on date,
  ends_on date,
  description text,
  project_id uuid references change.project (id)
);
select core.register_table('culture.creative_initiative', 'standard', 'creative_initiative', 'title', '{description}', 'R2.5');

create table culture.creative_initiative_link (
  like core.link_template including all,
  initiative_id uuid not null references culture.creative_initiative (id),
  entity_id uuid not null references core.entity (id),
  role text not null default 'part',
  visibility core.visibility not null default 'internal'
);
select core.register_table('culture.creative_initiative_link', 'standard', p_ui_release => 'R2.5');

-- ------------------------------------------------------------------ kommandon
create function cmd.create_creative_work(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_rights uuid; v_c jsonb; v_m jsonb;
begin
  insert into core.rights_record (site_id, subject_entity_id, creator_name, rights_status, may_publish, note)
  values (core.ctx_site(), null, p ->> 'creator_name', coalesce(nullif(p ->> 'rights_status', ''), 'unknown')::core.rights_status,
          coalesce((p ->> 'may_publish')::boolean, false), p ->> 'rights_note')
  returning id into v_rights;
  insert into culture.creative_work (id, site_id, title, medium, dimensions, created_on, description, ownership, for_sale, rights_record_id)
  values (v_id, core.ctx_site(), core.req(p, 'title'), p ->> 'medium', p ->> 'dimensions', (p ->> 'created_on')::date, p ->> 'description',
          coalesce(nullif(p ->> 'ownership', ''), 'vreta')::culture.ownership, coalesce((p ->> 'for_sale')::boolean, false), v_rights);
  update core.rights_record set subject_entity_id = v_id where id = v_rights;
  for v_c in select * from jsonb_array_elements(coalesce(p -> 'creators', '[]')) loop
    insert into culture.creative_work_creator (site_id, work_id, person_id, organization_id, role_code)
    values (core.ctx_site(), v_id, core.opt_uuid(v_c, 'person_id'), core.opt_uuid(v_c, 'organization_id'), coalesce(v_c ->> 'role_code', 'artist'));
    if core.opt_uuid(v_c, 'person_id') is not null then perform people.add_role(core.opt_uuid(v_c, 'person_id'), 'artist'); end if;
  end loop;
  for v_m in select * from jsonb_array_elements(coalesce(p -> 'materials', '[]')) loop
    insert into culture.creative_work_material (site_id, work_id, object_id, quantity, note)
    values (core.ctx_site(), v_id, (v_m ->> 'object_id')::uuid, (v_m ->> 'quantity')::numeric, v_m ->> 'note');
  end loop;
  perform core.record_history('culture.work_created', format('Verk: %s', p ->> 'title'), jsonb_build_array(jsonb_build_object('id', v_id)), p_story_value => true);
  return jsonb_build_object('creative_work_id', v_id);
end $$;

create function cmd.place_creative_work(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_work uuid := core.req_uuid(p, 'work_id'); v_place uuid := core.req_uuid(p, 'place_id');
begin
  perform core.assert_entity(v_work, '{creative_work}');
  perform place.assert_place(v_place);
  insert into culture.display_placement (id, site_id, work_id, place_id, geom, starts_on, ends_on, permanent, status, return_due, note)
  values (v_id, core.ctx_site(), v_work, v_place, place.geom_from_geojson(p -> 'geometry'), coalesce((p ->> 'starts_on')::date, current_date),
          (p ->> 'ends_on')::date, coalesce((p ->> 'permanent')::boolean, false), 'installed', (p ->> 'return_due')::date, p ->> 'note');
  update culture.creative_work set in_storage = false where id = v_work;
  perform core.record_history('culture.installed', format('%s installerat på %s', (select title from culture.creative_work where id = v_work), place.path_label(v_place)),
    jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', v_work, 'role', 'work')), p_place_id => v_place, p_story_value => true);
  return jsonb_build_object('display_placement_id', v_id);
end $$;

create function cmd.create_creative_initiative(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_e text;
begin
  insert into culture.creative_initiative (id, site_id, title, kind, starts_on, ends_on, description, project_id)
  values (v_id, core.ctx_site(), core.req(p, 'title'), coalesce(nullif(p ->> 'kind', ''), 'exhibition'), (p ->> 'starts_on')::date,
          (p ->> 'ends_on')::date, p ->> 'description', core.opt_uuid(p, 'project_id'));
  for v_e in select jsonb_array_elements_text(coalesce(p -> 'entity_ids', '[]')) loop
    insert into culture.creative_initiative_link (site_id, initiative_id, entity_id) values (core.ctx_site(), v_id, v_e::uuid);
  end loop;
  return jsonb_build_object('creative_initiative_id', v_id);
end $$;

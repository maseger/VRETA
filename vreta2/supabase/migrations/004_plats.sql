-- VRETA 2 · Migrering 004 · Plats (Place & Spatial)
-- Orter, zoner, strukturer, spaces (rum och platsdelar), hierarkiska lagerplatser med QR, platser
-- utanför Vreta med privat adress, kartunderlag, kartobjekt med verklighetsläge, fotopunkter och tours.

create type place.place_status as enum ('existing', 'planned', 'removed');
create type place.feature_kind as enum ('point', 'line', 'polygon');
create type place.tour_mode as enum ('on_site', 'digital', 'guided');
create type place.tour_status as enum ('draft', 'published', 'archived');

select core.define_entity_type('locality', 'place.locality', 'Ort', 'Orter', '/ort/:id', 'place', '{name,municipality,county}', true);
select core.define_entity_type('zone', 'place.zone', 'Område', 'Områden', '/zon/:id', 'place', '{name,description,type_code,permaculture_zone}', true);
select core.define_entity_type('structure', 'place.structure', 'Byggnad', 'Byggnader och anläggningar', '/byggnad/:id', 'place', '{name,description,type_code,permaculture_zone}', true);
select core.define_entity_type('space', 'place.space', 'Rum/platsdel', 'Rum och platsdelar', '/space/:id', 'place', '{name,description,type_code}', true);
select core.define_entity_type('storage_location', 'place.storage_location', 'Lagerplats', 'Lagerplatser', '/lager/:id', 'place', '{name,description}', true);
select core.define_entity_type('external_place', 'place.external_place', 'Plats utanför', 'Platser utanför', '/plats/:id', 'place', '{name,description,kind_code}', true);
select core.define_entity_type('map_basemap', 'place.map_basemap', 'Grundbild', 'Grundbilder', null, 'place', '{name,opacity}');
select core.define_entity_type('map_overlay', 'place.map_overlay', 'Överlägg', 'Överlägg', null, 'place', '{name,opacity}');
select core.define_entity_type('map_feature', 'place.map_feature', 'Kartobjekt', 'Kartobjekt', null, 'place', '{label}', false);
select core.define_entity_type('photo_point', 'place.photo_point', 'Fotopunkt', 'Fotopunkter', '/fotopunkt/:id', 'place', '{name,description,bearing}', false, 'R2.2');
select core.define_entity_type('tour', 'place.tour', 'Rundvandring', 'Rundvandringar', '/tour/:id', 'place', '{title,intro}', false, 'R2.5');
select core.define_entity_type('tour_stop', 'place.tour_stop', 'Tour-stopp', 'Tour-stopp', null, 'place', '{title,intro,what_is_this,what_happened,how_now,what_future}', false, 'R2.5');

-- Ort på kommunnivå som egen post (R1.1 6.4). Får synas; adresser är alltid privata.
create table place.locality (
  like core.entity_template including all,
  name text not null,
  municipality text,
  county text,
  country text not null default 'SE',
  approx_point extensions.geometry(Point, 4326)
);
create unique index locality_name_uq on place.locality (site_id, lower(name)) where archived_at is null;
select core.register_table('place.locality', 'standard', 'locality', 'name', '{municipality,county}');

create table place.zone (
  like core.entity_template including all,
  name text not null,
  type_code text,
  permaculture_zone smallint check (permaculture_zone between 0 and 5),
  status place.place_status not null default 'existing',
  reality_mode core.reality_mode not null default 'now',
  parent_zone_id uuid references place.zone (id),
  geom extensions.geometry(Geometry, 4326),
  description text,
  valid_from date,
  valid_to date
);
create index zone_geom_idx on place.zone using gist (geom);
select core.register_table('place.zone', 'standard', 'zone', 'name', '{description,type_code}');

create table place.structure (
  like core.entity_template including all,
  name text not null,
  type_code text,
  permaculture_zone smallint check (permaculture_zone between 0 and 5),
  status place.place_status not null default 'existing',
  reality_mode core.reality_mode not null default 'now',
  zone_id uuid references place.zone (id),
  geom extensions.geometry(Geometry, 4326),
  description text,
  valid_from date,
  valid_to date
);
create index structure_geom_idx on place.structure using gist (geom);
select core.register_table('place.structure', 'standard', 'structure', 'name', '{description,type_code}');

-- Rum eller platsdel under en struktur eller zon (2.0): "Gästrum väst", "södra väggen", "tältplats vid ängen".
create table place.space (
  like core.entity_template including all,
  name text not null,
  type_code text,
  structure_id uuid references place.structure (id),
  zone_id uuid references place.zone (id),
  geom extensions.geometry(Geometry, 4326),
  properties jsonb not null default '{}',
  description text,
  check (structure_id is not null or zone_id is not null)
);
select core.register_table('place.space', 'standard', 'space', 'name', '{description,type_code}');

-- Hierarkisk lagerplats (förråd → hylla → låda) med QR; kan ligga i ett space (2.0).
create table place.storage_location (
  like core.entity_template including all,
  name text not null,
  parent_id uuid references place.storage_location (id),
  space_id uuid references place.space (id),
  structure_id uuid references place.structure (id),
  zone_id uuid references place.zone (id),
  qr_code text not null unique,
  description text,
  sort integer not null default 0,
  geom extensions.geometry(Point, 4326)
);
create index storage_location_parent_idx on place.storage_location (parent_id);
select core.register_table('place.storage_location', 'standard', 'storage_location', 'name', '{description,qr_code}');

-- Plats utanför Vreta (R1.1): loppis, gård, återvinningscentral. Adressen är privat (INV-12, INV-13).
create table place.external_place (
  like core.entity_template including all,
  name text not null,
  kind_code text not null default 'other',
  locality_id uuid references place.locality (id),
  description text
);
select core.register_table('place.external_place', 'standard', 'external_place', 'name', '{description,kind_code}');

create table place.external_place_private (
  like core.link_template including all,
  external_place_id uuid not null unique references place.external_place (id),
  address text,
  exact_point extensions.geometry(Point, 4326),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
select core.register_table('place.external_place_private', 'owner');

-- Kartunderlag (R1.1 7.6). Vretakartan är intern och aldrig publik.
create table place.map_basemap (
  like core.entity_template including all,
  name text not null,
  captured_on date,
  source_projection text,
  media_id uuid references core.media (id),
  -- Hörnkoordinater [[lon,lat] × 4] i ordningen uppe vänster, uppe höger, nere höger, nere vänster
  corners jsonb not null,
  opacity numeric(3, 2) not null default 1,
  is_default boolean not null default false,
  sort integer not null default 0
);
alter table place.map_basemap alter column visibility set default 'private';
select core.register_table('place.map_basemap', 'standard', 'map_basemap', 'name');

create table place.map_overlay (
  like core.entity_template including all,
  name text not null,
  captured_on date,
  source_projection text,
  basemap_id uuid references place.map_basemap (id),
  media_id uuid references core.media (id),
  corners jsonb not null,
  opacity numeric(3, 2) not null default 0.7,
  layer_code text,
  sort integer not null default 0
);
alter table place.map_overlay alter column visibility set default 'private';
select core.register_table('place.map_overlay', 'standard', 'map_overlay', 'name');

-- Vektorobjekt med verklighetsläge: NU, PLAN, VISION eller borttaget (R2.2). Precision exakt, zon eller dold.
create table place.map_feature (
  like core.entity_template including all,
  layer_code text not null,
  feature_kind place.feature_kind not null,
  geom extensions.geometry(Geometry, 4326) not null,
  reality_mode core.reality_mode not null default 'now',
  precision core.location_precision not null default 'exact',
  valid_from date,
  valid_to date,
  label text,
  -- Vad objektet föreställer, t.ex. en zon, en plantering eller ett objekt i bruk
  entity_id uuid references core.entity (id),
  properties jsonb not null default '{}'
);
create index map_feature_geom_idx on place.map_feature using gist (geom);
create index map_feature_entity_idx on place.map_feature (entity_id);
select core.register_table('place.map_feature', 'standard', 'map_feature', 'label');

create table place.photo_point (
  like core.entity_template including all,
  name text not null,
  geom extensions.geometry(Point, 4326),
  bearing numeric(5, 1),
  place_id uuid references core.entity (id),
  description text
);
select core.register_table('place.photo_point', 'standard', 'photo_point', 'name', '{description}', 'R2.2');

create table place.photo_point_capture (
  like core.link_template including all,
  photo_point_id uuid not null references place.photo_point (id),
  media_id uuid not null references core.media (id),
  captured_at timestamptz not null default now(),
  visibility core.visibility not null default 'internal'
);
select core.register_table('place.photo_point_capture', 'custom', p_ui_release => 'R2.2');
create policy read on place.photo_point_capture for select to authenticated
  using (exists (select 1 from place.photo_point x where x.id = photo_point_id)
         and exists (select 1 from core.media m where m.id = media_id));

-- Rundvandring (R2.5): Tour är upplevelsen, Route gånglinjen, TourStop en referens – aldrig en kopia.
create table place.tour (
  like core.entity_template including all,
  title text not null,
  intro text,
  mode place.tour_mode not null default 'on_site',
  status place.tour_status not null default 'draft',
  languages text[] not null default '{sv}',
  leakage_test_passed_at timestamptz,
  published_at timestamptz
);
select core.register_table('place.tour', 'standard', 'tour', 'title', '{intro}', 'R2.5');

create table place.route (
  like core.entity_template including all,
  tour_id uuid not null references place.tour (id),
  geom extensions.geometry(LineString, 4326),
  length_m numeric,
  surface text,
  stairs_or_levels text,
  accessibility_note text,
  estimated_minutes integer
);
select core.register_table('place.route', 'standard', p_ui_release => 'R2.5');

create table place.tour_stop (
  like core.entity_template including all,
  tour_id uuid not null references place.tour (id),
  ordinal integer not null,
  entity_id uuid not null references core.entity (id),
  title text not null,
  intro text,
  what_is_this text,
  what_happened text,
  how_now text,
  what_future text,
  duration_minutes integer,
  -- Publikt urval: vilka delar av den refererade entiteten som får visas
  public_selection jsonb not null default '{}',
  unique (tour_id, ordinal)
);
select core.register_table('place.tour_stop', 'standard', 'tour_stop', 'title', '{intro,what_is_this,what_happened,how_now,what_future}', 'R2.5');

create table place.tour_stop_media (
  like core.link_template including all,
  tour_stop_id uuid not null references place.tour_stop (id),
  media_id uuid not null references core.media (id),
  era text not null default 'now' check (era in ('before', 'during', 'done', 'later', 'now', 'vision')),
  ordinal integer not null default 0
);
select core.register_table('place.tour_stop_media', 'custom', p_ui_release => 'R2.5');
create policy read on place.tour_stop_media for select to authenticated
  using (exists (select 1 from place.tour_stop s where s.id = tour_stop_id));

-- ------------------------------------------------------------------ platshierarki
-- Platsen och alla dess överordnade platser: lagerplats → space → struktur → zon → överordnad zon;
-- plats utanför → ort. Används för att samma händelse ska synas i plats- och zonjournal (AC-05).
create function place.lineage(p_id uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out uuid[] := '{}';
  v_cur uuid := p_id;
  v_type text;
  v_next uuid;
  i integer := 0;
begin
  while v_cur is not null and i < 20 loop
    v_out := v_out || v_cur;
    select entity_type into v_type from core.entity where id = v_cur;
    v_next := case v_type
      when 'storage_location' then (select coalesce(parent_id, space_id, structure_id, zone_id) from place.storage_location where id = v_cur)
      when 'space' then (select coalesce(structure_id, zone_id) from place.space where id = v_cur)
      when 'structure' then (select zone_id from place.structure where id = v_cur)
      when 'zone' then (select parent_zone_id from place.zone where id = v_cur)
      when 'external_place' then (select locality_id from place.external_place where id = v_cur)
      else null end;
    v_cur := v_next;
    i := i + 1;
  end loop;
  return v_out;
end $$;

-- Läsbar platsväg, t.ex. "Garage › Vänster vägg › Hylla 3".
create function place.path_label(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(e.title, ' › ' order by x.ord desc)
  from unnest(place.lineage(p_id)) with ordinality as x(id, ord)
  join core.entity e on e.id = x.id
$$;

-- Närmaste zon för en plats (eller null).
create function place.zone_of(p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select x.id from unnest(place.lineage(p_id)) with ordinality as x(id, ord)
  join core.entity e on e.id = x.id and e.entity_type = 'zone' order by x.ord limit 1
$$;

create function place.assert_place(p_id uuid, p_types text[] default null) returns text
language plpgsql stable set search_path = '' as $$
declare v_type text := core.assert_entity(p_id);
begin
  if not exists (select 1 from core.entity_type where code = v_type and is_place) then
    perform core.fail('not_a_place', 'Välj en plats');
  end if;
  if p_types is not null and not (v_type = any (p_types)) then
    perform core.fail('wrong_place', 'Fel slags plats');
  end if;
  return v_type;
end $$;

-- GeoJSON → geometri i WGS 84.
create function place.geom_from_geojson(p jsonb) returns extensions.geometry
language sql immutable set search_path = '' as $$
  select case when p is null or p = 'null'::jsonb then null
    else extensions.st_setsrid(extensions.st_geomfromgeojson(p::text), 4326) end
$$;

-- Zonen som innehåller en punkt (för "Här" med GPS, FR-066).
create function place.zone_at(p_site uuid, p_lon float8, p_lat float8) returns uuid
language sql stable security definer set search_path = '' as $$
  select z.id from place.zone z
  where z.site_id = p_site and z.archived_at is null and z.reality_mode = 'now' and z.geom is not null
    and extensions.st_contains(z.geom, extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326))
  order by extensions.st_area(z.geom) limit 1
$$;

-- Hittar eller skapar en ort med namn (orter är egna poster, R1.1).
create function place.ensure_locality(p_name text) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  select id into v_id from place.locality where site_id = core.ctx_site() and lower(name) = lower(btrim(p_name)) and archived_at is null;
  if v_id is null then
    insert into place.locality (site_id, name) values (core.ctx_site(), initcap(btrim(p_name))) returning id into v_id;
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ kommandon
-- Ny plats i fem slag (R1.1 S10 + space i 2.0): zone, structure, space, storage_location, external_place.
create function cmd.create_place(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_kind text := core.req(p, 'kind');
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_name text := btrim(core.req(p, 'name'));
  v_geom extensions.geometry := place.geom_from_geojson(p -> 'geometry');
  v_pz smallint := (p ->> 'permaculture_zone')::smallint;
  v_parent uuid := core.opt_uuid(p, 'parent_id');
  v_parent_type text;
  v_loc uuid;
begin
  if v_parent is not null then v_parent_type := place.assert_place(v_parent); end if;
  if v_pz is null and p ->> 'type_code' is not null then
    v_pz := (select (attributes ->> 'pz')::smallint from core.code_value
             where list_code = v_kind || '_type' and code = p ->> 'type_code' and (site_id is null or site_id = core.ctx_site())
             order by site_id nulls last limit 1);
  end if;
  case v_kind
  when 'zone' then
    insert into place.zone (id, site_id, name, type_code, permaculture_zone, status, reality_mode, parent_zone_id, geom, description)
    values (v_id, core.ctx_site(), v_name, p ->> 'type_code', v_pz, coalesce(nullif(p ->> 'status', ''), 'existing')::place.place_status,
            coalesce(nullif(p ->> 'reality_mode', ''), 'now')::core.reality_mode,
            case when v_parent_type = 'zone' then v_parent end, v_geom, p ->> 'description');
  when 'structure' then
    insert into place.structure (id, site_id, name, type_code, permaculture_zone, status, reality_mode, zone_id, geom, description)
    values (v_id, core.ctx_site(), v_name, p ->> 'type_code', v_pz, coalesce(nullif(p ->> 'status', ''), 'existing')::place.place_status,
            coalesce(nullif(p ->> 'reality_mode', ''), 'now')::core.reality_mode,
            case when v_parent_type = 'zone' then v_parent end, v_geom, p ->> 'description');
  when 'space' then
    if v_parent_type is null or v_parent_type not in ('structure', 'zone') then
      perform core.fail('missing_field', 'Ett rum eller en platsdel ligger i en byggnad eller ett område');
    end if;
    insert into place.space (id, site_id, name, type_code, structure_id, zone_id, geom, description, properties)
    values (v_id, core.ctx_site(), v_name, p ->> 'type_code', case when v_parent_type = 'structure' then v_parent end,
            case when v_parent_type = 'zone' then v_parent end, v_geom, p ->> 'description', coalesce(p -> 'properties', '{}'));
  when 'storage_location' then
    insert into place.storage_location (id, site_id, name, parent_id, space_id, structure_id, zone_id, qr_code, description, geom)
    values (v_id, core.ctx_site(), v_name,
            case when v_parent_type = 'storage_location' then v_parent end,
            case when v_parent_type = 'space' then v_parent end,
            case when v_parent_type = 'structure' then v_parent end,
            case when v_parent_type = 'zone' then v_parent end,
            upper(substr(replace(v_id::text, '-', ''), 1, 8)), p ->> 'description',
            case when extensions.geometrytype(v_geom) = 'POINT' then v_geom end);
  when 'external_place' then
    v_loc := coalesce(core.opt_uuid(p, 'locality_id'), place.ensure_locality(p ->> 'locality'));
    insert into place.external_place (id, site_id, name, kind_code, locality_id, description)
    values (v_id, core.ctx_site(), v_name, coalesce(nullif(p ->> 'kind_code', ''), 'other'), v_loc, p ->> 'description');
    if nullif(p ->> 'address', '') is not null then
      insert into place.external_place_private (site_id, external_place_id, address) values (core.ctx_site(), v_id, p ->> 'address');
    end if;
  when 'locality' then
    v_id := place.ensure_locality(v_name);
  else
    perform core.fail('invalid', 'Okänt slag av plats');
  end case;
  perform core.record_history('place.created', format('Ny plats: %s', v_name), jsonb_build_array(jsonb_build_object('id', v_id)),
                              p_place_id => case when v_kind <> 'locality' then v_id end);
  return jsonb_build_object('id', v_id, 'kind', v_kind, 'qr_code',
    (select qr_code from place.storage_location where id = v_id));
end $$;

-- Rita in eller ändra geometri på en plats eller ett projekt (FR-075, FR-078).
create function cmd.set_geometry(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'id');
  v_type text := core.assert_entity(v_id);
  v_geom extensions.geometry := place.geom_from_geojson(p -> 'geometry');
begin
  if v_geom is not null and not extensions.st_isvalid(v_geom) then
    perform core.fail('invalid_geometry', 'Ytan korsar sig själv – flytta något hörn');
  end if;
  case v_type
    when 'zone' then update place.zone set geom = v_geom where id = v_id;
    when 'structure' then update place.structure set geom = v_geom where id = v_id;
    when 'space' then update place.space set geom = v_geom where id = v_id;
    when 'storage_location' then update place.storage_location set geom = v_geom where id = v_id;
    when 'map_feature' then update place.map_feature set geom = v_geom where id = v_id;
    when 'photo_point' then update place.photo_point set geom = v_geom, bearing = coalesce((p ->> 'bearing')::numeric, bearing) where id = v_id;
    when 'project' then execute 'update change.project set geom = $1 where id = $2' using v_geom, v_id;
    when 'site' then null;
    else perform core.fail('wrong_type', 'Den här posten har ingen geometri');
  end case;
  return jsonb_build_object('id', v_id,
    'area_m2', case when extensions.geometrytype(v_geom) in ('POLYGON', 'MULTIPOLYGON')
                    then round(extensions.st_area(v_geom::extensions.geography)::numeric, 1) end,
    'length_m', case when extensions.geometrytype(v_geom) in ('LINESTRING', 'MULTILINESTRING')
                     then round(extensions.st_length(v_geom::extensions.geography)::numeric, 1) end);
end $$;

-- Grundbild eller överlägg med hörnkoordinater (kartpaket, hörnfil eller tre stödpunkter i appen).
create function cmd.add_map_layer(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'basemap');
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_media uuid := core.opt_uuid(p, 'media_id');
begin
  if v_media is not null then perform core.assert_entity(v_media, '{media}'); end if;
  if jsonb_typeof(p -> 'corners') <> 'array' or jsonb_array_length(p -> 'corners') <> 4 then
    perform core.fail('invalid', 'Kartlagret behöver fyra hörn');
  end if;
  if v_kind = 'basemap' then
    insert into place.map_basemap (id, site_id, name, captured_on, source_projection, media_id, corners, opacity, is_default, visibility)
    values (v_id, core.ctx_site(), core.req(p, 'name'), (p ->> 'captured_on')::date, p ->> 'source_projection', v_media, p -> 'corners',
            coalesce((p ->> 'opacity')::numeric, 1),
            coalesce((p ->> 'is_default')::boolean, not exists (select 1 from place.map_basemap where site_id = core.ctx_site())), 'private');
  else
    insert into place.map_overlay (id, site_id, name, captured_on, source_projection, basemap_id, media_id, corners, opacity, layer_code, visibility)
    values (v_id, core.ctx_site(), core.req(p, 'name'), (p ->> 'captured_on')::date, p ->> 'source_projection',
            core.opt_uuid(p, 'basemap_id'), v_media, p -> 'corners', coalesce((p ->> 'opacity')::numeric, 0.7), p ->> 'layer_code', 'private');
  end if;
  return jsonb_build_object('id', v_id, 'kind', v_kind);
end $$;

create function cmd.update_map_layer(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'id');
  v_type text := core.assert_entity(v_id, '{map_basemap,map_overlay}');
begin
  if v_type = 'map_basemap' then
    update place.map_basemap set opacity = coalesce((p ->> 'opacity')::numeric, opacity), corners = coalesce(p -> 'corners', corners),
      is_default = coalesce((p ->> 'is_default')::boolean, is_default), name = coalesce(nullif(p ->> 'name', ''), name)
    where id = v_id;
    if coalesce((p ->> 'is_default')::boolean, false) then
      update place.map_basemap set is_default = false where site_id = core.ctx_site() and id <> v_id;
    end if;
  else
    update place.map_overlay set opacity = coalesce((p ->> 'opacity')::numeric, opacity), corners = coalesce(p -> 'corners', corners),
      name = coalesce(nullif(p ->> 'name', ''), name)
    where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create function cmd.create_map_feature(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_geom extensions.geometry := place.geom_from_geojson(p -> 'geometry');
  v_entity uuid := core.opt_uuid(p, 'entity_id');
begin
  if v_geom is null then perform core.fail('missing_field', 'Rita något på kartan först'); end if;
  if v_entity is not null then perform core.assert_entity(v_entity); end if;
  insert into place.map_feature (id, site_id, layer_code, feature_kind, geom, reality_mode, precision, label, entity_id, properties, valid_from)
  values (v_id, core.ctx_site(), core.req(p, 'layer_code'),
          case extensions.geometrytype(v_geom) when 'POINT' then 'point' when 'LINESTRING' then 'line' else 'polygon' end::place.feature_kind,
          v_geom, coalesce(nullif(p ->> 'reality_mode', ''), 'now')::core.reality_mode,
          coalesce(nullif(p ->> 'precision', ''), 'exact')::core.location_precision, p ->> 'label', v_entity,
          coalesce(p -> 'properties', '{}'), (p ->> 'valid_from')::date);
  return jsonb_build_object('id', v_id);
end $$;

-- Den privata adressen till en plats utanför Vreta (bara ägaren ser den).
create function cmd.set_external_place_address(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'external_place_id');
begin
  perform core.assert_entity(v_id, '{external_place}');
  insert into place.external_place_private (site_id, external_place_id, address, note)
  values (core.ctx_site(), v_id, p ->> 'address', p ->> 'note')
  on conflict (external_place_id) do update set address = excluded.address, note = coalesce(excluded.note, place.external_place_private.note);
  return jsonb_build_object('external_place_id', v_id);
end $$;

create function cmd.move_storage_location(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'id');
  v_parent uuid := core.opt_uuid(p, 'parent_id');
  v_parent_type text;
begin
  perform core.assert_entity(v_id, '{storage_location}');
  if v_parent is not null then
    v_parent_type := place.assert_place(v_parent, '{storage_location,space,structure,zone}');
    if v_id = any (place.lineage(v_parent)) then perform core.fail('cycle', 'En lagerplats kan inte ligga i sig själv'); end if;
  end if;
  update place.storage_location set
    parent_id = case when v_parent_type = 'storage_location' then v_parent end,
    space_id = case when v_parent_type = 'space' then v_parent end,
    structure_id = case when v_parent_type = 'structure' then v_parent end,
    zone_id = case when v_parent_type = 'zone' then v_parent end
  where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

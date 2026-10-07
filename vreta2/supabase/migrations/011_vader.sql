-- VRETA 2 · Migrering 011 · Väder (WeatherContext, ADR-016)
-- Väder är ett kontextlager, inte en väderapp. Prognos och observerat väder hålls isär: en gammal prognos
-- visas aldrig som observerat väder. Väder kopieras inte till poster; en post länkar till en väderversion
-- bara när sammanhanget måste vara reproducerbart. Gränssnitt i R2.1, källan väljs i Q-10.

create table core.weather_source (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  provider text not null,
  url text,
  terms text,
  created_at timestamptz not null default now()
);
select core.register_table('core.weather_source', 'global', p_audit => false, p_ui_release => 'R2.1');

insert into core.weather_source (code, name, provider, url, terms) values
  ('open_meteo', 'Open-Meteo', 'open-meteo.com', 'https://open-meteo.com', 'CC BY 4.0 – källa anges vid visning'),
  ('local', 'Vretas egen notering', 'vreta', null, 'Lokal observation sparas som Observation');

-- Prognos skapad vid en tidpunkt för en framtida period. Källa, skapandetid, giltighet och version sparas.
create table core.weather_forecast (
  like core.link_template including all,
  source_id uuid not null references core.weather_source (id),
  issued_at timestamptz not null,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  version integer not null default 1,
  -- {temp_c, precip_mm, wind_ms, gust_ms, cloud_pct, symbol}
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (site_id, source_id, issued_at, valid_from)
);
create index weather_forecast_site_idx on core.weather_forecast (site_id, valid_from);
select core.register_table('core.weather_forecast', 'member', p_audit => false, p_ui_release => 'R2.1');

-- Väder som faktiskt registrerats för plats och tid, med källa och mätperiod.
create table core.weather_observation (
  like core.link_template including all,
  source_id uuid not null references core.weather_source (id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (site_id, source_id, period_start)
);
create index weather_observation_site_idx on core.weather_observation (site_id, period_start);
select core.register_table('core.weather_observation', 'member', p_audit => false, p_ui_release => 'R2.1');

-- Referens från en post till den väderversion som användes (t.ex. prognosen när plan B valdes).
create table core.weather_context_ref (
  like core.link_template including all,
  entity_id uuid not null references core.entity (id),
  forecast_id uuid references core.weather_forecast (id),
  observation_id uuid references core.weather_observation (id),
  purpose text,
  check (forecast_id is not null or observation_id is not null)
);
select core.register_table('core.weather_context_ref', 'member', p_ui_release => 'R2.1');

-- WeatherContextService i databasen: slår upp observerat väder om det finns, annars prognosen –
-- alltid märkt med slag, källa och skapandetid så att gränssnittet kan skilja dem åt.
create function core.weather_at(p_site uuid, p_at timestamptz) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('kind', 'observed', 'source', s.name, 'period_start', o.period_start, 'period_end', o.period_end, 'data', o.data, 'id', o.id)
     from core.weather_observation o join core.weather_source s on s.id = o.source_id
     where o.site_id = p_site and p_at >= o.period_start and p_at < o.period_end order by o.period_start desc limit 1),
    (select jsonb_build_object('kind', 'forecast', 'source', s.name, 'issued_at', f.issued_at, 'valid_from', f.valid_from, 'valid_to', f.valid_to,
                               'data', f.data, 'id', f.id, 'version', f.version)
     from core.weather_forecast f join core.weather_source s on s.id = f.source_id
     where f.site_id = p_site and p_at >= f.valid_from and p_at < f.valid_to and f.issued_at <= greatest(p_at, now())
     order by f.issued_at desc limit 1))
$$;

-- Vädersignaler som påverkar verksamheten nu och 48 timmar framåt: frost, kraftigt regn, hård vind, värme, torka.
create function core.weather_signals(p_site uuid, p_hours integer default 48) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_th jsonb := coalesce((select value from core.site_setting where site_id = p_site and key = 'weather_thresholds'),
                         '{"frost_c":0,"heavy_rain_mm_h":4,"strong_wind_ms":12,"heat_c":28,"dry_days":14}');
  v_out jsonb := '[]';
  r record;
begin
  for r in
    select distinct on (f.valid_from) f.valid_from, f.data, f.issued_at, s.name as source
    from core.weather_forecast f join core.weather_source s on s.id = f.source_id
    where f.site_id = p_site and f.valid_from between now() and now() + make_interval(hours => p_hours)
    order by f.valid_from, f.issued_at desc
  loop
    if (r.data ->> 'temp_c')::numeric <= (v_th ->> 'frost_c')::numeric then
      v_out := v_out || jsonb_build_object('kind', 'frost', 'at', r.valid_from, 'value', r.data -> 'temp_c', 'issued_at', r.issued_at, 'source', r.source);
    end if;
    if (r.data ->> 'precip_mm')::numeric >= (v_th ->> 'heavy_rain_mm_h')::numeric then
      v_out := v_out || jsonb_build_object('kind', 'heavy_rain', 'at', r.valid_from, 'value', r.data -> 'precip_mm', 'issued_at', r.issued_at, 'source', r.source);
    end if;
    if coalesce((r.data ->> 'gust_ms')::numeric, (r.data ->> 'wind_ms')::numeric) >= (v_th ->> 'strong_wind_ms')::numeric then
      v_out := v_out || jsonb_build_object('kind', 'strong_wind', 'at', r.valid_from, 'value', coalesce(r.data -> 'gust_ms', r.data -> 'wind_ms'), 'issued_at', r.issued_at, 'source', r.source);
    end if;
    if (r.data ->> 'temp_c')::numeric >= (v_th ->> 'heat_c')::numeric then
      v_out := v_out || jsonb_build_object('kind', 'heat', 'at', r.valid_from, 'value', r.data -> 'temp_c', 'issued_at', r.issued_at, 'source', r.source);
    end if;
  end loop;
  return v_out;
end $$;

-- Vädertjänsten (serverfunktionen weather) skriver hit med service role. Idempotent per källa och period.
create function api.ingest_weather(p_site uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source uuid := (select id from core.weather_source where code = coalesce(p_payload ->> 'source', 'open_meteo'));
  v_row jsonb;
  v_f integer := 0;
  v_o integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'service_role') then
    raise exception 'forbidden: Bara vädertjänsten skriver väder' using errcode = '42501';
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'forecast', '[]')) loop
    insert into core.weather_forecast (site_id, source_id, issued_at, valid_from, valid_to, data)
    values (p_site, v_source, (p_payload ->> 'issued_at')::timestamptz, (v_row ->> 'valid_from')::timestamptz, (v_row ->> 'valid_to')::timestamptz, v_row -> 'data')
    on conflict (site_id, source_id, issued_at, valid_from) do nothing;
    v_f := v_f + 1;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'observed', '[]')) loop
    insert into core.weather_observation (site_id, source_id, period_start, period_end, data)
    values (p_site, v_source, (v_row ->> 'period_start')::timestamptz, (v_row ->> 'period_end')::timestamptz, v_row -> 'data')
    on conflict (site_id, source_id, period_start) do update set data = excluded.data, fetched_at = now();
    v_o := v_o + 1;
  end loop;
  return jsonb_build_object('forecast', v_f, 'observed', v_o);
end $$;

create function cmd.reference_weather(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_entity uuid := core.req_uuid(p, 'entity_id'); v_ctx jsonb; v_id uuid := gen_random_uuid();
begin
  perform core.assert_entity(v_entity);
  v_ctx := core.weather_at(core.ctx_site(), core.opt_ts(p, 'at'));
  if v_ctx is null then perform core.fail('no_weather', 'Det finns inget väder för den tiden'); end if;
  insert into core.weather_context_ref (id, site_id, entity_id, forecast_id, observation_id, purpose)
  values (v_id, core.ctx_site(), v_entity, case when v_ctx ->> 'kind' = 'forecast' then (v_ctx ->> 'id')::uuid end,
          case when v_ctx ->> 'kind' = 'observed' then (v_ctx ->> 'id')::uuid end, p ->> 'purpose');
  return jsonb_build_object('weather_context_ref_id', v_id, 'kind', v_ctx ->> 'kind');
end $$;

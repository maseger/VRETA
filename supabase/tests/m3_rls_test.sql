-- M3: partier (AC-04), nytt liv i flera journaler (AC-05), demontering (AC-06), zon vid punkt, observationer.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as site from sites \gset
select id as orangeri from zones where name = 'Orangeriet' \gset
update zones set geom = '{"type":"Polygon","coordinates":[[[15.0,60.0],[15.001,60.0],[15.001,60.001],[15.0,60.001],[15.0,60.0]]]}' where id = :'orangeri';
do $$ begin
  assert zone_at((select id from sites), 15.0005, 60.0005) = (select id from zones where name = 'Orangeriet'), 'punkten ska ligga i orangeriet';
  assert zone_at((select id from sites), 15.01, 60.01) is null, 'punkten utanför ska inte ge zon';
end $$;

-- AC-04: 400 tegel → 250 i bruk, 120 i lager, 30 sålda
select create_from_proposal(:'site', jsonb_build_object('object', jsonb_build_object('title','Tegel','quantity',400))) as tegel \gset
update objects set status = 'collected' where id = :'tegel';
select store_object(:'tegel', (select id from storage_locations where name = 'Hylla 3'));
select record_usage(:'tegel', jsonb_build_object('type','built_in','zone_id', :'orangeri','quantity',250));
select id as rest from batch_allocations where object_id = :'tegel' and status = 'stored' \gset
-- 30 av resten säljs: dela upp och sätt status sold via reserved_out (M4 gör detta via annons)
begin;
update batch_allocations set quantity = 120 where id = :'rest';
insert into batch_allocations (site_id, object_id, quantity, status) values (:'site', :'tegel', 30, 'sold');
commit;
do $$
declare v_obj uuid := (select id from objects where title = 'Tegel' and quantity = 400);
begin
  -- 250 + 120 + 30 = 400
  assert (select sum(quantity) from batch_allocations where object_id = v_obj) = 400, 'summan ska vara 400';
  assert (select quantity from batch_allocations where object_id = v_obj and status = 'in_use') = 250, '250 i bruk';
  assert (select status from objects where id = v_obj) = 'stored' or (select status from objects where id = v_obj) = 'in_use', 'partiets status ska vara härledd';
end $$;

-- INV-11 håller vid commit
\set ON_ERROR_STOP off
begin;
update batch_allocations set quantity = 1 where object_id = :'tegel' and status = 'sold';
commit;
\set ON_ERROR_STOP on
do $$ begin
  assert (select quantity from batch_allocations where status = 'sold' and object_id = (select id from objects where title = 'Tegel' and quantity = 400)) = 30, 'felaktig summa ska rullas tillbaka';
end $$;

-- AC-05: händelsen syns i objekt-, zon- och platsjournal
do $$
declare v_event uuid := (select event_id from usage_events where object_id = (select id from objects where title = 'Tegel' and quantity = 400) limit 1);
begin
  assert exists (select 1 from event_links where event_id = v_event and entity_type = 'object'), 'objektjournal';
  assert exists (select 1 from event_links where event_id = v_event and entity_type = 'zone'), 'zonjournal';
  assert exists (select 1 from event_links where event_id = v_event and entity_type = 'site'), 'platsjournal';
  assert (select count(*) from event_links where event_id = v_event and entity_type = 'site') = 1, 'en platslänk';
end $$;

-- AC-06: ett helt objekt i bruk demonteras och läggs tillbaka i lager
select id as kakel from objects where title = 'Kakelugn' \gset
select record_usage(:'kakel', jsonb_build_object('type','installed','zone_id', :'orangeri'));
do $$ begin assert (select status from objects where title = 'Kakelugn') = 'in_use', 'i bruk'; end $$;
select store_object(:'kakel', (select id from storage_locations where name = 'Garaget'));
do $$ begin
  assert (select status from objects where title = 'Kakelugn') = 'stored', 'tillbaka i lager';
  assert (select count(*) from usage_events where object_id = (select id from objects where title = 'Kakelugn')) = 1, 'historiken finns kvar';
end $$;

-- Nytt liv kräver plats
do $$ begin
  begin
    perform record_usage((select id from objects where title = 'Kakelugn'), '{"type":"installed"}'::jsonb);
    raise exception 'FEL: nytt liv utan plats borde nekas';
  exception when check_violation then null; end;
end $$;

-- Observation hamnar i zon- och platsjournal
insert into observations (site_id, kind, text, zone_id) values (:'site', 'vatten', 'Stående vatten efter regnet', :'orangeri');
do $$ begin
  assert exists (select 1 from events e join event_links l on l.event_id = e.id where e.event_type = 'observation.vatten' and l.entity_type = 'zone'), 'zonjournal';
  assert (select event_id from observations limit 1) is not null, 'observationen ska peka på sin händelse';
end $$;
insert into decisions (site_id, question, choice, rationale, zone_id) values (:'site', 'Var ska kakelugnen stå?', 'I orangeriets vinterdel', 'Värmen behövs där', :'orangeri');
do $$ begin assert exists (select 1 from events where event_type = 'decision'), 'beslut i journalen'; end $$;
reset role;
select 'M3-TESTER GODKÄNDA' as resultat;

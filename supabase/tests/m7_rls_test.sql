-- M7: behov i projekt och projektytor.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as site from sites \gset
select id as proj from projects where name = 'Jordkällaren' \gset
select id as sten from objects where title = 'Kalksten' \gset

-- Projektytan blir PostGIS-geometri
update projects set geom = '{"type":"Polygon","coordinates":[[[17.1,60.6],[17.2,60.6],[17.2,60.7],[17.1,60.6]]]}' where id = :'proj';
do $$ begin
  assert (select geom_pg is not null from projects where name = 'Jordkällaren'), 'projektytan har geometri';
end $$;

-- Behov: 1 500 sten, fylls i två steg
insert into needs (site_id, project_id, title, quantity, unit) values (:'site', :'proj', 'Sten till valvet', 1500, 'st') returning id as behov \gset
insert into need_fulfillments (site_id, need_id, quantity, object_id) values (:'site', :'behov', 1020, :'sten');
do $$
declare v_need uuid := (select id from needs where title = 'Sten till valvet');
begin
  assert need_fulfilled(v_need) = 1020, '1 020 av 1 500';
  assert exists (select 1 from events e join event_links l on l.event_id = e.id
                  where e.event_type = 'need.fulfilled' and e.summary = 'Sten till valvet: 1020 av 1500 st – Kalksten' and l.entity_type = 'project'), 'händelse i projektjournalen';
end $$;
insert into need_fulfillments (site_id, need_id, quantity, note) values (:'site', :'behov', 480, 'Från stenröset');
do $$ begin
  assert exists (select 1 from events where event_type = 'need.covered' and story_worthy), 'behovet uppfyllt';
end $$;

-- Efterlysning kopplas till behovet
insert into listings (site_id, type, title, locality) values (:'site', 'wanted', 'Söker kalksten', 'Tierp') returning id as eft \gset
update needs set listing_id = :'eft' where id = :'behov';

-- Läsare ser behov men kan varken skapa eller fylla dem
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin
  assert (select count(*) from needs) = 1, 'läsaren ser behovet';
  assert (select count(*) from need_fulfillments) = 2, 'läsaren ser uppfyllelsen';
  begin
    insert into needs (site_id, project_id, title) values ((select id from sites), (select id from projects where name = 'Jordkällaren'), 'Smygbehov');
    raise exception 'FEL: läsare borde inte kunna skapa behov';
  exception when insufficient_privilege then null; end;
  begin
    insert into need_fulfillments (site_id, need_id, quantity) values ((select id from sites), (select id from needs limit 1), 1);
    raise exception 'FEL: läsare borde inte kunna fylla behov';
  exception when insufficient_privilege then null; end;
end $$;

-- Medhjälpare kan ta bort en felregistrering
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
delete from need_fulfillments where note = 'Från stenröset';
do $$ begin assert need_fulfilled((select id from needs limit 1)) = 1020, 'felregistrering borttagen'; end $$;
reset role;
select 'M7-TESTER GODKÄNDA' as resultat;

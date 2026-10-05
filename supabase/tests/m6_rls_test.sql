-- M6: projekt och platser utanför Vreta.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as site from sites \gset
select id as zon from zones limit 1 \gset

-- Projekt som angetts med namn i tidigare milstolpar har blivit riktiga projekt
do $$ begin
  assert not exists (select 1 from usage_events where btrim(project) <> '' and project_id is null), 'nytt liv har projekt-id';
  assert not exists (select 1 from contributions where btrim(project) <> '' and project_id is null), 'bidrag har projekt-id';
end $$;

-- Ett namn på nytt liv blir ett projekt, och samma namn med annat skiftläge återanvänds
select create_from_proposal(:'site', jsonb_build_object('object', jsonb_build_object('title','Kalksten'))) as sten \gset
update objects set status = 'collected' where id = :'sten';
select record_usage(:'sten', jsonb_build_object('type','built_in','zone_id', :'zon','project','  Jordkällaren ')) as ev \gset
insert into persons (site_id, name, locality) values (:'site', 'Stina', 'Tierp') returning id as stina \gset
insert into contributions (site_id, person_id, kind, description, project) values (:'site', :'stina', 'tid', 'Murade valvet', 'jordkällaren');
do $$
declare v_p uuid := (select id from projects where name = 'Jordkällaren');
begin
  assert v_p is not null, 'projektet skapades med städat namn';
  assert (select count(*) from projects where lower(name) = 'jordkällaren') = 1, 'ett projekt, inte två';
  assert (select project_id from usage_events where project = 'Jordkällaren' limit 1) = v_p, 'nytt liv pekar på projektet';
  assert (select project from contributions where description = 'Murade valvet') = 'Jordkällaren', 'bidraget får projektets namn';
  assert (select count(*) from event_links where entity_type = 'project' and entity_id = v_p) = 2, 'projektjournal: två händelser';
  assert (select zone_id from projects where id = v_p) is not null, 'projektet ärver zonen';
end $$;

-- Nytt namn speglas på nytt liv och bidrag
update projects set name = 'Jordkällaren vid ladan' where name = 'Jordkällaren';
do $$ begin
  assert (select project from usage_events where project_id = (select id from projects where name = 'Jordkällaren vid ladan') limit 1) = 'Jordkällaren vid ladan', 'nytt namn på nytt liv';
  assert (select project from contributions where description = 'Murade valvet') = 'Jordkällaren vid ladan', 'nytt namn på bidraget';
end $$;
update projects set name = 'Jordkällaren' where name = 'Jordkällaren vid ladan';

-- Status: klart sätter slutdatum och loggas
update projects set status = 'done' where name = 'Jordkällaren';
do $$ begin
  assert (select finished_on from projects where name = 'Jordkällaren') = current_date, 'slutdatum';
  assert exists (select 1 from audit_entries where action = 'project_status'), 'statusbyte i audit';
end $$;

-- Plats utanför Vreta med privat adress, kopplad till inköp, hämtning och avslut
insert into external_places (site_id, name, kind, locality) values (:'site', 'Tierps loppis', 'loppis', 'Tierp') returning id as loppis \gset
insert into external_place_private (place_id, site_id, address) values (:'loppis', :'site', 'Storgatan 1');
update acquisitions set place_id = :'loppis' where object_id = :'sten';
select id as disp from disposals limit 1 \gset
select set_disposal_place(:'disp', :'loppis');
do $$ begin
  assert exists (select 1 from disposals where place_id is not null), 'avslutet fick plats';
end $$;

-- Medhjälpare: ser adressen, kan skapa platser och projekt
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from external_place_private) = 1, 'medhjälparen ser adressen';
  insert into projects (site_id, name) values ((select id from sites), 'Hönshuset');
end $$;

-- Läsare: ser projekt och platser men inte adressen; kan inte skapa eller sätta plats på avslut
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin
  assert (select count(*) from projects) >= 2, 'läsaren ser projekt';
  assert (select count(*) from external_places) = 1, 'läsaren ser platsen';
  assert (select count(*) from external_place_private) = 0, 'läsaren ser inte adressen';
  begin
    insert into projects (site_id, name) values ((select id from sites), 'Smygprojekt');
    raise exception 'FEL: läsare borde inte kunna skapa projekt';
  exception when insufficient_privilege then null; end;
  begin
    perform set_disposal_place((select id from disposals limit 1), null);
    raise exception 'FEL: läsare borde inte kunna ändra avslut';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'M6-TESTER GODKÄNDA' as resultat;

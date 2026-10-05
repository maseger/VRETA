-- M2: anskaffningsflöde, hämtning (AC-03), lager, kontakthistorik. Körs efter m1_rls_test.sql.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as site from sites \gset

do $$ begin assert (select count(*) from checklist_templates) = 4, 'standardmallar saknas'; end $$;

-- Lagerträd
insert into storage_locations (site_id, name) values (:'site', 'Garaget') returning id as garage \gset
insert into storage_locations (site_id, name, parent_id) values (:'site', 'Hylla 3', :'garage') returning id as hylla \gset
do $$ begin assert storage_path((select id from storage_locations where name = 'Hylla 3')) = 'Garaget → Hylla 3', 'fel sökväg'; end $$;

-- Ett nytt fynd med anskaffning
select create_from_proposal(:'site', jsonb_build_object(
  'object', jsonb_build_object('title','Kakelugn','quantity',1),
  'person', jsonb_build_object('name','Birgitta','locality','Sandviken'),
  'acquisition', jsonb_build_object('type','purchase','price',3000))) as obj \gset
select id as acq from acquisitions where object_id = :'obj' \gset

-- Anskaffningsflöde 5.2
do $$ begin
  begin
    update acquisitions set status = 'settled' where object_id = (select id from objects where title = 'Kakelugn');
    raise exception 'FEL: lead → settled borde nekas';
  exception when check_violation then null; end;
end $$;
update acquisitions set status = 'agreed' where id = :'acq';
update objects set status = 'reserved' where id = :'obj';

-- Hämtning med mall
select create_pickup(:'site', jsonb_build_object(
  'acquisition_id', :'acq', 'person_id', (select person_id from acquisitions where id = :'acq'), 'title', 'Kakelugn hos Birgitta',
  'scheduled_date', '2026-10-10', 'address', 'Storgatan 1', 'object_ids', jsonb_build_array(:'obj'),
  'template_id', (select id from checklist_templates where name = 'Stora byggnadsdelar'))) as pickup \gset
do $$ begin
  assert (select count(*) from checklist_items) = 6, 'checklista saknas';
  assert (select status from objects where title = 'Kakelugn') = 'pickup_planned', 'objektet ska vara hämtning planerad';
end $$;

-- Kan inte avslutas utan kvittering
do $$ begin
  begin
    perform complete_pickup((select id from pickups limit 1), '[]'::jsonb, null);
    raise exception 'FEL: avslut utan kvittering borde nekas';
  exception when check_violation then null; end;
end $$;

-- AC-03: avslut uppdaterar objekt, anskaffning, händelse och lager utan dubbelregistrering
select complete_pickup(:'pickup', jsonb_build_array(jsonb_build_object('object_id', :'obj', 'receipt', 'received')), :'hylla');
do $$ begin
  assert (select status from pickups limit 1) = 'completed', 'hämtningen ska vara klar';
  assert (select status from objects where title = 'Kakelugn') = 'stored', 'objektet ska ligga i lager';
  assert (select storage_location_id from objects where title = 'Kakelugn') = (select id from storage_locations where name = 'Hylla 3'), 'fel lagerplats';
  assert (select status from acquisitions where object_id = (select id from objects where title = 'Kakelugn')) = 'received', 'anskaffningen ska vara mottagen';
  assert (select count(*) from events where event_type = 'pickup.completed') = 1, 'en hämtningshändelse';
  assert (select count(*) from event_links l join events e on e.id = l.event_id
          where e.event_type = 'pickup.completed' and l.entity_type = 'object') = 1, 'händelsen ska länka objektet';
end $$;

-- Kontakthistorik är privat
insert into interactions (site_id, person_id, channel, summary)
values (:'site', (select person_id from acquisitions where id = :'acq'), 'samtal', 'Vill ha kontant betalning');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from interactions) = 0, 'medhjälpare får inte se ägarens kontakthistorik';
  assert (select count(*) from pickup_private) = 1, 'medhjälpare behöver adressen för att hämta';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin assert (select count(*) from pickup_private) = 0, 'läsare får inte se hämtadresser'; end $$;
reset role;
select 'M2-TESTER GODKÄNDA' as resultat;

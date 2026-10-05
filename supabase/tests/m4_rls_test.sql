-- M4: annons i kanaler, intressenter, utflöde (AC-07, AC-08), bidrag och samtycke.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as site from sites \gset

-- Ett parti takpannor i lager; 30 av 100 annonseras
select create_from_proposal(:'site', jsonb_build_object('object', jsonb_build_object('title','Takpannor','quantity',100))) as pannor \gset
update objects set status = 'collected' where id = :'pannor';
select store_object(:'pannor', (select id from storage_locations where name = 'Hylla 3'));
insert into listings (site_id, object_id, type, title, description, price, quantity, locality)
values (:'site', :'pannor', 'sell', '30 lertakpannor', 'Enkupiga, rengjorda', 600, 30, 'Uppsala') returning id as annons \gset

-- AC-07: publicering i två kanaler, delen blir utannonserad
select publish_channel(:'annons', 'blocket', 'https://www.blocket.se/annons/1', 'manual');
select publish_channel(:'annons', 'facebook_marketplace', 'https://www.facebook.com/marketplace/item/1', 'browser_agent');
do $$
declare v_obj uuid := (select id from objects where title = 'Takpannor');
begin
  assert (select status from listings where title = '30 lertakpannor') = 'published', 'annonsen publicerad';
  assert (select count(*) from channel_posts where status = 'posted') = 2, 'två kanaler';
  assert (select quantity from batch_allocations where object_id = v_obj and status = 'listed') = 30, '30 utannonserade';
  assert (select quantity from batch_allocations where object_id = v_obj and status = 'stored') = 70, '70 kvar i lager';
  assert (select sum(quantity) from batch_allocations where object_id = v_obj) = 100, 'INV-11';
  assert exists (select 1 from audit_entries where action = 'channel_posted'), 'audit för kanal';
end $$;

-- Intressenter i kö
insert into persons (site_id, name, locality) values (:'site', 'Karin', 'Uppsala') returning id as karin \gset
insert into persons (site_id, name, locality) values (:'site', 'Olle', 'Enköping') returning id as olle \gset
insert into leads (site_id, listing_id, person_id, channel, queue_position, message) values (:'site', :'annons', :'karin', 'blocket', 1, 'Finns de kvar?') returning id as lead1 \gset
insert into leads (site_id, listing_id, person_id, channel, queue_position, bid) values (:'site', :'annons', :'olle', 'facebook_marketplace', 2, 500) returning id as lead2 \gset

-- Otillåten övergång nekas
do $$ begin
  begin
    update leads set status = 'completed' where person_id = (select id from persons where name = 'Karin');
    raise exception 'FEL: new → completed borde nekas';
  exception when check_violation then null; end;
end $$;

-- Karin kommer inte: tillbaka till publicerad, sedan Olle
select agree_lead(:'lead1');
do $$ begin
  assert (select status from listings where title = '30 lertakpannor') = 'agreed', 'överenskommen';
  assert exists (select 1 from batch_allocations where status = 'reserved_out' and quantity = 30), 'delen reserverad';
end $$;
select release_lead(:'lead1', 'no_show');
do $$ begin
  assert (select status from listings where title = '30 lertakpannor') = 'published', 'tillbaka till publicerad';
  assert exists (select 1 from batch_allocations where status = 'listed' and quantity = 30), 'delen utannonserad igen';
end $$;
select agree_lead(:'lead2');

-- AC-08: avsluta affären i en transaktion
select complete_disposal(:'annons', jsonb_build_object('lead_id', :'lead2', 'price', 500, 'payment_method', 'swish')) as disposal \gset
do $$
declare v_obj uuid := (select id from objects where title = 'Takpannor');
begin
  assert (select status from listings where title = '30 lertakpannor') = 'completed', 'annonsen klar';
  assert (select quantity from batch_allocations where object_id = v_obj and status = 'sold') = 30, '30 sålda';
  assert (select sum(quantity) from batch_allocations where object_id = v_obj) = 100, 'INV-11 efter försäljning';
  assert (select status from objects where id = v_obj) = 'stored', 'resten av partiet i lager';
  assert (select status from leads where person_id = (select id from persons where name = 'Olle')) = 'completed', 'leaden klar';
  assert (select roles from persons where name = 'Olle') @> array['Köpare'], 'köparrollen';
  assert (select price from disposal_private) = 500, 'privat pris';
  assert (select count(*) from tasks where title like 'Ta ner annonsen%') = 2, 'påminnelser för båda kanalerna';
  assert exists (select 1 from events e join event_links l on l.event_id = e.id
                  where e.event_type = 'disposal.sold' and l.entity_type = 'person'), 'händelse i personens journal';
  assert exists (select 1 from events e join event_links l on l.event_id = e.id
                  where e.event_type = 'disposal.sold' and l.entity_type = 'object' and l.entity_id = v_obj), 'händelse i objektets journal';
end $$;
select remove_channel(:'annons', 'blocket');
do $$ begin
  assert (select status from channel_posts where channel = 'blocket') = 'removed', 'nedtagen';
  assert (select count(*) from tasks where title like 'Ta ner annonsen%' and status = 'open') = 1, 'påminnelsen för blocket är klar';
  assert (select queue_position from leads where person_id = (select id from persons where name = 'Olle')) = 2, 'köordning';
end $$;

-- Tillbakadragen annons: delen går tillbaka till lager
insert into listings (site_id, object_id, type, title, quantity, locality) values (:'site', :'pannor', 'sell', '10 takpannor', 10, 'Uppsala') returning id as tio \gset
select publish_channel(:'tio', 'blocket', '', 'manual');
select withdraw_listing(:'tio');
do $$ begin
  assert (select status from listings where title = '10 takpannor') = 'withdrawn', 'tillbakadragen';
  assert (select status from batch_allocations where id = (select allocation_id from listings where title = '10 takpannor')) = 'stored', 'tillbaka i lager';
  assert (select count(*) from tasks where title like 'Ta ner annonsen ”10 takpannor”%') = 1, 'påminnelse vid tillbakadragning';
end $$;

-- Hel sak skänks bort
select id as kakel from objects where title = 'Kakelugn' \gset
select create_from_proposal(:'site', jsonb_build_object('object', jsonb_build_object('title','Pardörr','quantity',1))) as dorr \gset
update objects set status = 'collected' where id = :'dorr';
select store_object(:'dorr', (select id from storage_locations where name = 'Garaget'));
insert into listings (site_id, object_id, type, title, locality) values (:'site', :'dorr', 'give', 'Pardörr skänkes', 'Uppsala') returning id as gava \gset
select publish_channel(:'gava', 'facebook_group', '', 'manual');
insert into leads (site_id, listing_id, person_id) values (:'site', :'gava', :'karin') returning id as lead3 \gset
select agree_lead(:'lead3');
select complete_disposal(:'gava', '{}'::jsonb);
do $$ begin
  assert (select status from objects where title = 'Pardörr') = 'donated', 'skänkt';
  assert (select roles from persons where name = 'Karin') @> array['Mottagare'], 'mottagarroll';
end $$;

-- Avsluta kräver överenskommelse
insert into listings (site_id, type, title) values (:'site', 'wanted', 'Söker spröjsade fönster') returning id as sokes \gset
do $$ begin
  begin
    perform complete_disposal((select id from listings where title = 'Söker spröjsade fönster'), '{}'::jsonb);
    raise exception 'FEL: avsluta utan överenskommelse borde nekas';
  exception when check_violation then null; end;
end $$;

-- AC-10: bidrag ger roll och händelse i personens och platsens journal
insert into contributions (site_id, person_id, kind, description, hours) values (:'site', :'olle', 'tid', 'Hjälpte till att lägga om taket', 6);
do $$ begin
  assert (select roles from persons where name = 'Olle') @> array['Medskapare'], 'medskaparroll';
  assert exists (select 1 from events e join event_links l on l.event_id = e.id
                  where e.event_type = 'contribution.tid' and l.entity_type = 'site'), 'platsjournal';
  assert (select event_id from contributions limit 1) is not null, 'bidraget pekar på händelsen';
end $$;
insert into reciprocity_entries (site_id, person_id, description) values (:'site', :'olle', 'Fick tegel till sin jordkällare');

-- Samtycke per inlägg: ägaren registrerar
insert into content_items (site_id, goal, source_type, source_id) values (:'site', 'Tack till Olle', 'person', :'olle') returning id as inlagg \gset
insert into content_consents (site_id, content_id, person_id, name_ok, how) values (:'site', :'inlagg', :'olle', true, 'Muntligt på plats');
do $$ begin assert exists (select 1 from audit_entries where action = 'content_consent'), 'samtycke loggas'; end $$;

-- Medhjälpare: ser annonser och intressenter men inte försäljningspriset; kan inte registrera samtycke
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from listings) = 4, 'medhjälparen ser annonser';
  assert (select count(*) from leads) = 3, 'medhjälparen ser intressenter';
  assert (select count(*) from disposal_private) = 0, 'medhjälparen ser inte ägarens pris';
  begin
    insert into content_consents (site_id, content_id, person_id) values ((select id from sites), (select id from content_items where goal = 'Tack till Olle'), (select id from persons where name = 'Karin'));
    raise exception 'FEL: medhjälpare borde inte kunna registrera samtycke';
  exception when insufficient_privilege then null; end;
end $$;

-- Läsare: ser annonser men inte intressenter
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin
  assert (select count(*) from listings) = 4, 'läsaren ser annonser';
  assert (select count(*) from leads) = 0, 'läsaren ser inte intressenter';
  assert (select count(*) from disposal_private) = 0, 'läsaren ser inte pris';
end $$;
reset role;
select 'M4-TESTER GODKÄNDA' as resultat;

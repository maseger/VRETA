-- Kör: scripts/test-db.sh. Varje kontroll avbryter med fel om den inte håller.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Ägaren skapar platsen
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select bootstrap_site('Vreta', 'Ägaren') as site \gset
reset role;
insert into site_members values (:'site', '00000000-0000-0000-0000-00000000000c', 'contributor', 'Medhjälpare');
insert into site_members values (:'site', '00000000-0000-0000-0000-00000000000f', 'viewer', 'Läsare');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into zones (site_id, name) values (:'site', 'Orangeriet') returning id as zone \gset

-- AC-01: förslag → objekt, person, anskaffning, uppgift, händelse, audit
select create_from_proposal(:'site', jsonb_build_object(
  'object', jsonb_build_object('title','Gjutjärnsfönster','category','Fönster och dörrar','quantity',6),
  'person', jsonb_build_object('name','Anders','locality','Ockelbo'),
  'acquisition', jsonb_build_object('type','purchase','price',1200,'deadline','2026-11-01'),
  'task', jsonb_build_object('title','Hämta fönstren','due','2026-11-01'),
  'why', 'Från ett torp från 1890-talet')) as obj \gset

do $$ begin
  assert (select count(*) from objects) = 1, 'objekt saknas';
  assert (select is_batch from objects) = true, 'parti ska vara batch';
  assert (select count(*) from persons) = 1, 'person saknas';
  assert (select price from acquisition_private) = 1200, 'pris saknas';
  assert (select count(*) from tasks) = 1, 'uppgift saknas';
  assert (select count(*) from events where event_type = 'object.discovered') = 1, 'händelse saknas';
  assert (select count(*) from audit_entries where action = 'create_from_proposal') = 1, 'audit saknas';
end $$;

-- Tillståndsmaskin: otillåten övergång nekas, tillåten ger händelse + audit
do $$ begin
  begin
    update objects set status = 'sold';
    raise exception 'FEL: discovered → sold borde nekas';
  exception when check_violation then null; end;
end $$;
update objects set status = 'collected';
update objects set status = 'stored';
do $$ begin
  assert (select count(*) from events where event_type = 'object.status_changed') = 2, 'statushändelser saknas';
  assert (select count(*) from audit_entries where action = 'status_change') = 2, 'status-audit saknas';
end $$;
-- INV-05: i bruk kräver plats
do $$ begin
  begin
    update objects set status = 'in_use';
    raise exception 'FEL: in_use utan plats borde nekas';
  exception when check_violation then null; end;
end $$;
update objects set status = 'in_use', zone_id = (select id from zones limit 1);

-- Ägaren skriver en privat anteckning och sätter samtycke
update person_private set contact = '070-000 00 00', notes = 'Vill ha fönstren hämtade på kvällen';
update persons set consent_name = 'yes';
insert into content_items (site_id, goal, source_type, source_id) values (:'site', 'fyndet', 'object', :'obj');

-- AC-17: medhjälparen registrerar men ser inte privata uppgifter och kan inte publicera
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from objects) = 1, 'medhjälpare ska se objektet';
  assert (select count(*) from person_private) = 0, 'medhjälpare får inte se kontaktuppgifter';
  assert (select count(*) from acquisition_private) = 0, 'medhjälpare får inte se priser';
  assert (select count(*) from audit_entries) = 0, 'medhjälpare får inte se audit';
  begin
    update persons set consent_image = 'yes';
    raise exception 'FEL: medhjälpare ska inte kunna ändra samtycke';
  exception when insufficient_privilege then null; end;
  begin
    update content_items set status = 'shared';
    raise exception 'FEL: medhjälpare ska inte kunna dela';
  exception when insufficient_privilege then null; end;
end $$;
select create_from_proposal(:'site', jsonb_build_object('object', jsonb_build_object('title','Mässingshandtag','quantity',4))) is not null as contributor_can_capture;

-- Läsaren kan läsa men inte registrera
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin
  assert (select count(*) from objects) = 2, 'läsare ska se objekten';
  begin
    perform create_from_proposal((select id from sites), jsonb_build_object('object', jsonb_build_object('title','X')));
    raise exception 'FEL: läsare ska inte kunna registrera';
  exception when insufficient_privilege then null; end;
end $$;

-- Utomstående ser ingenting
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', false);
do $$ begin
  assert (select count(*) from objects) = 0, 'utomstående ska inte se något';
  assert (select count(*) from sites) = 0, 'utomstående ska inte se platsen';
end $$;
reset role;
select 'ALLA DATABASTESTER GODKÄNDA' as resultat;

-- M9: gäster via gästlänk.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;

-- Medhjälparen kan inte skapa länkar
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  begin
    perform create_guest_link('Smyglänk');
    raise exception 'FEL: medhjälpare borde inte kunna skapa gästlänkar';
  exception when insufficient_privilege then null; end;
end $$;

-- Ägaren skapar en länk och ger Karin namnsamtycke
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select create_guest_link('Familjen') ->> 'token' as token, create_guest_link('Grannarna') ->> 'id' as granne_id \gset
update persons set consent_name = 'yes' where name = 'Karin';
select count(*) as med_samtycke from persons where consent_name = 'yes' \gset
select count(*) as alla from persons \gset
do $$ begin
  assert (select count(*) from guest_links) = 2, 'två länkar';
  assert not exists (select 1 from guest_links where token_hash = ''), 'bara hash sparas';
end $$;

-- En anonym besökare med fel nyckel kommer inte in
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
do $$ begin
  begin
    perform redeem_guest_link('fel');
    raise exception 'FEL: fel nyckel borde nekas';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from objects) = 0, 'utan medlemskap syns inget';
end $$;

-- Med rätt nyckel blir besökaren gäst: ser saker men bara personer med samtycke, och kan inte ändra
select redeem_guest_link(:'token');
select count(*) = :med_samtycke and :med_samtycke < :alla as samtycke_ok from persons \gset
\if :samtycke_ok
\else
  \echo 'FEL: gästen ser bara personer med namnsamtycke'
  select 1/0;
\endif
do $$ begin
  assert (select count(*) from objects) > 0, 'gästen ser saker';
  assert (select count(*) from projects) > 0, 'gästen ser projekt';
  assert exists (select 1 from persons where name = 'Karin'), 'Karin syns';
  assert not exists (select 1 from persons where consent_name <> 'yes'), 'inga personer utan samtycke';
  assert (select count(*) from person_private) = 0, 'inga privata uppgifter';
  assert (select count(*) from acquisition_private) = 0, 'inga priser';
  assert (select count(*) from person_relations) = 0, 'inga relationer';
  assert (select count(*) from external_place_private) = 0, 'inga adresser';
  assert (select count(*) from guest_links) = 0, 'gästen ser inte länkarna';
  assert (select count(*) from pickups) = 0, 'inga hämtningar';
  assert (select count(*) from tasks) = 0, 'inga uppgifter';
  assert (select count(*) from story_notes) = 0, 'inga citat eller anteckningar';
  assert not exists (select 1 from contributions c join persons p on p.id = c.person_id where p.consent_contribution <> 'yes'), 'bara bidrag med samtycke';
  assert (select count(*) from events) > 0, 'gästen ser journalen';
  assert not exists (select 1 from event_links l join events e on e.id = l.event_id where l.entity_type = 'person'
                      and l.entity_id not in (select id from persons)), 'inga händelser om personer utan samtycke';
  begin
    insert into projects (site_id, name) values ((select id from sites), 'Gästprojekt');
    raise exception 'FEL: gäst borde inte kunna skapa';
  exception when insufficient_privilege then null; end;
  begin
    update objects set title = 'Ändrat';
    if exists (select 1 from objects where title = 'Ändrat') then raise exception 'FEL: gäst ändrade ett objekt'; end if;
  end;
end $$;

-- Ägaren kan inte nedgraderas av en gästlänk
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select redeem_guest_link(:'token');
do $$ begin assert is_owner((select id from sites)), 'ägaren är fortfarande ägare'; end $$;

-- Ägaren stänger länken: gästen förlorar åtkomsten
select id as familj_id from guest_links where label = 'Familjen' \gset
select revoke_guest_link(:'familj_id');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
do $$ begin
  assert (select count(*) from objects) = 0, 'stängd länk – ingen åtkomst';
  begin
    perform redeem_guest_link((select 'x'));
    raise exception 'FEL';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  begin
    perform revoke_guest_link((select id from guest_links limit 1));
    raise exception 'FEL: gäst borde inte kunna stänga länkar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
do $$ begin assert not is_member((select site_id from guest_links limit 1)), 'gästen är inte längre medlem'; end $$;
reset role;
select 'M9-TESTER GODKÄNDA' as resultat;

-- M8: relationer mellan människor.
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as site from sites \gset
select id as karin from persons where name = 'Karin' \gset
select id as olle from persons where name = 'Olle' \gset
select id as stina from persons where name = 'Stina' \gset

insert into person_relations (site_id, person_id, other_id, kind) values (:'site', :'karin', :'olle', 'granne');
insert into person_relations (site_id, person_id, other_id, kind, note) values (:'site', :'karin', :'stina', 'introduced', 'Karin tipsade om Stinas kalksten');
do $$ begin
  assert (select count(*) from person_relations) = 2, 'två relationer';
  assert exists (select 1 from audit_entries where action = 'person_relation'), 'relationen loggas';
end $$;

-- Samma grannskap åt andra hållet är en dubblett; att Olle tipsade om Karin är en ny relation
do $$ begin
  begin
    insert into person_relations (site_id, person_id, other_id, kind) values ((select id from sites), (select id from persons where name = 'Olle'), (select id from persons where name = 'Karin'), 'granne');
    raise exception 'FEL: dubbletten borde nekas';
  exception when unique_violation then null; end;
  begin
    insert into person_relations (site_id, person_id, other_id, kind) values ((select id from sites), (select id from persons where name = 'Olle'), (select id from persons where name = 'Olle'), 'van');
    raise exception 'FEL: relation med sig själv borde nekas';
  exception when check_violation then null; end;
end $$;
insert into person_relations (site_id, person_id, other_id, kind) values (:'site', :'olle', :'karin', 'introduced');

-- Medhjälpare ser och kan ta bort
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin assert (select count(*) from person_relations) = 3, 'medhjälparen ser relationerna'; end $$;
delete from person_relations where kind = 'introduced' and note = '';
-- Läsare ser inga relationer och kan inte skapa
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin
  assert (select count(*) from person_relations) = 0, 'läsaren ser inga relationer';
  begin
    insert into person_relations (site_id, person_id, other_id, kind) values ((select id from sites), (select id from persons where name = 'Olle'), (select id from persons where name = 'Stina'), 'van');
    raise exception 'FEL: läsare borde inte kunna skapa relationer';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin assert (select count(*) from person_relations) = 2, 'borttagen'; end $$;
select 'M8-TESTER GODKÄNDA' as resultat;

-- VRETA R1 · M8: relationer mellan människor
-- Människor hanterar sakerna och har relationer med varandra: familj, grannar, vänner, kollegor – och vem
-- som tipsade oss om vem. Relationerna är personuppgifter och syns bara för ägare och medhjälpare.

create table person_relations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  person_id uuid not null references persons(id) on delete cascade,
  other_id uuid not null references persons(id) on delete cascade,
  -- introduced är riktad: person_id tipsade oss om other_id. Övriga gäller åt båda hållen.
  kind text not null check (kind in ('familj', 'partner', 'granne', 'van', 'kollega', 'samarbetar', 'introduced')),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  check (person_id <> other_id)
);
-- Samma relation bara en gång, oavsett håll för de symmetriska
create unique index person_relations_unique on person_relations (site_id, kind,
  (case when kind = 'introduced' then person_id else least(person_id, other_id) end),
  (case when kind = 'introduced' then other_id else greatest(person_id, other_id) end));
create index person_relations_person on person_relations (person_id);
create index person_relations_other on person_relations (other_id);

-- Båda personerna måste höra till platsen
create or replace function person_relations_check() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.person_id = new.other_id then
    raise exception 'En person kan inte ha en relation med sig själv' using errcode = 'check_violation';
  end if;
  if (select count(*) from persons where id in (new.person_id, new.other_id) and site_id = new.site_id) <> 2 then
    raise exception 'Personen finns inte' using errcode = 'foreign_key_violation';
  end if;
  insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
  values (new.site_id, auth.uid(), 'person_relation', 'person', new.person_id, null, jsonb_build_object('kind', new.kind, 'other_id', new.other_id));
  return new;
end $$;
create trigger person_relations_check before insert on person_relations for each row execute function person_relations_check();

alter table person_relations enable row level security;
create policy person_relations_read on person_relations for select to authenticated using (is_writer(site_id));
create policy person_relations_insert on person_relations for insert to authenticated with check (is_writer(site_id));
create policy person_relations_delete on person_relations for delete to authenticated using (is_writer(site_id));

-- VRETA R1 · M6: projekt och platser utanför Vreta
-- Saker hanteras, människor hanterar dem och platser är där det sker. Platserna är två slag:
-- platser på Vreta (zoner, byggnader, lager – och projekt som genomförs där) och platser utanför
-- Vreta där saker hämtas, köps och lämnas. Spec: docs/spec-r1.md avsnitt 6.4 och 7.1.

-- ---------------------------------------------------------------- projekt (6.4, P1)
create type project_status as enum ('idea', 'planned', 'active', 'paused', 'done');

create table projects (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  kind text not null default '',          -- bygge, plantering, renovering, anläggning, annat
  status project_status not null default 'active',
  description text not null default '',
  zone_id uuid references zones(id) on delete set null,
  structure_id uuid references structures(id) on delete set null,
  started_on date,
  finished_on date,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index projects_site_name on projects (site_id, lower(btrim(name)));

alter table usage_events add column project_id uuid references projects(id) on delete set null;
alter table contributions add column project_id uuid references projects(id) on delete set null;
create index usage_events_project_idx on usage_events (project_id);
create index contributions_project_idx on contributions (project_id);

-- Nytt liv och bidrag anger projekt med namn (fritext) eller id. Namnet slås upp – eller blir ett nytt
-- projekt – och händelsen länkas till projektet så att den syns i projektets journal.
create or replace function resolve_project() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if new.project_id is not null then
    select name into v_name from projects where id = new.project_id and site_id = new.site_id;
    if v_name is null then raise exception 'Projektet finns inte' using errcode = 'foreign_key_violation'; end if;
    new.project := v_name;
  elsif btrim(coalesce(new.project, '')) <> '' then
    new.project := regexp_replace(btrim(new.project), '\s+', ' ', 'g');
    select id, name into v_id, v_name from projects where site_id = new.site_id and lower(btrim(name)) = lower(new.project);
    if v_id is not null then
      new.project := v_name;
    else
      insert into projects (site_id, name, zone_id, started_on)
      values (new.site_id, new.project, new.zone_id, coalesce(new.occurred_at, now())::date)
      returning id into v_id;
    end if;
    new.project_id := v_id;
  end if;
  if new.project_id is not null and new.event_id is not null and tg_op = 'INSERT' then
    insert into event_links (site_id, event_id, entity_type, entity_id, role) values (new.site_id, new.event_id, 'project', new.project_id, 'project');
  end if;
  return new;
end $$;
-- Körs efter contributions_journal (triggrar körs i namnordning) så att händelsen finns.
create trigger usage_events_project before insert on usage_events for each row execute function resolve_project();
create trigger contributions_project before insert on contributions for each row execute function resolve_project();

-- Projekt som bara funnits som namn blir riktiga projekt
insert into projects (site_id, name, zone_id, started_on)
select distinct on (site_id, lower(n)) site_id, n, zone_id, occurred_at::date
from (
  select site_id, regexp_replace(btrim(project), '\s+', ' ', 'g') as n, zone_id, occurred_at from usage_events where btrim(project) <> ''
  union all
  select site_id, regexp_replace(btrim(project), '\s+', ' ', 'g'), zone_id, occurred_at from contributions where btrim(project) <> ''
) x
order by site_id, lower(n), occurred_at
on conflict do nothing;
update usage_events u set project_id = p.id from projects p
 where u.project_id is null and p.site_id = u.site_id and lower(btrim(p.name)) = lower(regexp_replace(btrim(u.project), '\s+', ' ', 'g'));
update contributions c set project_id = p.id from projects p
 where c.project_id is null and p.site_id = c.site_id and lower(btrim(p.name)) = lower(regexp_replace(btrim(c.project), '\s+', ' ', 'g'));
insert into event_links (site_id, event_id, entity_type, entity_id, role)
select site_id, event_id, 'project', project_id, 'project' from usage_events where project_id is not null and event_id is not null
union
select site_id, event_id, 'project', project_id, 'project' from contributions where project_id is not null and event_id is not null;

create or replace function projects_touch() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'done' and new.finished_on is null then new.finished_on := current_date; end if;
    if new.status = 'active' and new.started_on is null then new.started_on := current_date; end if;
    insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
    values (new.site_id, auth.uid(), 'project_status', 'project', new.id, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;
create trigger projects_touch before update on projects for each row execute function projects_touch();

-- Byter projektet namn speglas namnet på nytt liv och bidrag (fritextfältet läses av Fråga Vreta och exporten).
create or replace function projects_rename() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update usage_events set project = new.name where project_id = new.id;
  update contributions set project = new.name where project_id = new.id;
  return null;
end $$;
create trigger projects_rename after update of name on projects for each row
  when (new.name is distinct from old.name) execute function projects_rename();

-- ---------------------------------------------------------------- platser utanför Vreta
-- Hämtställen, loppisar, återvinningscentraler, butiker, gårdar – där saker kommer ifrån och dit de går.
-- Orten är på kommunnivå och får synas (INV-12); adressen är privat som hämtadresser (INV-13).
create table external_places (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  kind text not null default '',          -- hamtstalle, loppis, atervinning, butik, leverantor, gard, annat
  locality text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table external_place_private (
  place_id uuid primary key references external_places(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  address text not null default '',
  created_by uuid not null default auth.uid()
);

alter table acquisitions add column place_id uuid references external_places(id) on delete set null;
alter table pickups add column place_id uuid references external_places(id) on delete set null;
alter table disposals add column place_id uuid references external_places(id) on delete set null;

-- Avslut är oföränderliga för klienten; bara platsen kan sättas i efterhand.
create or replace function set_disposal_place(p_disposal uuid, p_place uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_site uuid;
begin
  select site_id into v_site from disposals where id = p_disposal;
  if v_site is null or not is_writer(v_site) then raise exception 'Saknar rätt att ändra' using errcode = 'insufficient_privilege'; end if;
  if p_place is not null and not exists (select 1 from external_places where id = p_place and site_id = v_site) then
    raise exception 'Platsen finns inte' using errcode = 'foreign_key_violation';
  end if;
  update disposals set place_id = p_place where id = p_disposal;
end $$;

-- ---------------------------------------------------------------- radnivåsäkerhet
alter table projects enable row level security;
alter table external_places enable row level security;
alter table external_place_private enable row level security;

create policy projects_read on projects for select to authenticated using (is_member(site_id));
create policy projects_insert on projects for insert to authenticated with check (is_writer(site_id));
create policy projects_update on projects for update to authenticated using (is_writer(site_id));
create policy external_places_read on external_places for select to authenticated using (is_member(site_id));
create policy external_places_insert on external_places for insert to authenticated with check (is_writer(site_id));
create policy external_places_update on external_places for update to authenticated using (is_writer(site_id));
-- Adressen följer hämtadressen: medhjälpare behöver den för att åka dit, läsare ser den aldrig.
create policy external_place_private_read on external_place_private for select to authenticated using (is_writer(site_id));
create policy external_place_private_insert on external_place_private for insert to authenticated with check (is_writer(site_id));
create policy external_place_private_update on external_place_private for update to authenticated using (is_writer(site_id));

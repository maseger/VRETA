-- Det som Supabase redan har men som en vanlig PostgreSQL eller PGlite saknar:
-- rollerna anon/authenticated/service_role, schemat auth med auth.uid() och auth.jwt(),
-- och schemat extensions. Används av demoläget (PGlite i webbläsaren) och av databastesterna.
-- Körs aldrig mot Supabase.

create schema if not exists extensions;
create schema if not exists auth;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  is_anonymous boolean not null default false,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Samma definitioner som i Supabase: allt läses ur JWT-anspråken i request.jwt.claims.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub'), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;

grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

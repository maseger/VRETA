-- VRETA R1 · M9: gäster
-- Familj och vänner kan titta utan konto. Ägaren skapar en gästlänk med en hemlig nyckel; den som öppnar
-- länken loggas in anonymt (Supabase anonymous sign-in) och blir läsare med gästflagga. Gäster ser bara
-- människor som sagt ja till att namnges, och en länk kan stängas – då försvinner åtkomsten för alla som
-- använt den. Bara nyckelns hash sparas.

alter table site_members add column is_guest boolean not null default false;

create table guest_links (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  last_used_at timestamptz,
  uses int not null default 0,
  revoked_at timestamptz
);
alter table site_members add column guest_link_id uuid references guest_links(id) on delete cascade;

-- Medlemskap via en stängd gästlänk räknas inte: gästen förlorar åtkomsten utan att något raderas
create or replace function member_role_for(p_site uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select m.role from site_members m
   where m.site_id = p_site and m.user_id = auth.uid()
     and (m.guest_link_id is null or exists (select 1 from guest_links g where g.id = m.guest_link_id and g.revoked_at is null))
$$;

create or replace function is_guest(p_site uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_guest from site_members where site_id = p_site and user_id = auth.uid()), false)
$$;

-- Ägaren skapar en länk. Nyckeln returneras en gång och sparas bara som hash.
create or replace function create_guest_link(p_label text) returns jsonb
-- pgcrypto ligger i schemat extensions i Supabase
language plpgsql security definer set search_path = public, extensions as $$
declare v_site uuid; v_token text; v_id uuid;
begin
  select site_id into v_site from site_members where user_id = auth.uid() and role = 'owner' limit 1;
  if v_site is null then raise exception 'Bara ägaren kan skapa gästlänkar' using errcode = 'insufficient_privilege'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into guest_links (site_id, token_hash, label) values (v_site, encode(digest(v_token, 'sha256'), 'hex'), coalesce(btrim(p_label), ''))
  returning id into v_id;
  insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
  values (v_site, auth.uid(), 'guest_link_created', 'guest_link', v_id, null, jsonb_build_object('label', p_label));
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- Den som öppnar länken (anonymt inloggad) blir läsare med gästflagga. En medlem blir aldrig nedgraderad.
create or replace function redeem_guest_link(p_token text) returns uuid
-- pgcrypto ligger i schemat extensions i Supabase
language plpgsql security definer set search_path = public, extensions as $$
declare l guest_links%rowtype;
begin
  if auth.uid() is null then raise exception 'Inte inloggad' using errcode = 'insufficient_privilege'; end if;
  select * into l from guest_links where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null;
  if l.id is null then raise exception 'Gästlänken gäller inte längre' using errcode = 'insufficient_privilege'; end if;
  insert into site_members (site_id, user_id, role, name, is_guest, guest_link_id)
  values (l.site_id, auth.uid(), 'viewer', coalesce(nullif(l.label, ''), 'Gäst'), true, l.id)
  on conflict (site_id, user_id) do nothing;
  update guest_links set last_used_at = now(), uses = uses + 1 where id = l.id;
  return l.site_id;
end $$;

-- Stäng en länk: alla gäster som kom in via den förlorar åtkomsten direkt (member_role_for).
create or replace function revoke_guest_link(p_link uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_site uuid;
begin
  select site_id into v_site from guest_links where id = p_link;
  if v_site is null or not is_owner(v_site) then raise exception 'Bara ägaren kan stänga gästlänkar' using errcode = 'insufficient_privilege'; end if;
  update guest_links set revoked_at = now() where id = p_link and revoked_at is null;
  insert into audit_entries (site_id, actor, action, entity_type, entity_id, before, after)
  values (v_site, auth.uid(), 'guest_link_revoked', 'guest_link', p_link, null, null);
end $$;

alter table guest_links enable row level security;
create policy guest_links_owner on guest_links for select to authenticated using (is_owner(site_id));

-- Gäster ser bara människor som sagt ja till att namnges (12.2). Reglerna ändras med alter policy.
alter policy persons_read on persons
  using (is_member(site_id) and (not is_guest(site_id) or consent_name = 'yes'));

-- Det operativa och det personliga är inte för gäster: hämtningar (rubrik med namn, adress), uppgifter,
-- citat och anteckningar, vad Vreta gett tillbaka.
alter policy pickups_read on pickups using (is_member(site_id) and not is_guest(site_id));
alter policy pickup_items_read on pickup_items using (is_member(site_id) and not is_guest(site_id));
alter policy checklist_items_read on checklist_items using (is_member(site_id) and not is_guest(site_id));
alter policy tasks_read on tasks using (is_member(site_id) and not is_guest(site_id));
alter policy story_notes_read on story_notes using (is_member(site_id) and not is_guest(site_id));
alter policy reciprocity_read on reciprocity_entries using (is_member(site_id) and not is_guest(site_id));
alter policy content_consents_read on content_consents using (is_member(site_id) and not is_guest(site_id));

-- Bidrag syns för gäster bara när personen sagt ja till både namn och att bidraget beskrivs
alter policy contributions_read on contributions
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by))
         and (not is_guest(site_id) or exists (select 1 from persons p where p.id = person_id and p.consent_name = 'yes' and p.consent_contribution = 'yes')));

-- Journalhändelser som nämner en person syns för gäster bara om personen sagt ja till att namnges
create or replace function event_names_unconsented(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_links l join persons p on p.id = l.entity_id
                  where l.event_id = p_event and l.entity_type = 'person' and p.consent_name <> 'yes')
$$;
alter policy events_read on events
  using (is_member(site_id) and (visibility <> 'private' or sees_private(site_id, created_by))
         and (not is_guest(site_id) or not event_names_unconsented(id)));

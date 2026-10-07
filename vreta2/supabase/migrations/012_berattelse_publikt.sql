-- VRETA 2 · Migrering 012 · Berättelse och publikt
-- Innehåll med kanalversioner, råmaterial (StoryNotes), berättelsebågar och Bidra-inskick. Read models
-- (schema rm) som Idag, kartan, Project Canvas, Pulse och årsbilden läser, och publika projektioner
-- (schema pub) – det enda den anonyma rollen kan läsa. Projektionerna bär redan generaliserad geometri,
-- bara samtyckta namn och inga vistelser (ADR-015).

create type story.content_status as enum ('idea', 'draft', 'review', 'approved', 'shared', 'archived', 'rejected');
create type story.note_kind as enum ('why', 'quote', 'moment');
create type story.submission_kind as enum ('have', 'can_help', 'know_where', 'want_to_come');
create type story.submission_status as enum ('new', 'reviewed', 'converted', 'rejected');

select core.define_entity_type('content_item', 'story.content_item', 'Berättelse', 'Berättelser', '/berattelse/:id', 'story', '{title}');
select core.define_entity_type('story_note', 'story.story_note', 'Berättarnotering', 'Berättarnoteringar', null, 'story', '{text}');
select core.define_entity_type('story_arc', 'story.story_arc', 'Berättelsebåge', 'Berättelsebågar', '/bage/:id', 'story', '{title,description}', false, 'R2.7');
select core.define_entity_type('contribute_submission', 'story.contribute_submission', 'Inskick via Bidra', 'Inskick via Bidra', null, 'story', '{message}', false, 'R2.7');

create table story.content_item (
  like core.entity_template including all,
  goal_code text not null,
  status story.content_status not null default 'draft',
  title text not null,
  -- Källorna är länkar, aldrig kopior: objekt, händelser, personer, platser, perioder
  source_ids uuid[] not null default '{}',
  -- Personer som nämns eller syns – kontrolleras mot samtycke vid godkännande (INV-06)
  person_ids uuid[] not null default '{}',
  period_start date,
  period_end date,
  approved_by uuid,
  approved_at timestamptz,
  shared_at timestamptz,
  shared_url text,
  shared_channels text[] not null default '{}'
);
create index content_item_status_idx on story.content_item (site_id, status);
select core.register_table('story.content_item', 'standard', 'content_item', 'title');
alter table people.content_consent add constraint content_consent_item_fk foreign key (content_item_id) references story.content_item (id);

create table story.channel_variant (
  like core.link_template including all,
  content_id uuid not null references story.content_item (id),
  channel_code text not null,
  body text not null default '',
  media_ids uuid[] not null default '{}',
  tone text,
  cta text,
  -- Det integritetsfiltret tog bort och varningar i gult (S9 steg 4)
  removed_by_guard jsonb not null default '[]',
  warnings jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (content_id, channel_code)
);
select core.register_table('story.channel_variant', 'custom');
create policy read on story.channel_variant for select to authenticated
  using (exists (select 1 from story.content_item c where c.id = content_id));

-- Råmaterial: varför, citat (bara med samtycke för citat) och ögonblick (R1.1 8.1).
create table story.story_note (
  like core.entity_template including all,
  entity_id uuid not null references core.entity (id),
  kind story.note_kind not null,
  text text,
  media_id uuid references core.media (id),
  person_id uuid references people.person (id),
  quote_consent boolean not null default false
);
create index story_note_entity_idx on story.story_note (entity_id);
select core.register_table('story.story_note', 'standard', 'story_note', 'text');

create table story.story_arc (
  like core.entity_template including all,
  title text not null,
  description text,
  status text not null default 'emerging' check (status in ('emerging', 'active', 'closed')),
  period_start date,
  period_end date
);
select core.register_table('story.story_arc', 'standard', 'story_arc', 'title', '{description}', 'R2.7');

create table story.story_arc_source (
  like core.link_template including all,
  arc_id uuid not null references story.story_arc (id),
  entity_id uuid not null references core.entity (id),
  ordinal integer not null default 0,
  visibility core.visibility not null default 'internal'
);
select core.register_table('story.story_arc_source', 'standard', p_ui_release => 'R2.7');

-- Inskick från Bidra (R2.7): "Jag har något", "Jag kan hjälpa", "Jag vet var något finns", "Jag vill komma".
-- Kontaktuppgifterna är privata; inskicket hamnar i Att granska.
create table story.contribute_submission (
  like core.entity_template including all,
  kind story.submission_kind not null,
  name text,
  contact text,
  message text not null,
  consent_name boolean not null default false,
  listing_id uuid references resources.listing (id),
  need_id uuid references change.need (id),
  starts_on date,
  ends_on date,
  party_size integer,
  status story.submission_status not null default 'new',
  converted_entity_id uuid references core.entity (id)
);
alter table story.contribute_submission alter column visibility set default 'private';
select core.register_table('story.contribute_submission', 'owner', 'contribute_submission', 'name', '{message}', 'R2.7');
alter table hospitality.stay_request add constraint stay_request_submission_fk foreign key (contribute_submission_id) references story.contribute_submission (id);

insert into core.state (machine, state, label_sv, terminal, sort) values
  ('content', 'idea', 'Idé', false, 1), ('content', 'draft', 'Utkast', false, 2), ('content', 'review', 'Till granskning', false, 3),
  ('content', 'approved', 'Godkänd', false, 4), ('content', 'shared', 'Delad', false, 5), ('content', 'archived', 'Arkiverad', true, 6),
  ('content', 'rejected', 'Avvisad', true, 7);
insert into core.state_transition (machine, from_state, to_state) values
  ('content', 'idea', 'draft'), ('content', 'draft', 'review'), ('content', 'review', 'approved'), ('content', 'draft', 'approved'),
  ('content', 'review', 'draft'), ('content', 'approved', 'draft'), ('content', 'approved', 'shared'), ('content', 'shared', 'archived'),
  ('content', 'approved', 'archived'), ('content', 'draft', 'archived'), ('content', 'idea', 'archived'),
  ('content', 'draft', 'rejected'), ('content', 'review', 'rejected'), ('content', 'shared', 'shared');

-- Mönster för ett helt ord, också med å, ä och ö (regexens ordgränser räknar bara ASCII i C-locale).
create function core.word_re(p text) returns text
language sql immutable set search_path = '' as $$
  select '(?<![[:alnum:]_åäöÅÄÖéÉüÜ])' || regexp_replace(p, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '(?![[:alnum:]_åäöÅÄÖéÉüÜ])'
$$;

-- ------------------------------------------------------------------ integritetsfiltrets sista kontroll
-- Privacy Guard bygger den rensade kontexten i serverfunktionerna (deterministisk kod). Här finns den
-- sista, deterministiska kontrollen innan något godkänns eller publiceras: inga namn utan samtycke,
-- inga adresser, inga lagerplatser, inga inköpspriser och inga privata bilder (INV-03, INV-06, INV-12).
create function story.privacy_violations(p_site uuid, p_text text, p_media uuid[], p_person_ids uuid[], p_content uuid default null,
                                         p_listing boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb := '[]';
  r record;
  v_text text := coalesce(p_text, '');
  v_first text;
begin
  -- Namn: personer som nämns i texten eller är kopplade till inlägget
  for r in
    select pe.id, pe.display_name, c.name as name_consent, c.image as image_consent,
           (select value from people.content_consent cc where cc.content_item_id = p_content and cc.person_id = pe.id and cc.aspect = 'name') as post_name
    from people.person pe left join people.consent_policy c on c.person_id = pe.id
    where pe.site_id = p_site and pe.erased_at is null and length(pe.display_name) >= 3
      and (pe.id = any (coalesce(p_person_ids, '{}'))
           or v_text ~* core.word_re(pe.display_name))
  loop
    v_first := split_part(r.display_name, ' ', 1);
    if (v_text ~* core.word_re(r.display_name)
        or (length(v_first) >= 3 and v_text ~* core.word_re(v_first)))
       and coalesce(r.post_name, r.name_consent, 'ask') <> 'yes' then
      v_out := v_out || jsonb_build_object('kind', 'name_without_consent', 'person_id', r.id, 'text', r.display_name);
    end if;
    if p_listing and exists (select 1 from resources.acquisition a where a.counterpart_person_id = r.id)
       and v_text ~* core.word_re(r.display_name) then
      v_out := v_out || jsonb_build_object('kind', 'giver_name_in_listing', 'person_id', r.id, 'text', r.display_name);
    end if;
  end loop;
  -- Adresser
  for r in
    select address as a from people.person_private where site_id = p_site and length(coalesce(address, '')) >= 6
    union select address from people.organization_private where site_id = p_site and length(coalesce(address, '')) >= 6
    union select address from place.external_place_private where site_id = p_site and length(coalesce(address, '')) >= 6
    union select from_address from resources.pickup_private where site_id = p_site and length(coalesce(from_address, '')) >= 6
    union select address from core.site_private where site_id = p_site and length(coalesce(address, '')) >= 6
  loop
    if position(lower(split_part(r.a, ',', 1)) in lower(v_text)) > 0 then
      v_out := v_out || jsonb_build_object('kind', 'address', 'text', split_part(r.a, ',', 1));
    end if;
  end loop;
  -- Lagerplatser
  for r in select name from place.storage_location where site_id = p_site and length(name) >= 5 and archived_at is null loop
    if v_text ~* core.word_re(r.name) then
      v_out := v_out || jsonb_build_object('kind', 'storage_location', 'text', r.name);
    end if;
  end loop;
  -- Inköpspriser ("200 kr", "1 200 kr")
  for r in select distinct ap.price from resources.acquisition_private ap where ap.site_id = p_site and ap.price is not null and ap.price > 0 loop
    if v_text ~* ('\m' || replace(trim(to_char(r.price, 'FM999G999G990')), ',', ' ') || '\s*(kr|kronor|:-)')
       or v_text ~* ('\m' || trim(to_char(r.price, 'FM9999990')) || '\s*(kr|kronor|:-)') then
      if not p_listing then
        v_out := v_out || jsonb_build_object('kind', 'purchase_price', 'text', trim(to_char(r.price, 'FM9999990')) || ' kr');
      end if;
    end if;
  end loop;
  -- Bilder: privata bilder och bilder på personer utan bildsamtycke
  for r in
    select m.id, m.visibility,
      exists (select 1 from core.media_link l left join people.consent_policy c on c.person_id = l.entity_id
              left join people.content_consent cc on cc.content_item_id = p_content and cc.person_id = l.entity_id and cc.aspect = 'image'
              where l.media_id = m.id and l.role in ('depicts', 'avatar') and coalesce(cc.value, c.image, 'ask') <> 'yes') as person_without_consent,
      m.flagged_for_review
    from core.media m where m.id = any (coalesce(p_media, '{}'))
  loop
    if r.visibility = 'private' or r.person_without_consent then
      v_out := v_out || jsonb_build_object('kind', 'image', 'media_id', r.id);
    elsif r.flagged_for_review then
      v_out := v_out || jsonb_build_object('kind', 'image_flagged', 'media_id', r.id, 'warning', true);
    end if;
  end loop;
  return v_out;
end $$;

-- ------------------------------------------------------------------ kommandon
create function cmd.create_content(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid()); v_ch text; v_src uuid;
begin
  for v_src in select (jsonb_array_elements_text(coalesce(p -> 'source_ids', '[]')))::uuid loop
    perform core.assert_entity(v_src);
  end loop;
  insert into story.content_item (id, site_id, goal_code, status, title, source_ids, person_ids, period_start, period_end)
  values (v_id, core.ctx_site(), core.req(p, 'goal_code'), 'draft', coalesce(nullif(p ->> 'title', ''), 'Berättelse'),
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'source_ids') x), '{}'),
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'person_ids') x), '{}'),
          (p ->> 'period_start')::date, (p ->> 'period_end')::date);
  for v_ch in select jsonb_array_elements_text(coalesce(p -> 'channels', '["instagram"]')) loop
    insert into story.channel_variant (site_id, content_id, channel_code) values (core.ctx_site(), v_id, v_ch) on conflict do nothing;
  end loop;
  return jsonb_build_object('content_id', v_id);
end $$;

create function cmd.save_channel_variant(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_content uuid := core.req_uuid(p, 'content_id'); v_status story.content_status;
begin
  select status into v_status from story.content_item where id = v_content and site_id = core.ctx_site();
  if v_status is null then perform core.fail('not_found', 'Berättelsen finns inte'); end if;
  if v_status in ('shared', 'archived', 'rejected') then perform core.fail('locked', 'Berättelsen är redan delad eller arkiverad'); end if;
  insert into story.channel_variant (site_id, content_id, channel_code, body, media_ids, tone, cta, removed_by_guard, warnings)
  values (core.ctx_site(), v_content, core.req(p, 'channel_code'), coalesce(p ->> 'body', ''),
          coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'media_ids') x), '{}'), p ->> 'tone', p ->> 'cta',
          coalesce(p -> 'removed_by_guard', '[]'), coalesce(p -> 'warnings', '[]'))
  on conflict (content_id, channel_code) do update set body = excluded.body, media_ids = excluded.media_ids, tone = excluded.tone,
    cta = excluded.cta, removed_by_guard = excluded.removed_by_guard, warnings = excluded.warnings;
  -- Ändras ett godkänt utkast måste det godkännas igen
  if v_status = 'approved' then update story.content_item set status = 'draft', approved_at = null, approved_by = null where id = v_content; end if;
  if p ? 'person_ids' then
    update story.content_item set person_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'person_ids') x), '{}')
    where id = v_content;
  end if;
  return jsonb_build_object('content_id', v_content, 'channel_code', p ->> 'channel_code');
end $$;

create function cmd.set_content_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'content_id'); v_to story.content_status := core.req(p, 'status')::story.content_status; v_from story.content_status;
begin
  if v_to in ('approved', 'shared') then perform core.fail('use_flow', 'Godkännande och delning har egna steg'); end if;
  select status into v_from from story.content_item where id = v_id and site_id = core.ctx_site() for update;
  if v_from is null then perform core.fail('not_found', 'Berättelsen finns inte'); end if;
  perform core.assert_transition('content', v_from::text, v_to::text);
  update story.content_item set status = v_to where id = v_id;
  return jsonb_build_object('content_id', v_id, 'status', v_to);
end $$;

-- Godkännande (ägaren): den deterministiska kontrollen måste vara tom för alla kanalversioner.
create function cmd.approve_content(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'content_id');
  v_c story.content_item;
  v_v story.channel_variant;
  v_viol jsonb;
  v_all jsonb := '[]';
begin
  select * into v_c from story.content_item where id = v_id and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Berättelsen finns inte'); end if;
  perform core.assert_transition('content', v_c.status::text, 'approved');
  for v_v in select * from story.channel_variant where content_id = v_id loop
    v_viol := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(
      story.privacy_violations(core.ctx_site(), v_v.body, v_v.media_ids, v_c.person_ids, v_id)) x where coalesce((x ->> 'warning')::boolean, false) = false);
    if jsonb_array_length(v_viol) > 0 then
      v_all := v_all || jsonb_build_object('channel_code', v_v.channel_code, 'violations', v_viol);
    end if;
  end loop;
  if jsonb_array_length(v_all) > 0 then
    perform core.fail('privacy', 'Utkastet innehåller sådant som inte får delas – se granskningen', v_all);
  end if;
  update story.content_item set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = v_id;
  return jsonb_build_object('content_id', v_id, 'status', 'approved');
end $$;

-- Delad (INV-04: bara efter ägarens uttryckliga tryck). Syns på källorna ("Berättat 2 gånger").
create function cmd.mark_content_shared(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'content_id'); v_c story.content_item; v_person uuid;
begin
  select * into v_c from story.content_item where id = v_id and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Berättelsen finns inte'); end if;
  perform core.assert_transition('content', v_c.status::text, 'shared');
  update story.content_item set status = 'shared', shared_at = coalesce(shared_at, now()),
    shared_url = coalesce(nullif(p ->> 'shared_url', ''), shared_url),
    shared_channels = (select array_agg(distinct x) from unnest(shared_channels || coalesce((select array_agg(y) from jsonb_array_elements_text(p -> 'channels') y), '{}')) x)
  where id = v_id;
  if v_c.goal_code = 'thanks' then
    foreach v_person in array v_c.person_ids loop
      update people.contribution set thanked_at = now() where person_id = v_person and thanked_at is null;
    end loop;
  end if;
  perform core.record_history('content.shared', format('Berättat: %s', v_c.title),
    jsonb_build_array(jsonb_build_object('id', v_id)) ||
    (select coalesce(jsonb_agg(jsonb_build_object('id', s, 'role', 'source')), '[]') from unnest(v_c.source_ids) s) ||
    (select coalesce(jsonb_agg(jsonb_build_object('id', s, 'role', 'person')), '[]') from unnest(v_c.person_ids) s));
  return jsonb_build_object('content_id', v_id, 'status', 'shared');
end $$;

create function cmd.record_content_consent(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_content uuid := core.req_uuid(p, 'content_id'); v_person uuid := core.req_uuid(p, 'person_id');
begin
  perform core.assert_entity(v_content, '{content_item}');
  perform core.assert_entity(v_person, '{person}');
  insert into people.content_consent (site_id, content_item_id, person_id, aspect, value, given_how)
  values (core.ctx_site(), v_content, v_person, core.req(p, 'aspect'), core.req(p, 'value')::core.consent_value, p ->> 'given_how')
  on conflict (content_item_id, person_id, aspect) do update set value = excluded.value, given_at = now(), given_how = excluded.given_how;
  update story.content_item set person_ids = (select array_agg(distinct x) from unnest(person_ids || v_person) x) where id = v_content;
  return jsonb_build_object('content_id', v_content, 'person_id', v_person);
end $$;

-- Berättarfångst (append-only): varför, citat och ögonblick.
create function cmd.add_story_note(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid()); v_entity uuid := core.req_uuid(p, 'entity_id');
begin
  if exists (select 1 from story.story_note where id = v_id) then return jsonb_build_object('story_note_id', v_id, 'existing', true); end if;
  perform core.assert_entity(v_entity);
  insert into story.story_note (id, site_id, entity_id, kind, text, media_id, person_id, quote_consent)
  values (v_id, core.ctx_site(), v_entity, core.req(p, 'kind')::story.note_kind, p ->> 'text', core.opt_uuid(p, 'media_id'),
          core.opt_uuid(p, 'person_id'), coalesce((p ->> 'quote_consent')::boolean, false));
  if p ->> 'kind' = 'why' and (select entity_type from core.entity where id = v_entity) = 'object' then
    update resources.object set story_why = coalesce(story_why, p ->> 'text') where id = v_entity;
  end if;
  if core.opt_uuid(p, 'media_id') is not null then
    insert into core.media_link (site_id, media_id, entity_id, role) values (core.ctx_site(), core.opt_uuid(p, 'media_id'), v_entity,
      coalesce(nullif(p ->> 'media_role', ''), 'before')) on conflict do nothing;
  end if;
  return jsonb_build_object('story_note_id', v_id);
end $$;

-- "Markera som bra ögonblick": händelsen blir värd att berätta.
create function cmd.mark_story_value(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'history_event_id');
begin
  update core.history_event set story_value = coalesce((p ->> 'value')::boolean, true) where id = v_id and site_id = core.ctx_site();
  if not found then
    -- Tillåt också en entitet: markera dess senaste händelse
    update core.history_event set story_value = true where id = (
      select l.event_id from core.history_event_link l join core.history_event e on e.id = l.event_id
      where l.entity_id = v_id order by e.occurred_at desc limit 1);
    if not found then perform core.fail('not_found', 'Händelsen finns inte'); end if;
  end if;
  return jsonb_build_object('history_event_id', v_id);
end $$;

-- Ägaren omvandlar ett inskick från Bidra till en intressent, ett bidrag eller en förfrågan om boende.
create function cmd.convert_submission(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_s story.contribute_submission;
  v_person uuid;
  v_result jsonb;
begin
  select * into v_s from story.contribute_submission where id = core.req_uuid(p, 'submission_id') and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Inskicket finns inte'); end if;
  if coalesce((p ->> 'reject')::boolean, false) then
    update story.contribute_submission set status = 'rejected' where id = v_s.id;
    return jsonb_build_object('submission_id', v_s.id, 'status', 'rejected');
  end if;
  v_person := coalesce(core.opt_uuid(p, 'person_id'), people.create_person(coalesce(v_s.name, 'Bidragsgivare'), null, 'Via Bidra'));
  perform people.add_role(v_person, 'follower');
  if v_s.contact is not null then
    insert into people.person_private (site_id, person_id, email) values (core.ctx_site(), v_person, v_s.contact) on conflict (person_id) do nothing;
  end if;
  if v_s.kind = 'want_to_come' and v_s.starts_on is not null then
    insert into hospitality.stay_request (site_id, person_id, requester_name, starts_on, ends_on, party_size, message, contribute_submission_id)
    values (core.ctx_site(), v_person, v_s.name, v_s.starts_on, coalesce(v_s.ends_on, v_s.starts_on), coalesce(v_s.party_size, 1), v_s.message, v_s.id);
    v_result := jsonb_build_object('stay_request', true);
  elsif v_s.listing_id is not null then
    v_result := cmd.log_lead(jsonb_build_object('listing_id', v_s.listing_id, 'person_id', v_person, 'message', v_s.message));
  else
    insert into people.interaction (site_id, person_id, channel_code, summary, body)
    values (core.ctx_site(), v_person, 'message', 'Inskick via Bidra', v_s.message);
    v_result := jsonb_build_object('interaction', true);
  end if;
  update story.contribute_submission set status = 'converted', converted_entity_id = v_person where id = v_s.id;
  return jsonb_build_object('submission_id', v_s.id, 'person_id', v_person) || v_result;
end $$;

-- ------------------------------------------------------------------ read models (schema rm)
-- Färdiga sammanställningar så att gränssnittet inte aggregerar domändata själv. Byggs om av
-- bakgrundsjobbet refresh_site inom en minut efter en ändring och läses med användarens behörighet.
create table rm.today_item (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  kind text not null,
  priority integer not null,
  entity_id uuid,
  title text not null,
  subtitle text,
  due_at timestamptz,
  visibility core.visibility not null default 'internal',
  created_by uuid,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
create index today_item_site_idx on rm.today_item (site_id, priority);
select core.register_table('rm.today_item', 'rm');

create table rm.pulse_signal (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  domain text not null,
  period text not null,
  summary text not null,
  attention boolean not null default false,
  visibility core.visibility not null default 'internal',
  created_by uuid,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
select core.register_table('rm.pulse_signal', 'rm', p_ui_release => 'R2.1');

create table rm.project_canvas (
  project_id uuid primary key references change.project (id),
  site_id uuid not null references core.site (id),
  visibility core.visibility not null default 'internal',
  created_by uuid,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
select core.register_table('rm.project_canvas', 'rm');

create table rm.map_feature (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  layer_code text not null,
  entity_id uuid,
  entity_type text,
  label text,
  geom extensions.geometry(Geometry, 4326) not null,
  reality_mode core.reality_mode not null default 'now',
  status text,
  visibility core.visibility not null default 'internal',
  created_by uuid,
  props jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
create index rm_map_feature_site_idx on rm.map_feature (site_id, layer_code);
select core.register_table('rm.map_feature', 'rm');

create table rm.life_summary (
  site_id uuid primary key references core.site (id),
  visibility core.visibility not null default 'internal',
  created_by uuid,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
select core.register_table('rm.life_summary', 'rm', p_ui_release => 'R2.3');

create table rm.year_timeline (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  year integer not null,
  visibility core.visibility not null default 'internal',
  created_by uuid,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now(),
  unique (site_id, year)
);
select core.register_table('rm.year_timeline', 'rm', p_ui_release => 'R2.1');

create table rm.event_readiness (
  hosted_event_id uuid primary key references hospitality.hosted_event (id),
  site_id uuid not null references core.site (id),
  visibility core.visibility not null default 'internal',
  created_by uuid,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
select core.register_table('rm.event_readiness', 'rm', p_ui_release => 'R2.6');

create table rm.person_relationship (
  person_id uuid primary key references people.person (id),
  site_id uuid not null references core.site (id),
  visibility core.visibility not null default 'internal',
  created_by uuid,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
select core.register_table('rm.person_relationship', 'rm');

-- Idag: det som behöver göras nu, i den ordning det brådskar (R1.1 S1, FR-045).
create function rm.refresh_today(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_long integer := coalesce((core.setting(p_site, 'long_stored_months') #>> '{}')::integer, 12);
  v_n integer;
begin
  delete from rm.today_item where site_id = p_site;
  -- 1. Att granska
  select count(*) into v_n from core.proposal where site_id = p_site and status = 'pending' and archived_at is null;
  v_n := v_n + (select count(*) from core.capture c where c.site_id = p_site and c.status in ('new', 'failed')
                and not exists (select 1 from core.proposal p where p.capture_id = c.id));
  if v_n > 0 then
    insert into rm.today_item (site_id, kind, priority, title, subtitle, payload)
    values (p_site, 'review', 10, format('Att granska · %s förslag', v_n), 'Fångster som väntar på beslut', jsonb_build_object('count', v_n));
  end if;
  v_n := (select count(*) from story.contribute_submission where site_id = p_site and status = 'new');
  if v_n > 0 then
    insert into rm.today_item (site_id, kind, priority, title, visibility, payload)
    values (p_site, 'submissions', 11, format('Inskick via Bidra · %s', v_n), 'private', jsonb_build_object('count', v_n));
  end if;
  -- 2. Dagens (och morgondagens) hämtningar
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, due_at, visibility, created_by)
  select p_site, 'pickup', 20, x.id, x.title,
         concat_ws(' · ', to_char(coalesce(x.window_start, x.scheduled_on::timestamptz), 'YYYY-MM-DD HH24:MI'),
                   (select string_agg(resources.object_label(i.object_id, i.quantity), ', ') from resources.pickup_item i where i.pickup_id = x.id)),
         coalesce(x.window_start, x.scheduled_on::timestamptz), x.visibility, x.created_by
  from resources.pickup x
  where x.site_id = p_site and x.status in ('planned', 'confirmed', 'in_progress') and x.archived_at is null
    and coalesce(x.scheduled_on, x.window_start::date, current_date) <= current_date + 1;
  -- 3. Försenat och att göra
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, due_at, visibility, created_by)
  select p_site, case when t.due_at < now() then 'overdue' else 'task' end, case when t.due_at < now() then 30 else 40 end, t.id, t.title,
         (select title from core.entity where id = t.subject_entity_id), t.due_at, t.visibility, t.created_by
  from core.task t
  where t.site_id = p_site and t.status in ('open', 'in_progress') and t.archived_at is null
    and (t.due_at is null or t.due_at < now() + interval '7 days')
  order by t.due_at nulls last limit 30;
  -- 4. Väntar på svar: intressenter och anskaffningar
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, due_at, visibility, created_by)
  select p_site, 'lead_waiting', 35, l.id,
         format('%s väntar på svar', coalesce((select display_name from people.person where id = l.person_id), 'En intressent')),
         (select title from resources.listing where id = l.listing_id), l.created_at, l.visibility, l.created_by
  from resources.lead l where l.site_id = p_site and l.status = 'new' and l.archived_at is null;
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, due_at, visibility, created_by)
  select p_site, 'acquisition_waiting', 36, a.id,
         format('%s – %s', resources.object_label(a.object_id), lower(core.state_label('acquisition', a.status::text))),
         (select display_name from people.person where id = a.counterpart_person_id), a.updated_at, a.visibility, a.created_by
  from resources.acquisition a
  where a.site_id = p_site and a.status in ('contacted', 'negotiating') and a.updated_at < now() - interval '2 days' and a.archived_at is null;
  -- 5. Att tacka och visa vad bidraget blev
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, visibility, payload)
  select p_site, 'thank', 50, pe.id, format('Tacka %s', pe.display_name), format('%s bidrag utan tack', count(*)), 'internal',
         jsonb_build_object('contributions', count(*))
  from people.contribution c join people.person pe on pe.id = c.person_id
  where c.site_id = p_site and c.thanked_at is null and c.archived_at is null and pe.erased_at is null
  group by pe.id, pe.display_name;
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, visibility, payload)
  select distinct on (pe.id) p_site, 'show_result', 55, pe.id, format('Visa %s var %s hamnade', split_part(pe.display_name, ' ', 1), lower(o.title)),
         place.path_label(u.place_id), 'internal', jsonb_build_object('object_id', o.id, 'usage_event_id', u.id)
  from resources.usage_event u
  join resources.object o on o.id = u.object_id
  join resources.acquisition a on a.object_id = o.id
  join people.person pe on pe.id = a.counterpart_person_id
  where u.site_id = p_site and u.type <> 'dismantled' and u.occurred_at > now() - interval '120 days' and pe.erased_at is null
    and not exists (select 1 from story.content_item ci where ci.site_id = p_site and ci.status = 'shared' and pe.id = any (ci.person_ids) and ci.shared_at > u.occurred_at)
    and not exists (select 1 from people.interaction i where i.person_id = pe.id and i.occurred_at > u.occurred_at)
  order by pe.id, u.occurred_at desc;
  -- 6. Legat i lager länge (R1.1 S1: över 12 månader)
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, visibility, created_by, payload)
  select p_site, 'long_stored', 60, o.id,
         format('%s har legat i lager i %s månader', resources.object_label(o.id),
                (extract(year from age(now(), o.status_since)) * 12 + extract(month from age(now(), o.status_since)))::integer),
         place.path_label(o.place_id), o.visibility, o.created_by,
         jsonb_build_object('months', (extract(year from age(now(), o.status_since)) * 12 + extract(month from age(now(), o.status_since)))::integer)
  from resources.object o
  where o.site_id = p_site and o.status = 'stored' and o.archived_at is null and o.status_since < now() - make_interval(months => v_long)
  order by o.status_since limit 10;
  -- 7. Att berätta: 1–3 färska ögonblick som inte berättats
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, due_at, visibility, created_by)
  select p_site, 'story', 70, e.id, e.summary, 'Berätta', e.occurred_at, e.visibility, e.created_by
  from core.history_event e
  where e.site_id = p_site and e.story_value and e.occurred_at > now() - interval '30 days' and e.visibility <> 'private'
    and not exists (select 1 from story.content_item ci where e.id = any (ci.source_ids))
  order by e.occurred_at desc limit 3;
  -- 8. Senaste fynden
  insert into rm.today_item (site_id, kind, priority, entity_id, title, subtitle, due_at, visibility, created_by)
  select p_site, 'recent_find', 80, o.id, resources.object_label(o.id), core.state_label('object', o.status::text), o.created_at, o.visibility, o.created_by
  from resources.object o
  where o.site_id = p_site and o.archived_at is null
    and coalesce((select min(e.occurred_at) from core.history_event_link l join core.history_event e on e.id = l.event_id where l.entity_id = o.id),
                 o.created_at) > now() - interval '14 days'
  order by o.created_at desc limit 5;
end $$;

create function rm.refresh_map(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from rm.map_feature where site_id = p_site;
  insert into rm.map_feature (site_id, layer_code, entity_id, entity_type, label, geom, reality_mode, status, visibility, created_by, props)
  select p_site, 'zones', z.id, 'zone', z.name, z.geom, z.reality_mode, z.status::text, z.visibility, z.created_by,
         jsonb_build_object('type_code', z.type_code, 'pz', z.permaculture_zone)
  from place.zone z where z.site_id = p_site and z.geom is not null and z.archived_at is null
  union all
  select p_site, 'structures', s.id, 'structure', s.name, s.geom, s.reality_mode, s.status::text, s.visibility, s.created_by,
         jsonb_build_object('type_code', s.type_code)
  from place.structure s where s.site_id = p_site and s.geom is not null and s.archived_at is null
  union all
  select p_site, 'structures', sp.id, 'space', sp.name, sp.geom, 'now', null, sp.visibility, sp.created_by, '{}'
  from place.space sp where sp.site_id = p_site and sp.geom is not null and sp.archived_at is null
  union all
  select p_site, 'storage', l.id, 'storage_location', l.name,
         coalesce(l.geom, extensions.st_pointonsurface((select geom from place.structure where id = l.structure_id))), 'now', null, l.visibility, l.created_by, '{}'
  from place.storage_location l where l.site_id = p_site and l.archived_at is null
    and coalesce(l.geom, (select geom from place.structure where id = l.structure_id)) is not null
  union all
  select p_site, 'projects', pr.id, 'project', pr.name, pr.geom,
         case when pr.status in ('idea', 'planned') then 'plan' else 'now' end::core.reality_mode, pr.status::text, pr.visibility, pr.created_by, '{}'
  from change.project pr where pr.site_id = p_site and pr.geom is not null and pr.archived_at is null
  union all
  select p_site, f.layer_code, coalesce(f.entity_id, f.id), coalesce((select entity_type from core.entity where id = f.entity_id), 'map_feature'),
         f.label, f.geom, f.reality_mode, null, f.visibility, f.created_by, f.properties
  from place.map_feature f where f.site_id = p_site and f.archived_at is null
  union all
  -- Återbruk i bruk: nål på platsens yta
  select p_site, 'reuse_in_use', o.id, 'object', resources.object_label(o.id),
         extensions.st_pointonsurface(g.geom), 'now', o.status::text, o.visibility, o.created_by, jsonb_build_object('place', place.path_label(o.place_id))
  from resources.object o
  cross join lateral (select coalesce(
    (select geom from place.space where id = o.place_id), (select geom from place.structure where id = o.place_id),
    (select geom from place.zone where id = o.place_id)) as geom) g
  where o.site_id = p_site and o.status = 'in_use' and o.archived_at is null and g.geom is not null
  union all
  -- Observationer: exakt position bara om den inte är känslig
  select p_site, 'observations', ob.id, 'observation', left(coalesce(nullif(ob.description, ''), ob.kind_code), 60),
         coalesce(case when ob.location_precision = 'exact' and ob.sensitivity = 'normal' then ob.geom end,
                  extensions.st_pointonsurface((select geom from place.zone where id = place.zone_of(ob.place_id)))),
         'now', ob.kind_code, ob.visibility, ob.created_by, jsonb_build_object('occurred_at', ob.occurred_at, 'precision', ob.location_precision)
  from life.observation ob where ob.site_id = p_site and ob.archived_at is null and ob.occurred_at > now() - interval '1 year'
    and coalesce(case when ob.location_precision = 'exact' and ob.sensitivity = 'normal' then ob.geom end,
                 (select geom from place.zone where id = place.zone_of(ob.place_id))) is not null
  union all
  select p_site, 'plants', pl.id, 'planting', pl.name, pl.geom, 'now', pl.health_status::text, pl.visibility, pl.created_by, '{}'
  from life.planting pl where pl.site_id = p_site and pl.geom is not null and pl.archived_at is null
  union all
  select p_site, 'plants', pi.id, 'plant_individual', pi.name, pi.geom, 'now', pi.health_status::text, pi.visibility, pi.created_by, '{}'
  from life.plant_individual pi where pi.site_id = p_site and pi.geom is not null and pi.archived_at is null
  union all
  select p_site, 'observations', pp.id, 'photo_point', pp.name, pp.geom, 'now', null, pp.visibility, pp.created_by, jsonb_build_object('bearing', pp.bearing)
  from place.photo_point pp where pp.site_id = p_site and pp.geom is not null and pp.archived_at is null;
end $$;

create function rm.refresh_project_canvas(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from rm.project_canvas where site_id = p_site;
  insert into rm.project_canvas (project_id, site_id, visibility, created_by, payload)
  select pr.id, p_site, pr.visibility, pr.created_by, jsonb_build_object(
    'name', pr.name, 'status', pr.status, 'parent_id', pr.parent_id, 'place', place.path_label(pr.place_id),
    'needs', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'kind', n.kind_code, 'quantity', n.quantity, 'unit', n.unit,
                     'fulfilled', change.need_fulfilled_quantity(n.id), 'met', change.need_is_met(n.id), 'progress', change.need_progress_label(n.id))
                     order by n.created_at), '[]')
              from change.need n where n.project_id = pr.id and n.status = 'open' and n.archived_at is null),
    'needs_total', (select count(*) from change.need n where n.project_id = pr.id and n.status = 'open' and n.archived_at is null),
    'needs_met', (select count(*) from change.need n where n.project_id = pr.id and n.status = 'open' and n.archived_at is null and change.need_is_met(n.id)),
    'objects_used', (select count(distinct u.object_id) from resources.usage_event u where u.project_id = pr.id and u.type <> 'dismantled'),
    'contributors', (select count(distinct c.person_id) from people.contribution c where c.project_id = pr.id),
    'subprojects', (select count(*) from change.project c where c.parent_id = pr.id and c.archived_at is null),
    'last_event', (select jsonb_build_object('summary', e.summary, 'occurred_at', e.occurred_at) from core.history_event e
                   join core.history_event_link l on l.event_id = e.id where l.entity_id = pr.id and e.visibility <> 'private'
                   order by e.occurred_at desc limit 1),
    'open_tasks', (select count(*) from core.task t where t.subject_entity_id = pr.id and t.status in ('open', 'in_progress')),
    'stories', (select count(*) from story.content_item ci where pr.id = any (ci.source_ids) and ci.status = 'shared'))
  from change.project pr where pr.site_id = p_site and pr.archived_at is null;
end $$;

create function rm.refresh_person_relationship(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from rm.person_relationship where site_id = p_site;
  insert into rm.person_relationship (person_id, site_id, visibility, created_by, payload)
  select pe.id, p_site, pe.visibility, pe.created_by, jsonb_build_object(
    'first_event', (select min(e.occurred_at) from core.history_event e join core.history_event_link l on l.event_id = e.id where l.entity_id = pe.id),
    'last_event', (select max(e.occurred_at) from core.history_event e join core.history_event_link l on l.event_id = e.id where l.entity_id = pe.id),
    'roles', (select coalesce(jsonb_agg(role_code), '[]') from people.person_role where person_id = pe.id),
    -- Relation till Vreta över tid: bidragit, arbetat, gett, köpt, sålt till oss (deltagit och bott tillkommer i R2.6)
    'contributed', (select count(*) from people.contribution c where c.person_id = pe.id),
    'worked_hours', (select coalesce(sum(hours), 0) from people.contribution c where c.person_id = pe.id),
    'gave', (select count(*) from resources.acquisition a where a.counterpart_person_id = pe.id and a.type = 'gift'),
    'sold_to_us', (select count(*) from resources.acquisition a where a.counterpart_person_id = pe.id and a.type = 'purchase'),
    'bought', (select count(*) from resources.disposal d where d.counterpart_person_id = pe.id and d.type = 'sold'),
    'received', (select count(*) from resources.disposal d where d.counterpart_person_id = pe.id and d.type in ('donated', 'exchanged', 'lent')),
    'unthanked', (select count(*) from people.contribution c where c.person_id = pe.id and c.thanked_at is null),
    'reciprocity', (select count(*) from people.reciprocity_entry r where r.person_id = pe.id))
  from people.person pe where pe.site_id = p_site and pe.archived_at is null;
end $$;

-- Årsbild (R2.1): material som fått nytt liv, människor som bidrog, saker in och vidare, arter, berättelser.
create function rm.refresh_year_timeline(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_year integer;
begin
  delete from rm.year_timeline where site_id = p_site;
  for v_year in select generate_series(coalesce(extract(year from (select min(occurred_at) from core.history_event where site_id = p_site))::integer,
                                               extract(year from now())::integer), extract(year from now())::integer) loop
    insert into rm.year_timeline (site_id, year, payload)
    values (p_site, v_year, jsonb_build_object(
      'kg_new_life', (select coalesce(round(sum(coalesce(o.weight_kg, 0) * coalesce(u.quantity, 1))), 0) from resources.usage_event u join resources.object o on o.id = u.object_id
                      where u.site_id = p_site and u.type <> 'dismantled' and extract(year from u.occurred_at) = v_year),
      'people_contributed', (select count(distinct person_id) from people.contribution where site_id = p_site and extract(year from occurred_at) = v_year),
      'project_moments', (select count(*) from core.history_event where site_id = p_site and extract(year from occurred_at) = v_year
                          and (event_type like 'usage.%' or event_type = 'need.fulfilled' or event_type = 'activity.completed')),
      'things_in', (select count(*) from resources.acquisition where site_id = p_site and extract(year from coalesce(received_at, created_at)) = v_year and status in ('received', 'settled')),
      'things_out', (select count(*) from resources.disposal where site_id = p_site and extract(year from occurred_at) = v_year),
      'wild_species', (select count(distinct taxon_id) from life.observation where site_id = p_site and extract(year from occurred_at) = v_year and taxon_id is not null),
      'breeding_species', (select count(*) from life.species_presence where site_id = p_site and reproduction_status = 'confirmed'
                           and coalesce(extract(year from period_start), v_year) = v_year),
      'stories', (select count(*) from story.content_item where site_id = p_site and status = 'shared' and extract(year from shared_at) = v_year),
      'waiting_to_see', (select count(distinct a.counterpart_person_id) from resources.acquisition a
                         join resources.usage_event u on u.object_id = a.object_id and extract(year from u.occurred_at) = v_year
                         where a.site_id = p_site and a.counterpart_person_id is not null
                           and not exists (select 1 from story.content_item ci where a.counterpart_person_id = any (ci.person_ids) and ci.status = 'shared'))));
  end loop;
end $$;

-- Vreta Pulse (R2.1): förändring och flöde per domän – aldrig poäng.
create function rm.refresh_pulse(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_period text; v_from timestamptz;
begin
  delete from rm.pulse_signal where site_id = p_site;
  foreach v_period in array array['week', 'month', 'year'] loop
    v_from := now() - case v_period when 'week' then interval '7 days' when 'month' then interval '30 days' else interval '365 days' end;
    insert into rm.pulse_signal (site_id, domain, period, summary, attention, payload)
    values
      (p_site, 'place', v_period, format('%s händelser på platsen · %s nya observationer',
         (select count(*) from core.history_event where site_id = p_site and occurred_at > v_from and place_id is not null),
         (select count(*) from life.observation where site_id = p_site and occurred_at > v_from)), false, '{}'),
      (p_site, 'material', v_period, format('%s saker in · %s fick nytt liv · %s vidare',
         (select count(*) from resources.object where site_id = p_site and created_at > v_from),
         (select count(*) from resources.usage_event where site_id = p_site and occurred_at > v_from and type <> 'dismantled'),
         (select count(*) from resources.disposal where site_id = p_site and occurred_at > v_from)), false, '{}'),
      (p_site, 'projects', v_period, format('%s projekt rör sig · %s står still',
         (select count(distinct l.entity_id) from core.history_event_link l join core.history_event e on e.id = l.event_id
          where e.site_id = p_site and l.entity_type = 'project' and e.occurred_at > v_from),
         (select count(*) from change.project pr where pr.site_id = p_site and pr.status = 'active' and not exists (
            select 1 from core.history_event_link l join core.history_event e on e.id = l.event_id where l.entity_id = pr.id and e.occurred_at > now() - interval '42 days'))),
       exists (select 1 from change.project pr where pr.site_id = p_site and pr.status = 'active' and not exists (
            select 1 from core.history_event_link l join core.history_event e on e.id = l.event_id where l.entity_id = pr.id and e.occurred_at > now() - interval '42 days')), '{}'),
      (p_site, 'people', v_period, format('%s bidrag · %s väntar på att se vad det blev',
         (select count(*) from people.contribution where site_id = p_site and occurred_at > v_from),
         (select count(*) from rm.today_item where site_id = p_site and kind = 'show_result')),
       exists (select 1 from rm.today_item where site_id = p_site and kind = 'show_result'), '{}'),
      (p_site, 'life', v_period, format('%s observationer av arter · %s bekräftad närvaro',
         (select count(*) from life.observation where site_id = p_site and occurred_at > v_from and taxon_id is not null),
         (select count(*) from life.species_presence where site_id = p_site and archived_at is null)), false, '{}'),
      (p_site, 'plants', v_period, format('%s planteringar · %s kämpar',
         (select count(*) from resources.usage_event where site_id = p_site and occurred_at > v_from and type = 'planted'),
         (select count(*) from resources.object where site_id = p_site and health_status = 'struggling')),
       exists (select 1 from resources.object where site_id = p_site and health_status = 'struggling'), '{}'),
      (p_site, 'stories', v_period, format('%s delade berättelser',
         (select count(*) from story.content_item where site_id = p_site and status = 'shared' and shared_at > v_from)), false, '{}');
  end loop;
end $$;

create function rm.refresh_life_summary(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into rm.life_summary (site_id, payload, refreshed_at)
  values (p_site, jsonb_build_object(
    'animals', (select count(*) from life.animal_individual where site_id = p_site and status = 'alive' and archived_at is null),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', estimated_count, 'kind', kind)), '[]') from life.resident_group where site_id = p_site and status = 'alive' and archived_at is null),
    'breeding_now', (select count(*) from life.species_presence where site_id = p_site and reproduction_status in ('indicated', 'confirmed') and archived_at is null),
    'species_this_year', (select count(distinct taxon_id) from life.observation where site_id = p_site and extract(year from occurred_at) = extract(year from now())),
    'new_this_year', (select count(*) from (select taxon_id, min(occurred_at) m from life.observation where site_id = p_site and taxon_id is not null group by taxon_id) x
                      where extract(year from x.m) = extract(year from now())),
    'follow_up', (select count(*) from life.observation where site_id = p_site and not verified and certainty in ('uncertain', 'probable'))), now())
  on conflict (site_id) do update set payload = excluded.payload, refreshed_at = now();
end $$;

create function rm.refresh_event_readiness(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from rm.event_readiness where site_id = p_site;
  insert into rm.event_readiness (hosted_event_id, site_id, visibility, created_by, payload)
  select h.id, p_site, h.visibility, h.created_by, jsonb_build_object(
    'title', h.title, 'starts_at', h.starts_at,
    'ready', (select count(*) from hospitality.readiness_check c where c.hosted_event_id = h.id and c.status in ('ready', 'not_applicable')),
    'total', (select count(*) from hospitality.readiness_check c where c.hosted_event_id = h.id),
    'missing', (select coalesce(jsonb_agg(c.area_code), '[]') from hospitality.readiness_check c where c.hosted_event_id = h.id and c.status = 'missing'),
    'registered', (select coalesce(sum(r.party_size), 0) from hospitality.registration r where r.hosted_event_id = h.id and r.status = 'confirmed'),
    'capacity_target', h.capacity_target,
    'capacity_basis', (select capacity_basis from hospitality.venue_configuration where id = h.venue_configuration_id),
    'weather_dependency', h.weather_dependency,
    'plan_b', (select name from hospitality.venue_configuration where id = h.plan_b_venue_configuration_id))
  from hospitality.hosted_event h where h.site_id = p_site and h.archived_at is null and h.ends_at > now() - interval '1 day';
end $$;

create function rm.refresh_site(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform rm.refresh_today(p_site);
  perform rm.refresh_map(p_site);
  perform rm.refresh_project_canvas(p_site);
  perform rm.refresh_person_relationship(p_site);
  perform rm.refresh_year_timeline(p_site);
  perform rm.refresh_pulse(p_site);
  perform rm.refresh_life_summary(p_site);
  perform rm.refresh_event_readiness(p_site);
end $$;

-- ------------------------------------------------------------------ publika projektioner (schema pub)
-- Byggs bara från godkänd data. Namn bara med samtycke, aldrig adresser, priser för inköp, lagerplatser,
-- vistelser eller exakta känsliga positioner. Gästvyn (R2.0) och VRETA Live/Rundvandring (R2.5–R2.7).
create table pub.guest_item (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  kind text not null,
  entity_id uuid not null,
  title text not null,
  summary text,
  image_path text,
  place_label text,
  status_label text,
  occurred_at timestamptz,
  sort integer not null default 0,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
create index guest_item_site_idx on pub.guest_item (site_id, kind);
select core.register_table('pub.guest_item', 'pub_guest');

create table pub.live_item (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  section text not null check (section in ('happening', 'new_life', 'people', 'upcoming', 'stay', 'life', 'story')),
  entity_id uuid,
  title text not null,
  summary text,
  image_path text,
  place_label text,
  occurred_at timestamptz,
  payload jsonb not null default '{}',
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.live_item', 'pub_public', p_ui_release => 'R2.7');

create table pub.wanted (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  listing_id uuid,
  need_id uuid,
  title text not null,
  description text,
  quantity_label text,
  locality text,
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.wanted', 'pub_public', p_ui_release => 'R2.7');

create table pub.tour (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  title text not null,
  intro text,
  mode text,
  route_geom extensions.geometry(LineString, 4326),
  length_m numeric,
  surface text,
  accessibility_note text,
  estimated_minutes integer,
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.tour', 'pub_public', p_ui_release => 'R2.5');

create table pub.tour_stop (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  tour_id uuid not null references pub.tour (id) on delete cascade,
  ordinal integer not null,
  title text not null,
  what_is_this text,
  what_happened text,
  how_now text,
  what_future text,
  -- Generaliserad position (zonens mittpunkt), aldrig en exakt känslig punkt
  point extensions.geometry(Point, 4326),
  media jsonb not null default '[]',
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.tour_stop', 'pub_public', p_ui_release => 'R2.5');

create table pub.map_feature (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references core.site (id),
  layer text not null,
  label text,
  geom extensions.geometry(Geometry, 4326) not null,
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.map_feature', 'pub_public', p_ui_release => 'R2.5');

create table pub.hosted_event (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  title text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  place_label text,
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.hosted_event', 'pub_public', p_ui_release => 'R2.6');

-- "Bo på Vreta": boendets egenskaper och tillgänglighet – aldrig vem som bor där.
create table pub.accommodation (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  name text not null,
  description text,
  capacity integer,
  facilities text[] not null default '{}',
  season text,
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.accommodation', 'pub_public', p_ui_release => 'R2.6');

create table pub.person (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  display_name text not null,
  roles text[] not null default '{}',
  contribution_summary text,
  image_path text,
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.person', 'pub_public', p_ui_release => 'R2.7');

create table pub.story (
  id uuid primary key,
  site_id uuid not null references core.site (id),
  title text not null,
  body text,
  image_paths text[] not null default '{}',
  shared_at timestamptz,
  refreshed_at timestamptz not null default now()
);
select core.register_table('pub.story', 'pub_public', p_ui_release => 'R2.7');

-- Byter namn på personer utan namnsamtycke mot "någon" i fritext som byggts av systemet.
create function pub.redact_names(p_site uuid, p_text text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text := coalesce(p_text, ''); r record;
begin
  for r in
    select pe.display_name from people.person pe left join people.consent_policy c on c.person_id = pe.id
    where pe.site_id = p_site and coalesce(c.name, 'ask') <> 'yes' and length(pe.display_name) >= 2
    order by length(pe.display_name) desc
  loop
    v := regexp_replace(v, core.word_re(r.display_name), 'någon', 'gi');
  end loop;
  return v;
end $$;

-- Bild som får visas i en projektion: delbar eller intern, inte privat, inga personer utan bildsamtycke,
-- inte flaggad, och alltid den rensade versionen (INV-07).
create function pub.safe_image(p_entity uuid, p_min_visibility core.visibility default 'internal') returns text
language sql stable security definer set search_path = '' as $$
  select m.share_path from core.media_link l join core.media m on m.id = l.media_id
  where l.entity_id = p_entity and l.role not in ('receipt', 'voice', 'document') and m.kind = 'photo' and m.share_path is not null
    and m.archived_at is null and not m.flagged_for_review
    and m.visibility >= p_min_visibility and m.visibility <> 'private'
    and not exists (select 1 from core.media_link l2 left join people.consent_policy c on c.person_id = l2.entity_id
                    where l2.media_id = m.id and l2.role in ('depicts', 'avatar') and coalesce(c.image, 'ask') <> 'yes')
  order by case l.role when 'after' then 0 when 'cover' then 1 else 2 end, l.sort limit 1
$$;

create function pub.zone_label(p_place uuid) returns text
language sql stable set search_path = '' as $$
  -- Ortnivå för platser utanför, zon- eller byggnadsnivå på Vreta – aldrig lagerplatser
  select case when e.entity_type in ('storage_location') then null
              when e.entity_type = 'external_place' then (select l.name from place.external_place x join place.locality l on l.id = x.locality_id where x.id = e.id)
              else e.title end
  from core.entity e where e.id = coalesce(
    (select x from unnest(place.lineage(p_place)) x join core.entity e2 on e2.id = x and e2.entity_type in ('structure', 'zone', 'space', 'external_place') limit 1), p_place)
$$;

-- Gästvyn (R1.1 S15, AC-28): projekt, saker som fått nytt liv, senaste fynden, annonser, platser och
-- människor med samtycke. Aldrig priser, adresser, inköp, hämtningar, uppgifter, relationer eller ömsesidighet.
create function pub.refresh_guest(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from pub.guest_item where site_id = p_site;
  if not core.feature_enabled(p_site, 'guest_view') then return; end if;
  insert into pub.guest_item (site_id, kind, entity_id, title, summary, image_path, place_label, status_label, occurred_at, sort, payload)
  select p_site, 'project', pr.id, pr.name, pub.redact_names(p_site, pr.description), pub.safe_image(pr.id), pub.zone_label(pr.place_id),
         core.state_label('project', pr.status::text), pr.updated_at,
         array_position(array['active','planned','idea','paused','done']::change.project_status[], pr.status),
         jsonb_build_object('needs', (select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'progress', change.need_progress_label(n.id))), '[]')
                                      from change.need n where n.project_id = pr.id and n.status = 'open' and n.archived_at is null))
  from change.project pr where pr.site_id = p_site and pr.archived_at is null and pr.visibility <> 'private';
  insert into pub.guest_item (site_id, kind, entity_id, title, summary, image_path, place_label, status_label, occurred_at, sort)
  select p_site, case when o.status = 'in_use' then 'new_life' else 'object' end, o.id, resources.object_label(o.id),
         pub.redact_names(p_site, o.story_why), pub.safe_image(o.id),
         case when o.status = 'in_use' then pub.zone_label(o.place_id) end,
         core.state_label('object', o.status::text), o.status_since, 0
  from resources.object o
  where o.site_id = p_site and o.archived_at is null and o.visibility <> 'private'
    and o.status in ('collected', 'stored', 'processing', 'in_use', 'listed', 'discovered');
  insert into pub.guest_item (site_id, kind, entity_id, title, summary, image_path, status_label, occurred_at)
  select p_site, 'listing', l.id, l.title, pub.redact_names(p_site, l.description), pub.safe_image(coalesce(l.object_id, l.id)),
         core.state_label('listing', l.status::text), l.published_at
  from resources.listing l where l.site_id = p_site and l.status in ('published', 'agreed') and l.visibility <> 'private' and l.archived_at is null;
  insert into pub.guest_item (site_id, kind, entity_id, title, summary, image_path, status_label)
  select p_site, 'place', z.id, z.name, z.description, pub.safe_image(z.id), (select label_sv from core.code_value where list_code = 'zone_type' and code = z.type_code and site_id is null)
  from place.zone z where z.site_id = p_site and z.archived_at is null and z.visibility <> 'private' and z.reality_mode = 'now'
  union all
  select p_site, 'place', s.id, s.name, s.description, pub.safe_image(s.id), (select label_sv from core.code_value where list_code = 'structure_type' and code = s.type_code and site_id is null)
  from place.structure s where s.site_id = p_site and s.archived_at is null and s.visibility <> 'private' and s.reality_mode = 'now';
  insert into pub.guest_item (site_id, kind, entity_id, title, summary, image_path, payload)
  select p_site, 'person', pe.id, pe.display_name,
         case when c.contribution = 'yes' then (select string_agg(distinct cv.label_sv, ', ') from people.contribution co
                join core.code_value cv on cv.list_code = 'contribution_type' and cv.code = co.type_code and cv.site_id is null where co.person_id = pe.id) end,
         case when c.image = 'yes' then pub.safe_image(pe.id) end,
         jsonb_build_object('roles', (select coalesce(jsonb_agg(cv.label_sv), '[]') from people.person_role r
                                       join core.code_value cv on cv.list_code = 'person_role' and cv.code = r.role_code and cv.site_id is null where r.person_id = pe.id))
  from people.person pe join people.consent_policy c on c.person_id = pe.id
  where pe.site_id = p_site and c.name = 'yes' and pe.archived_at is null and pe.visibility <> 'private';
  insert into pub.guest_item (site_id, kind, entity_id, title, place_label, occurred_at)
  select p_site, 'event', e.id, pub.redact_names(p_site, e.summary), pub.zone_label(e.place_id), e.occurred_at
  from core.history_event e
  where e.site_id = p_site and e.visibility <> 'private' and e.story_value and e.archived_at is null
    and e.event_type not like 'acquisition.%' and e.event_type not like 'pickup.%' and e.event_type not like 'disposal.%'
    and e.event_type not like 'person.%' and e.event_type not like 'reciprocity.%' and e.event_type not like 'task.%'
    and e.event_type not like 'hospitality.%'
  order by e.occurred_at desc limit 30;
end $$;

-- VRETA Live (R2.7) och övriga publika projektioner byggs bara när funktionen är påslagen, och bara av
-- det som uttryckligen är publikt eller publicerat. Publika aktivitetsflöden fördröjs (site_setting public_delay_hours).
create function pub.refresh_public(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_delay integer := coalesce((core.setting(p_site, 'public_delay_hours') #>> '{}')::integer, 48);
begin
  delete from pub.live_item where site_id = p_site;
  delete from pub.wanted where site_id = p_site;
  delete from pub.hosted_event where site_id = p_site;
  delete from pub.accommodation where site_id = p_site;
  delete from pub.person where site_id = p_site;
  delete from pub.story where site_id = p_site;
  delete from pub.map_feature where site_id = p_site;
  delete from pub.tour where site_id = p_site;
  if core.feature_enabled(p_site, 'live') then
    insert into pub.wanted (site_id, listing_id, need_id, title, description, quantity_label, locality)
    select p_site, l.id, l.need_id, l.title, pub.redact_names(p_site, l.description),
           case when l.need_id is not null then change.need_progress_label(l.need_id) end,
           (select name from place.locality where id = l.locality_id)
    from resources.listing l where l.site_id = p_site and l.type in ('wanted', 'help_wanted') and l.status = 'published'
      and l.visibility in ('shareable', 'public');
    insert into pub.story (id, site_id, title, body, image_paths, shared_at)
    select ci.id, p_site, ci.title, (select body from story.channel_variant v where v.content_id = ci.id order by length(v.body) desc limit 1),
           coalesce((select array_agg(m.share_path) from story.channel_variant v cross join unnest(v.media_ids) mid join core.media m on m.id = mid
                     where v.content_id = ci.id and m.visibility <> 'private' and m.share_path is not null), '{}'),
           ci.shared_at
    from story.content_item ci where ci.site_id = p_site and ci.status = 'shared' and ci.visibility = 'public';
    insert into pub.live_item (site_id, section, entity_id, title, summary, image_path, place_label, occurred_at)
    select p_site, 'happening', e.id, pub.redact_names(p_site, e.summary), null, null, pub.zone_label(e.place_id), date_trunc('day', e.occurred_at)
    from core.history_event e
    where e.site_id = p_site and e.visibility = 'public' and e.story_value and e.occurred_at < now() - make_interval(hours => v_delay)
      and e.event_type not like 'hospitality.%' and e.event_type not like 'person.%'
    order by e.occurred_at desc limit 20;
    insert into pub.live_item (site_id, section, entity_id, title, image_path, place_label, occurred_at)
    select p_site, 'new_life', o.id, resources.object_label(o.id), pub.safe_image(o.id, 'public'), pub.zone_label(o.place_id), date_trunc('day', o.status_since)
    from resources.object o where o.site_id = p_site and o.status = 'in_use' and o.visibility = 'public';
    insert into pub.person (id, site_id, display_name, roles, contribution_summary, image_path)
    select pe.id, p_site, pe.display_name,
           coalesce((select array_agg(cv.label_sv) from people.person_role r join core.code_value cv on cv.list_code = 'person_role' and cv.code = r.role_code and cv.site_id is null where r.person_id = pe.id), '{}'),
           case when c.contribution = 'yes' then (select string_agg(distinct cv.label_sv, ', ') from people.contribution co
                  join core.code_value cv on cv.list_code = 'contribution_type' and cv.code = co.type_code and cv.site_id is null where co.person_id = pe.id) end,
           case when c.image = 'yes' then pub.safe_image(pe.id, 'public') end
    from people.person pe join people.consent_policy c on c.person_id = pe.id
    where pe.site_id = p_site and c.name = 'yes' and pe.visibility = 'public' and pe.archived_at is null;
    insert into pub.hosted_event (id, site_id, title, description, starts_at, ends_at, place_label)
    select h.id, p_site, h.title, h.public_description, h.starts_at, h.ends_at, pub.zone_label(h.place_id)
    from hospitality.hosted_event h where h.site_id = p_site and h.publish_publicly and h.status in ('planned', 'confirmed') and h.ends_at > now();
    insert into pub.accommodation (id, site_id, name, description, capacity, facilities, season)
    select a.id, p_site, a.name, a.public_description, a.capacity,
           coalesce((select array_agg(cv.label_sv) from hospitality.accommodation_facility f join core.code_value cv on cv.list_code = 'facility' and cv.code = f.facility_code and cv.site_id is null where f.accommodation_id = a.id), '{}'),
           nullif(concat_ws('–', a.season_from, a.season_to), '')
    from hospitality.accommodation a where a.site_id = p_site and a.active and a.visibility = 'public';
    insert into pub.live_item (site_id, section, title, summary)
    select p_site, 'life', coalesce(t.swedish_name, t.scientific_name),
           case sp.presence_pattern when 'established' then 'Etablerad' when 'recurring' then 'Återkommande' when 'seasonal_resident' then 'Säsongsinvånare'
                                    when 'wintering' then 'Övervintrar' when 'visitor' then 'Besökare' else 'Tidigare' end
    from life.species_presence sp join life.taxon t on t.id = sp.taxon_id
    where sp.site_id = p_site and sp.archived_at is null and sp.sensitivity = 'normal' and t.default_sensitivity = 'normal';
  end if;
  -- Rundvandring (R2.5): bara publicerade tours med grönt läckagetest; stoppen får zonens mittpunkt.
  if core.feature_enabled(p_site, 'culture') then
    insert into pub.tour (id, site_id, title, intro, mode, route_geom, length_m, surface, accessibility_note, estimated_minutes)
    select t.id, p_site, t.title, t.intro, t.mode::text, r.geom, r.length_m, r.surface, r.accessibility_note, r.estimated_minutes
    from place.tour t left join place.route r on r.tour_id = t.id
    where t.site_id = p_site and t.status = 'published' and t.leakage_test_passed_at is not null;
    insert into pub.tour_stop (id, site_id, tour_id, ordinal, title, what_is_this, what_happened, how_now, what_future, point, media)
    select s.id, p_site, s.tour_id, s.ordinal, s.title, s.what_is_this, pub.redact_names(p_site, s.what_happened), s.how_now, s.what_future,
           extensions.st_pointonsurface(coalesce(
             (select geom from place.zone where id = place.zone_of(s.entity_id)),
             (select geom from place.structure where id = s.entity_id))),
           (select coalesce(jsonb_agg(jsonb_build_object('path', m.share_path, 'era', tm.era) order by tm.ordinal), '[]')
              from place.tour_stop_media tm join core.media m on m.id = tm.media_id
              where tm.tour_stop_id = s.id and m.visibility in ('shareable', 'public') and m.share_path is not null)
    from place.tour_stop s join pub.tour pt on pt.id = s.tour_id where s.site_id = p_site and s.archived_at is null;
    insert into pub.map_feature (site_id, layer, label, geom)
    select p_site, 'tour_stop', s.title, s.point from pub.tour_stop s where s.site_id = p_site and s.point is not null
    union all
    select p_site, 'route', t.title, t.route_geom from pub.tour t where t.site_id = p_site and t.route_geom is not null;
  end if;
end $$;

create function pub.refresh_site(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pub.refresh_guest(p_site);
  perform pub.refresh_public(p_site);
end $$;

-- Bakgrundsjobben byggs ut med read models och projektioner.
create or replace function core.run_job(p_job core.job) returns void
language plpgsql security definer set search_path = '' as $$
begin
  case p_job.kind
    when 'noop' then null;
    when 'refresh_site' then
      perform rm.refresh_site(p_job.site_id);
      perform pub.refresh_site(p_job.site_id);
    when 'expire_proposals' then
      update core.proposal set status = 'expired' where status = 'pending' and expires_at < now() and (p_job.site_id is null or site_id = p_job.site_id);
    else raise exception 'unknown_job: %', p_job.kind;
  end case;
end $$;

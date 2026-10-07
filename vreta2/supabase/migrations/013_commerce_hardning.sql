-- VRETA 2 · Migrering 013 · Commerce och härdning
-- Commerce reserveras som egen gräns (ADR-017). Domain API:ts frågor, godkännandet av förslag som ett
-- enda kommando, inloggningens startpunkter (ny plats, gäst- och inbjudningslänk, Bidra), hela
-- kommandokatalogen, lagringsregler och den sista härdningen: varje tabell registrerad med RLS, inga
-- funktioner som kan anropas av vem som helst (NFR-019).

-- ================================================================== Commerce (reserverad, tom till R3)
-- Schemat nås av inloggade men tabellerna bara av ägaren (RLS). Inga kommandon förrän R3.
grant usage on schema commerce to authenticated;

create table commerce.catalog_item (
  like core.entity_template including all,
  title text not null,
  kind text not null check (kind in ('food_drink', 'product_batch', 'creative_work', 'workshop', 'service', 'other')),
  subject_entity_id uuid references core.entity (id),
  producer_person_id uuid references people.person (id),
  producer_organization_id uuid references people.organization (id),
  description text
);
select core.register_table('commerce.catalog_item', 'owner', p_ui_release => 'R3');

create table commerce.offering_price (
  like core.entity_template including all,
  catalog_item_id uuid not null references commerce.catalog_item (id),
  price numeric not null,
  currency text not null default 'SEK',
  valid_from date,
  valid_to date
);
select core.register_table('commerce.offering_price', 'owner', p_ui_release => 'R3');

create table commerce.consignment_agreement (
  like core.entity_template including all,
  catalog_item_id uuid references commerce.catalog_item (id),
  consignor_person_id uuid references people.person (id),
  consignor_organization_id uuid references people.organization (id),
  commission_pct numeric,
  starts_on date,
  ends_on date,
  terms text
);
select core.register_table('commerce.consignment_agreement', 'owner', p_ui_release => 'R3');

create table commerce.sale (
  like core.entity_template including all,
  occurred_at timestamptz not null default now(),
  total numeric,
  currency text not null default 'SEK',
  payment_method text,
  hosted_event_id uuid references hospitality.hosted_event (id)
);
select core.register_table('commerce.sale', 'owner', p_ui_release => 'R3');

create table commerce.sale_line (
  like core.link_template including all,
  sale_id uuid not null references commerce.sale (id),
  catalog_item_id uuid references commerce.catalog_item (id),
  quantity numeric not null default 1,
  unit_price numeric,
  consignment_agreement_id uuid references commerce.consignment_agreement (id)
);
select core.register_table('commerce.sale_line', 'owner', p_ui_release => 'R3');

-- ================================================================== inloggningens startpunkter
-- Första inloggningen skapar platsen och gör användaren till ägare (R1.1). Ingen data förs över (ADR-022).
create function api.bootstrap_site(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_site uuid := gen_random_uuid();
  v_name text := coalesce(nullif(btrim(p ->> 'name'), ''), 'Vreta');
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated: Logga in först' using errcode = '28000'; end if;
  if coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'forbidden: Ett gästkonto kan inte skapa en plats' using errcode = '42501';
  end if;
  if exists (select 1 from core.membership where user_id = v_uid and revoked_at is null and role = 'owner') then
    raise exception 'already_owner: Du har redan en plats' using errcode = '42501';
  end if;
  perform set_config('vreta.site_id', v_site::text, true);
  perform set_config('vreta.role', 'owner', true);
  insert into core.site (id, name, slug, description, approx_lat, approx_lon)
  values (v_site, v_name, coalesce(nullif(p ->> 'slug', ''), lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(v_site::text, 1, 4)),
          coalesce(p ->> 'description', ''), (p ->> 'approx_lat')::numeric, (p ->> 'approx_lon')::numeric);
  insert into core.membership (site_id, user_id, role, display_name) values (v_site, v_uid, 'owner', coalesce(p ->> 'display_name', ''));
  if nullif(p ->> 'address', '') is not null then
    insert into core.site_private (site_id, address) values (v_site, p ->> 'address');
  end if;
  insert into core.site_setting (site_id, key, value) values
    (v_site, 'capacity_targets', '{"multi_day_retreat":12,"day_open_air":80,"day_covered":40}'),
    (v_site, 'weather_thresholds', '{"frost_c":0,"heavy_rain_mm_h":4,"strong_wind_ms":12,"heat_c":28,"dry_days":14}'),
    (v_site, 'ai_monthly_cap_usd', '20'),
    (v_site, 'public_delay_hours', '48'),
    (v_site, 'long_stored_months', '12'),
    (v_site, 'follow_up_plants_days', '90');
  for r in select code, attributes ->> 'release' as rel from core.code_value where list_code = 'feature' and site_id is null loop
    insert into core.feature_flag (site_id, flag, enabled, release) values (v_site, r.code, r.rel = 'R2.0', r.rel);
  end loop;
  insert into resources.category (site_id, code, name, parent_id)
  select v_site, code, label_sv, null from core.code_value where list_code = 'default_category' and site_id is null;
  update resources.category c set parent_id = pc.id
  from core.code_value cv, resources.category pc
  where c.site_id = v_site and cv.list_code = 'default_category' and cv.site_id is null and cv.code = c.code and cv.parent_code is not null
    and pc.site_id = v_site and pc.code = cv.parent_code;
  insert into hospitality.capacity_rule (site_id, scenario_code, capacity_target, basis) values
    (v_site, 'multi_day_retreat', 12, 'Designmål för flerdagars retreat – inte ett juridiskt besked (Q-12)'),
    (v_site, 'day_open_air', 80, 'Designmål för endagsaktivitet under bar himmel – inte ett juridiskt besked (Q-12)'),
    (v_site, 'day_covered', 40, 'Designmål för endagsaktivitet i tält eller täckt – inte ett juridiskt besked (Q-12)');
  perform core.record_history('site.created', format('%s började i VRETA 2', v_name), '[]'::jsonb);
  perform core.enqueue('refresh_site', v_site::text, '{}', v_site);
  return jsonb_build_object('site_id', v_site);
end $$;

-- Gästlänk: den som öppnar länken loggas in anonymt och blir gäst. Samma mekanism bjuder in
-- medhjälpare, läsare och värdar – de måste då vara inloggade med ett riktigt konto (Q-16).
create function api.redeem_guest_link(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_link core.guest_link;
  v_anon boolean := coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true';
begin
  if v_uid is null then raise exception 'not_authenticated: Öppna länken igen' using errcode = '28000'; end if;
  select * into v_link from core.guest_link
  where token_hash = encode(extensions.digest(coalesce(p ->> 'token', ''), 'sha256'), 'hex');
  if not found or v_link.closed_at is not null or (v_link.expires_at is not null and v_link.expires_at < now()) then
    raise exception 'link_closed: Länken fungerar inte längre' using errcode = '42501';
  end if;
  if v_link.role <> 'guest' and v_anon then
    raise exception 'needs_account: Logga in med ditt konto för att ta emot inbjudan' using errcode = '42501';
  end if;
  if not exists (select 1 from core.membership where site_id = v_link.site_id and user_id = v_uid and revoked_at is null) then
    insert into core.membership (site_id, user_id, role, display_name, guest_link_id)
    values (v_link.site_id, v_uid, v_link.role, coalesce(nullif(p ->> 'display_name', ''), case when v_link.role = 'guest' then 'Gäst' else '' end),
            case when v_link.role = 'guest' then v_link.id end);
  end if;
  update core.guest_link set uses = uses + 1, last_used_at = now() where id = v_link.id;
  return jsonb_build_object('site_id', v_link.site_id, 'role', v_link.role);
end $$;

-- Bidra (R2.7): publikt formulär utan inloggning. Hamnar i Att granska. Kräver att Live är påslaget.
create function api.submit_contribution(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_site uuid := (select id from core.site where slug = p ->> 'site' or id::text = p ->> 'site');
  v_id uuid := gen_random_uuid();
begin
  if v_site is null or not core.feature_enabled(v_site, 'live') then
    raise exception 'not_found: Bidra är inte öppet' using errcode = '42501';
  end if;
  if coalesce(btrim(p ->> 'message'), '') = '' then raise exception 'missing_field: Skriv något om vad du vill bidra med'; end if;
  if (select count(*) from story.contribute_submission where site_id = v_site and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited: Många inskick just nu – försök igen om en stund';
  end if;
  perform set_config('vreta.site_id', v_site::text, true);
  insert into story.contribute_submission (id, site_id, kind, name, contact, message, consent_name, listing_id, need_id, starts_on, ends_on, party_size, source_type)
  values (v_id, v_site, coalesce(nullif(p ->> 'kind', ''), 'have')::story.submission_kind, left(p ->> 'name', 120), left(p ->> 'contact', 200),
          left(p ->> 'message', 4000), coalesce((p ->> 'consent_name')::boolean, false),
          (select id from resources.listing where id = nullif(p ->> 'listing_id', '')::uuid and site_id = v_site),
          (select id from change.need where id = nullif(p ->> 'need_id', '')::uuid and site_id = v_site),
          (p ->> 'starts_on')::date, (p ->> 'ends_on')::date, (p ->> 'party_size')::integer, 'system');
  perform core.enqueue('refresh_site', v_site::text, '{}', v_site);
  return jsonb_build_object('ok', true);
end $$;

-- ================================================================== Fånga och Granska: godkänn som ett kommando
-- "Då skapas objekt, person, anskaffning, händelse och eventuell hämtning i ett steg – från 2.0 som ett enda
-- domänkommando." Korten kommer från förslaget; användarens beslut och ändringar skickas med.
-- payload: {proposal_id, cards: [{key, kind, decision: accept|reject, match_entity_id, fields: {…}}], story: {why, story_value}}
create function cmd.approve_proposal(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_prop core.proposal;
  v_card jsonb;
  f jsonb;
  v_kind text;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_person uuid;
  v_tipster uuid;
  v_place uuid;
  v_object uuid;
  v_acq uuid;
  v_project uuid;
  v_need uuid;
  v_task uuid;
  v_other jsonb := '[]';
  v_result jsonb := '{}';
  v_event uuid;
  v_media uuid;
  v_qty numeric;
  v_summary text;
  v_cards jsonb;
begin
  select * into v_prop from core.proposal where id = core.req_uuid(p, 'proposal_id') and site_id = core.ctx_site() for update;
  if not found then perform core.fail('not_found', 'Förslaget finns inte'); end if;
  if v_prop.status <> 'pending' then
    perform core.fail('not_pending', 'Förslaget är redan avgjort', jsonb_build_object('result', v_prop.result));
  end if;
  v_cards := coalesce(p -> 'cards', '[]');
  -- Fältbesluten sparas på förslaget (INV-02: förslag blir fakta först när en människa godkänt dem)
  for v_card in select * from jsonb_array_elements(v_cards) loop
    update core.proposal_field pf set
      decision = case when v_card ->> 'decision' = 'reject' then 'rejected'
                      when (v_card -> 'fields') ? pf.field and (v_card -> 'fields' -> pf.field) is distinct from pf.value then 'edited'
                      else 'accepted' end,
      final_value = case when v_card ->> 'decision' = 'reject' then null else coalesce(v_card -> 'fields' -> pf.field, pf.value) end,
      verified = v_card ->> 'decision' <> 'reject',
      match_entity_id = coalesce(core.opt_uuid(v_card, 'match_entity_id'), pf.match_entity_id)
    where pf.proposal_id = v_prop.id and pf.entity_key = v_card ->> 'key';
  end loop;

  perform set_config('vreta.suppress_history', 'on', true);
  -- 1. Personen (befintlig vid "Samma som …", annars ny) och tipsaren
  for v_card in select * from jsonb_array_elements(v_cards) where value ->> 'kind' in ('person') and coalesce(value ->> 'decision', 'accept') = 'accept' loop
    f := coalesce(v_card -> 'fields', '{}');
    if core.opt_uuid(v_card, 'match_entity_id') is not null then
      v_person := core.opt_uuid(v_card, 'match_entity_id');
      perform core.assert_entity(v_person, '{person}');
    elsif nullif(f ->> 'display_name', '') is not null then
      v_person := (cmd.create_person(jsonb_build_object('display_name', f ->> 'display_name', 'locality', f ->> 'locality',
                    'how_we_met', coalesce(f ->> 'how_we_met', 'Via fångst'), 'phone', f ->> 'phone')) ->> 'person_id')::uuid;
    end if;
    v_accepted := v_accepted + 1;
  end loop;
  -- 2. Kopplingar: plats utanför Vreta, projekt och behov, tipsare
  for v_card in select * from jsonb_array_elements(v_cards) where value ->> 'kind' = 'links' and coalesce(value ->> 'decision', 'accept') = 'accept' loop
    f := coalesce(v_card -> 'fields', '{}');
    v_place := core.opt_uuid(f, 'external_place_id');
    if v_place is null and nullif(f ->> 'external_place', '') is not null then
      select id into v_place from place.external_place where site_id = core.ctx_site() and lower(name) = lower(f ->> 'external_place') and archived_at is null limit 1;
      if v_place is null then
        v_place := (cmd.create_place(jsonb_build_object('kind', 'external_place', 'name', f ->> 'external_place', 'locality', f ->> 'locality')) ->> 'id')::uuid;
      end if;
    end if;
    v_project := coalesce(core.opt_uuid(f, 'project_id'), change.ensure_project(f ->> 'project', null));
    v_need := core.opt_uuid(f, 'need_id');
    if v_need is null and v_project is not null and nullif(f ->> 'new_need_title', '') is not null then
      v_need := (cmd.add_need(jsonb_build_object('project_id', v_project, 'title', f ->> 'new_need_title', 'quantity', f ->> 'new_need_quantity',
                                                 'unit', f ->> 'new_need_unit')) ->> 'need_id')::uuid;
    end if;
    v_tipster := core.opt_uuid(f, 'tipster_person_id');
    if v_tipster is null and nullif(f ->> 'tipster', '') is not null then
      select id into v_tipster from people.person where site_id = core.ctx_site() and lower(display_name) = lower(f ->> 'tipster') and archived_at is null limit 1;
      if v_tipster is null then v_tipster := people.create_person(f ->> 'tipster', null, 'Tipsade oss'); end if;
    end if;
    v_accepted := v_accepted + 1;
  end loop;
  -- 3. Saken (objekt eller parti) med fångstens bilder
  for v_card in select * from jsonb_array_elements(v_cards) where value ->> 'kind' = 'object' and coalesce(value ->> 'decision', 'accept') = 'accept' loop
    f := coalesce(v_card -> 'fields', '{}');
    v_object := (cmd.create_object(f || jsonb_build_object('source_type', 'ai_capture', 'story_why', coalesce(f ->> 'story_why', p -> 'story' ->> 'why'),
                  'media_ids', (select coalesce(jsonb_agg(l.media_id), '[]') from core.media_link l join core.media m on m.id = l.media_id
                                where l.entity_id = v_prop.capture_id and m.kind = 'photo'))) ->> 'object_id')::uuid;
    if v_project is not null then update resources.object set project_id = v_project where id = v_object; end if;
    v_accepted := v_accepted + 1;
  end loop;
  -- 4. Anskaffningen kopplas till motparten, platsen och tipsaren – aldrig tipsaren som säljare (R1.1 11.2)
  for v_card in select * from jsonb_array_elements(v_cards) where value ->> 'kind' = 'acquisition' and coalesce(value ->> 'decision', 'accept') = 'accept' loop
    f := coalesce(v_card -> 'fields', '{}');
    if v_object is null then perform core.fail('missing_object', 'En anskaffning behöver en sak – godkänn saken också'); end if;
    v_acq := (cmd.create_acquisition(f || jsonb_build_object('object_id', v_object, 'counterpart_person_id', v_person,
               'external_place_id', v_place, 'tipster_person_id', case when v_tipster is distinct from v_person then v_tipster end,
               'source_url', (select url from core.capture where id = v_prop.capture_id), 'source_type', 'ai_capture')) ->> 'acquisition_id')::uuid;
    v_accepted := v_accepted + 1;
  end loop;
  if v_acq is null and v_tipster is not null and v_person is not null and v_tipster <> v_person then
    insert into people.person_relation (site_id, person_id, other_person_id, kind_code) values (core.ctx_site(), v_tipster, v_person, 'introduced') on conflict do nothing;
    perform people.add_role(v_tipster, 'tipster');
  end if;
  -- Saken räknas mot projektets behov (AC-26)
  if v_need is not null and v_object is not null then
    select coalesce((select total_quantity from resources.object_batch where object_id = v_object), 1) into v_qty;
    perform set_config('vreta.suppress_history', 'off', true);
    perform change.fulfill_need(v_need, v_qty, 'acquisition', p_object => v_object, p_acquisition => v_acq);
    perform set_config('vreta.suppress_history', 'on', true);
  end if;
  -- 5. Uppgift/hämtning: "hämta före 1 nov"
  for v_card in select * from jsonb_array_elements(v_cards) where value ->> 'kind' in ('task', 'pickup') and coalesce(value ->> 'decision', 'accept') = 'accept' loop
    f := coalesce(v_card -> 'fields', '{}');
    v_task := (cmd.create_task(jsonb_build_object('title', coalesce(nullif(f ->> 'title', ''), 'Hämta ' || coalesce(resources.object_label(v_object), '')),
                'kind', case when v_card ->> 'kind' = 'pickup' then 'pickup' else 'todo' end, 'due_at', f ->> 'due_at',
                'subject_entity_id', coalesce(v_object, v_person), 'note', f ->> 'note')) ->> 'task_id')::uuid;
    v_accepted := v_accepted + 1;
  end loop;
  perform set_config('vreta.suppress_history', 'off', true);
  -- 6. Kort som är egna händelser: observation, ögonblick, bidrag
  for v_card in select * from jsonb_array_elements(v_cards) where value ->> 'kind' in ('observation', 'moment', 'contribution') and coalesce(value ->> 'decision', 'accept') = 'accept' loop
    f := coalesce(v_card -> 'fields', '{}');
    if v_card ->> 'kind' = 'observation' then
      v_other := v_other || cmd.record_observation(f || jsonb_build_object('media_ids',
        (select coalesce(jsonb_agg(media_id), '[]') from core.media_link where entity_id = v_prop.capture_id), 'geometry',
        (select c.context -> 'geometry' from core.capture c where c.id = v_prop.capture_id)));
    elsif v_card ->> 'kind' = 'moment' then
      v_other := v_other || cmd.record_moment(f || jsonb_build_object('capture_id', v_prop.capture_id, 'media_ids',
        (select coalesce(jsonb_agg(media_id), '[]') from core.media_link where entity_id = v_prop.capture_id)));
    else
      v_other := v_other || cmd.record_contribution(f || jsonb_build_object('person_id', coalesce(core.opt_uuid(f, 'person_id'), v_person),
        'project_id', coalesce(core.opt_uuid(f, 'project_id'), v_project), 'need_id', v_need));
    end if;
    v_accepted := v_accepted + 1;
  end loop;
  select count(*) into v_rejected from jsonb_array_elements(v_cards) where value ->> 'decision' = 'reject';
  -- En gemensam händelse för fyndet (INV-01)
  if v_object is not null then
    v_summary := format('Upptäckt: %s%s%s', resources.object_label(v_object),
      coalesce(case (select type from resources.acquisition where id = v_acq) when 'gift' then ' som gåva från ' else ' från ' end
               || (select display_name from people.person where id = v_person), ''),
      coalesce(', ' || (select name from place.external_place where id = v_place), ''));
    v_event := core.record_history('object.discovered', v_summary,
      jsonb_build_array(jsonb_build_object('id', v_object, 'role', 'object'), jsonb_build_object('id', v_person, 'role', 'counterpart'),
        jsonb_build_object('id', v_acq, 'role', 'acquisition'), jsonb_build_object('id', v_tipster, 'role', 'tipster'),
        jsonb_build_object('id', v_project, 'role', 'project'), jsonb_build_object('id', v_need, 'role', 'need'),
        jsonb_build_object('id', v_prop.capture_id, 'role', 'capture'), jsonb_build_object('id', v_prop.id, 'role', 'proposal')),
      (select coalesce(client_created_at, created_at) from core.capture where id = v_prop.capture_id), v_place,
      coalesce((p -> 'story' ->> 'story_value')::boolean, false));
  elsif v_person is not null and jsonb_array_length(v_other) = 0 then
    v_event := core.record_history('person.created', format('Ny kontakt: %s', (select display_name from people.person where id = v_person)),
      jsonb_build_array(jsonb_build_object('id', v_person), jsonb_build_object('id', v_prop.capture_id, 'role', 'capture')));
  end if;
  v_result := jsonb_strip_nulls(jsonb_build_object('object_id', v_object, 'person_id', v_person, 'acquisition_id', v_acq,
    'external_place_id', v_place, 'project_id', v_project, 'need_id', v_need, 'tipster_person_id', v_tipster, 'task_id', v_task,
    'history_event_id', v_event, 'other', case when jsonb_array_length(v_other) > 0 then v_other end));
  update core.proposal set status = case when v_rejected > 0 and v_accepted > 0 then 'partially_accepted'::core.proposal_status
                                         when v_accepted = 0 then 'rejected'::core.proposal_status else 'accepted'::core.proposal_status end,
    decided_by = auth.uid(), decided_at = now(), result = v_result
  where id = v_prop.id;
  return v_result;
end $$;

-- ================================================================== frågor (Domain API: läsning)
-- Frågorna körs med användarens behörighet (security invoker): radnivåsäkerheten filtrerar allt innan
-- något når appen, Fråga Vreta eller MCP. Översikter läser read models, publika ytor bara projektioner.

create function core.qsite(p jsonb) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(nullif(p ->> 'site_id', '')::uuid,
    (select m.site_id from core.membership m where m.user_id = auth.uid() and m.revoked_at is null
     order by array_position(array['owner','helper','reader','host','guest']::core.member_role[], m.role), m.created_at limit 1))
$$;

create function core.entity_ref(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'type', e.entity_type, 'title', e.title, 'type_label', t.label_sv,
                            'route', replace(t.route, ':id', e.id::text), 'archived', e.archived_at is not null)
  from core.entity e join core.entity_type t on t.code = e.entity_type where e.id = p_id
$$;

create function core.media_ref(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'kind', m.kind, 'share_path', m.share_path, 'thumb_path', m.thumb_path, 'caption', m.caption,
                            'visibility', m.visibility, 'has_people', m.has_people, 'flagged', m.flagged_for_review,
                            'width', m.width, 'height', m.height, 'taken_at', m.taken_at, 'transcript', m.transcript, 'mime_type', m.mime_type)
  from core.media m where m.id = p_id and m.archived_at is null
$$;

create function core.media_for(p_entity uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(core.media_ref(l.media_id) || jsonb_build_object('role', l.role) order by l.sort, l.created_at), '[]')
  from core.media_link l join core.media m on m.id = l.media_id and m.archived_at is null where l.entity_id = p_entity
$$;

create function core.cover(p_entity uuid) returns jsonb
language sql stable set search_path = '' as $$
  select core.media_ref(l.media_id) from core.media_link l join core.media m on m.id = l.media_id
  where l.entity_id = p_entity and m.kind = 'photo' and m.archived_at is null and l.role in ('photo', 'after', 'cover', 'avatar', 'before', 'during')
  order by case l.role when 'cover' then 0 when 'after' then 1 when 'avatar' then 2 else 3 end, l.sort limit 1
$$;

-- Tidslinje: händelser som länkar entiteten (eller platsen och dess underplatser).
create function core.timeline(p_entity uuid, p_limit integer default 100) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'occurred_at') desc), '[]') from (
    select jsonb_build_object('id', e.id, 'event_type', e.event_type, 'occurred_at', e.occurred_at, 'summary', e.summary, 'note', e.note,
      'story_value', e.story_value, 'role', min(l.role), 'place', core.entity_ref(e.place_id), 'visibility', e.visibility,
      'links', (select coalesce(jsonb_agg(core.entity_ref(l2.entity_id) || jsonb_build_object('role', l2.role)), '[]')
                from core.history_event_link l2 where l2.event_id = e.id and l2.entity_id <> p_entity and l2.role not in ('place_ancestor')),
      'media', core.media_for(e.id)) as x
    from core.history_event_link l join core.history_event e on e.id = l.event_id
    where l.entity_id = p_entity and e.archived_at is null
    group by e.id order by e.occurred_at desc limit p_limit) s
$$;

create function core.allowed_next(p_machine text, p_state text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('to', t.to_state, 'label', s.label_sv, 'note', t.label_sv) order by s.sort), '[]')
  from core.state_transition t join core.state s on s.machine = t.machine and s.state = t.to_state
  where t.machine = p_machine and t.from_state = p_state
$$;

create function core.person_brief(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', pe.id, 'display_name', pe.display_name, 'locality', (select name from place.locality where id = pe.locality_id),
    'avatar', (select core.media_ref(l.media_id) from core.media_link l where l.entity_id = pe.id and l.role = 'avatar' limit 1),
    'roles', (select coalesce(jsonb_agg(role_code order by role_code), '[]') from people.person_role where person_id = pe.id),
    'consent', (select jsonb_build_object('name', c.name, 'image', c.image, 'contribution', c.contribution) from people.consent_policy c where c.person_id = pe.id),
    'erased', pe.erased_at is not null)
  from people.person pe where pe.id = p_id
$$;

-- ------------------------------------------------------------------ appens kontext
create function api.q_context(p jsonb default '{}') returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_site uuid;
begin
  if v_uid is null then return jsonb_build_object('user_id', null, 'sites', '[]'::jsonb); end if;
  v_site := core.qsite(p);
  return jsonb_build_object(
    'user_id', v_uid,
    'is_anonymous', coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true',
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('site_id', m.site_id, 'name', s.name, 'role', m.role, 'display_name', m.display_name)), '[]')
              from core.membership m join core.site s on s.id = m.site_id where m.user_id = v_uid and m.revoked_at is null),
    'site', (select jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description, 'timezone', s.timezone,
                                       'approx_lat', s.approx_lat, 'approx_lon', s.approx_lon,
                                       'boundary', extensions.st_asgeojson(s.boundary)::jsonb) from core.site s where s.id = v_site),
    'role', core.my_role(v_site),
    'display_name', (select display_name from core.membership where site_id = v_site and user_id = v_uid and revoked_at is null limit 1),
    'flags', (select coalesce(jsonb_object_agg(cv.code, coalesce(f.enabled, cv.code = 'core')), '{}')
              from core.code_value cv left join core.feature_flag f on f.site_id = v_site and f.flag = cv.code
              where cv.list_code = 'feature' and cv.site_id is null),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}') from core.site_setting where site_id = v_site),
    'catalog', (select coalesce(jsonb_agg(jsonb_build_object('type', command_type, 'version', version, 'label', label_sv, 'context', context,
                  'offline_class', offline_class, 'roles', allowed_roles, 'feature', feature, 'requires_own_tap', requires_own_tap)), '[]')
                from core.command_catalog where enabled),
    'states', (select coalesce(jsonb_object_agg(machine, states), '{}') from (
                 select machine, jsonb_agg(jsonb_build_object('state', state, 'label', label_sv, 'terminal', terminal) order by sort) states
                 from core.state group by machine) x),
    'transitions', (select coalesce(jsonb_object_agg(machine, tr), '{}') from (
                 select machine, jsonb_object_agg(from_state, tos) tr from (
                   select machine, from_state, jsonb_agg(to_state) tos from core.state_transition group by machine, from_state) y group by machine) x),
    'entity_types', (select coalesce(jsonb_object_agg(code, jsonb_build_object('label', label_sv, 'plural', label_plural_sv, 'route', route,
                       'context', context, 'is_place', is_place, 'simple_fields', simple_fields, 'ui_release', ui_release)), '{}') from core.entity_type),
    'codes', (select coalesce(jsonb_object_agg(list_code, vals), '{}') from (
                select list_code, jsonb_agg(jsonb_build_object('code', code, 'label', label_sv, 'parent', parent_code, 'sort', sort,
                                                               'attributes', attributes, 'site', site_id is not null, 'id', id) order by sort, label_sv) vals
                from core.code_value where (site_id is null or site_id = v_site) and archived_at is null group by list_code) x),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'parent_id', parent_id, 'default_unit', default_unit) order by name), '[]')
                   from resources.category where site_id = v_site and archived_at is null),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('membership_id', id, 'user_id', user_id, 'role', role, 'display_name', display_name)), '[]')
                from core.membership where site_id = v_site and revoked_at is null and role <> 'guest'));
end $$;

-- ------------------------------------------------------------------ Idag
create function api.q_today(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'priority', t.priority, 'entity', core.entity_ref(t.entity_id),
                'title', t.title, 'subtitle', t.subtitle, 'due_at', t.due_at, 'payload', t.payload) order by t.priority, t.due_at nulls last), '[]')
              from rm.today_item t where t.site_id = core.qsite(p)),
    'refreshed_at', (select max(refreshed_at) from rm.today_item where site_id = core.qsite(p)),
    'sync_issues', (select count(*) from core.domain_command where issued_by = auth.uid() and status = 'rejected' and resolved_at is null
                    and origin = 'offline' and site_id = core.qsite(p)),
    'weather', case when exists (select 1 from core.feature_flag where site_id = core.qsite(p) and flag = 'weather' and enabled)
                    then jsonb_build_object('now', core.weather_at(core.qsite(p), now()), 'signals', core.weather_signals(core.qsite(p))) end,
    'today_events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'summary', e.summary, 'occurred_at', e.occurred_at) order by e.occurred_at desc), '[]')
                     from (select * from core.history_event where site_id = core.qsite(p) and occurred_at > now() - interval '2 days'
                           order by occurred_at desc limit 8) e))
$$;

-- ------------------------------------------------------------------ Granska
create function api.q_review_queue(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'proposals', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'summary', pr.summary, 'created_at', pr.created_at, 'agent', pr.agent,
                    'capture', (select jsonb_build_object('id', c.id, 'text', c.text, 'kind_hint', c.kind_hint, 'transcript', c.transcript,
                                                          'cover', core.cover(c.id), 'created_by', c.created_by) from core.capture c where c.id = pr.capture_id),
                    'fields', (select count(*) from core.proposal_field f where f.proposal_id = pr.id and f.field <> '_match'),
                    'uncertain', (select count(*) from core.proposal_field f where f.proposal_id = pr.id and f.confidence < 0.7 and f.field <> '_match'),
                    'expires_at', pr.expires_at) order by pr.created_at desc), '[]')
                  from core.proposal pr where pr.site_id = core.qsite(p) and pr.status = 'pending' and pr.archived_at is null),
    'captures', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'text', c.text, 'kind_hint', c.kind_hint, 'status', c.status, 'error', c.error,
                   'transcript', c.transcript, 'url', c.url, 'created_at', c.created_at, 'media', core.media_for(c.id)) order by c.created_at desc), '[]')
                 from core.capture c where c.site_id = core.qsite(p) and c.status in ('new', 'interpreting', 'failed') and c.archived_at is null
                   and not exists (select 1 from core.proposal pr where pr.capture_id = c.id)),
    'submissions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name, 'contact', s.contact, 'message', s.message,
                      'consent_name', s.consent_name, 'created_at', s.created_at, 'listing', core.entity_ref(s.listing_id), 'need', core.entity_ref(s.need_id),
                      'starts_on', s.starts_on, 'ends_on', s.ends_on, 'party_size', s.party_size) order by s.created_at desc), '[]')
                    from story.contribute_submission s where s.site_id = core.qsite(p) and s.status = 'new'))
$$;

create function api.q_capture(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'text', c.text, 'transcript', c.transcript, 'url', c.url, 'kind_hint', c.kind_hint, 'status', c.status,
    'context', c.context, 'created_at', c.created_at, 'client_created_at', c.client_created_at, 'error', c.error, 'media', core.media_for(c.id),
    'proposal_id', (select id from core.proposal where capture_id = c.id order by created_at desc limit 1))
  from core.capture c where c.id = (p ->> 'id')::uuid
$$;

create function api.q_proposal(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', pr.id, 'status', pr.status, 'summary', pr.summary, 'agent', pr.agent, 'model', pr.model, 'created_at', pr.created_at,
    'result', pr.result, 'expires_at', pr.expires_at,
    'capture', api.q_capture(jsonb_build_object('id', pr.capture_id)),
    'cards', (select coalesce(jsonb_agg(card order by (card ->> 'sort')::integer), '[]') from (
      select jsonb_build_object('key', f.entity_key, 'kind', min(f.entity_kind), 'sort', min(f.sort),
        'match_entity', (select core.entity_ref(f2.match_entity_id) from core.proposal_field f2 where f2.proposal_id = pr.id and f2.entity_key = f.entity_key and f2.match_entity_id is not null limit 1),
        'match_candidates', (select f2.match_candidates from core.proposal_field f2 where f2.proposal_id = pr.id and f2.entity_key = f.entity_key and f2.field = '_match' limit 1),
        'fields', jsonb_agg(jsonb_build_object('id', f.id, 'field', f.field, 'value', f.value, 'confidence', f.confidence, 'verified', f.verified,
                    'decision', f.decision, 'final_value', f.final_value,
                    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('kind', ev.kind, 'reference', ev.reference, 'excerpt', ev.excerpt,
                                   'start_ms', ev.start_ms, 'end_ms', ev.end_ms, 'entity', core.entity_ref(ev.entity_id))), '[]')
                                 from core.proposal_evidence ev where ev.field_id = f.id)) order by f.sort) filter (where f.field <> '_match')) as card
      from core.proposal_field f where f.proposal_id = pr.id group by f.entity_key) x))
  from core.proposal pr where pr.id = (p ->> 'id')::uuid
$$;

-- ------------------------------------------------------------------ Saker
create function resources.status_group(p_status resources.object_status) returns text
language sql immutable set search_path = '' as $$
  select case when p_status in ('discovered', 'contacted', 'reserved', 'pickup_planned') then 'incoming'
              when p_status in ('collected', 'stored', 'processing') then 'home'
              when p_status = 'in_use' then 'in_use'
              when p_status in ('listed', 'reserved_out', 'lent') then 'outgoing'
              else 'closed' end
$$;

create function resources.allocation_summary(p_object uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'label', core.state_label('object', status::text), 'quantity', q) order by min_sort), '[]')
  from (select a.status, sum(a.quantity) q, min(s.sort) min_sort from resources.batch_allocation a
        join core.state s on s.machine = 'object' and s.state = a.status::text where a.object_id = p_object group by a.status) x
$$;

create function api.q_objects(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.ts desc), '[]') from (
    select o.updated_at ts, jsonb_build_object('id', o.id, 'title', o.title, 'label', resources.object_label(o.id), 'status', o.status,
      'status_label', core.state_label('object', o.status::text), 'group', resources.status_group(o.status),
      'is_batch', b.object_id is not null, 'quantity', b.total_quantity, 'unit', b.unit,
      'allocations', case when b.object_id is not null then resources.allocation_summary(o.id) end,
      'cover', core.cover(o.id), 'place', place.path_label(o.place_id), 'category', c.name, 'living', o.living_material,
      'health', o.health_status, 'status_since', o.status_since, 'visibility', o.visibility, 'project', core.entity_ref(o.project_id)) j
    from resources.object o
    left join resources.object_batch b on b.object_id = o.id
    left join resources.category c on c.id = o.category_id
    where o.site_id = core.qsite(p) and o.archived_at is null
      and (coalesce(p ->> 'group', 'all') = 'all' or resources.status_group(o.status) = p ->> 'group'
           or (p ->> 'group' = 'active' and resources.status_group(o.status) <> 'closed'))
      and (nullif(p ->> 'status', '') is null or o.status::text = p ->> 'status')
      and (nullif(p ->> 'category_id', '') is null or o.category_id = (p ->> 'category_id')::uuid)
      and (nullif(p ->> 'place_id', '') is null or (p ->> 'place_id')::uuid = any (place.lineage(o.place_id))
           or exists (select 1 from resources.batch_allocation a where a.object_id = o.id and (p ->> 'place_id')::uuid = any (place.lineage(a.place_id))))
      and (nullif(p ->> 'q', '') is null or o.title ilike '%' || (p ->> 'q') || '%' or o.description ilike '%' || (p ->> 'q') || '%'
           or o.material ilike '%' || (p ->> 'q') || '%')
    order by o.updated_at desc
    limit coalesce((p ->> 'limit')::integer, 200) offset coalesce((p ->> 'offset')::integer, 0)) x
$$;

create function api.q_object(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'title', o.title, 'label', resources.object_label(o.id), 'description', o.description, 'material', o.material,
    'dimensions', o.dimensions, 'weight_kg', o.weight_kg, 'age_period', o.age_period, 'condition', o.condition, 'status', o.status,
    'status_label', core.state_label('object', o.status::text), 'group', resources.status_group(o.status), 'status_since', o.status_since,
    'living_material', o.living_material, 'species_variety', o.species_variety, 'health_status', o.health_status, 'story_why', o.story_why,
    'visibility', o.visibility, 'source_type', o.source_type, 'created_at', o.created_at, 'archived_at', o.archived_at,
    'category', (select jsonb_build_object('id', c.id, 'name', c.name, 'co2e_per_kg', c.co2e_per_kg) from resources.category c where c.id = o.category_id),
    'place', core.entity_ref(o.place_id), 'place_path', place.path_label(o.place_id), 'project', core.entity_ref(o.project_id),
    'batch', (select jsonb_build_object('total_quantity', b.total_quantity, 'unit', b.unit) from resources.object_batch b where b.object_id = o.id),
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'quantity', a.quantity, 'status', a.status,
                      'status_label', core.state_label('object', a.status::text), 'place', core.entity_ref(a.place_id), 'place_path', place.path_label(a.place_id),
                      'project', core.entity_ref(a.project_id), 'health_status', a.health_status, 'status_since', a.status_since,
                      'next', core.allowed_next('object', a.status::text)) order by a.created_at), '[]')
                    from resources.batch_allocation a where a.object_id = o.id),
    'private', (select jsonb_build_object('estimated_value', x.estimated_value, 'note', x.note) from resources.object_private x where x.object_id = o.id),
    'media', core.media_for(o.id),
    'acquisitions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'status', a.status,
                       'status_label', core.state_label('acquisition', a.status::text), 'counterpart', core.person_brief(a.counterpart_person_id),
                       'organization', core.entity_ref(a.counterpart_organization_id), 'external_place', core.entity_ref(a.external_place_id),
                       'tipster', core.entity_ref(a.tipster_person_id), 'source_url', a.source_url, 'received_at', a.received_at, 'created_at', a.created_at,
                       'price', ap.price, 'payment_method', ap.payment_method, 'next', core.allowed_next('acquisition', a.status::text)) order by a.created_at), '[]')
                     from resources.acquisition a left join resources.acquisition_private ap on ap.acquisition_id = a.id
                     where a.object_id = o.id and a.archived_at is null),
    'pickups', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'scheduled_on', x.scheduled_on,
                  'receipt_status', i.receipt_status, 'quantity', i.quantity) order by x.created_at), '[]')
                from resources.pickup_item i join resources.pickup x on x.id = i.pickup_id where i.object_id = o.id),
    'usage', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'type', u.type, 'occurred_at', u.occurred_at, 'place', core.entity_ref(u.place_id),
                'place_path', place.path_label(u.place_id), 'project', core.entity_ref(u.project_id), 'quantity', u.quantity, 'note', u.note) order by u.occurred_at), '[]')
              from resources.usage_event u where u.object_id = o.id),
    'listings', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'type', l.type, 'status', l.status, 'status_label', core.state_label('listing', l.status::text),
                   'title', l.title, 'price', l.price, 'quantity', l.quantity,
                   'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', cp.channel_code, 'status', cp.status, 'url', cp.external_url)), '[]')
                                from resources.channel_post cp where cp.listing_id = l.id),
                   'leads', (select count(*) from resources.lead ld where ld.listing_id = l.id and ld.status not in ('lost', 'rejected', 'no_show'))) order by l.created_at), '[]')
                 from resources.listing l where l.object_id = o.id and l.archived_at is null),
    'disposals', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'quantity', d.quantity, 'occurred_at', d.occurred_at,
                    'counterpart', core.person_brief(d.counterpart_person_id), 'price', dp.price, 'payment_method', dp.payment_method) order by d.occurred_at), '[]')
                  from resources.disposal d left join resources.disposal_private dp on dp.disposal_id = d.id where d.object_id = o.id),
    'contributions', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'person', core.person_brief(c.person_id), 'type_code', c.type_code,
                        'description', c.description, 'occurred_at', c.occurred_at)), '[]')
                      from people.contribution c where c.subject_entity_id = o.id),
    'story_notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'text', n.text, 'person', core.entity_ref(n.person_id),
                      'quote_consent', n.quote_consent, 'created_at', n.created_at) order by n.created_at), '[]')
                    from story.story_note n where n.entity_id = o.id and n.archived_at is null),
    'stories', (select count(*) from story.content_item ci where o.id = any (ci.source_ids) and ci.status = 'shared'),
    'timeline', core.timeline(o.id),
    'next', core.allowed_next('object', o.status::text),
    'plants', (select coalesce(jsonb_agg(core.entity_ref(x.id)), '[]') from (
                 select id from life.plant_individual where origin_object_id = o.id union all select id from life.planting where origin_object_id = o.id) x),
    'open_tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'kind', t.kind)), '[]')
                   from core.task t where t.subject_entity_id = o.id and t.status in ('open', 'in_progress', 'snoozed')))
  from resources.object o where o.id = (p ->> 'id')::uuid
$$;

create function api.q_acquisitions(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'status', a.status, 'status_label', core.state_label('acquisition', a.status::text),
    'object', jsonb_build_object('id', a.object_id, 'label', resources.object_label(a.object_id), 'cover', core.cover(a.object_id)),
    'counterpart', core.person_brief(a.counterpart_person_id), 'external_place', core.entity_ref(a.external_place_id),
    'price', ap.price, 'updated_at', a.updated_at, 'pickup_window_end', a.pickup_window_end,
    'next', core.allowed_next('acquisition', a.status::text)) order by a.updated_at desc), '[]')
  from resources.acquisition a left join resources.acquisition_private ap on ap.acquisition_id = a.id
  where a.site_id = core.qsite(p) and a.archived_at is null
    and (coalesce((p ->> 'include_closed')::boolean, false) or a.status not in ('settled', 'declined', 'lost') or a.updated_at > now() - interval '30 days')
$$;

create function api.q_acquisition(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'type', a.type, 'status', a.status, 'status_label', core.state_label('acquisition', a.status::text),
    'object', api.q_object(jsonb_build_object('id', a.object_id)) - 'timeline', 'counterpart', core.person_brief(a.counterpart_person_id),
    'organization', core.entity_ref(a.counterpart_organization_id), 'external_place', core.entity_ref(a.external_place_id),
    'tipster', core.entity_ref(a.tipster_person_id), 'source_url', a.source_url, 'quantity', a.quantity,
    'pickup_window_start', a.pickup_window_start, 'pickup_window_end', a.pickup_window_end, 'agreed_at', a.agreed_at,
    'received_at', a.received_at, 'settled_at', a.settled_at, 'note', a.note,
    'private', (select jsonb_build_object('price', ap.price, 'payment_method', ap.payment_method, 'receipt', core.media_ref(ap.receipt_media_id))
                from resources.acquisition_private ap where ap.acquisition_id = a.id),
    'interactions', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'channel', i.channel_code, 'occurred_at', i.occurred_at, 'summary', i.summary, 'body', i.body) order by i.occurred_at desc), '[]')
                     from people.interaction i where i.person_id = a.counterpart_person_id),
    'pickups', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'scheduled_on', x.scheduled_on)), '[]')
                from resources.pickup x where x.acquisition_id = a.id),
    'next', core.allowed_next('acquisition', a.status::text), 'timeline', core.timeline(a.id))
  from resources.acquisition a where a.id = (p ->> 'id')::uuid
$$;

create function api.q_pickups(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'status_label', core.state_label('pickup', x.status::text),
    'scheduled_on', x.scheduled_on, 'window_start', x.window_start, 'window_end', x.window_end, 'contact', core.person_brief(x.contact_person_id),
    'external_place', core.entity_ref(x.external_place_id),
    'locality', (select l.name from place.external_place e join place.locality l on l.id = e.locality_id where e.id = x.external_place_id),
    'address', (select from_address from resources.pickup_private pp where pp.pickup_id = x.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('object_id', i.object_id, 'label', resources.object_label(i.object_id, i.quantity), 'receipt_status', i.receipt_status)), '[]')
              from resources.pickup_item i where i.pickup_id = x.id),
    'resources', (select coalesce(jsonb_agg(r.label), '[]') from resources.pickup_resource r where r.pickup_id = x.id),
    'checklist', jsonb_build_object('done', (select count(*) from resources.checklist_item c where c.pickup_id = x.id and c.checked),
                                    'total', (select count(*) from resources.checklist_item c where c.pickup_id = x.id)))
    order by coalesce(x.window_start, x.scheduled_on::timestamptz, x.created_at)), '[]')
  from resources.pickup x where x.site_id = core.qsite(p) and x.archived_at is null
    and (case coalesce(p ->> 'scope', 'upcoming') when 'upcoming' then x.status in ('planned', 'confirmed', 'in_progress')
         when 'done' then x.status in ('completed', 'cancelled') else true end)
$$;

create function api.q_pickup(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'status_label', core.state_label('pickup', x.status::text),
    'scheduled_on', x.scheduled_on, 'window_start', x.window_start, 'window_end', x.window_end, 'note', x.note, 'checklist_name', x.checklist_name,
    'contact', core.person_brief(x.contact_person_id), 'driver', core.entity_ref(x.driver_person_id), 'driver_user_id', x.driver_user_id,
    'external_place', core.entity_ref(x.external_place_id), 'acquisition', core.entity_ref(x.acquisition_id),
    'locality', (select l.name from place.external_place e join place.locality l on l.id = e.locality_id where e.id = x.external_place_id),
    'private', (select jsonb_build_object('from_address', pp.from_address, 'contact_phone', pp.contact_phone,
                                          'point', extensions.st_asgeojson(pp.exact_point)::jsonb) from resources.pickup_private pp where pp.pickup_id = x.id),
    'contact_phone', (select phone from people.person_private where person_id = x.contact_person_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'object_id', i.object_id, 'label', resources.object_label(i.object_id, i.quantity),
                'quantity', i.quantity, 'receipt_status', i.receipt_status, 'receipt_note', i.receipt_note, 'cover', core.cover(i.object_id))), '[]')
              from resources.pickup_item i where i.pickup_id = x.id),
    'checklist', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'text', c.text, 'checked', c.checked, 'checked_at', c.checked_at) order by c.ordinal), '[]')
                  from resources.checklist_item c where c.pickup_id = x.id),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('label', r.label, 'vehicle', core.entity_ref(r.vehicle_machine_id), 'person', core.entity_ref(r.person_id))), '[]')
                  from resources.pickup_resource r where r.pickup_id = x.id),
    'media', core.media_for(x.id), 'timeline', core.timeline(x.id), 'next', core.allowed_next('pickup', x.status::text))
  from resources.pickup x where x.id = (p ->> 'id')::uuid
$$;

create function api.q_listings(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'type', l.type, 'status', l.status, 'status_label', core.state_label('listing', l.status::text),
    'title', l.title, 'price', l.price, 'quantity', l.quantity, 'object', core.entity_ref(l.object_id), 'need', core.entity_ref(l.need_id),
    'cover', core.cover(coalesce(l.object_id, l.id)),
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', cp.channel_code, 'status', cp.status)), '[]') from resources.channel_post cp where cp.listing_id = l.id),
    'leads', (select count(*) from resources.lead ld where ld.listing_id = l.id and ld.status in ('new', 'replied', 'viewing_booked', 'agreed')),
    'waiting', (select count(*) from resources.lead ld where ld.listing_id = l.id and ld.status = 'new')) order by l.updated_at desc), '[]')
  from resources.listing l where l.site_id = core.qsite(p) and l.archived_at is null
    and (coalesce((p ->> 'include_closed')::boolean, false) or l.status not in ('archived', 'withdrawn', 'completed'))
$$;

create function api.q_listing(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', l.id, 'type', l.type, 'status', l.status, 'status_label', core.state_label('listing', l.status::text),
    'title', l.title, 'description', l.description, 'price', l.price, 'price_rationale', l.price_rationale, 'quantity', l.quantity,
    'condition', l.condition, 'locality', (select name from place.locality where id = l.locality_id), 'published_at', l.published_at,
    'object', case when l.object_id is not null then api.q_object(jsonb_build_object('id', l.object_id)) - 'timeline' end,
    'need', case when l.need_id is not null then jsonb_build_object('id', l.need_id, 'ref', core.entity_ref(l.need_id), 'progress', change.need_progress_label(l.need_id)) end,
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('channel', cp.channel_code, 'status', cp.status, 'title', cp.title, 'body', cp.body,
                   'media_ids', cp.media_ids, 'external_url', cp.external_url, 'publish_mode', cp.publish_mode, 'posted_at', cp.posted_at) order by cp.channel_code), '[]')
                 from resources.channel_post cp where cp.listing_id = l.id),
    'leads', (select coalesce(jsonb_agg(jsonb_build_object('id', ld.id, 'person', core.person_brief(ld.person_id), 'queue_position', ld.queue_position,
                'status', ld.status, 'status_label', core.state_label('lead', ld.status::text), 'bid', ld.bid, 'message', ld.message,
                'viewing_at', ld.viewing_at, 'created_at', ld.created_at, 'next', core.allowed_next('lead', ld.status::text)) order by ld.queue_position), '[]')
              from resources.lead ld where ld.listing_id = l.id),
    'media', core.media_for(coalesce(l.object_id, l.id)), 'timeline', core.timeline(l.id), 'next', core.allowed_next('listing', l.status::text))
  from resources.listing l where l.id = (p ->> 'id')::uuid
$$;

-- Annonspaketet (R1.1 9.3): fakta utan adress, givare eller lagerplats; inköpspris och tidigare försäljningar
-- syns bara för den som får se dem (radnivåsäkerheten) och används bara till prisförslaget.
create function api.q_listing_package(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('listing_id', l.id, 'type', l.type, 'title', l.title, 'description', l.description, 'price', l.price,
    'quantity', coalesce(l.quantity, b.total_quantity), 'unit', b.unit, 'condition', coalesce(l.condition, o.condition),
    'object', case when o.id is not null then jsonb_build_object('title', o.title, 'material', o.material, 'dimensions', o.dimensions,
                     'age_period', o.age_period, 'weight_kg', o.weight_kg, 'story_why', o.story_why, 'living_material', o.living_material,
                     'species_variety', o.species_variety) end,
    'category', (select jsonb_build_object('name', c.name, 'channel_mapping', c.channel_mapping) from resources.category c where c.id = o.category_id),
    'locality', coalesce((select name from place.locality where id = l.locality_id), (select name from place.locality where id = (
                  select locality_id from people.person where id = (select counterpart_person_id from resources.acquisition where object_id = o.id limit 1))), ''),
    'media', (select coalesce(jsonb_agg(core.media_ref(l2.media_id) order by l2.sort), '[]') from core.media_link l2 join core.media m on m.id = l2.media_id
              where l2.entity_id = o.id and m.kind = 'photo' and m.visibility <> 'private' and m.archived_at is null
                and not exists (select 1 from core.media_link l3 left join people.consent_policy cc on cc.person_id = l3.entity_id
                                where l3.media_id = m.id and l3.role in ('depicts', 'avatar') and coalesce(cc.image, 'ask') <> 'yes')),
    'purchase_price', (select ap.price from resources.acquisition a join resources.acquisition_private ap on ap.acquisition_id = a.id where a.object_id = o.id limit 1),
    'comparable_sales', (select coalesce(jsonb_agg(jsonb_build_object('title', o2.title, 'price', dp.price, 'quantity', d.quantity, 'condition', o2.condition)), '[]')
                         from resources.disposal d join resources.disposal_private dp on dp.disposal_id = d.id join resources.object o2 on o2.id = d.object_id
                         where d.site_id = l.site_id and d.type = 'sold' and dp.price is not null and (o2.category_id = o.category_id or o2.title ilike '%' || split_part(o.title, ' ', 1) || '%')),
    'need', case when l.need_id is not null then jsonb_build_object('title', n.title, 'progress', change.need_progress_label(n.id), 'project', (select name from change.project where id = n.project_id)) end,
    'channels', (select coalesce(jsonb_agg(cp.channel_code), '[]') from resources.channel_post cp where cp.listing_id = l.id))
  from resources.listing l left join resources.object o on o.id = l.object_id left join resources.object_batch b on b.object_id = o.id
  left join change.need n on n.id = l.need_id
  where l.id = (p ->> 'listing_id')::uuid
$$;

create function api.q_storage_tree(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'qr_code', l.qr_code, 'parent_id', l.parent_id,
    'container', core.entity_ref(coalesce(l.space_id, l.structure_id, l.zone_id)), 'path', place.path_label(l.id),
    'count', (select count(*) from resources.object o where o.place_id = l.id and o.status in ('stored', 'collected', 'processing') and o.archived_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', resources.object_label(o.id, a.quantity), 'cover', core.cover(o.id),
                'status_since', coalesce(a.status_since, o.status_since))), '[]')
              from resources.object o left join resources.batch_allocation a on a.object_id = o.id and a.place_id = l.id and a.status in ('stored', 'collected', 'processing')
              where (o.place_id = l.id and o.status in ('stored', 'collected', 'processing') and not exists (select 1 from resources.object_batch b where b.object_id = o.id))
                 or a.id is not null)) order by l.sort, l.name), '[]')
  from place.storage_location l where l.site_id = core.qsite(p) and l.archived_at is null
$$;

-- ------------------------------------------------------------------ Platser
create function api.q_places(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'zones', (select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'type_code', z.type_code, 'pz', z.permaculture_zone,
                'status', z.status, 'reality_mode', z.reality_mode, 'parent_id', z.parent_zone_id, 'has_geom', z.geom is not null, 'cover', core.cover(z.id)) order by z.name), '[]')
              from place.zone z where z.site_id = core.qsite(p) and z.archived_at is null),
    'structures', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'type_code', s.type_code, 'pz', s.permaculture_zone,
                     'status', s.status, 'reality_mode', s.reality_mode, 'zone_id', s.zone_id, 'has_geom', s.geom is not null, 'cover', core.cover(s.id)) order by s.name), '[]')
                   from place.structure s where s.site_id = core.qsite(p) and s.archived_at is null),
    'spaces', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'type_code', s.type_code, 'structure_id', s.structure_id, 'zone_id', s.zone_id) order by s.name), '[]')
               from place.space s where s.site_id = core.qsite(p) and s.archived_at is null),
    'storage_count', (select count(*) from place.storage_location where site_id = core.qsite(p) and archived_at is null),
    'localities', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'municipality', l.municipality,
                     'people', (select count(*) from people.person pe where pe.locality_id = l.id and pe.archived_at is null),
                     'places', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'kind_code', e.kind_code) order by e.name), '[]')
                                from place.external_place e where e.locality_id = l.id and e.archived_at is null)) order by l.name), '[]')
                   from place.locality l where l.site_id = core.qsite(p) and l.archived_at is null),
    'external_without_locality', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'kind_code', e.kind_code)), '[]')
                                  from place.external_place e where e.site_id = core.qsite(p) and e.locality_id is null and e.archived_at is null))
$$;

create function api.q_place(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_type text := (select entity_type from core.entity where id = v_id);
  v_base jsonb;
begin
  if v_type is null then return null; end if;
  v_base := case v_type
    when 'zone' then (select jsonb_build_object('name', z.name, 'type_code', z.type_code, 'pz', z.permaculture_zone, 'status', z.status,
                        'reality_mode', z.reality_mode, 'description', z.description, 'parent', core.entity_ref(z.parent_zone_id),
                        'geometry', extensions.st_asgeojson(z.geom)::jsonb,
                        'area_m2', round(extensions.st_area(z.geom::extensions.geography)::numeric)) from place.zone z where z.id = v_id)
    when 'structure' then (select jsonb_build_object('name', s.name, 'type_code', s.type_code, 'pz', s.permaculture_zone, 'status', s.status,
                        'reality_mode', s.reality_mode, 'description', s.description, 'parent', core.entity_ref(s.zone_id),
                        'geometry', extensions.st_asgeojson(s.geom)::jsonb) from place.structure s where s.id = v_id)
    when 'space' then (select jsonb_build_object('name', s.name, 'type_code', s.type_code, 'description', s.description, 'properties', s.properties,
                        'parent', core.entity_ref(coalesce(s.structure_id, s.zone_id)), 'geometry', extensions.st_asgeojson(s.geom)::jsonb,
                        'accommodations', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'capacity', a.capacity, 'active', a.active)), '[]')
                                           from hospitality.accommodation a where a.space_id = s.id),
                        'facilities', (select coalesce(jsonb_agg(distinct f.facility_code), '[]') from hospitality.accommodation a
                                       join hospitality.accommodation_facility f on f.accommodation_id = a.id where a.space_id = s.id))
                       from place.space s where s.id = v_id)
    when 'storage_location' then (select jsonb_build_object('name', l.name, 'qr_code', l.qr_code, 'description', l.description,
                        'parent', core.entity_ref(coalesce(l.parent_id, l.space_id, l.structure_id, l.zone_id))) from place.storage_location l where l.id = v_id)
    when 'external_place' then (select jsonb_build_object('name', e.name, 'kind_code', e.kind_code, 'description', e.description,
                        'parent', core.entity_ref(e.locality_id),
                        'private', (select jsonb_build_object('address', x.address, 'note', x.note) from place.external_place_private x where x.external_place_id = e.id),
                        'acquisitions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'object', core.entity_ref(a.object_id), 'label', resources.object_label(a.object_id),
                                           'type', a.type, 'status', a.status, 'created_at', a.created_at)), '[]') from resources.acquisition a where a.external_place_id = e.id),
                        'disposals', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', resources.object_label(d.object_id, d.quantity), 'type', d.type,
                                           'occurred_at', d.occurred_at)), '[]') from resources.disposal d where d.external_place_id = e.id),
                        'pickups', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'scheduled_on', x.scheduled_on)), '[]')
                                    from resources.pickup x where x.external_place_id = e.id))
                       from place.external_place e where e.id = v_id)
    when 'locality' then (select jsonb_build_object('name', l.name, 'municipality', l.municipality, 'county', l.county,
                        'people', (select coalesce(jsonb_agg(core.person_brief(pe.id) order by pe.display_name), '[]') from people.person pe where pe.locality_id = l.id and pe.archived_at is null),
                        'external_places', (select coalesce(jsonb_agg(core.entity_ref(e.id)), '[]') from place.external_place e where e.locality_id = l.id and e.archived_at is null),
                        'flows_in', (select count(*) from resources.acquisition a join place.external_place e on e.id = a.external_place_id where e.locality_id = l.id),
                        'flows_out', (select count(*) from resources.disposal d join place.external_place e on e.id = d.external_place_id where e.locality_id = l.id))
                       from place.locality l where l.id = v_id)
    else '{}'::jsonb end;
  return v_base || jsonb_build_object(
    'id', v_id, 'type', v_type, 'ref', core.entity_ref(v_id), 'path', place.path_label(v_id),
    'children', (select coalesce(jsonb_agg(core.entity_ref(x.id) order by x.t), '[]') from (
                   select id, name t from place.zone where parent_zone_id = v_id and archived_at is null
                   union all select id, name from place.structure where zone_id = v_id and archived_at is null
                   union all select id, name from place.space where (structure_id = v_id or zone_id = v_id) and archived_at is null
                   union all select id, name from place.storage_location where (parent_id = v_id or space_id = v_id or structure_id = v_id or zone_id = v_id) and archived_at is null) x),
    'in_use', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', resources.object_label(o.id, a.quantity), 'cover', core.cover(o.id),
                 'place_path', place.path_label(coalesce(a.place_id, o.place_id)), 'project', core.entity_ref(coalesce(a.project_id, o.project_id)))), '[]')
               from resources.object o left join resources.batch_allocation a on a.object_id = o.id and a.status = 'in_use'
               where o.archived_at is null and ((a.id is null and o.status = 'in_use' and v_id = any (place.lineage(o.place_id)))
                                                or (a.id is not null and v_id = any (place.lineage(a.place_id))))),
    'stored', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', resources.object_label(o.id, a.quantity), 'cover', core.cover(o.id),
                 'place_path', place.path_label(coalesce(a.place_id, o.place_id)), 'since', coalesce(a.status_since, o.status_since))), '[]')
               from resources.object o left join resources.batch_allocation a on a.object_id = o.id and a.status in ('stored', 'collected', 'processing')
               where o.archived_at is null and ((a.id is null and o.status in ('stored', 'collected', 'processing') and not exists (select 1 from resources.object_batch b where b.object_id = o.id)
                                                 and v_id = any (place.lineage(o.place_id)))
                                                or (a.id is not null and v_id = any (place.lineage(a.place_id))))),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status, 'status_label', core.state_label('project', pr.status::text))), '[]')
                 from change.project pr where pr.archived_at is null and pr.place_id is not null and v_id = any (place.lineage(pr.place_id))),
    'observations', (select coalesce(jsonb_agg(jsonb_build_object('id', ob.id, 'kind_code', ob.kind_code, 'description', ob.description, 'occurred_at', ob.occurred_at,
                       'taxon', (select coalesce(swedish_name, scientific_name) from life.taxon where id = ob.taxon_id), 'certainty', ob.certainty, 'verified', ob.verified)
                       order by ob.occurred_at desc), '[]')
                     from (select * from life.observation where archived_at is null and place_id is not null and v_id = any (place.lineage(place_id))
                           order by occurred_at desc limit 20) ob),
    'media', core.media_for(v_id),
    'timeline', core.timeline(v_id, 60),
    'visions', (select coalesce(jsonb_agg(jsonb_build_object('id', vi.id, 'title', vi.title, 'statement', vi.statement, 'status', vi.status)), '[]')
                from change.vision vi where vi.subject_entity_id = v_id and vi.status in ('active', 'chosen')));
end $$;

create function api.q_map(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'features', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'layer', f.layer_code, 'entity_id', f.entity_id, 'entity_type', f.entity_type,
                   'label', f.label, 'reality_mode', f.reality_mode, 'status', f.status, 'props', f.props,
                   'geometry', extensions.st_asgeojson(f.geom, 7)::jsonb)), '[]')
                 from rm.map_feature f where f.site_id = core.qsite(p)
                   and (p -> 'layers' is null or f.layer_code in (select jsonb_array_elements_text(p -> 'layers')))),
    'basemaps', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'captured_on', b.captured_on, 'corners', b.corners,
                   'opacity', b.opacity, 'is_default', b.is_default, 'media', core.media_ref(b.media_id)) order by b.is_default desc, b.captured_on desc nulls last), '[]')
                 from place.map_basemap b where b.site_id = core.qsite(p) and b.archived_at is null),
    'overlays', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'captured_on', o.captured_on, 'corners', o.corners,
                   'opacity', o.opacity, 'layer_code', o.layer_code, 'media', core.media_ref(o.media_id)) order by o.sort, o.name), '[]')
                 from place.map_overlay o where o.site_id = core.qsite(p) and o.archived_at is null),
    'boundary', (select extensions.st_asgeojson(boundary)::jsonb from core.site where id = core.qsite(p)),
    'refreshed_at', (select max(refreshed_at) from rm.map_feature where site_id = core.qsite(p)))
$$;

-- ------------------------------------------------------------------ Projekt och journal
create function api.q_projects(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status, 'status_label', core.state_label('project', pr.status::text),
    'kind_code', pr.kind_code, 'parent', core.entity_ref(pr.parent_id), 'place', place.path_label(pr.place_id), 'cover', core.cover(pr.id),
    'needs_total', (select count(*) from change.need n where n.project_id = pr.id and n.status = 'open' and n.archived_at is null),
    'needs_met', (select count(*) from change.need n where n.project_id = pr.id and n.status = 'open' and n.archived_at is null and change.need_is_met(n.id)),
    'canvas', (select payload from rm.project_canvas where project_id = pr.id))
    order by array_position(array['active','planned','idea','paused','done']::change.project_status[], pr.status), pr.name), '[]')
  from change.project pr where pr.site_id = core.qsite(p) and pr.archived_at is null
$$;

create function api.q_project(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status, 'status_label', core.state_label('project', pr.status::text),
    'kind_code', pr.kind_code, 'description', pr.description, 'started_on', pr.started_on, 'finished_on', pr.finished_on,
    'parent', core.entity_ref(pr.parent_id), 'place', core.entity_ref(pr.place_id), 'place_path', place.path_label(pr.place_id),
    'geometry', extensions.st_asgeojson(pr.geom)::jsonb, 'vision', core.entity_ref(pr.vision_id),
    'subprojects', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status)), '[]') from change.project c where c.parent_id = pr.id and c.archived_at is null),
    'needs', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'kind_code', n.kind_code, 'quantity', n.quantity, 'unit', n.unit,
                'status', n.status, 'fulfilled', change.need_fulfilled_quantity(n.id), 'met', change.need_is_met(n.id), 'progress', change.need_progress_label(n.id),
                'fulfillments', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'quantity', f.quantity, 'source_kind', f.source_kind,
                                   'object', core.entity_ref(f.object_id), 'contribution', core.entity_ref(f.contribution_id), 'occurred_at', f.occurred_at, 'note', f.note)
                                   order by f.occurred_at), '[]') from change.need_fulfillment f where f.need_id = n.id and f.archived_at is null),
                'listings', (select coalesce(jsonb_agg(core.entity_ref(l.id)), '[]') from resources.listing l where l.need_id = n.id and l.archived_at is null))
                order by n.created_at), '[]')
              from change.need n where n.project_id = pr.id and n.archived_at is null),
    'objects_used', (select coalesce(jsonb_agg(jsonb_build_object('object_id', u.object_id, 'label', resources.object_label(u.object_id, u.quantity),
                       'type', u.type, 'occurred_at', u.occurred_at, 'cover', core.cover(u.object_id)) order by u.occurred_at), '[]')
                     from resources.usage_event u where u.project_id = pr.id and u.type <> 'dismantled'),
    'contributors', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('person', core.person_brief(c.person_id), 'count', count(*),
                       'hours', sum(c.hours), 'types', jsonb_agg(distinct c.type_code)) x
                     from people.contribution c where c.project_id = pr.id and c.person_id is not null group by c.person_id) y),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'status', t.status)), '[]')
              from core.task t where t.subject_entity_id = pr.id and t.status in ('open', 'in_progress', 'snoozed')),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'question', d.question, 'choice', d.choice, 'decided_at', d.decided_at)), '[]')
                  from change.decision d where d.project_id = pr.id),
    'canvas', (select payload from rm.project_canvas where project_id = pr.id),
    'media', core.media_for(pr.id), 'timeline', core.timeline(pr.id))
  from change.project pr where pr.id = (p ->> 'id')::uuid
$$;

create function api.q_journal(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'occurred_at', e.occurred_at, 'summary', e.summary, 'note', e.note,
    'story_value', e.story_value, 'place', core.entity_ref(e.place_id), 'place_path', place.path_label(e.place_id),
    'links', (select coalesce(jsonb_agg(core.entity_ref(l.entity_id) || jsonb_build_object('role', l.role)), '[]')
              from core.history_event_link l where l.event_id = e.id and l.role <> 'place_ancestor'),
    'media', core.media_for(e.id)) order by e.occurred_at desc), '[]')
  from (select e.* from core.history_event e
        where e.site_id = core.qsite(p) and e.archived_at is null
          and (nullif(p ->> 'place_id', '') is null or exists (select 1 from core.history_event_link l where l.event_id = e.id and l.entity_id = (p ->> 'place_id')::uuid))
          and (nullif(p ->> 'entity_id', '') is null or exists (select 1 from core.history_event_link l where l.event_id = e.id and l.entity_id = (p ->> 'entity_id')::uuid))
          and (nullif(p ->> 'type', '') is null or e.event_type like (p ->> 'type') || '%')
          and (nullif(p ->> 'from', '') is null or e.occurred_at >= (p ->> 'from')::timestamptz)
          and (nullif(p ->> 'to', '') is null or e.occurred_at < (p ->> 'to')::timestamptz)
          and (not coalesce((p ->> 'story_only')::boolean, false) or e.story_value)
          and (nullif(p ->> 'q', '') is null or e.summary ilike '%' || (p ->> 'q') || '%' or e.note ilike '%' || (p ->> 'q') || '%')
        order by e.occurred_at desc limit coalesce((p ->> 'limit')::integer, 100)) e
$$;

create function api.q_event(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'event_type', e.event_type, 'occurred_at', e.occurred_at, 'recorded_at', e.recorded_at, 'summary', e.summary,
    'note', e.note, 'story_value', e.story_value, 'visibility', e.visibility, 'place', core.entity_ref(e.place_id), 'place_path', place.path_label(e.place_id),
    'links', (select coalesce(jsonb_agg(core.entity_ref(l.entity_id) || jsonb_build_object('role', l.role)), '[]') from core.history_event_link l where l.event_id = e.id),
    'media', core.media_for(e.id))
  from core.history_event e where e.id = (p ->> 'id')::uuid
$$;

create function api.q_tasks(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'kind', t.kind, 'status', t.status, 'due_at', t.due_at, 'note', t.note,
    'subject', core.entity_ref(t.subject_entity_id), 'next', core.allowed_next('task', t.status::text)) order by t.due_at nulls last), '[]')
  from core.task t where t.site_id = core.qsite(p) and t.archived_at is null
    and (case coalesce(p ->> 'scope', 'open') when 'open' then t.status in ('open', 'in_progress', 'snoozed') when 'done' then t.status in ('done', 'cancelled') else true end)
$$;

-- ------------------------------------------------------------------ Människor
create function api.q_people(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(core.person_brief(pe.id) || jsonb_build_object(
      'relationship', (select payload from rm.person_relationship where person_id = pe.id),
      'organizations', (select coalesce(jsonb_agg(o.name), '[]') from people.person_organization po join people.organization o on o.id = po.organization_id where po.person_id = pe.id))
    order by pe.display_name), '[]')
  from people.person pe
  where pe.site_id = core.qsite(p) and (pe.archived_at is null or coalesce((p ->> 'include_archived')::boolean, false))
    and (nullif(p ->> 'role', '') is null or exists (select 1 from people.person_role r where r.person_id = pe.id and r.role_code = p ->> 'role'))
    and (nullif(p ->> 'q', '') is null or pe.display_name ilike '%' || (p ->> 'q') || '%' or pe.nickname ilike '%' || (p ->> 'q') || '%')
$$;

create function api.q_person(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select core.person_brief(pe.id) || jsonb_build_object(
    'nickname', pe.nickname, 'how_we_met', pe.how_we_met, 'social_profiles', pe.social_profiles, 'locality_id', pe.locality_id,
    'visibility', pe.visibility, 'created_at', pe.created_at, 'archived_at', pe.archived_at,
    'consent_detail', (select jsonb_build_object('name', c.name, 'image', c.image, 'contribution', c.contribution, 'given_at', c.given_at,
                         'given_how', c.given_how, 'note', c.note) from people.consent_policy c where c.person_id = pe.id),
    'private', (select jsonb_build_object('phone', x.phone, 'email', x.email, 'address', x.address, 'notes', x.notes, 'reliability_note', x.reliability_note)
                from people.person_private x where x.person_id = pe.id),
    'organizations', (select coalesce(jsonb_agg(core.entity_ref(po.organization_id) || jsonb_build_object('role_title', po.role_title)), '[]')
                      from people.person_organization po where po.person_id = pe.id),
    'relations', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind_code', r.kind_code, 'note', r.note,
                    'direction', case when r.person_id = pe.id then 'out' else 'in' end,
                    'other', core.person_brief(case when r.person_id = pe.id then r.other_person_id else r.person_id end))), '[]')
                  from people.person_relation r where r.person_id = pe.id or r.other_person_id = pe.id),
    'interactions', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'channel_code', i.channel_code, 'occurred_at', i.occurred_at,
                       'summary', i.summary, 'body', i.body) order by i.occurred_at desc), '[]') from people.interaction i where i.person_id = pe.id),
    'contributions', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type_code', c.type_code, 'description', c.description, 'amount', c.amount,
                        'unit', c.unit, 'hours', c.hours, 'occurred_at', c.occurred_at, 'project', core.entity_ref(c.project_id),
                        'subject', core.entity_ref(c.subject_entity_id), 'thanked_at', c.thanked_at) order by c.occurred_at desc), '[]')
                      from people.contribution c where c.person_id = pe.id and c.archived_at is null),
    'reciprocity', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'type_code', r.type_code, 'description', r.description, 'occurred_at', r.occurred_at)
                      order by r.occurred_at desc), '[]') from people.reciprocity_entry r where r.person_id = pe.id),
    'objects_from', (select coalesce(jsonb_agg(jsonb_build_object('acquisition_id', a.id, 'object_id', a.object_id, 'label', resources.object_label(a.object_id),
                       'type', a.type, 'status', a.status, 'object_status', o.status, 'object_status_label', core.state_label('object', o.status::text),
                       'place_path', place.path_label(o.place_id), 'cover', core.cover(a.object_id), 'price', ap.price, 'created_at', a.created_at) order by a.created_at desc), '[]')
                     from resources.acquisition a join resources.object o on o.id = a.object_id
                     left join resources.acquisition_private ap on ap.acquisition_id = a.id where a.counterpart_person_id = pe.id),
    'objects_to', (select coalesce(jsonb_agg(jsonb_build_object('disposal_id', d.id, 'object_id', d.object_id, 'label', resources.object_label(d.object_id, d.quantity),
                     'type', d.type, 'occurred_at', d.occurred_at, 'price', dp.price) order by d.occurred_at desc), '[]')
                   from resources.disposal d left join resources.disposal_private dp on dp.disposal_id = d.id where d.counterpart_person_id = pe.id),
    'tipped', (select coalesce(jsonb_agg(core.entity_ref(a.object_id)), '[]') from resources.acquisition a where a.tipster_person_id = pe.id),
    'relationship', (select payload from rm.person_relationship where person_id = pe.id),
    'stays', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'starts_on', s.starts_on, 'ends_on', s.ends_on, 'status', s.status,
                'accommodation', core.entity_ref(s.accommodation_id)) order by s.starts_on desc), '[]') from hospitality.stay s where s.person_id = pe.id),
    'vehicles', (select coalesce(jsonb_agg(core.entity_ref(v.id)), '[]') from resources.vehicle_machine v where v.owner_person_id = pe.id),
    'capabilities', (select coalesce(jsonb_agg(jsonb_build_object('kind_code', c.kind_code, 'value', c.value, 'unit', c.unit, 'note', c.note)), '[]')
                     from people.capability c where c.holder_entity_id = pe.id),
    'stories', (select coalesce(jsonb_agg(jsonb_build_object('id', ci.id, 'title', ci.title, 'status', ci.status, 'shared_at', ci.shared_at)), '[]')
                from story.content_item ci where pe.id = any (ci.person_ids)),
    'media', core.media_for(pe.id),
    'timeline', core.timeline(pe.id))
  from people.person pe where pe.id = (p ->> 'id')::uuid
$$;

create function api.q_organizations(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'kind_code', o.kind_code, 'locality', (select name from place.locality where id = o.locality_id),
    'members', (select count(*) from people.person_organization po where po.organization_id = o.id)) order by o.name), '[]')
  from people.organization o where o.site_id = core.qsite(p) and o.archived_at is null
    and (nullif(p ->> 'q', '') is null or o.name ilike '%' || (p ->> 'q') || '%')
$$;

create function api.q_organization(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'kind_code', o.kind_code, 'description', o.description,
    'locality', core.entity_ref(o.locality_id),
    'private', (select jsonb_build_object('phone', x.phone, 'email', x.email, 'address', x.address, 'notes', x.notes) from people.organization_private x where x.organization_id = o.id),
    'members', (select coalesce(jsonb_agg(core.person_brief(po.person_id) || jsonb_build_object('role_title', po.role_title)), '[]')
                from people.person_organization po where po.organization_id = o.id),
    'objects_from', (select coalesce(jsonb_agg(jsonb_build_object('object_id', a.object_id, 'label', resources.object_label(a.object_id), 'cover', core.cover(a.object_id),
                       'via', core.entity_ref(a.counterpart_person_id))), '[]')
                     from resources.acquisition a where a.counterpart_organization_id = o.id
                        or a.counterpart_person_id in (select person_id from people.person_organization where organization_id = o.id)),
    'vehicles', (select coalesce(jsonb_agg(core.entity_ref(v.id)), '[]') from resources.vehicle_machine v where v.owner_organization_id = o.id),
    'timeline', core.timeline(o.id))
  from people.organization o where o.id = (p ->> 'id')::uuid
$$;

-- ------------------------------------------------------------------ sök
create function api.q_search(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(core.entity_ref(x.entity_id) || jsonb_build_object('snippet', x.snippet, 'rank', x.rank) order by x.rank desc), '[]') from (
    select d.entity_id, left(d.body, 160) as snippet,
      greatest(ts_rank(d.tsv, websearch_to_tsquery('swedish', p ->> 'q')), extensions.similarity(d.title, p ->> 'q'),
               case when d.title ilike '%' || (p ->> 'q') || '%' then 0.5 else 0 end) as rank
    from core.search_document d
    where d.site_id = core.qsite(p) and d.archived_at is null and coalesce(p ->> 'q', '') <> ''
      and (p -> 'types' is null or d.entity_type in (select jsonb_array_elements_text(p -> 'types')))
      and (d.tsv @@ websearch_to_tsquery('swedish', p ->> 'q') or d.title operator(extensions.%) (p ->> 'q') or d.title ilike '%' || (p ->> 'q') || '%'
           or d.body ilike '%' || (p ->> 'q') || '%')
    order by rank desc limit coalesce((p ->> 'limit')::integer, 25)) x
$$;

create function api.q_entity(p jsonb) returns jsonb
language sql stable set search_path = '' as $$ select core.entity_ref((p ->> 'id')::uuid) $$;

-- ------------------------------------------------------------------ Berätta
create function api.q_content_list(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'goal_code', c.goal_code, 'status', c.status,
    'status_label', core.state_label('content', c.status::text), 'updated_at', c.updated_at, 'shared_at', c.shared_at,
    'channels', (select coalesce(jsonb_agg(v.channel_code), '[]') from story.channel_variant v where v.content_id = c.id)) order by c.updated_at desc), '[]')
  from story.content_item c where c.site_id = core.qsite(p) and c.archived_at is null
    and (nullif(p ->> 'source_id', '') is null or (p ->> 'source_id')::uuid = any (c.source_ids))
$$;

create function api.q_content(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'goal_code', c.goal_code, 'status', c.status, 'status_label', core.state_label('content', c.status::text),
    'source_ids', c.source_ids, 'sources', (select coalesce(jsonb_agg(core.entity_ref(s)), '[]') from unnest(c.source_ids) s),
    'persons', (select coalesce(jsonb_agg(core.person_brief(s) || jsonb_build_object('post_consent',
                  (select coalesce(jsonb_object_agg(cc.aspect, cc.value), '{}') from people.content_consent cc where cc.content_item_id = c.id and cc.person_id = s))), '[]')
                from unnest(c.person_ids) s),
    'variants', (select coalesce(jsonb_agg(jsonb_build_object('channel_code', v.channel_code, 'body', v.body, 'media_ids', v.media_ids, 'tone', v.tone,
                   'cta', v.cta, 'removed_by_guard', v.removed_by_guard, 'warnings', v.warnings,
                   'media', (select coalesce(jsonb_agg(core.media_ref(m)), '[]') from unnest(v.media_ids) m)) order by v.channel_code), '[]')
                 from story.channel_variant v where v.content_id = c.id),
    'approved_at', c.approved_at, 'shared_at', c.shared_at, 'shared_url', c.shared_url, 'shared_channels', c.shared_channels,
    'period_start', c.period_start, 'period_end', c.period_end, 'next', core.allowed_next('content', c.status::text))
  from story.content_item c where c.id = (p ->> 'id')::uuid
$$;

-- Råmaterialet som Privacy Guard (deterministisk kod i appen och serverfunktionerna) får ta ställning till.
-- Radnivåsäkerheten har redan filtrerat bort det användaren inte får se.
create function api.q_story_context(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'site', (select jsonb_build_object('name', name) from core.site where id = core.qsite(p)),
    'sources', (select coalesce(jsonb_agg(core.entity_ref(s) || jsonb_build_object(
        'visibility', (select visibility from core.entity where id = s),
        'facts', case (select entity_type from core.entity where id = s)
          when 'object' then (select jsonb_build_object('title', o.title, 'label', resources.object_label(o.id), 'material', o.material, 'age_period', o.age_period,
                                'condition', o.condition, 'dimensions', o.dimensions, 'status', o.status, 'status_label', core.state_label('object', o.status::text),
                                'story_why', o.story_why, 'place', pub.zone_label(o.place_id), 'living', o.living_material, 'health', o.health_status,
                                'usage', (select coalesce(jsonb_agg(jsonb_build_object('type', u.type, 'occurred_at', u.occurred_at, 'place', pub.zone_label(u.place_id),
                                            'project', (select name from change.project where id = u.project_id))), '[]') from resources.usage_event u where u.object_id = o.id),
                                'from_locality', (select l.name from resources.acquisition a join people.person pe on pe.id = a.counterpart_person_id
                                                  join place.locality l on l.id = pe.locality_id where a.object_id = o.id limit 1))
                              from resources.object o where o.id = s)
          when 'history_event' then (select jsonb_build_object('summary', e.summary, 'note', e.note, 'occurred_at', e.occurred_at, 'place', pub.zone_label(e.place_id),
                                       'event_type', e.event_type) from core.history_event e where e.id = s)
          when 'project' then (select jsonb_build_object('name', pr.name, 'status', pr.status, 'description', pr.description,
                                 'needs', (select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'progress', change.need_progress_label(n.id))), '[]')
                                           from change.need n where n.project_id = pr.id and n.status = 'open')) from change.project pr where pr.id = s)
          when 'zone' then (select jsonb_build_object('name', z.name, 'description', z.description, 'type_code', z.type_code) from place.zone z where z.id = s)
          when 'structure' then (select jsonb_build_object('name', x.name, 'description', x.description, 'type_code', x.type_code) from place.structure x where x.id = s)
          when 'person' then (select jsonb_build_object('display_name', pe.display_name) from people.person pe where pe.id = s)
          when 'listing' then (select jsonb_build_object('title', l.title, 'description', l.description, 'type', l.type, 'price', l.price) from resources.listing l where l.id = s)
          else '{}'::jsonb end,
        'timeline', (select coalesce(jsonb_agg(jsonb_build_object('summary', e.summary, 'occurred_at', e.occurred_at, 'event_type', e.event_type) order by e.occurred_at), '[]')
                     from core.history_event e join core.history_event_link l on l.event_id = e.id where l.entity_id = s and e.visibility <> 'private'))), '[]')
      from unnest(coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'source_ids') x), '{}')) s),
    'people', (select coalesce(jsonb_agg(distinct core.person_brief(x.pid)), '[]') from (
        select a.counterpart_person_id pid from resources.acquisition a where a.object_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid)
        union select c.person_id from people.contribution c where c.subject_entity_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid)
           or c.project_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid)
        union select l.entity_id from core.history_event_link l where l.entity_type = 'person' and l.event_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid)
        union select (jsonb_array_elements_text(p -> 'source_ids'))::uuid where exists (select 1 from people.person where id::text in (select jsonb_array_elements_text(p -> 'source_ids')))
        union select (jsonb_array_elements_text(coalesce(p -> 'person_ids', '[]')))::uuid) x where x.pid is not null
          and exists (select 1 from people.person where id = x.pid)),
    'contributions', (select coalesce(jsonb_agg(jsonb_build_object('person_id', c.person_id, 'type_code', c.type_code, 'description', c.description,
                        'hours', c.hours, 'occurred_at', c.occurred_at)), '[]')
                      from people.contribution c where c.subject_entity_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid)
                         or c.project_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid)
                         or c.person_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid)),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'text', n.text, 'person_id', n.person_id, 'quote_consent', n.quote_consent)), '[]')
              from story.story_note n where n.entity_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid) and n.archived_at is null),
    'media', (select coalesce(jsonb_agg(distinct core.media_ref(l.media_id) || jsonb_build_object('role', l.role,
                'depicts', (select coalesce(jsonb_agg(jsonb_build_object('person_id', l2.entity_id,
                              'image_consent', (select image from people.consent_policy where person_id = l2.entity_id))), '[]')
                            from core.media_link l2 where l2.media_id = l.media_id and l2.role in ('depicts', 'avatar')))), '[]')
              from core.media_link l join core.media m on m.id = l.media_id
              where l.entity_id in (select (jsonb_array_elements_text(p -> 'source_ids'))::uuid) and m.kind = 'photo' and m.archived_at is null))
$$;

-- Förhandsvisning av den sista kontrollen (S9 steg 4). Bara ägare och medhjälpare.
create function api.q_privacy_check(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_site uuid := core.qsite(p);
  v_content story.content_item;
  v_out jsonb := '[]';
  v_v story.channel_variant;
begin
  if core.my_role(v_site) not in ('owner', 'helper') then raise exception 'forbidden: Bara ägare och medhjälpare' using errcode = '42501'; end if;
  if nullif(p ->> 'content_id', '') is not null then
    select * into v_content from story.content_item where id = (p ->> 'content_id')::uuid and site_id = v_site;
    for v_v in select * from story.channel_variant where content_id = v_content.id loop
      v_out := v_out || jsonb_build_object('channel_code', v_v.channel_code,
        'violations', story.privacy_violations(v_site, v_v.body, v_v.media_ids, v_content.person_ids, v_content.id));
    end loop;
    return v_out;
  end if;
  return story.privacy_violations(v_site, p ->> 'text',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'media_ids') x), '{}'),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p -> 'person_ids') x), '{}'), null,
    coalesce((p ->> 'listing')::boolean, false));
end $$;

-- ------------------------------------------------------------------ Inställningar, synk, audit, export
create function api.q_settings(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'site', (select jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description, 'timezone', s.timezone,
                                       'approx_lat', s.approx_lat, 'approx_lon', s.approx_lon) from core.site s where s.id = core.qsite(p)),
    'private', (select jsonb_build_object('address', x.address, 'property_designation', x.property_designation) from core.site_private x where x.site_id = core.qsite(p)),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('membership_id', m.id, 'user_id', m.user_id, 'role', m.role, 'display_name', m.display_name,
                  'created_at', m.created_at, 'via_link', m.guest_link_id is not null) order by m.created_at), '[]')
                from core.membership m where m.site_id = core.qsite(p) and m.revoked_at is null),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label, 'role', g.role, 'uses', g.uses, 'last_used_at', g.last_used_at,
                'closed_at', g.closed_at, 'created_at', g.created_at, 'expires_at', g.expires_at) order by g.created_at desc), '[]')
              from core.guest_link g where g.site_id = core.qsite(p)),
    'flags', (select coalesce(jsonb_agg(jsonb_build_object('flag', cv.code, 'label', cv.label_sv, 'release', cv.attributes ->> 'release',
                'enabled', coalesce(f.enabled, cv.code = 'core')) order by cv.sort), '[]')
              from core.code_value cv left join core.feature_flag f on f.site_id = core.qsite(p) and f.flag = cv.code where cv.list_code = 'feature' and cv.site_id is null),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}') from core.site_setting where site_id = core.qsite(p)),
    'code_lists', (select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'label', l.label_sv, 'description', l.description, 'extensible', l.site_extensible,
                     'values', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code, 'label', v.label_sv, 'site', v.site_id is not null,
                                  'archived', v.archived_at is not null, 'attributes', v.attributes, 'parent', v.parent_code) order by v.sort, v.label_sv), '[]')
                                from core.code_value v where v.list_code = l.code and (v.site_id is null or v.site_id = core.qsite(p)))) order by l.label_sv), '[]')
                   from core.code_list l where l.code not in ('feature', 'default_category')),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'parent_id', c.parent_id, 'co2e_per_kg', c.co2e_per_kg) order by c.name), '[]')
                   from resources.category c where c.site_id = core.qsite(p) and c.archived_at is null),
    'checklist_templates', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'items', t.items)), '[]')
                            from resources.checklist_template t where t.site_id = core.qsite(p) and t.archived_at is null),
    'ai_usage', (select coalesce(jsonb_agg(jsonb_build_object('function_name', u.function_name, 'month', u.month, 'calls', u.calls,
                   'input_tokens', u.input_tokens, 'output_tokens', u.output_tokens, 'cost_usd', u.cost_usd) order by u.month desc, u.function_name), '[]')
                 from core.ai_usage u where u.site_id = core.qsite(p) and u.month > now() - interval '6 months'),
    'rejected_commands', (select count(*) from core.domain_command where site_id = core.qsite(p) and status = 'rejected' and resolved_at is null),
    'jobs', (select jsonb_build_object('pending', count(*) filter (where status = 'pending'), 'failed', count(*) filter (where status = 'failed'))
             from core.job where site_id = core.qsite(p)))
$$;

create function api.q_sync_issues(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'command_type', d.command_type, 'label', c.label_sv, 'payload', d.payload,
    'reason', d.rejection_reason, 'suggestion', d.result -> 'suggestion', 'client_time', d.client_time, 'received_at', d.received_at, 'origin', d.origin)
    order by d.received_at desc), '[]')
  from core.domain_command d left join core.command_catalog c on c.command_type = d.command_type and c.version = d.version
  where d.site_id = core.qsite(p) and d.status = 'rejected' and d.resolved_at is null and d.issued_by = auth.uid()
    and (coalesce((p ->> 'all')::boolean, false) or d.origin = 'offline')
$$;

create function api.q_audit(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'occurred_at', a.occurred_at, 'actor_id', a.actor_id,
    'actor', (select display_name from core.membership m where m.user_id = a.actor_id and m.site_id = a.site_id limit 1),
    'command_id', a.command_id, 'command_type', (select command_type from core.domain_command where id = a.command_id),
    'table_name', a.table_name, 'row_id', a.row_id, 'operation', a.operation, 'before', a.before, 'after', a.after,
    'agent', a.agent, 'approved_by', a.approved_by) order by a.id desc), '[]')
  from (select * from core.audit_entry a where a.site_id = core.qsite(p)
          and (nullif(p ->> 'row_id', '') is null or a.row_id = p ->> 'row_id')
          and (nullif(p ->> 'command_id', '') is null or a.command_id = (p ->> 'command_id')::uuid)
        order by a.id desc limit coalesce((p ->> 'limit')::integer, 100)) a
$$;

-- Export (AC-16): alla registrerade tabeller som JSON, sida för sida, med användarens behörighet.
create function api.q_export(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_site uuid := core.qsite(p);
  v_table text := p ->> 'table';
  v_out jsonb;
  v_has_site boolean;
begin
  if core.my_role(v_site) <> 'owner' then raise exception 'forbidden: Bara ägaren exporterar' using errcode = '42501'; end if;
  if v_table is null then
    return (select jsonb_agg(table_name order by table_name) from core.table_registry where policy_class not in ('none'));
  end if;
  if not exists (select 1 from core.table_registry where table_name = v_table and policy_class <> 'none') then
    raise exception 'not_found: Okänd tabell';
  end if;
  select exists (select 1 from pg_attribute where attrelid = v_table::regclass and attname = 'site_id' and not attisdropped) into v_has_site;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from (select * from %s %s order by 1 limit %s offset %s) t',
                 v_table::regclass, case when v_has_site then format('where site_id = %L or site_id is null', v_site) else '' end,
                 least(coalesce((p ->> 'limit')::integer, 1000), 5000), coalesce((p ->> 'offset')::integer, 0))
    into v_out;
  return v_out;
end $$;

-- ------------------------------------------------------------------ gästvy och publika ytor
create function api.q_guest_home(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'site', (select jsonb_build_object('name', name, 'description', description) from core.site where id = core.qsite(p)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'entity_id', g.entity_id, 'title', g.title, 'summary', g.summary,
                'image_path', g.image_path, 'place_label', g.place_label, 'status_label', g.status_label, 'occurred_at', g.occurred_at, 'payload', g.payload)
                order by g.sort, g.occurred_at desc nulls last), '[]') from pub.guest_item g where g.site_id = core.qsite(p)))
$$;

-- VRETA Live och Bo på Vreta (R2.7): bara projektioner, ingen inloggning.
create function api.q_live(p jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'site', jsonb_build_object('name', s.name, 'description', s.description, 'slug', s.slug),
    'happening', (select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'place', l.place_label, 'date', l.occurred_at) order by l.occurred_at desc), '[]')
                  from pub.live_item l where l.site_id = s.id and l.section = 'happening'),
    'new_life', (select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'image_path', l.image_path, 'place', l.place_label)), '[]')
                 from pub.live_item l where l.site_id = s.id and l.section = 'new_life'),
    'life', (select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'summary', l.summary)), '[]') from pub.live_item l where l.site_id = s.id and l.section = 'life'),
    'wanted', (select coalesce(jsonb_agg(jsonb_build_object('listing_id', w.listing_id, 'need_id', w.need_id, 'title', w.title, 'description', w.description,
                 'progress', w.quantity_label, 'locality', w.locality)), '[]') from pub.wanted w where w.site_id = s.id),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('name', pp.display_name, 'roles', pp.roles, 'contribution', pp.contribution_summary, 'image_path', pp.image_path)), '[]')
               from pub.person pp where pp.site_id = s.id),
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'starts_at', e.starts_at,
                   'ends_at', e.ends_at, 'place', e.place_label) order by e.starts_at), '[]') from pub.hosted_event e where e.site_id = s.id),
    'stay', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'description', a.description, 'capacity', a.capacity,
               'facilities', a.facilities, 'season', a.season)), '[]') from pub.accommodation a where a.site_id = s.id),
    'stories', (select coalesce(jsonb_agg(jsonb_build_object('title', st.title, 'body', st.body, 'image_paths', st.image_paths, 'shared_at', st.shared_at)
                  order by st.shared_at desc), '[]') from pub.story st where st.site_id = s.id),
    'tours', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'intro', t.intro)), '[]') from pub.tour t where t.site_id = s.id))
  from core.site s where (s.slug = p ->> 'site' or s.id::text = p ->> 'site') and core.feature_enabled(s.id, 'live')
$$;

create function api.q_public_tour(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'title', t.title, 'intro', t.intro, 'mode', t.mode, 'length_m', t.length_m, 'surface', t.surface,
    'accessibility_note', t.accessibility_note, 'estimated_minutes', t.estimated_minutes, 'route', extensions.st_asgeojson(t.route_geom)::jsonb,
    'stops', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ordinal', s.ordinal, 'title', s.title, 'what_is_this', s.what_is_this,
                'what_happened', s.what_happened, 'how_now', s.how_now, 'what_future', s.what_future, 'media', s.media,
                'point', extensions.st_asgeojson(s.point)::jsonb) order by s.ordinal), '[]') from pub.tour_stop s where s.tour_id = t.id))
  from pub.tour t where t.id = (p ->> 'id')::uuid
$$;

-- ------------------------------------------------------------------ senare releaser (läsning finns från R2.0)
create function api.q_pulse(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'signals', (select coalesce(jsonb_agg(jsonb_build_object('domain', s.domain, 'summary', s.summary, 'attention', s.attention)), '[]')
                from rm.pulse_signal s where s.site_id = core.qsite(p) and s.period = coalesce(p ->> 'period', 'month')),
    'years', (select coalesce(jsonb_agg(jsonb_build_object('year', y.year, 'payload', y.payload) order by y.year desc), '[]')
              from rm.year_timeline y where y.site_id = core.qsite(p)))
$$;

create function api.q_weather(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('now', core.weather_at(core.qsite(p), now()), 'signals', core.weather_signals(core.qsite(p), coalesce((p ->> 'hours')::integer, 48)),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('valid_from', f.valid_from, 'data', f.data, 'issued_at', f.issued_at) order by f.valid_from), '[]')
              from (select distinct on (valid_from) * from core.weather_forecast where site_id = core.qsite(p)
                      and valid_from between now() and now() + interval '48 hours' order by valid_from, issued_at desc) f))
$$;

create function api.q_life(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('summary', (select payload from rm.life_summary where site_id = core.qsite(p)),
    'animals', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'taxon', (select swedish_name from life.taxon where id = a.taxon_id),
                  'status', a.status, 'place', place.path_label(a.place_id))), '[]') from life.animal_individual a where a.site_id = core.qsite(p) and a.archived_at is null),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'estimated_count', g.estimated_count)), '[]')
               from life.resident_group g where g.site_id = core.qsite(p) and g.archived_at is null),
    'presence', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'taxon', jsonb_build_object('id', t.id, 'swedish_name', t.swedish_name, 'scientific_name', t.scientific_name),
                   'presence_pattern', s.presence_pattern, 'reproduction_status', s.reproduction_status, 'place', place.path_label(s.place_id),
                   'supporting_observations', s.supporting_observation_count)), '[]')
                 from life.species_presence s join life.taxon t on t.id = s.taxon_id where s.site_id = core.qsite(p) and s.archived_at is null),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'occurred_at', o.occurred_at, 'description', o.description, 'certainty', o.certainty,
                 'verified', o.verified, 'taxon', (select coalesce(swedish_name, scientific_name) from life.taxon where id = o.taxon_id),
                 'taxon_suggestion', o.taxon_suggestion, 'place', place.path_label(o.place_id)) order by o.occurred_at desc), '[]')
               from (select * from life.observation where site_id = core.qsite(p) and archived_at is null order by occurred_at desc limit 50) o),
    'taxa', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'swedish_name', t.swedish_name, 'scientific_name', t.scientific_name, 'group', t.organism_group)
               order by coalesce(t.swedish_name, t.scientific_name)), '[]') from life.taxon t where t.site_id is null or t.site_id = core.qsite(p)))
$$;

create function api.q_vehicles(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'kind_code', v.kind_code, 'status', v.status, 'owner_kind', v.owner_kind,
    'owner', core.entity_ref(coalesce(v.owner_person_id, v.owner_organization_id)), 'place', place.path_label(v.place_id),
    'capabilities', (select coalesce(jsonb_agg(jsonb_build_object('kind_code', c.kind_code, 'value', c.value, 'unit', c.unit)), '[]') from people.capability c where c.holder_entity_id = v.id),
    'reservations', (select coalesce(jsonb_agg(jsonb_build_object('starts_at', r.starts_at, 'ends_at', r.ends_at, 'purpose', core.entity_ref(r.purpose_entity_id)) order by r.starts_at), '[]')
                     from resources.resource_reservation r where r.vehicle_id = v.id and r.ends_at > now() and r.status in ('requested', 'confirmed')),
    'drivers', (select coalesce(jsonb_agg(core.entity_ref(a.person_id)), '[]') from resources.vehicle_authorization a where a.vehicle_id = v.id)) order by v.name), '[]')
  from resources.vehicle_machine v where v.site_id = core.qsite(p) and v.archived_at is null
$$;

create function api.q_hospitality(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'accommodations', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'capacity', a.capacity, 'beds', a.beds, 'active', a.active,
                         'space', core.entity_ref(a.space_id), 'blocks', (select coalesce(jsonb_agg(jsonb_build_object('starts_on', b.starts_on, 'ends_on', b.ends_on, 'kind', b.kind)), '[]')
                                                     from hospitality.availability_block b where b.accommodation_id = a.id and b.ends_on >= current_date))), '[]')
                       from hospitality.accommodation a where a.site_id = core.qsite(p) and a.archived_at is null),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'requester_name', r.requester_name, 'starts_on', r.starts_on, 'ends_on', r.ends_on,
                   'party_size', r.party_size, 'message', r.message, 'status', r.status, 'accommodation', core.entity_ref(r.accommodation_id))), '[]')
                 from hospitality.stay_request r where r.site_id = core.qsite(p) and r.status = 'requested'),
    'stays', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'person', core.entity_ref(s.person_id), 'starts_on', s.starts_on, 'ends_on', s.ends_on,
                'status', s.status, 'accommodation', core.entity_ref(s.accommodation_id)) order by s.starts_on), '[]')
              from hospitality.stay s where s.site_id = core.qsite(p) and s.ends_on >= current_date - 1 and s.status <> 'cancelled'),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'title', h.title, 'starts_at', h.starts_at, 'ends_at', h.ends_at, 'status', h.status,
                 'readiness', (select payload from rm.event_readiness where hosted_event_id = h.id)) order by h.starts_at), '[]')
               from hospitality.hosted_event h where h.site_id = core.qsite(p) and h.ends_at > now() - interval '30 days'))
$$;

create function api.q_assistant_threads(p jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'updated_at', t.updated_at) order by t.updated_at desc), '[]')
  from core.assistant_thread t where t.site_id = core.qsite(p) and t.created_by = auth.uid()
$$;

create function api.q_assistant_thread(p jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'title', t.title, 'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content,
    'sources', m.sources, 'general_advice', m.general_advice, 'action_preview_id', m.action_preview_id, 'created_at', m.created_at) order by m.created_at), '[]')
    from core.assistant_message m where m.thread_id = t.id))
  from core.assistant_thread t where t.id = (p ->> 'id')::uuid
$$;

-- ------------------------------------------------------------------ Fråga Vretas verktyg
-- Strukturerade frågor besvaras med definierade verktyg, inte med fri SQL från modellen (R1.1 11.3).
-- Varje svar bär källor (INV-10). Synlighet och behörighet tillämpas av radnivåsäkerheten.
create function api.q_tool(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_tool text := p ->> 'tool';
  v_args jsonb := coalesce(p -> 'args', '{}') || jsonb_build_object('site_id', core.qsite(p));
  v_year integer := coalesce((v_args ->> 'year')::integer, extract(year from now())::integer);
  v_person uuid;
begin
  if v_tool in ('stock_from_person', 'person_network') then
    v_person := coalesce(nullif(v_args ->> 'person_id', '')::uuid,
      (select id from people.person where site_id = core.qsite(p) and archived_at is null and
         (display_name ilike (v_args ->> 'name') || '%' or display_name ilike '% ' || (v_args ->> 'name') || '%')
       order by length(display_name) limit 1));
  end if;
  return case v_tool
    when 'search' then api.q_search(v_args)
    -- "fönstren från Ockelbo": ursprunget (givarens namn, ort eller platsen saken hämtades på) filtrerar träffarna
    when 'find_object' then (select coalesce(jsonb_agg(jsonb_build_object('source', core.entity_ref(o.id), 'label', resources.object_label(o.id),
        'status', core.state_label('object', o.status::text), 'place', place.path_label(o.place_id),
        'allocations', resources.allocation_summary(o.id),
        'from', (select pe.display_name from resources.acquisition a join people.person pe on pe.id = a.counterpart_person_id where a.object_id = o.id limit 1))), '[]')
      from resources.object o where o.site_id = core.qsite(p) and o.archived_at is null
        and (o.title ilike '%' || (v_args ->> 'q') || '%' or o.description ilike '%' || (v_args ->> 'q') || '%' or o.material ilike '%' || (v_args ->> 'q') || '%'
             or exists (select 1 from core.search_document d where d.entity_id = o.id and d.tsv @@ websearch_to_tsquery('swedish', v_args ->> 'q')))
        and (nullif(v_args ->> 'origin', '') is null or exists (
             select 1 from resources.acquisition a
             left join people.person pe on pe.id = a.counterpart_person_id
             left join place.locality pl on pl.id = pe.locality_id
             left join place.external_place ep on ep.id = a.external_place_id
             left join place.locality el on el.id = ep.locality_id
             where a.object_id = o.id and (pe.display_name ilike '%' || (v_args ->> 'origin') || '%' or pl.name ilike (v_args ->> 'origin')
                                           or ep.name ilike '%' || (v_args ->> 'origin') || '%' or el.name ilike (v_args ->> 'origin')))))
    when 'stock_from_person' then (select jsonb_build_object('person', core.entity_ref(v_person), 'objects', coalesce(jsonb_agg(jsonb_build_object(
        'source', core.entity_ref(o.id), 'label', resources.object_label(o.id), 'status', core.state_label('object', o.status::text),
        'place', place.path_label(o.place_id), 'price', ap.price)), '[]'))
      from resources.acquisition a join resources.object o on o.id = a.object_id left join resources.acquisition_private ap on ap.acquisition_id = a.id
      where a.counterpart_person_id = v_person and resources.status_group(o.status) in ('home', 'in_use', 'outgoing'))
    when 'contributors' then (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('source', core.entity_ref(c.person_id),
        'contributions', count(*), 'unthanked', count(*) filter (where c.thanked_at is null), 'types', jsonb_agg(distinct c.type_code)) x
      from people.contribution c where c.site_id = core.qsite(p) and extract(year from c.occurred_at) = v_year and c.person_id is not null group by c.person_id) y)
    when 'unanswered_leads' then (select coalesce(jsonb_agg(jsonb_build_object('source', core.entity_ref(l.id), 'person', core.entity_ref(l.person_id),
        'listing', core.entity_ref(l.listing_id), 'since', l.created_at)), '[]') from resources.lead l where l.site_id = core.qsite(p) and l.status = 'new')
    when 'longest_stored' then (select coalesce(jsonb_agg(jsonb_build_object('source', core.entity_ref(o.id), 'label', resources.object_label(o.id),
        'since', o.status_since, 'place', place.path_label(o.place_id)) order by o.status_since), '[]')
      from (select * from resources.object where site_id = core.qsite(p) and status = 'stored' and archived_at is null order by status_since limit 10) o)
    when 'bought_sold' then jsonb_build_object('year', v_year,
        'bought', (select jsonb_build_object('count', count(*), 'sum', sum(ap.price), 'priced', count(ap.price)) from resources.acquisition a
                   left join resources.acquisition_private ap on ap.acquisition_id = a.id
                   where a.site_id = core.qsite(p) and a.type = 'purchase' and a.status in ('received', 'settled', 'agreed') and extract(year from a.created_at) = v_year),
        'sold', (select jsonb_build_object('count', count(*), 'sum', sum(dp.price), 'priced', count(dp.price)) from resources.disposal d
                 left join resources.disposal_private dp on dp.disposal_id = d.id where d.site_id = core.qsite(p) and d.type = 'sold' and extract(year from d.occurred_at) = v_year),
        'note', 'Priser syns bara för den som får se dem.')
    when 'open_needs' then (select coalesce(jsonb_agg(jsonb_build_object('source', core.entity_ref(n.id), 'project', core.entity_ref(n.project_id),
        'title', n.title, 'progress', change.need_progress_label(n.id))), '[]')
      from change.need n where n.site_id = core.qsite(p) and n.status = 'open' and n.archived_at is null and not change.need_is_met(n.id))
    when 'projects' then api.q_projects(v_args)
    when 'project_overview' then api.q_project(jsonb_build_object('id', coalesce(nullif(v_args ->> 'project_id', '')::uuid,
        (select id from change.project where site_id = core.qsite(p) and name ilike '%' || (v_args ->> 'name') || '%' order by length(name) limit 1))))
    when 'person_network' then jsonb_build_object('person', core.entity_ref(v_person), 'relations', (select coalesce(jsonb_agg(jsonb_build_object(
        'kind', r.kind_code, 'direction', case when r.person_id = v_person then 'out' else 'in' end,
        'source', core.entity_ref(case when r.person_id = v_person then r.other_person_id else r.person_id end))), '[]')
      from people.person_relation r where r.person_id = v_person or r.other_person_id = v_person),
      'organizations', (select coalesce(jsonb_agg(core.entity_ref(organization_id)), '[]') from people.person_organization where person_id = v_person))
    when 'place_overview' then api.q_place(jsonb_build_object('id', coalesce(nullif(v_args ->> 'place_id', '')::uuid,
        (select e.id from core.entity e join core.entity_type t on t.code = e.entity_type and t.is_place
         where e.site_id = core.qsite(p) and e.title ilike '%' || (v_args ->> 'name') || '%' order by length(e.title) limit 1))))
    when 'follow_up' then api.q_today(v_args)
    when 'story_ideas' then api.q_journal(v_args || '{"story_only": true, "limit": 10}'::jsonb)
    when 'period_summary' then api.q_journal(v_args || jsonb_build_object('limit', 200))
    when 'pickups' then api.q_pickups(v_args)
    when 'weather' then api.q_weather(v_args)
    else jsonb_build_object('error', 'unknown_tool') end;
end $$;

-- ================================================================== kommandokatalogen (versionerad)
-- Alla klienter – app, offlinejournal, Fråga Vreta, MCP och agenter – använder samma katalog.
insert into core.command_catalog (command_type, handler, label_sv, context, offline_class, allowed_roles, feature, requires_own_tap) values
  -- plattform
  ('UpdateFields', 'cmd.update_fields', 'Ändra uppgifter', 'platform', 'simple', '{owner,helper}', 'core', false),
  ('ArchiveEntity', 'cmd.archive_entity', 'Arkivera', 'platform', 'invariant', '{owner,helper}', 'core', false),
  ('SetVisibility', 'cmd.set_visibility', 'Ändra synlighet', 'platform', 'sensitive', '{owner,helper}', 'core', false),
  ('SetFeatureFlag', 'cmd.set_feature_flag', 'Slå på eller av en funktion', 'platform', 'sensitive', '{owner}', 'core', false),
  ('SetSiteSetting', 'cmd.set_site_setting', 'Ändra en inställning', 'platform', 'sensitive', '{owner}', 'core', false),
  ('UpsertCodeValue', 'cmd.upsert_code_value', 'Lägga till värde i en kodlista', 'platform', 'sensitive', '{owner}', 'core', false),
  ('ArchiveCodeValue', 'cmd.archive_code_value', 'Ta bort värde ur en kodlista', 'platform', 'sensitive', '{owner}', 'core', false),
  ('CreateGuestLink', 'cmd.create_guest_link', 'Skapa gästlänk', 'platform', 'sensitive', '{owner}', 'guest_view', false),
  ('CloseGuestLink', 'cmd.close_guest_link', 'Stänga gästlänk', 'platform', 'sensitive', '{owner}', 'core', false),
  ('SetMemberRole', 'cmd.set_member_role', 'Ändra roll', 'platform', 'sensitive', '{owner}', 'core', false),
  ('SetDisplayName', 'cmd.set_display_name', 'Ändra visningsnamn', 'platform', 'simple', '{owner,helper,reader,host}', 'core', false),
  ('ResolveRejectedCommand', 'cmd.resolve_rejected_command', 'Lösa en avvisad synkning', 'platform', 'simple', '{owner,helper}', 'core', false),
  -- fångst, media, uppgifter, assistent
  ('RecordCapture', 'cmd.record_capture', 'Fånga', 'platform', 'append', '{owner,helper}', 'core', false),
  ('RegisterMedia', 'cmd.register_media', 'Spara bild eller ljud', 'platform', 'append', '{owner,helper}', 'core', false),
  ('LinkMedia', 'cmd.link_media', 'Koppla bild', 'platform', 'simple', '{owner,helper}', 'core', false),
  ('SetCaptureStatus', 'cmd.set_capture_status', 'Ändra fångstens status', 'platform', 'simple', '{owner,helper}', 'core', false),
  ('CreateProposal', 'cmd.create_proposal', 'Skapa förslag', 'platform', 'append', '{owner,helper}', 'core', false),
  ('ApproveProposal', 'cmd.approve_proposal', 'Godkänna förslag', 'platform', 'invariant', '{owner,helper}', 'core', false),
  ('RejectProposal', 'cmd.reject_proposal', 'Slänga förslag', 'platform', 'invariant', '{owner,helper}', 'core', false),
  ('SaveProposalDraft', 'cmd.save_proposal_draft', 'Spara utkast av förslag', 'platform', 'simple', '{owner,helper}', 'core', false),
  ('CreateTask', 'cmd.create_task', 'Skapa uppgift', 'platform', 'append', '{owner,helper}', 'core', false),
  ('SetTaskStatus', 'cmd.set_task_status', 'Ändra uppgift', 'platform', 'invariant', '{owner,helper}', 'core', false),
  ('AppendAssistantMessage', 'cmd.append_assistant_message', 'Spara samtal med Fråga Vreta', 'platform', 'append', '{owner,helper,reader}', 'core', false),
  ('DeleteAssistantThread', 'cmd.delete_assistant_thread', 'Radera samtal', 'platform', 'simple', '{owner,helper,reader}', 'core', false),
  ('RecordAiUsage', 'cmd.record_ai_usage', 'Räkna AI-kostnad', 'platform', 'append', '{owner,helper,reader}', 'core', false),
  ('ReferenceWeather', 'cmd.reference_weather', 'Spara vädret som användes', 'platform', 'append', '{owner,helper}', 'weather', false),
  -- plats
  ('CreatePlace', 'cmd.create_place', 'Lägga till plats', 'place', 'invariant', '{owner,helper}', 'core', false),
  ('SetGeometry', 'cmd.set_geometry', 'Rita på kartan', 'place', 'simple', '{owner,helper}', 'core', false),
  ('AddMapLayer', 'cmd.add_map_layer', 'Lägga till kartlager', 'place', 'invariant', '{owner}', 'core', false),
  ('UpdateMapLayer', 'cmd.update_map_layer', 'Ändra kartlager', 'place', 'simple', '{owner}', 'core', false),
  ('CreateMapFeature', 'cmd.create_map_feature', 'Rita kartobjekt', 'place', 'append', '{owner,helper}', 'core', false),
  ('SetExternalPlaceAddress', 'cmd.set_external_place_address', 'Spara adress', 'place', 'simple', '{owner,helper}', 'core', false),
  ('MoveStorageLocation', 'cmd.move_storage_location', 'Flytta lagerplats', 'place', 'invariant', '{owner,helper}', 'core', false),
  -- människor
  ('CreatePerson', 'cmd.create_person', 'Lägga till person', 'people', 'invariant', '{owner,helper}', 'core', false),
  ('UpdatePerson', 'cmd.update_person', 'Ändra namn och ort', 'people', 'simple', '{owner,helper}', 'core', false),
  ('SetPersonPhoto', 'cmd.set_person_photo', 'Byta foto', 'people', 'invariant', '{owner,helper}', 'core', false),
  ('ChangeConsent', 'cmd.change_consent', 'Ändra samtycke', 'people', 'sensitive', '{owner}', 'core', true),
  ('SetPersonRole', 'cmd.set_person_role', 'Ändra roll', 'people', 'simple', '{owner,helper}', 'core', false),
  ('SetPersonPrivate', 'cmd.set_person_private', 'Spara kontaktuppgifter', 'people', 'simple', '{owner,helper}', 'core', false),
  ('LogInteraction', 'cmd.log_interaction', 'Logga kontakt', 'people', 'append', '{owner,helper}', 'core', false),
  ('RecordContribution', 'cmd.record_contribution', 'Registrera bidrag', 'people', 'invariant', '{owner,helper}', 'core', false),
  ('RecordReciprocity', 'cmd.record_reciprocity', 'Registrera ömsesidighet', 'people', 'append', '{owner,helper}', 'core', false),
  ('MarkThanked', 'cmd.mark_thanked', 'Markera som tackad', 'people', 'simple', '{owner,helper}', 'core', false),
  ('SetPersonRelation', 'cmd.set_person_relation', 'Ändra relation', 'people', 'invariant', '{owner,helper}', 'core', false),
  ('CreateOrganization', 'cmd.create_organization', 'Lägga till organisation', 'people', 'invariant', '{owner,helper}', 'core', false),
  ('LinkPersonOrganization', 'cmd.link_person_organization', 'Koppla till organisation', 'people', 'simple', '{owner,helper}', 'core', false),
  ('SetCapability', 'cmd.set_capability', 'Ändra kapacitet', 'people', 'simple', '{owner,helper}', 'vehicles', false),
  ('ErasePerson', 'cmd.erase_person', 'Radera person (GDPR)', 'people', 'sensitive', '{owner}', 'core', true),
  -- resurser
  ('CreateObject', 'cmd.create_object', 'Registrera sak', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('ChangeObjectStatus', 'cmd.change_object_status', 'Ändra status', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('MoveObject', 'cmd.move_object', 'Lagra eller flytta', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('UseObject', 'cmd.use_object', 'Nytt liv', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('DismantleObject', 'cmd.dismantle_object', 'Demontera', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('SplitAllocation', 'cmd.split_allocation', 'Dela parti', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('AdjustBatchQuantity', 'cmd.adjust_batch_quantity', 'Ändra antal i parti', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('SetHealthStatus', 'cmd.set_health_status', 'Ändra hälsa', 'resources', 'simple', '{owner,helper}', 'core', false),
  ('SetObjectPrivate', 'cmd.set_object_private', 'Spara värde', 'resources', 'simple', '{owner,helper}', 'core', false),
  ('SetObjectCategory', 'cmd.set_object_category', 'Ändra kategori', 'resources', 'simple', '{owner,helper}', 'core', false),
  ('CreateAcquisition', 'cmd.create_acquisition', 'Registrera anskaffning', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('AdvanceAcquisition', 'cmd.advance_acquisition', 'Flytta anskaffning', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('PlanPickup', 'cmd.plan_pickup', 'Planera hämtning', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('SetPickupStatus', 'cmd.set_pickup_status', 'Ändra hämtning', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('CheckChecklistItem', 'cmd.check_checklist_item', 'Bocka av', 'resources', 'simple', '{owner,helper}', 'core', false),
  ('AddChecklistItem', 'cmd.add_checklist_item', 'Lägga till rad i checklistan', 'resources', 'append', '{owner,helper}', 'core', false),
  ('CompletePickup', 'cmd.complete_pickup', 'Avsluta hämtning', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('UpsertChecklistTemplate', 'cmd.upsert_checklist_template', 'Spara checklistmall', 'resources', 'simple', '{owner,helper}', 'core', false),
  ('CreateListing', 'cmd.create_listing', 'Lägga ut', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('SaveChannelPost', 'cmd.save_channel_post', 'Spara annonstext', 'resources', 'simple', '{owner,helper}', 'core', false),
  ('SetListingStatus', 'cmd.set_listing_status', 'Ändra annons', 'resources', 'sensitive', '{owner,helper}', 'core', true),
  ('MarkChannelPosted', 'cmd.mark_channel_posted', 'Markera annons som publicerad', 'resources', 'sensitive', '{owner}', 'core', true),
  ('MarkChannelRemoved', 'cmd.mark_channel_removed', 'Markera annons som nedtagen', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('LogLead', 'cmd.log_lead', 'Registrera intressent', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('SetLeadStatus', 'cmd.set_lead_status', 'Ändra intressent', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('CompleteDisposal', 'cmd.complete_disposal', 'Överlämna', 'resources', 'invariant', '{owner,helper}', 'core', false),
  ('CreateVehicle', 'cmd.create_vehicle', 'Lägga till fordon eller maskin', 'resources', 'invariant', '{owner,helper}', 'vehicles', false),
  ('ReserveResource', 'cmd.reserve_resource', 'Boka fordon eller maskin', 'resources', 'invariant', '{owner,helper}', 'vehicles', false),
  ('RecordMaintenance', 'cmd.record_maintenance', 'Registrera underhåll', 'resources', 'append', '{owner,helper}', 'vehicles', false),
  ('AuthorizeDriver', 'cmd.authorize_driver', 'Ge behörighet att köra', 'resources', 'sensitive', '{owner}', 'vehicles', false),
  -- förändring
  ('CreateProject', 'cmd.create_project', 'Skapa projekt', 'change', 'invariant', '{owner,helper}', 'core', false),
  ('SetProjectStatus', 'cmd.set_project_status', 'Ändra projektets läge', 'change', 'invariant', '{owner,helper}', 'core', false),
  ('SetProjectPlace', 'cmd.set_project_place', 'Ändra projektets plats', 'change', 'simple', '{owner,helper}', 'core', false),
  ('AddNeed', 'cmd.add_need', 'Lägga till behov', 'change', 'invariant', '{owner,helper}', 'core', false),
  ('SetNeedStatus', 'cmd.set_need_status', 'Stryka behov', 'change', 'invariant', '{owner,helper}', 'core', false),
  ('FulfillNeed', 'cmd.fulfill_need', 'Fylla behov', 'change', 'invariant', '{owner,helper}', 'core', false),
  ('RecordDecision', 'cmd.record_decision', 'Journalföra beslut', 'change', 'append', '{owner,helper}', 'core', false),
  ('RecordMoment', 'cmd.record_moment', 'Spara ögonblick', 'change', 'append', '{owner,helper}', 'canvas', false),
  ('StartActivity', 'cmd.start_activity', 'Starta aktivitet', 'change', 'invariant', '{owner,helper}', 'canvas', false),
  ('CompleteActivity', 'cmd.complete_activity', 'Avsluta aktivitet', 'change', 'invariant', '{owner,helper}', 'canvas', false),
  ('CreateVision', 'cmd.create_vision', 'Skapa vision', 'change', 'invariant', '{owner,helper}', 'map_modes', false),
  ('AddVisionAsset', 'cmd.add_vision_asset', 'Lägga till inspiration', 'change', 'append', '{owner,helper}', 'map_modes', false),
  ('AddVisionAlternative', 'cmd.add_vision_alternative', 'Lägga till alternativ', 'change', 'append', '{owner,helper}', 'map_modes', false),
  ('ChooseVisionAlternative', 'cmd.choose_vision_alternative', 'Välja alternativ', 'change', 'sensitive', '{owner}', 'map_modes', false),
  ('SetTargetState', 'cmd.set_target_state', 'Sätta målbild', 'change', 'invariant', '{owner,helper}', 'map_modes', false),
  ('SetHabitatIntent', 'cmd.set_habitat_intent', 'Ange habitatavsikt', 'change', 'simple', '{owner,helper}', 'life', false),
  -- livet
  ('RecordObservation', 'cmd.record_observation', 'Registrera observation', 'life', 'append', '{owner,helper}', 'core', false),
  ('VerifyObservation', 'cmd.verify_observation', 'Verifiera art', 'life', 'sensitive', '{owner,helper}', 'life', false),
  ('ConfirmSpeciesPresence', 'cmd.confirm_species_presence', 'Bekräfta artnärvaro', 'life', 'sensitive', '{owner}', 'life', false),
  ('UpsertTaxon', 'cmd.upsert_taxon', 'Lägga till art', 'life', 'simple', '{owner,helper}', 'life', false),
  ('CreateAnimal', 'cmd.create_animal', 'Lägga till djur eller grupp', 'life', 'invariant', '{owner,helper}', 'life', false),
  ('CreateHabitatFeature', 'cmd.create_habitat_feature', 'Lägga till livsmiljö', 'life', 'invariant', '{owner,helper}', 'life', false),
  ('RecordHabitatUse', 'cmd.record_habitat_use', 'Registrera habitatanvändning', 'life', 'append', '{owner,helper}', 'life', false),
  ('PlantFromBatch', 'cmd.plant_from_batch', 'Plantera från parti', 'life', 'invariant', '{owner,helper}', 'life', false),
  ('RecordEcologicalRelation', 'cmd.record_ecological_relation', 'Registrera ekologisk relation', 'life', 'append', '{owner,helper}', 'life', false),
  -- kultur
  ('CreateCreativeWork', 'cmd.create_creative_work', 'Registrera verk', 'culture', 'invariant', '{owner,helper}', 'culture', false),
  ('PlaceCreativeWork', 'cmd.place_creative_work', 'Installera verk', 'culture', 'invariant', '{owner,helper}', 'culture', false),
  ('CreateCreativeInitiative', 'cmd.create_creative_initiative', 'Skapa kreativt initiativ', 'culture', 'invariant', '{owner,helper}', 'culture', false),
  -- värdskap
  ('CreateAccommodation', 'cmd.create_accommodation', 'Erbjuda boende', 'hospitality', 'invariant', '{owner}', 'hospitality', false),
  ('SetAvailability', 'cmd.set_availability', 'Ändra tillgänglighet', 'hospitality', 'invariant', '{owner,helper}', 'hospitality', false),
  ('DecideStayRequest', 'cmd.decide_stay_request', 'Godkänna eller avböja vistelse', 'hospitality', 'sensitive', '{owner}', 'hospitality', true),
  ('SetStayStatus', 'cmd.set_stay_status', 'Checka in eller ut', 'hospitality', 'invariant', '{owner}', 'hospitality', false),
  ('CreateHostedEvent', 'cmd.create_hosted_event', 'Planera evenemang', 'hospitality', 'invariant', '{owner,helper}', 'hospitality', false),
  ('AddSession', 'cmd.add_session', 'Lägga till programdel', 'hospitality', 'invariant', '{owner,helper,host}', 'hospitality', false),
  ('AddVenueConfiguration', 'cmd.add_venue_configuration', 'Lägga till venue-konfiguration', 'hospitality', 'invariant', '{owner,helper}', 'hospitality', false),
  ('RegisterParticipant', 'cmd.register_participant', 'Anmäla deltagare', 'hospitality', 'invariant', '{owner}', 'hospitality', false),
  ('RecordAttendance', 'cmd.record_attendance', 'Registrera närvaro', 'hospitality', 'append', '{owner,host}', 'hospitality', false),
  ('SetReadinessCheck', 'cmd.set_readiness_check', 'Uppdatera beredskap', 'hospitality', 'simple', '{owner,helper,host}', 'hospitality', false),
  ('AssignHost', 'cmd.assign_host', 'Tilldela värd', 'hospitality', 'sensitive', '{owner}', 'hospitality', false),
  -- berättelse
  ('CreateContent', 'cmd.create_content', 'Börja berätta', 'story', 'invariant', '{owner,helper}', 'core', false),
  ('SaveChannelVariant', 'cmd.save_channel_variant', 'Spara utkast', 'story', 'simple', '{owner,helper}', 'core', false),
  ('SetContentStatus', 'cmd.set_content_status', 'Ändra berättelsens läge', 'story', 'invariant', '{owner,helper}', 'core', false),
  ('ApproveContent', 'cmd.approve_content', 'Godkänna berättelse', 'story', 'sensitive', '{owner}', 'core', true),
  ('MarkContentShared', 'cmd.mark_content_shared', 'Markera som delad', 'story', 'sensitive', '{owner}', 'core', true),
  ('RecordContentConsent', 'cmd.record_content_consent', 'Spara samtycke för inlägg', 'story', 'sensitive', '{owner}', 'core', true),
  ('AddStoryNote', 'cmd.add_story_note', 'Spara berättarfångst', 'story', 'append', '{owner,helper}', 'core', false),
  ('MarkStoryValue', 'cmd.mark_story_value', 'Markera som bra ögonblick', 'story', 'simple', '{owner,helper}', 'core', false),
  ('ConvertSubmission', 'cmd.convert_submission', 'Ta hand om inskick', 'story', 'sensitive', '{owner}', 'live', false);

-- ================================================================== lagring (Supabase Storage)
-- Originalen är privata; det som delas är alltid rensat (INV-07). Bara i Supabase – PGlite har ingen storage.
do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict (id) do nothing;
    -- Sökvägar: <site_id>/<media_id>/<original|share|thumb>.<ext>
    execute $p$create policy "vreta media read" on storage.objects for select to authenticated using (
      bucket_id = 'media' and (
        (storage.foldername(name))[1]::uuid in (select unnest(core.sites_with_role('{owner}'::core.member_role[])))
        or (name not like '%/original.%' and exists (select 1 from core.media m where m.id::text = (storage.foldername(name))[2]))
        or name in (select image_path from pub.guest_item where image_path is not null)))$p$;
    execute $p$create policy "vreta media public" on storage.objects for select to anon using (
      bucket_id = 'media' and name not like '%/original.%' and (
        name in (select image_path from pub.live_item where image_path is not null)
        or name in (select image_path from pub.person where image_path is not null)
        or name in (select unnest(image_paths) from pub.story)))$p$;
    execute $p$create policy "vreta media write" on storage.objects for insert to authenticated with check (
      bucket_id = 'media' and (storage.foldername(name))[1]::uuid in (select unnest(core.sites_with_role('{owner,helper}'::core.member_role[]))))$p$;
  end if;
end $$;

-- ================================================================== schemalagda jobb (pg_cron i Supabase)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('vreta-process-jobs', '* * * * *', 'select core.process_jobs(200)');
    perform cron.schedule('vreta-expire-proposals', '17 3 * * *', $c$select core.enqueue('expire_proposals', current_date::text, '{}', null)$c$);
  end if;
end $$;

-- ================================================================== härdning
-- 1. Varje tabell i de tolv schemana är registrerad (och har därmed RLS och en policyklass).
do $$
declare v_missing text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('core', 'place', 'life', 'people', 'resources', 'change', 'culture', 'hospitality', 'story', 'rm', 'pub', 'commerce')
    and not exists (select 1 from core.table_registry r where r.table_name = n.nspname || '.' || c.relname);
  if v_missing is not null then raise exception 'Tabeller utan registrering och RLS: %', v_missing; end if;
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('core', 'place', 'life', 'people', 'resources', 'change', 'culture', 'hospitality', 'story', 'rm', 'pub', 'commerce')
    and not c.relrowsecurity;
  if v_missing is not null then raise exception 'Tabeller utan RLS: %', v_missing; end if;
end $$;

-- 2. Inga funktioner kan anropas av vem som helst. Triggerfunktioner och kommandohanterare nås inte alls;
--    frågor och kommandoutföraren bara av inloggade; några få publika ingångar av anonyma (NFR-019).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('core', 'place', 'life', 'people', 'resources', 'change', 'culture', 'hospitality', 'story', 'rm', 'pub', 'commerce', 'api', 'cmd')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
  end loop;
  -- Kommandoutföraren och frågorna
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname not in ('ingest_weather', 'weather_sites')
  loop
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
  -- Hjälpare som policyerna och frågorna (security invoker) behöver
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('core', 'sites_with_role'), ('core', 'my_role'), ('core', 'is_owner'), ('core', 'is_staff'), ('core', 'can_read'),
      ('core', 'my_host_entities'), ('core', 'my_host_events'), ('core', 'qsite'), ('core', 'entity_ref'), ('core', 'media_ref'),
      ('core', 'media_for'), ('core', 'cover'), ('core', 'timeline'), ('core', 'allowed_next'), ('core', 'person_brief'),
      ('core', 'state_label'), ('core', 'fmt_num'), ('core', 'weather_at'), ('core', 'weather_signals'), ('core', 'word_re'), ('core', 'policy_expr'),
      ('place', 'lineage'), ('place', 'path_label'), ('place', 'zone_of'), ('place', 'zone_at'),
      ('resources', 'object_label'), ('resources', 'status_group'), ('resources', 'allocation_summary'),
      ('change', 'need_fulfilled_quantity'), ('change', 'need_is_met'), ('change', 'need_progress_label'),
      ('pub', 'zone_label'))
  loop
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
  -- Publika ingångar
  execute 'grant execute on function api.q_live(jsonb) to anon';
  execute 'grant execute on function api.q_public_tour(jsonb) to anon';
  execute 'grant execute on function api.submit_contribution(jsonb) to anon';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function api.ingest_weather(uuid, jsonb) to service_role';
    execute 'grant execute on function api.weather_sites() to service_role';
    execute 'grant execute on function core.process_jobs(integer, uuid) to service_role';
  end if;
end $$;

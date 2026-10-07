-- VRETA 2 · Migrering 003 · Media, fångst och förslag
-- Media med privata original och rensade derivat (INV-07), rättigheter, Capture → Proposal med
-- confidence och evidens per fält (INV-02), uppgifter, sökindex och Fråga Vreta-trådar.

select core.define_entity_type('media', 'core.media', 'Bild', 'Bilder', '/media/:id', 'platform', '{caption,description}');
select core.define_entity_type('rights_record', 'core.rights_record', 'Rättighet', 'Rättigheter', null, 'platform', '{creator_name,source,source_url,license,note}', false, 'R2.2');
select core.define_entity_type('capture', 'core.capture', 'Fångst', 'Fångster', '/granska/fangst/:id', 'platform', '{text}');
select core.define_entity_type('proposal', 'core.proposal', 'Förslag', 'Förslag', '/granska/:id', 'platform', '{}');
select core.define_entity_type('task', 'core.task', 'Uppgift', 'Uppgifter', '/uppgift/:id', 'platform', '{title,note}');

create type core.media_kind as enum ('photo', 'video', 'audio', 'document');
create type core.media_status as enum ('pending_upload', 'ready', 'failed');

create table core.media (
  like core.entity_template including all,
  kind core.media_kind not null default 'photo',
  status core.media_status not null default 'pending_upload',
  mime_type text,
  byte_size bigint,
  width integer,
  height integer,
  duration_ms integer,
  taken_at timestamptz,
  photographer_person_id uuid,
  caption text,
  -- Bildbeskrivning och transkription gör bilder och ljud sökbara (R1.1 11.6)
  description text,
  transcript text,
  storage_bucket text not null default 'media',
  -- Rensad bild utan EXIF/GPS. Det enda som får lämna appen.
  share_path text,
  thumb_path text,
  has_people boolean not null default false,
  -- Registreringsskyltar, adresskyltar och hemmiljöer flaggas för granskning före publicering (R1.1 12.3)
  flagged_for_review boolean not null default false
);
select core.register_table('core.media', 'standard', 'media', 'caption', '{description,transcript}');

-- Originalet med metadata är alltid privat (R1.1 12.3).
create table core.media_original (
  like core.link_template including all,
  media_id uuid not null unique references core.media (id) on delete cascade,
  storage_path text not null,
  original_filename text,
  exif jsonb,
  gps extensions.geometry(Point, 4326)
);
select core.register_table('core.media_original', 'private');

create table core.media_derivative (
  like core.link_template including all,
  media_id uuid not null references core.media (id) on delete cascade,
  kind text not null check (kind in ('thumb', 'share', 'square', 'portrait_4_5', 'audio_compressed')),
  storage_path text not null,
  width integer,
  height integer,
  exif_stripped boolean not null default true,
  unique (media_id, kind)
);
select core.register_table('core.media_derivative', 'custom');
create policy read on core.media_derivative for select to authenticated
  using (exists (select 1 from core.media m where m.id = media_id));

create table core.media_link (
  like core.link_template including all,
  media_id uuid not null references core.media (id) on delete cascade,
  entity_id uuid not null references core.entity (id),
  -- photo, before, during, after, process, receipt, depicts, avatar, voice, document, cover
  role text not null default 'photo',
  sort integer not null default 0,
  unique (media_id, entity_id, role)
);
create index media_link_entity_idx on core.media_link (entity_id, sort);
select core.register_table('core.media_link', 'custom');
create policy read on core.media_link for select to authenticated
  using (exists (select 1 from core.media m where m.id = media_id) and exists (select 1 from core.entity e where e.id = entity_id));

-- Rättigheter för inspirationsbilder, verk och media (R2.2). Upphovsrätt är metadata, inte ett antagande.
create type core.rights_status as enum ('unknown', 'own', 'licensed', 'permission_granted', 'no_permission', 'public_domain');
create table core.rights_record (
  like core.entity_template including all,
  subject_entity_id uuid references core.entity (id),
  creator_name text,
  creator_person_id uuid,
  source text,
  source_url text,
  license text,
  rights_status core.rights_status not null default 'unknown',
  may_publish boolean not null default false,
  note text
);
select core.register_table('core.rights_record', 'standard', 'rights_record', 'creator_name', '{source,note}', 'R2.2');

-- ------------------------------------------------------------------ fångst och förslag
-- Fynd · Person · Observation · Bidrag · Ögonblick · Annat (AI avgör)
create type core.capture_kind as enum ('find', 'person', 'observation', 'contribution', 'moment', 'other');
create type core.capture_status as enum ('new', 'interpreting', 'proposed', 'failed', 'discarded');
create type core.proposal_status as enum ('pending', 'accepted', 'partially_accepted', 'rejected', 'expired');
create type core.evidence_kind as enum ('transcript_excerpt', 'image_region', 'existing_relation', 'shared_attributes', 'context', 'text_excerpt');

create table core.capture (
  like core.entity_template including all,
  kind_hint core.capture_kind not null default 'other',
  status core.capture_status not null default 'new',
  text text,
  transcript text,
  url text,
  -- Kontextmedveten Fånga (2.0): GPS, aktuell skärm, närliggande projekt, nyligen använda entiteter
  context jsonb not null default '{}',
  client_created_at timestamptz,
  interpreted_at timestamptz,
  error text
);
create index capture_status_idx on core.capture (site_id, status);
select core.register_table('core.capture', 'standard', 'capture', 'text', '{transcript,url}');

create table core.proposal (
  like core.entity_template including all,
  capture_id uuid references core.capture (id),
  status core.proposal_status not null default 'pending',
  agent text not null default 'capture_agent',
  model text,
  summary text not null default '',
  expires_at timestamptz not null default now() + interval '30 days',
  decided_by uuid,
  decided_at timestamptz,
  -- Vad godkännandet skapade: {"object": uuid, "person": uuid, …}
  result jsonb not null default '{}'
);
create index proposal_status_idx on core.proposal (site_id, status);
select core.register_table('core.proposal', 'standard', 'proposal', 'summary');

-- Ett fält i ett föreslaget kort. entity_key grupperar fälten i kort (object, person, acquisition, …).
create table core.proposal_field (
  like core.link_template including all,
  proposal_id uuid not null references core.proposal (id) on delete cascade,
  entity_key text not null,
  entity_kind text not null,
  field text not null,
  value jsonb,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  verified boolean not null default false,
  decision text check (decision in ('accepted', 'edited', 'rejected')),
  final_value jsonb,
  -- Koppling till befintlig post ("Samma som Anders Lind?") och kandidater med gemensamma attribut
  match_entity_id uuid references core.entity (id),
  match_candidates jsonb not null default '[]',
  sort integer not null default 0,
  unique (proposal_id, entity_key, field)
);
select core.register_table('core.proposal_field', 'custom');
create policy read on core.proposal_field for select to authenticated
  using (exists (select 1 from core.proposal p where p.id = proposal_id));

-- Evidens per förslagsfält (2.0): frasen i ljudet med tidskod, bildregion, befintlig relation …
create table core.proposal_evidence (
  like core.link_template including all,
  field_id uuid not null references core.proposal_field (id) on delete cascade,
  kind core.evidence_kind not null,
  reference text,
  excerpt text,
  start_ms integer,
  end_ms integer,
  entity_id uuid references core.entity (id)
);
select core.register_table('core.proposal_evidence', 'custom');
create policy read on core.proposal_evidence for select to authenticated
  using (exists (select 1 from core.proposal_field f where f.id = field_id));

-- ------------------------------------------------------------------ uppgifter
create type core.task_status as enum ('open', 'in_progress', 'done', 'snoozed', 'cancelled');
create table core.task (
  like core.entity_template including all,
  title text not null,
  kind text not null default 'todo',
  status core.task_status not null default 'open',
  due_at timestamptz,
  snoozed_until timestamptz,
  subject_entity_id uuid references core.entity (id),
  assignee_user_id uuid,
  done_at timestamptz,
  note text
);
create index task_open_idx on core.task (site_id, status, due_at);
select core.register_table('core.task', 'standard', 'task', 'title', '{note}');

-- ------------------------------------------------------------------ sök och assistent
-- Fulltext och vektor per entitet. Uppdateras av entitetsregistret i samma transaktion (FR-072);
-- vektorn fylls i av ett bakgrundsjobb när en inbäddningstjänst är konfigurerad.
create table core.search_document (
  entity_id uuid primary key references core.entity (id) on delete cascade,
  site_id uuid not null references core.site (id),
  entity_type text not null,
  title text not null default '',
  body text not null default '',
  visibility core.visibility not null default 'internal',
  created_by uuid,
  archived_at timestamptz,
  tsv tsvector generated always as (
    setweight(to_tsvector('swedish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('swedish', coalesce(body, '')), 'B')) stored,
  embedding extensions.vector(1024),
  embedded_at timestamptz,
  updated_at timestamptz not null default now()
);
create index search_document_tsv_idx on core.search_document using gin (tsv);
create index search_document_title_trgm on core.search_document using gin (title extensions.gin_trgm_ops);
select core.register_table('core.search_document', 'standard', p_audit => false);

create table core.assistant_thread (
  like core.entity_template including all,
  title text not null default 'Fråga Vreta',
  screen jsonb not null default '{}'
);
alter table core.assistant_thread alter column visibility set default 'private';
select core.register_table('core.assistant_thread', 'self', p_audit => false);

create table core.assistant_message (
  like core.link_template including all,
  thread_id uuid not null references core.assistant_thread (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Källkort: [{entity_id, entity_type, title, route}] och allmänt råd skilt från fakta
  sources jsonb not null default '[]',
  general_advice text,
  action_preview_id uuid references core.action_preview (id)
);
select core.register_table('core.assistant_message', 'self', p_audit => false);

-- AI-kostnad per funktion, plats och månad, med månadstak i site_setting (NFR-014).
create table core.ai_usage (
  like core.link_template including all,
  function_name text not null,
  month date not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (site_id, function_name, month)
);
select core.register_table('core.ai_usage', 'owner', p_audit => false);

-- ------------------------------------------------------------------ kommandon
-- Fånga sparas alltid, även offline (append-only, FR-003). Media laddas upp innan kommandot körs.
create function cmd.record_capture(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_media uuid;
  i integer := 0;
begin
  if coalesce(p ->> 'text', '') = '' and coalesce(p ->> 'transcript', '') = '' and coalesce(p ->> 'url', '') = ''
     and jsonb_array_length(coalesce(p -> 'media_ids', '[]')) = 0 then
    perform core.fail('empty_capture', 'Fångsten är tom – ta ett foto, tala in eller skriv något');
  end if;
  insert into core.capture (id, site_id, kind_hint, text, transcript, url, context, client_created_at, source_type)
  values (v_id, core.ctx_site(), coalesce(nullif(p ->> 'kind_hint', ''), 'other')::core.capture_kind,
          nullif(p ->> 'text', ''), nullif(p ->> 'transcript', ''), nullif(p ->> 'url', ''),
          coalesce(p -> 'context', '{}'), core.opt_ts(p, 'client_created_at', null), 'manual');
  for v_media in select (jsonb_array_elements_text(coalesce(p -> 'media_ids', '[]')))::uuid loop
    perform core.assert_entity(v_media, '{media}');
    insert into core.media_link (site_id, media_id, entity_id, role, sort)
    values (core.ctx_site(), v_media, v_id,
            case when (select kind from core.media where id = v_media) = 'audio' then 'voice' else 'photo' end, i);
    i := i + 1;
  end loop;
  return jsonb_build_object('capture_id', v_id);
end $$;

-- Registrerar ett uppladdat mediaobjekt (originalet privat, derivaten rensade). Append-only.
create function cmd.register_media(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(core.opt_uuid(p, 'id'), gen_random_uuid());
  v_kind core.media_kind := coalesce(nullif(p ->> 'kind', ''), 'photo')::core.media_kind;
  v_d jsonb;
begin
  if exists (select 1 from core.media where id = v_id) then
    return jsonb_build_object('media_id', v_id, 'existing', true);
  end if;
  insert into core.media (id, site_id, kind, status, mime_type, byte_size, width, height, duration_ms, taken_at, caption,
                          transcript, share_path, thumb_path, has_people, visibility)
  values (v_id, core.ctx_site(), v_kind, 'ready', p ->> 'mime_type', (p ->> 'byte_size')::bigint,
          (p ->> 'width')::integer, (p ->> 'height')::integer, (p ->> 'duration_ms')::integer,
          core.opt_ts(p, 'taken_at', null), p ->> 'caption', p ->> 'transcript', p ->> 'share_path', p ->> 'thumb_path',
          coalesce((p ->> 'has_people')::boolean, false),
          -- Ljud är alltid privat (R1.1 7.5); bilder interna tills någon delar dem
          case when v_kind = 'audio' then 'private' else coalesce(nullif(p ->> 'visibility', ''), 'internal') end::core.visibility);
  if p ->> 'original_path' is not null then
    insert into core.media_original (site_id, media_id, storage_path, original_filename, exif, gps)
    values (core.ctx_site(), v_id, p ->> 'original_path', p ->> 'original_filename', p -> 'exif',
            case when p ? 'gps' then extensions.st_setsrid(extensions.st_makepoint((p -> 'gps' ->> 'lon')::float8, (p -> 'gps' ->> 'lat')::float8), 4326) end);
  end if;
  for v_d in select * from jsonb_array_elements(coalesce(p -> 'derivatives', '[]')) loop
    insert into core.media_derivative (site_id, media_id, kind, storage_path, width, height)
    values (core.ctx_site(), v_id, v_d ->> 'kind', v_d ->> 'storage_path', (v_d ->> 'width')::integer, (v_d ->> 'height')::integer);
  end loop;
  return jsonb_build_object('media_id', v_id);
end $$;

create function cmd.link_media(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_media uuid := core.req_uuid(p, 'media_id');
  v_entity uuid := core.req_uuid(p, 'entity_id');
  v_role text := coalesce(nullif(p ->> 'role', ''), 'photo');
begin
  perform core.assert_entity(v_media, '{media}');
  perform core.assert_entity(v_entity);
  if coalesce((p ->> 'unlink')::boolean, false) then
    delete from core.media_link where media_id = v_media and entity_id = v_entity and role = v_role;
  else
    insert into core.media_link (site_id, media_id, entity_id, role, sort)
    values (core.ctx_site(), v_media, v_entity, v_role, coalesce((p ->> 'sort')::integer,
            (select coalesce(max(sort) + 1, 0) from core.media_link where entity_id = v_entity)))
    on conflict (media_id, entity_id, role) do update set sort = excluded.sort;
    -- Ett foto på en person ärver aldrig högre synlighet än bildsamtycket (INV-15)
    if v_role in ('depicts', 'avatar') then
      perform people.apply_image_consent(v_entity);
    end if;
  end if;
  return jsonb_build_object('media_id', v_media, 'entity_id', v_entity);
end $$;

create function cmd.set_capture_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'capture_id');
begin
  update core.capture set status = core.req(p, 'status')::core.capture_status, error = p ->> 'error',
    transcript = coalesce(nullif(p ->> 'transcript', ''), transcript),
    interpreted_at = case when p ->> 'status' in ('proposed', 'failed') then now() else interpreted_at end
  where id = v_id and site_id = core.ctx_site();
  if not found then perform core.fail('not_found', 'Fångsten finns inte'); end if;
  return jsonb_build_object('capture_id', v_id);
end $$;

-- Agenter skriver bara förslag (INV-02). Varje fält bär confidence och evidens.
-- payload: {capture_id, agent, model, summary, cards: [{key, kind, fields: [{field, value, confidence,
--           evidence: [{kind, reference, excerpt, start_ms, end_ms, entity_id}]}], match_entity_id, match_candidates}]}
create function cmd.create_proposal(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_capture uuid := core.opt_uuid(p, 'capture_id');
  v_card jsonb;
  v_field jsonb;
  v_ev jsonb;
  v_field_id uuid;
  i integer := 0;
begin
  if v_capture is not null then perform core.assert_entity(v_capture, '{capture}'); end if;
  insert into core.proposal (id, site_id, capture_id, agent, model, summary, source_type)
  values (v_id, core.ctx_site(), v_capture, coalesce(nullif(p ->> 'agent', ''), 'capture_agent'), p ->> 'model',
          coalesce(p ->> 'summary', ''), case when p ->> 'model' is null then 'system' else 'ai_capture' end::core.source_type);
  for v_card in select * from jsonb_array_elements(coalesce(p -> 'cards', '[]')) loop
    for v_field in select * from jsonb_array_elements(coalesce(v_card -> 'fields', '[]')) loop
      insert into core.proposal_field (site_id, proposal_id, entity_key, entity_kind, field, value, confidence,
                                       match_entity_id, match_candidates, sort)
      values (core.ctx_site(), v_id, v_card ->> 'key', v_card ->> 'kind', v_field ->> 'field', v_field -> 'value',
              least(1, greatest(0, coalesce((v_field ->> 'confidence')::numeric, 0.5))),
              case when v_field ->> 'field' = '_match' then core.opt_uuid(v_card, 'match_entity_id') end,
              case when v_field ->> 'field' = '_match' then coalesce(v_card -> 'match_candidates', '[]') else '[]' end, i)
      on conflict (proposal_id, entity_key, field) do nothing
      returning id into v_field_id;
      for v_ev in select * from jsonb_array_elements(coalesce(v_field -> 'evidence', '[]')) loop
        insert into core.proposal_evidence (site_id, field_id, kind, reference, excerpt, start_ms, end_ms, entity_id)
        values (core.ctx_site(), v_field_id, coalesce(nullif(v_ev ->> 'kind', ''), 'text_excerpt')::core.evidence_kind,
                v_ev ->> 'reference', v_ev ->> 'excerpt', (v_ev ->> 'start_ms')::integer, (v_ev ->> 'end_ms')::integer,
                case when exists (select 1 from core.entity e where e.id = core.opt_uuid(v_ev, 'entity_id') and e.site_id = core.ctx_site())
                     then core.opt_uuid(v_ev, 'entity_id') end);
      end loop;
      i := i + 1;
    end loop;
  end loop;
  if v_capture is not null then
    update core.capture set status = 'proposed', interpreted_at = now() where id = v_capture;
  end if;
  return jsonb_build_object('proposal_id', v_id);
end $$;

create function cmd.reject_proposal(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'proposal_id');
begin
  update core.proposal set status = 'rejected', decided_by = auth.uid(), decided_at = now()
  where id = v_id and site_id = core.ctx_site() and status = 'pending';
  if not found then perform core.fail('not_pending', 'Förslaget är redan avgjort'); end if;
  update core.capture set status = 'discarded' where id = (select capture_id from core.proposal where id = v_id)
    and coalesce((p ->> 'discard_capture')::boolean, false);
  return jsonb_build_object('proposal_id', v_id);
end $$;

-- Sparar fältbeslut som utkast utan att skapa något.
create function cmd.save_proposal_draft(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'proposal_id');
  v_d jsonb;
begin
  if not exists (select 1 from core.proposal where id = v_id and site_id = core.ctx_site() and status = 'pending') then
    perform core.fail('not_pending', 'Förslaget är redan avgjort');
  end if;
  for v_d in select * from jsonb_array_elements(coalesce(p -> 'decisions', '[]')) loop
    update core.proposal_field set decision = v_d ->> 'decision', final_value = v_d -> 'value',
      match_entity_id = coalesce(core.opt_uuid(v_d, 'match_entity_id'), match_entity_id)
    where proposal_id = v_id and entity_key = v_d ->> 'key' and field = v_d ->> 'field';
  end loop;
  return jsonb_build_object('proposal_id', v_id);
end $$;

create function cmd.create_task(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_subject uuid := core.opt_uuid(p, 'subject_entity_id');
begin
  if v_subject is not null then perform core.assert_entity(v_subject); end if;
  insert into core.task (id, site_id, title, kind, due_at, subject_entity_id, assignee_user_id, note)
  values (v_id, core.ctx_site(), core.req(p, 'title'), coalesce(nullif(p ->> 'kind', ''), 'todo'),
          core.opt_ts(p, 'due_at', null), v_subject, core.opt_uuid(p, 'assignee_user_id'), p ->> 'note');
  return jsonb_build_object('task_id', v_id);
end $$;

create function cmd.set_task_status(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id uuid := core.req_uuid(p, 'task_id');
  v_to core.task_status := core.req(p, 'status')::core.task_status;
  v_from core.task_status;
begin
  select status into v_from from core.task where id = v_id and site_id = core.ctx_site() for update;
  if v_from is null then perform core.fail('not_found', 'Uppgiften finns inte'); end if;
  perform core.assert_transition('task', v_from::text, v_to::text, p ->> 'override_reason');
  if v_to = 'snoozed' and nullif(p ->> 'snoozed_until', '') is null then
    perform core.fail('missing_field', 'Välj nytt datum');
  end if;
  update core.task set status = v_to, done_at = case when v_to = 'done' then now() end,
    snoozed_until = core.opt_ts(p, 'snoozed_until', null),
    due_at = coalesce(core.opt_ts(p, 'snoozed_until', null), due_at)
  where id = v_id;
  if v_to = 'done' then
    perform core.record_history('task.done', format('Klart: %s', (select title from core.task where id = v_id)),
      jsonb_build_array(jsonb_build_object('id', v_id), jsonb_build_object('id', (select subject_entity_id from core.task where id = v_id), 'role', 'about')));
  end if;
  return jsonb_build_object('task_id', v_id, 'status', v_to);
end $$;

insert into core.state (machine, state, label_sv, terminal, sort) values
  ('task', 'open', 'Att göra', false, 1), ('task', 'in_progress', 'Pågår', false, 2), ('task', 'done', 'Klar', true, 3),
  ('task', 'snoozed', 'Senare', false, 4), ('task', 'cancelled', 'Struken', true, 5),
  ('proposal', 'pending', 'Att granska', false, 1), ('proposal', 'accepted', 'Godkänt', true, 2),
  ('proposal', 'partially_accepted', 'Delvis godkänt', true, 3), ('proposal', 'rejected', 'Avvisat', true, 4),
  ('proposal', 'expired', 'Utgånget', true, 5);
insert into core.state_transition (machine, from_state, to_state) values
  ('task', 'open', 'in_progress'), ('task', 'in_progress', 'done'), ('task', 'open', 'done'),
  ('task', 'open', 'snoozed'), ('task', 'in_progress', 'snoozed'), ('task', 'snoozed', 'open'), ('task', 'snoozed', 'done'),
  ('task', 'open', 'cancelled'), ('task', 'in_progress', 'cancelled'), ('task', 'snoozed', 'snoozed'),
  ('proposal', 'pending', 'accepted'), ('proposal', 'pending', 'partially_accepted'),
  ('proposal', 'pending', 'rejected'), ('proposal', 'pending', 'expired');

-- Assistentens trådar skrivs av Fråga Vreta (med användarens behörighet). Privata (R1.1 11.6).
create function cmd.append_assistant_message(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_thread uuid := core.opt_uuid(p, 'thread_id');
  v_msg jsonb;
begin
  if v_thread is null or not exists (select 1 from core.assistant_thread where id = v_thread and created_by = auth.uid()) then
    v_thread := coalesce(v_thread, gen_random_uuid());
    insert into core.assistant_thread (id, site_id, title, screen)
    values (v_thread, core.ctx_site(), left(coalesce(p -> 'messages' -> 0 ->> 'content', 'Fråga Vreta'), 80), coalesce(p -> 'screen', '{}'));
  end if;
  for v_msg in select * from jsonb_array_elements(coalesce(p -> 'messages', '[]')) loop
    insert into core.assistant_message (site_id, thread_id, role, content, sources, general_advice, action_preview_id)
    values (core.ctx_site(), v_thread, v_msg ->> 'role', v_msg ->> 'content', coalesce(v_msg -> 'sources', '[]'),
            v_msg ->> 'general_advice', core.opt_uuid(v_msg, 'action_preview_id'));
  end loop;
  update core.assistant_thread set updated_at = now() where id = v_thread;
  return jsonb_build_object('thread_id', v_thread);
end $$;

create function cmd.delete_assistant_thread(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid := core.req_uuid(p, 'thread_id');
begin
  delete from core.assistant_thread where id = v_id and created_by = auth.uid();
  if not found then perform core.fail('not_found', 'Tråden finns inte'); end if;
  return jsonb_build_object('thread_id', v_id);
end $$;

-- Räknas av serverfunktionerna efter varje AI-anrop. Taket ligger i site_setting ai_monthly_cap_usd.
create function cmd.record_ai_usage(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_cap numeric := (core.setting(core.ctx_site(), 'ai_monthly_cap_usd') #>> '{}')::numeric;
  v_total numeric;
begin
  insert into core.ai_usage (site_id, function_name, month, calls, input_tokens, output_tokens, cost_usd)
  values (core.ctx_site(), core.req(p, 'function_name'), v_month, 1, coalesce((p ->> 'input_tokens')::bigint, 0),
          coalesce((p ->> 'output_tokens')::bigint, 0), coalesce((p ->> 'cost_usd')::numeric, 0))
  on conflict (site_id, function_name, month) do update set calls = core.ai_usage.calls + 1,
    input_tokens = core.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = core.ai_usage.output_tokens + excluded.output_tokens,
    cost_usd = core.ai_usage.cost_usd + excluded.cost_usd, updated_at = now();
  select sum(cost_usd) into v_total from core.ai_usage where site_id = core.ctx_site() and month = v_month;
  return jsonb_build_object('month_cost_usd', v_total, 'cap_usd', v_cap, 'over_cap', v_cap is not null and v_total >= v_cap);
end $$;

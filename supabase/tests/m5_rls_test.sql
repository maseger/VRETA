-- M5: sök (AC-13), audit (AC-15), privata trådar, AI-kostnad och behörighet för chatbotens källor (AC-25).
\set ON_ERROR_STOP on
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select id as site from sites \gset

-- AC-13: böjd form hittar objektet
select create_from_proposal(:'site', jsonb_build_object(
  'object', jsonb_build_object('title','Mässingshandtag','quantity',4, 'category', 'Beslag och smide'),
  'person', jsonb_build_object('name','Bengt','locality','Ockelbo'),
  'acquisition', jsonb_build_object('type','purchase','price',200))) as handtag \gset
update person_private set notes = 'Hemlig anteckning' where person_id = (select id from persons where name = 'Bengt');
do $$ begin
  assert exists (select 1 from search_vreta('Var är mässingshandtagen?') where entity_type = 'object' and title = 'Mässingshandtag'), 'sök med böjd form';
  assert exists (select 1 from search_vreta('bengt') where entity_type = 'person'), 'sök person';
  assert not exists (select 1 from search_vreta('')), 'tom sökning ger inget';
end $$;

-- AC-15: statusbyten, samtycke och publicering finns i audit
update objects set status = 'collected' where id = :'handtag';
update persons set consent_name = 'yes' where name = 'Bengt';
insert into content_items (site_id, goal, source_type, source_id, status) values (:'site', 'fyndet', 'object', :'handtag', 'draft') returning id as inlagg \gset
update content_items set status = 'approved' where id = :'inlagg';
update content_items set status = 'shared', shared_url = 'https://example.com/p/1' where id = :'inlagg';
do $$ begin
  assert exists (select 1 from audit_entries where action = 'status_change' and entity_id in (select id from objects where title = 'Mässingshandtag')), 'statusbyte';
  assert exists (select 1 from audit_entries where action = 'consent_change' and entity_id = (select id from persons where name = 'Bengt')), 'samtycke';
  assert exists (select 1 from audit_entries where action = 'content_shared'), 'publicering';
  assert exists (select 1 from audit_entries where action = 'content_approved'), 'godkännande';
  assert exists (select 1 from audit_entries where action = 'channel_posted'), 'annons i kanal (M4)';
  assert exists (select 1 from audit_entries where action = 'content_consent'), 'samtycke per inlägg (M4)';
end $$;

-- Trådar är privata för den som skapat dem
insert into ask_threads (site_id, title, messages) values (:'site', 'Ägarens tråd', '[]');
insert into ai_usage (site_id, function, input_tokens, output_tokens) values (:'site', 'ask-vreta', 1200, 300);
do $$ begin assert ai_tokens_this_month((select id from sites)) = 1500, 'AI-kostnad summeras'; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into ask_threads (site_id, title, messages) values (:'site', 'Medhjälparens tråd', '[]');
do $$ begin
  assert (select count(*) from ask_threads) = 1, 'medhjälparen ser bara sin tråd';
  assert (select title from ask_threads) = 'Medhjälparens tråd', 'rätt tråd';
  assert (select count(*) from ai_usage) = 0, 'bara ägaren ser AI-kostnad';
  -- AC-25: chatbotens källor för en medhjälpare saknar pris och anteckningar
  assert exists (select 1 from search_vreta('mässingshandtag')), 'medhjälparen kan söka';
  assert not exists (select 1 from acquisition_private), 'inga priser';
  assert not exists (select 1 from person_private where notes = 'Hemlig anteckning'), 'inga privata anteckningar';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin assert (select count(*) from ask_threads) = 1 and (select title from ask_threads) = 'Ägarens tråd', 'inte ens ägaren ser andras trådar'; end $$;
reset role;
select 'M5-TESTER GODKÄNDA' as resultat;

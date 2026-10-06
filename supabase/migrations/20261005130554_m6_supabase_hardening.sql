-- VRETA R1 · Härdning efter Supabase-rådgivarna (security/performance advisors)
-- Inga funktionella ändringar: snävare rättigheter, fast search_path och snabbare RLS.

-- ---------------------------------------------------------------- triggerfunktioner anropas aldrig direkt
-- Rättigheten kontrolleras bara när triggern skapas, så triggrarna fungerar som förut.
revoke execute on function acquisitions_on_status_change(), check_status_transition(), content_consents_audit(),
  content_on_change(), link_site_on_event(), objects_on_status_change(), objects_sync_allocations(),
  persons_on_consent_change(), pickups_on_status_change(), sites_after_insert(), ask_threads_touch(),
  check_allocation_sum(), persons_guard_consent()
  from public, anon, authenticated;

-- Standardmallar skapas bara via sites-triggern (som körs av bootstrap_site).
revoke execute on function default_checklists(uuid) from public, anon, authenticated;

-- Utloggade besökare ska inte kunna anropa något av detta.
revoke execute on function bootstrap_site(text, text), member_role_for(uuid), can_write(), ai_tokens_this_month(uuid)
  from public, anon;
grant execute on function bootstrap_site(text, text), member_role_for(uuid), can_write(), ai_tokens_this_month(uuid)
  to authenticated;

-- Tokenförbrukning bara för den egna platsen.
create or replace function ai_tokens_this_month(p_site uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(input_tokens + output_tokens), 0) from ai_usage
   where site_id = p_site and created_at >= date_trunc('month', now())
     and member_role_for(p_site) is not null;
$$;

-- ---------------------------------------------------------------- fast search_path
alter function is_owner(uuid) set search_path = public;
alter function is_member(uuid) set search_path = public;
alter function is_writer(uuid) set search_path = public;
alter function sees_private(uuid, uuid) set search_path = public;
alter function storage_path(uuid) set search_path = public;
alter function zone_at(uuid, double precision, double precision) set search_path = public;
alter function batch_summary_status(uuid) set search_path = public;
alter function sync_batch(uuid) set search_path = public;
alter function ensure_allocations(uuid) set search_path = public;
alter function vreta_tsquery(text) set search_path = public;
alter function persons_guard_consent() set search_path = public;
alter function sites_after_insert() set search_path = public;
alter function check_allocation_sum() set search_path = public;
alter function ask_threads_touch() set search_path = public;

-- ---------------------------------------------------------------- auth.uid() en gång per fråga, inte per rad
alter policy audit_insert on audit_entries
  with check (is_writer(site_id) and actor = (select auth.uid()));

alter policy ask_threads_own on ask_threads
  using (created_by = (select auth.uid()) and is_member(site_id))
  with check (created_by = (select auth.uid()) and is_member(site_id));

alter policy ai_usage_insert on ai_usage
  with check (is_member(site_id) and created_by = (select auth.uid()));

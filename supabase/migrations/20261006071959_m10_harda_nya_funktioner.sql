-- VRETA R1 · M10: samma härdning för funktionerna i M6–M9 som m6_supabase_hardening gjorde för M1–M5.
-- Triggerfunktioner ska inte kunna anropas direkt; RPC:er bara av inloggade (anonyma gäster räknas som inloggade).

revoke execute on function resolve_project(), projects_touch(), projects_rename(), need_fulfillments_journal(),
  needs_touch(), person_relations_check()
  from public, anon, authenticated;

revoke execute on function set_disposal_place(uuid, uuid), need_fulfilled(uuid), is_guest(uuid), event_names_unconsented(uuid),
  create_guest_link(text), redeem_guest_link(text), revoke_guest_link(uuid)
  from public, anon;
grant execute on function set_disposal_place(uuid, uuid), need_fulfilled(uuid), is_guest(uuid), event_names_unconsented(uuid),
  create_guest_link(text), redeem_guest_link(text), revoke_guest_link(uuid)
  to authenticated;

alter function need_fulfilled(uuid) set search_path = public;

// AI-kostnad per funktion (NFR-014): loggas efter varje anrop och kan begränsas med ett månadstak.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function siteOf(sb: SupabaseClient): Promise<{ site_id: string; role: "owner" | "contributor" | "viewer" } | null> {
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data } = await sb.from("site_members").select("site_id, role").eq("user_id", auth.user.id).limit(1);
  return (data?.[0] as { site_id: string; role: "owner" | "contributor" | "viewer" }) ?? null;
}

/** true om platsens månadstak för AI är nått. */
export async function overCap(sb: SupabaseClient, siteId: string): Promise<boolean> {
  const [{ data: site }, { data: used }] = await Promise.all([
    sb.from("sites").select("ai_monthly_token_cap").eq("id", siteId).single(),
    sb.rpc("ai_tokens_this_month", { p_site: siteId }),
  ]);
  const cap = (site as { ai_monthly_token_cap: number | null } | null)?.ai_monthly_token_cap;
  return cap != null && Number(used ?? 0) >= cap;
}

export async function logUsage(sb: SupabaseClient, siteId: string, fn: string, model: string, usage: { input_tokens: number; output_tokens: number } | undefined) {
  if (!usage) return;
  await sb.from("ai_usage").insert({ site_id: siteId, function: fn, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
}

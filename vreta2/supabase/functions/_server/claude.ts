// Claude för agenterna. Nyckeln finns bara här på servern (funktionens hemlighet ANTHROPIC_API_KEY).
// Reservmodell vid avböjande är påslagen (fallbacks: "default"); ett avböjande som ändå kommer
// tillbaka hanteras som "ingen AI" – appen använder då den lokala reserven (Designdokument 2.0).
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { command, HttpError, query, type Ctx } from "./http.ts";

export const MODEL = "claude-opus-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// USD per miljon token (Claude Opus 5.5) – för kostnadsuppföljning och månadstak (NFR-014)
const PRICE = { input: 4, output: 20, cache_read: 0.2, cache_write: 5 };

export const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

export class RefusedError extends Error {}

export function costUsd(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number {
  return (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output
    + (u.cache_read_input_tokens ?? 0) * PRICE.cache_read + (u.cache_creation_input_tokens ?? 0) * PRICE.cache_write) / 1_000_000;
}

// Månadstaket per plats: när det är nått svarar funktionen 429 och appen använder den lokala reserven.
export async function assertBudget(ctx: Ctx): Promise<void> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new HttpError(503, "no_ai", "AI är inte konfigurerat på servern");
  const cap = Number(ctx.settings.ai_monthly_cap_usd ?? 0);
  if (!cap) return;
  const s = await query<any>(ctx.sb, "q_settings");
  const month = new Date().toISOString().slice(0, 7);
  const used = (s?.ai_usage ?? []).filter((u: any) => String(u.month ?? "").startsWith(month)).reduce((n: number, u: any) => n + Number(u.cost_usd ?? 0), 0);
  if (used >= cap) throw new HttpError(429, "cap_reached", "Månadens AI-tak är nått");
}

export async function recordUsage(sb: SupabaseClient<any, any, any>, fn: string, usage: Parameters<typeof costUsd>[0] | undefined): Promise<void> {
  if (!usage) return;
  await command(sb, "RecordAiUsage", { function_name: fn, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: costUsd(usage) }, fn)
    .catch((e) => console.warn("RecordAiUsage", e));
}

export function apiErrorResponse(e: unknown): HttpError | null {
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, "rate_limited");
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(503, "no_ai", "Fel API-nyckel på servern");
  if (e instanceof Anthropic.APIError) return new HttpError(502, "upstream", `Claude svarade ${e.status}`);
  return null;
}

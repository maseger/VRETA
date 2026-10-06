// POST { text, kind, images: [{ media_type, data }] } → strukturerat förslag från Claude.
// Kräver inloggad användare med rätt att registrera (owner/contributor).
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { AgentRefusedError, runCaptureAgent, type CaptureImage } from "../_shared/agents.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { logUsage, overCap, siteOf } from "../_shared/usage.ts";

const anthropic = new Anthropic(); // läser ANTHROPIC_API_KEY från funktionens hemligheter

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: "unauthorized" }, 401);

  const { data: canWrite } = await supabase.rpc("can_write");
  if (!canWrite) return json({ error: "forbidden" }, 403);
  const member = await siteOf(supabase);
  if (member && (await overCap(supabase, member.site_id))) return json({ error: "cap_reached" }, 429);

  const body = (await req.json()) as { text?: string; kind?: string; images?: CaptureImage[] };
  const images = (body.images ?? []).slice(0, 6);
  // Namn på projekt och platser hjälper agenten att använda samma namn (läses med användarens inloggning)
  const [{ data: projects }, { data: places }] = await Promise.all([
    supabase.from("projects").select("name").neq("status", "done").is("archived_at", null).limit(50),
    supabase.from("external_places").select("name").is("archived_at", null).limit(50),
  ]);

  try {
    const proposal = await runCaptureAgent(anthropic, {
      text: (body.text ?? "").slice(0, 4000),
      kind: body.kind ?? "find",
      images,
      today: new Date().toISOString().slice(0, 10),
      known: { projects: (projects ?? []).map((p) => p.name as string), places: (places ?? []).map((p) => p.name as string) },
    }, (model, usage) => member ? logUsage(supabase, member.site_id, "capture-agent", model, usage) : undefined);
    return json({ proposal });
  } catch (err) {
    if (err instanceof AgentRefusedError) return json({ error: "refused" }, 422);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: "upstream", status: err.status }, 502);
    console.error("capture-agent:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    return json({ error: "internal" }, 500);
  }
});

// Story Agent på klientsidan. Med Supabase byggs och rensas kontexten på servern;
// i demoläge görs samma sak lokalt och utkasten skrivs från mallar.
import type { Channel, ContentGoal } from "../domain/types";
import { STATUS_LABEL } from "../domain/labels";
import type { Repo } from "../data/repo";
import { SupabaseRepo } from "../data/supabaseRepo";
import { guardStoryContext } from "../../supabase/functions/_shared/privacyGuard";
import { buildRawStoryContext } from "../../supabase/functions/_shared/storyContext";
import { draftStory } from "../../supabase/functions/_shared/storyTemplates";

export interface StoryDraftResult {
  ok: boolean;
  variants: { channel: Channel; text: string }[];
  media_ids: string[];
  removed: string[];
  warnings: string[];
  source: "claude" | "mall";
}

export async function draftForObject(repo: Repo, objectId: string, goal: ContentGoal, channels: Channel[], contentId?: string): Promise<StoryDraftResult> {
  if (repo instanceof SupabaseRepo) {
    const { data, error } = await repo.client.functions.invoke<{
      variants: { channel: Channel; text: string }[]; media_ids: string[]; removed: string[]; warnings: string[]; error?: string;
    }>("story-agent", { body: { object_id: objectId, goal, channels, content_id: contentId } });
    if (!error && data && !data.error) return { ok: true, ...data, source: "claude" };
    if (data?.error === "not_publishable") return { ok: false, variants: [], media_ids: [], removed: [], warnings: data.warnings ?? [], source: "claude" };
    // Servern äger rättigheterna till kontexten, så klienten bygger den inte själv vid fel.
    return { ok: false, variants: [], media_ids: [], removed: [], warnings: ["Kunde inte nå Story Agent. Försök igen när du har nät."], source: "claude" };
  }

  const obj = await repo.object(objectId);
  if (!obj) throw new Error("Objektet finns inte");
  const raw = buildRawStoryContext(await repo.storyRows(objectId, contentId));
  const guard = guardStoryContext(raw, STATUS_LABEL[obj.status]);
  if (!guard.allowed || !guard.context) return { ok: false, variants: [], media_ids: [], removed: guard.removed, warnings: guard.warnings, source: "mall" };
  return {
    ok: true,
    variants: channels.map((channel) => ({ channel, text: draftStory(guard.context!, goal, channel) })),
    media_ids: guard.context.media_ids,
    removed: guard.removed,
    warnings: guard.warnings,
    source: "mall",
  };
}

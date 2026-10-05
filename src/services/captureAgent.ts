// Capture Agent på klientsidan: Claude via edge-funktionen när det går, annars lokal tolkning.
import type { Capture, ProposalContent } from "../domain/types";
import type { Repo } from "../data/repo";
import { SupabaseRepo } from "../data/supabaseRepo";
import { parseCaptureText } from "../../supabase/functions/_shared/captureHeuristics";
import type { CaptureProposalOut } from "../../supabase/functions/_shared/agentSchemas";
import { fromAgent, fromHeuristics } from "./proposalMapping";
import { toAgentImage } from "./images";

export async function proposeForCapture(repo: Repo, capture: Capture): Promise<ProposalContent> {
  const people = await repo.persons();
  if (repo instanceof SupabaseRepo && navigator.onLine) {
    try {
      const media = await repo.mediaFor("capture", capture.id);
      const images = [];
      for (const m of media.slice(0, 6)) {
        const blob = await repo.mediaBlob(m);
        if (blob) images.push(await toAgentImage(blob));
      }
      const { data, error } = await repo.client.functions.invoke<{ proposal: CaptureProposalOut }>("capture-agent", {
        body: { text: capture.input.text, kind: capture.input.kind, images },
      });
      if (!error && data?.proposal) return fromAgent(data.proposal, people);
    } catch {
      // faller tillbaka till lokal tolkning nedan
    }
  }
  return fromHeuristics(parseCaptureText(capture.input.text), people);
}

/** Tolkar fångster som sparats offline och saknar förslag. */
export async function processPendingCaptures(repo: Repo): Promise<number> {
  if (!navigator.onLine) return 0;
  const pending = await repo.capturesWithoutProposal();
  for (const c of pending) {
    const content = await proposeForCapture(repo, c);
    await repo.attachProposal(c.id, content);
  }
  return pending.length;
}

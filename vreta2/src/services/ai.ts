// AI-lagret i appen: anropar serverfunktionerna (Claude) när de finns och nätet fungerar, annars den
// lokala reserven med samma regler. Alla agenter gör förslag som en människa granskar, och alla har en
// reserv utan AI (Designdokument 2.0, AI-funktioner).
import type { Repo } from "../data/repo";
import { interpretLocally } from "@shared/captureLocal.ts";
import { guardStory } from "@shared/privacyGuard.ts";
import { writeStory } from "@shared/storyTemplates.ts";
import { adapterFromCode, buildChannelPackage, suggestPrice, type ChannelPackage } from "@shared/listingPackage.ts";
import { answerLocally, type Answer } from "@shared/knowledgeLocal.ts";
import type { CaptureKnowledge, ChannelAdapter, GuardResult, StoryContextRaw } from "@shared/types.ts";
import type { CodeValue } from "../app/AppContext";

async function tryServer<T>(repo: Repo, fn: string, body: Record<string, unknown>): Promise<T | null> {
  if (repo.mode !== "supabase" || !repo.online()) return null;
  try {
    return await repo.invoke<T>(fn, body);
  } catch (e) {
    console.warn(`${fn} svarade inte – lokal reserv används`, e);
    return null;
  }
}

export async function captureKnowledge(repo: Repo, here?: CaptureKnowledge["here"], screen?: CaptureKnowledge["screen"]): Promise<CaptureKnowledge> {
  const [people, places, projects] = await Promise.all([
    repo.query<any[]>("q_people").catch(() => []),
    repo.query<any>("q_places").catch(() => null),
    repo.query<any[]>("q_projects").catch(() => []),
  ]);
  const external = (places?.localities ?? []).flatMap((l: any) => l.places.map((p: any) => ({ id: p.id, name: p.name, type: "external_place" })))
    .concat((places?.external_without_locality ?? []).map((p: any) => ({ id: p.id, name: p.name, type: "external_place" })));
  return {
    people: people.map((p) => ({ id: p.id, display_name: p.display_name, locality: p.locality, roles: p.roles })),
    places: external,
    projects: projects.map((p) => ({ id: p.id, name: p.name, needs: (p.canvas?.needs ?? []).map((n: any) => ({ id: n.id, title: n.title, unit: n.unit, quantity: n.quantity })) })),
    here: here ?? null,
    screen: screen ?? null,
  };
}

// Capture Agent: tolkar fångsten till ett förslag med evidens per fält.
export async function interpretCapture(repo: Repo, capture: { id: string; text?: string | null; transcript?: string | null; kind_hint?: string | null },
                                       here?: CaptureKnowledge["here"], screen?: CaptureKnowledge["screen"]): Promise<{ proposal_id?: string; queued?: boolean; local: boolean } | null> {
  const server = await tryServer<{ proposal_id: string }>(repo, "capture-agent", { capture_id: capture.id, here, screen });
  if (server?.proposal_id) return { proposal_id: server.proposal_id, local: false };
  const knowledge = await captureKnowledge(repo, here, screen).catch(() => ({ people: [], places: [], projects: [] } as CaptureKnowledge));
  const draft = interpretLocally({ text: capture.text, transcript: capture.transcript, kind_hint: capture.kind_hint }, knowledge);
  const r = await repo.command<{ proposal_id: string }>("CreateProposal", { capture_id: capture.id, agent: draft.agent, summary: draft.summary, cards: draft.cards }, { label: "Förslag" });
  if (r.status === "accepted") return { proposal_id: r.result?.proposal_id, local: true };
  if (r.status === "queued") return { queued: true, local: true };
  return null;
}

export type StoryDrafts = GuardResult & { drafts: Record<string, string>; local: boolean };

// Story Agent: Privacy Guard bygger den rensade kontexten; utkast per kanal.
export async function draftStory(repo: Repo, opts: { source_ids: string[]; person_ids?: string[]; goal: string; channels: CodeValue[]; tone?: "warm" | "plain" | "short" }): Promise<StoryDrafts> {
  const server = await tryServer<StoryDrafts>(repo, "story-agent", {
    source_ids: opts.source_ids, person_ids: opts.person_ids, goal: opts.goal, channels: opts.channels.map((c) => c.code), tone: opts.tone,
  });
  if (server?.drafts) return { ...server, local: false };
  const raw = await repo.query<StoryContextRaw>("q_story_context", { source_ids: opts.source_ids, person_ids: opts.person_ids ?? [] });
  const adapters = opts.channels.map((c) => adapterFromCode(c));
  const privateOnly = adapters.every((a) => a.code === "private_message");
  const g = guardStory(raw, { goal: opts.goal, channelKind: privateOnly ? "private" : "public", personIds: opts.person_ids });
  const drafts: Record<string, string> = {};
  if (g.allowed) for (const a of adapters) drafts[a.code] = writeStory(g.context, a, opts.tone ?? "warm");
  return { ...g, drafts, local: true };
}

// Marketplace Agent: annonspaket per kanal med prisförslag och motivering.
export async function listingPackages(repo: Repo, listingId: string, channels: CodeValue[]): Promise<{ packages: Record<string, ChannelPackage>; price: { price: number | null; rationale: string }; local: boolean }> {
  const server = await tryServer<{ packages: Record<string, ChannelPackage>; price: { price: number | null; rationale: string } }>(repo, "marketplace-agent", { listing_id: listingId, channels: channels.map((c) => c.code) });
  if (server?.packages) return { ...server, local: false };
  const pkg = await repo.query<any>("q_listing_package", { listing_id: listingId });
  const listing = await repo.query<any>("q_listing", { id: listingId });
  const forbidden = (listing.object?.acquisitions ?? []).flatMap((a: any) => a.counterpart ? [a.counterpart.display_name, a.counterpart.display_name.split(" ")[0]] : []);
  const storage = ((await repo.query<any[]>("q_storage_tree").catch(() => [])) ?? []).map((s) => s.name);
  const packages: Record<string, ChannelPackage> = {};
  for (const c of channels) packages[c.code] = buildChannelPackage(pkg, adapterFromCode(c), { forbiddenNames: forbidden, storagePlaces: storage });
  return { packages, price: suggestPrice(pkg), local: true };
}

export type AskResult = Answer & { thread_id?: string; local: boolean };

// Fråga Vreta: svar med källkort, allmänna råd märkta som allmänna råd, åtgärder via Action Preview.
export async function ask(repo: Repo, question: string, opts: { thread_id?: string | null; screen?: Answer extends never ? never : any; history?: { role: string; content: string }[] } = {}): Promise<AskResult> {
  const server = await tryServer<AskResult>(repo, "ask-vreta", { question, thread_id: opts.thread_id, screen: opts.screen, history: opts.history });
  if (server?.text) return { ...server, local: false };
  const a = await answerLocally(question, (tool, args) => repo.query("q_tool", { tool, args }), { screen: opts.screen });
  return { ...a, local: true };
}

export type { ChannelAdapter };

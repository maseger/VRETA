// Anrop till Claude för Capture Agent och Story Agent. Körs bara på servern
// (Supabase Edge Functions) så att API-nyckeln aldrig når klienten.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  CAPTURE_SYSTEM,
  CaptureProposalSchema,
  ListingPackagesSchema,
  MARKETPLACE_SYSTEM,
  STORY_SYSTEM,
  StoryDraftSchema,
  type CaptureProposalOut,
} from "./agentSchemas.ts";
import type { SafeStoryContext } from "./privacyGuard.ts";
import type { SafeListingContext } from "./listingPackage.ts";
import type { ChannelAdapter } from "./channels.ts";

const MODEL = "claude-opus-5-5";

export class AgentRefusedError extends Error {}

/** Anropas med tokenförbrukningen efter varje svar, för kostnadsuppföljning (NFR-014). */
export type UsageSink = (model: string, usage: { input_tokens: number; output_tokens: number }) => void | Promise<void>;

export interface CaptureImage {
  media_type: "image/jpeg" | "image/png" | "image/webp";
  data: string; // base64 utan radbrytningar
}

export async function runCaptureAgent(
  client: Anthropic,
  input: { text: string; kind: string; images: CaptureImage[]; today: string },
  onUsage?: UsageSink,
): Promise<CaptureProposalOut> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...input.images.map(
      (img): Anthropic.Beta.BetaImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.media_type, data: img.data },
      }),
    ),
    {
      type: "text",
      text: `Dagens datum: ${input.today}\nTyp av fångst: ${input.kind}\nAnvändarens beskrivning: ${input.text || "(ingen text, tolka bilderna)"}`,
    },
  ];

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(CaptureProposalSchema) },
    system: CAPTURE_SYSTEM,
    messages: [{ role: "user", content }],
  });

  await onUsage?.(MODEL, response.usage);
  if (response.stop_reason === "refusal") throw new AgentRefusedError("Capture Agent avböjde förfrågan");
  if (!response.parsed_output) throw new Error("Capture Agent gav inget tolkningsbart svar");
  return response.parsed_output;
}

export async function runStoryAgent(
  client: Anthropic,
  input: { context: SafeStoryContext; goal: string; channels: string[] },
  onUsage?: UsageSink,
): Promise<{ channel: string; text: string }[]> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(StoryDraftSchema) },
    system: STORY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Mål: ${input.goal}\nKanaler: ${input.channels.join(", ")}\nKontext (redan rensad av Privacy Guard):\n${JSON.stringify(input.context, null, 2)}`,
      },
    ],
  });

  await onUsage?.(MODEL, response.usage);
  if (response.stop_reason === "refusal") throw new AgentRefusedError("Story Agent avböjde förfrågan");
  if (!response.parsed_output) throw new Error("Story Agent gav inget tolkningsbart svar");
  return response.parsed_output.variants.filter((v) => input.channels.includes(v.channel));
}

export async function runMarketplaceAgent(
  client: Anthropic,
  input: { context: SafeListingContext; price_label: string; channels: ChannelAdapter[] },
  onUsage?: UsageSink,
): Promise<{ channel: string; title: string; text: string }[]> {
  const channels = input.channels.map((c) => ({ id: c.id, name: c.name, title_max_length: c.title_max_length, text_max_length: c.text_max_length, footer: c.footer }));
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ListingPackagesSchema) },
    system: MARKETPLACE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Kanaler:\n${JSON.stringify(channels, null, 2)}\nprice_label: ${input.price_label || "(tomt)"}\nKontext (redan rensad):\n${JSON.stringify({ ...input.context, media_ids: undefined }, null, 2)}`,
      },
    ],
  });
  await onUsage?.(MODEL, response.usage);
  if (response.stop_reason === "refusal") throw new AgentRefusedError("Marketplace Agent avböjde förfrågan");
  if (!response.parsed_output) throw new Error("Marketplace Agent gav inget tolkningsbart svar");
  const wanted = new Set(input.channels.map((c) => c.id));
  return response.parsed_output.packages.filter((p) => wanted.has(p.channel));
}

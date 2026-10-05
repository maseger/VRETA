// Tack till en person (4.8, AC-10). Kontexten rensas av guardThanks; utkasten skrivs från
// mallar och nämner personen bara enligt samtycke – eller samtycke för just detta inlägg.
import type { Repo } from "../data/repo";
import type { Channel } from "../domain/types";
import { guardThanks, type RawThanksContext, type SafeThanksContext } from "../../supabase/functions/_shared/privacyGuard";
import { draftThanks } from "../../supabase/functions/_shared/storyTemplates";

export interface ThanksDraft {
  variants: { channel: Channel; text: string }[];
  media_ids: string[];
  removed: string[];
  warnings: string[];
  context: SafeThanksContext;
  contribution_ids: string[];
}

export async function rawThanksContext(repo: Repo, personId: string, contentId?: string): Promise<{ raw: RawThanksContext; contribution_ids: string[] }> {
  const person = await repo.person(personId);
  if (!person) throw new Error("Personen finns inte");
  const [contributions, acquisitions, objects, usage, zones, structures, consents] = await Promise.all([
    repo.contributions(personId),
    repo.allAcquisitions(),
    repo.objects(),
    repo.allUsageEvents(),
    repo.zones(),
    repo.structures(),
    contentId ? repo.contentConsents(contentId) : Promise.resolve([]),
  ]);
  const fromPerson = acquisitions.filter((a) => a.person_id === personId);
  const objectIds = new Set([...fromPerson.map((a) => a.object_id), ...contributions.map((c) => c.object_id).filter(Boolean) as string[]]);
  const objs = objects.filter((o) => objectIds.has(o.id));
  const media = (await Promise.all(objs.map((o) => repo.mediaFor("object", o.id)))).flat();
  const placeName = (zoneId: string | null, structureId: string | null) =>
    zones.find((z) => z.id === zoneId)?.name ?? structures.find((s) => s.id === structureId)?.name ?? null;
  const override = consents.find((c) => c.person_id === personId);
  const open = contributions.filter((c) => !c.thanked_at);
  return {
    contribution_ids: open.map((c) => c.id),
    raw: {
      person: {
        name: person.name, locality: person.locality, contact: person.contact ?? "", notes: person.notes ?? "",
        consent_name: person.consent_name, consent_image: person.consent_image, consent_contribution: person.consent_contribution,
        consent_override: override ? { name_ok: override.name_ok, contribution_ok: override.contribution_ok } : null,
      },
      contributions: (open.length ? open : contributions).map((c) => ({ kind: c.kind, description: c.description, visibility: c.visibility, hours: c.hours })),
      objects: objs.map((o) => {
        const last = usage.find((u) => u.object_id === o.id && u.type !== "removed");
        return {
          title: o.title, visibility: o.visibility, status: o.status,
          new_life_place: placeName(last?.zone_id ?? o.zone_id, last?.structure_id ?? o.structure_id),
          price: fromPerson.find((a) => a.object_id === o.id)?.price ?? null,
        };
      }),
      media: media.map((m) => ({ id: m.id, visibility: m.visibility, has_people: m.has_people, has_clean: !!m.clean_path })),
    },
  };
}

export async function draftThanksForPerson(repo: Repo, personId: string, channels: Channel[], contentId?: string): Promise<ThanksDraft> {
  const { raw, contribution_ids } = await rawThanksContext(repo, personId, contentId);
  const g = guardThanks(raw);
  const ctx = g.thanks!;
  return {
    variants: channels.map((channel) => ({ channel, text: draftThanks(ctx, channel) })),
    media_ids: ctx.media_ids,
    removed: g.removed,
    warnings: g.warnings,
    context: ctx,
    contribution_ids,
  };
}

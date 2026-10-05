// Mallbaserade utkast när Story Agent inte kan nås (demoläge, offline, fel).
// Bygger enbart på den rensade kontexten från Privacy Guard.
import type { SafeStoryContext } from "./privacyGuard.ts";

export type Goal = "fyndet" | "resan" | "fore_efter" | "tack" | "visa_vad_som_hant";
export type StoryChannel = "facebook" | "instagram" | "linkedin" | "privat";

function subject(ctx: SafeStoryContext): string {
  const o = ctx.object;
  const qty = o.is_batch || o.quantity > 1 ? `${o.quantity} ${o.unit === "st" ? "" : o.unit + " "}`.replace(/\s+$/, " ") : "";
  return `${qty}${o.title.charAt(0).toLowerCase()}${o.title.slice(1)}`.trim();
}

function giver(ctx: SafeStoryContext): string {
  const p = ctx.people.find((p) => p.relation === "leverantör" || p.relation === "givare");
  if (!p) return "";
  return p.name ? ` från ${p.name}` : "";
}

function hashtags(ctx: SafeStoryContext): string {
  const tags = ["#återbruk", "#byggnadsvård", "#vreta"];
  if (ctx.object.category === "Växter") tags.push("#trädgård");
  return tags.join(" ");
}

export function draftStory(ctx: SafeStoryContext, goal: Goal, channel: StoryChannel): string {
  const s = subject(ctx);
  const why = ctx.why[0] ? ` ${ctx.why[0].replace(/\.?$/, ".")}` : "";
  const how = ctx.acquisition_kind ? ` Vi har ${ctx.acquisition_kind}${giver(ctx)}.` : giver(ctx) ? ` De kommer${giver(ctx)}.` : "";
  const facts = [ctx.object.material, ctx.object.era, ctx.object.dimensions].filter(Boolean).join(", ");
  const quote = ctx.quotes[0] ? `\n\n”${ctx.quotes[0]}”` : "";

  let core: string;
  switch (goal) {
    case "fyndet":
      core = `Nytt fynd till Vreta: ${s}.${why}${how}${facts ? ` (${facts})` : ""}${quote}`;
      break;
    case "resan":
      core = `${s.charAt(0).toUpperCase() + s.slice(1)} – resan hittills:\n${ctx.events.map((e) => `· ${e.date}: ${e.summary}`).join("\n")}${quote}`;
      break;
    case "fore_efter":
      core = `Före och efter: ${s}.${why} Status nu: ${ctx.object.status_label.toLowerCase()}.`;
      break;
    case "tack": {
      const named = ctx.people.filter((p) => p.name);
      core = named.length
        ? `Ett stort tack till ${named.map((p) => p.name).join(" och ")} för ${s}!${why}`
        : `Ett stort tack till den som gav oss ${s}!${why}`;
      break;
    }
    default:
      core = `På Vreta just nu: ${s}.${why}`;
  }

  switch (channel) {
    case "instagram":
      return `${core}\n\n${hashtags(ctx)}`;
    case "linkedin":
      return `${core}\n\nVi bygger Vreta med återbrukat material – varje del har en historia och ett nytt liv.`;
    case "privat":
      return `Hej! Ville visa dig hur det blev: ${s}.${why} Tack igen!`;
    default:
      return `${core}\n\nVet du någon som har något liknande, eller vill du bidra? Hör av dig!`;
  }
}

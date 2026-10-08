// Berättelser från mallar: reserven när Story Agent inte nås, och skrivaren i demoläget. Använder bara den
// rensade kontexten från Privacy Guard – inga påhittade händelser, siffror eller citat (R1.1 8.6).
import type { ChannelAdapter, CleanContext } from "./types.ts";

export const GOAL_LABELS: Record<string, string> = {
  story: "Berätta historien", before_after: "Före/efter", thanks: "Tacka", wanted: "Efterlys",
  show_what_happened: "Visa vad som hänt", weekly: "Veckans Vreta", offer: "Erbjudande", year_later: "Ett år senare",
};

const USAGE_VERB: Record<string, string> = {
  mounted: "monterats", planted: "planterats", installed: "installerats", built_in: "byggts in", renovated: "renoverats", moved: "flyttats",
};

function lower(s?: string | null) {
  return (s ?? "").toLocaleLowerCase("sv");
}
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}`;
}
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function mainSource(ctx: CleanContext) {
  return ctx.sources.find((s) => s.type === "object") ?? ctx.sources[0];
}

export function writeStory(ctx: CleanContext, channel: Pick<ChannelAdapter, "code" | "kind" | "hashtags">, tone: "warm" | "plain" | "short" = "warm"): string {
  const src = mainSource(ctx);
  const f = src?.facts ?? {};
  const label = f.label ?? src?.title ?? ctx.site_name;
  const lastUse = Array.isArray(f.usage) && f.usage.length ? f.usage[f.usage.length - 1] : null;
  const where = lastUse?.place ?? f.place ?? null;
  const peopleNames = ctx.people.map((p) => p.name.split(" ")[0]);
  const why = ctx.why[0] ?? f.story_why ?? null;
  const lines: string[] = [];

  switch (ctx.goal) {
    case "thanks": {
      if (ctx.people.length) {
        const detail = ctx.people.map((p) => p.contribution ? `${p.name.split(" ")[0]} för ${lower(p.contribution)}` : p.name.split(" ")[0]);
        lines.push(`Tack ${list(detail)}!`);
      } else {
        lines.push(`Tack till alla som bidragit till ${src?.type === "project" ? lower(src.title) : "Vreta"}!`);
      }
      if (lastUse && where) lines.push(sentence(`${label} har ${USAGE_VERB[lastUse.type] ?? "fått nytt liv"} i ${where}`));
      else if (src?.moments?.length) lines.push(sentence(src.moments[src.moments.length - 1]));
      break;
    }
    case "before_after":
    case "year_later": {
      lines.push(ctx.goal === "year_later" ? `Ett år senare: ${lower(label)}.` : `Före och efter: ${lower(label)}.`);
      if (why) lines.push(sentence(why));
      if (lastUse && where) lines.push(sentence(`Nu har de ${USAGE_VERB[lastUse.type] ?? "fått nytt liv"} i ${where}`));
      if (ctx.people.length) lines.push(`Tack ${list(peopleNames)}!`);
      break;
    }
    case "wanted": {
      const needs = (f.needs as { title: string; progress: string }[] | undefined) ?? [];
      lines.push(sentence(`Vi söker ${needs.length ? lower(needs[0].title) : lower(f.title ?? label)}${needs[0]?.progress ? ` – ${needs[0].progress} hittills` : ""}`));
      if (f.description) lines.push(sentence(f.description));
      lines.push("Har du något liggande, eller vet du var det finns? Hör av dig!");
      break;
    }
    case "offer": {
      lines.push(sentence(`Ny i lager: ${lower(f.title ?? label)} som söker nytt hem`));
      if (f.description) lines.push(sentence(f.description));
      if (f.price) lines.push(`${f.price} kr.`);
      break;
    }
    case "weekly":
    case "show_what_happened": {
      lines.push(ctx.goal === "weekly" ? `Veckans ${ctx.site_name}:` : `Det här har hänt på ${ctx.site_name}:`);
      const moments = ctx.sources.flatMap((s) => s.moments).slice(-5);
      for (const m of moments) lines.push(`– ${sentence(m)}`);
      if (ctx.people.length) lines.push(`Tack ${list(peopleNames)}!`);
      break;
    }
    default: {
      lines.push(sentence(`${label}${f.age_period ? ` från ${lower(f.age_period)}` : ""}${f.material ? ` i ${lower(f.material)}` : ""}`));
      if (why) lines.push(sentence(why));
      if (lastUse && where) lines.push(sentence(`Nu har de ${USAGE_VERB[lastUse.type] ?? "fått nytt liv"} i ${where}`));
      else if (src?.moments?.length) lines.push(sentence(src.moments[src.moments.length - 1]));
      if (ctx.people.length) lines.push(`Tack ${list(peopleNames)}!`);
    }
  }
  for (const q of ctx.quotes.slice(0, 1)) lines.push(`"${q.text}" – ${q.person_name.split(" ")[0]}`);

  let text = lines.filter(Boolean).join(tone === "short" || channel.code === "instagram" ? " " : "\n\n");
  if (tone === "plain") text = text.replace(/!/g, ".");
  if (channel.code === "linkedin") text = text.replace(/!/g, ".") + "\n\nÅterbruk och regenerativ platsutveckling i praktiken.";
  if (channel.code === "facebook" && ctx.goal !== "thanks") text += `\n\nFölj ${ctx.site_name} för fler berättelser om återbruk.`;
  if (channel.hashtags || channel.code === "instagram") text += `\n\n#återbruk #${ctx.site_name.toLocaleLowerCase("sv").replace(/\s+/g, "")} #permakultur`;
  return text.trim();
}

export function thanksMessage(personName: string, objectLabel?: string | null, place?: string | null): string {
  const first = personName.split(" ")[0];
  if (objectLabel && place) return `Hej ${first}! Jag ville visa dig var ${lower(objectLabel)} hamnade – de har fått nytt liv i ${place}. Tack igen!`;
  return `Hej ${first}! Tack för ditt bidrag till Vreta – det betyder mycket.`;
}

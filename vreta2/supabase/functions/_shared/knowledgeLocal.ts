// Fråga Vreta utan AI: fasta frågetyper mot de definierade verktygen (api.q_tool) och lokal sökning.
// Reserven när Claude inte nås, och chatten i demoläget. Varje svar om egen data bär källor (INV-10);
// åtgärder föreslås som kommandon och utförs först efter godkännande i Action Preview.

export type ToolRunner = (tool: string, args: Record<string, unknown>) => Promise<any>;
export type EntityRef = { id: string; type: string; title: string; route?: string | null; type_label?: string };
export type ProposedAction = {
  key: string;
  command_type: string;
  payload: Record<string, unknown>;
  label: string;
  effect: string;
  requires_own_tap?: boolean;
};
export type Answer = {
  text: string;
  sources: EntityRef[];
  general_advice?: string | null;
  actions?: ProposedAction[];
  navigate?: string | null;
  tool?: string;
};
export type AskContext = { screen?: { entity_id?: string; entity_type?: string; title?: string; route?: string } | null; now?: Date };

const WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

export function parseWhen(text: string, now = new Date()): { date: string; excerpt: string } | null {
  const t = text.toLocaleLowerCase("sv");
  const d = new Date(now);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (/\bi\s?morgon\b/.test(t)) { d.setDate(d.getDate() + 1); return { date: iso(d), excerpt: "i morgon" }; }
  if (/\bidag\b|\bi dag\b/.test(t)) return { date: iso(d), excerpt: "idag" };
  if (/\bnästa vecka\b/.test(t)) { d.setDate(d.getDate() + 7); return { date: iso(d), excerpt: "nästa vecka" }; }
  const wd = t.match(/\b(?:på\s+)?(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() + diff);
    return { date: iso(d), excerpt: wd[0] };
  }
  const dm = t.match(/\b(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/);
  if (dm) {
    const m = MONTHS.indexOf(dm[2]);
    let y = now.getFullYear();
    if (new Date(y, m, Number(dm[1])) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) y++;
    return { date: `${y}-${String(m + 1).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`, excerpt: dm[0] };
  }
  return null;
}

// "mässingshandtagen" → ["mässingshandtagen", "mässingshandtag"]
export function stems(word: string): string[] {
  const w = word.toLocaleLowerCase("sv").replace(/[?!.]/g, "").trim();
  const out = [w];
  for (const suf of ["arna", "erna", "orna", "ena", "en", "et", "na", "n", "ar", "er", "or"]) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) out.push(w.slice(0, -suf.length));
  }
  // fönstren → fönster, cyklarna → cykel: bestämd form där e:et i stammen faller bort
  if (w.length > 5 && /[^aeiouyåäö][rl]en$/.test(w)) out.push(w.slice(0, -3) + "e" + w.slice(-3, -2));
  if (w.length > 6 && /[^aeiouyåäö][rl]arna$/.test(w)) out.push(w.slice(0, -5) + "e" + w.slice(-5, -4));
  return [...new Set(out)];
}

function refs(rows: any[], key = "source"): EntityRef[] {
  return rows.map((r) => r?.[key]).filter(Boolean);
}
function strip(s: string): string {
  return s.replace(/^(den|det|de|mina|våra|vår|min)\s+/i, "").replace(/[?.!]+$/, "").trim();
}

async function find(run: ToolRunner, what: string): Promise<any[]> {
  // "fönstren från Ockelbo" → saken "fönstren", ursprunget "Ockelbo" (givare, ort eller plats)
  const [thing, origin] = strip(what).split(/\s+från\s+/i);
  const words = thing.split(/\s+/).filter((x) => x.length > 2);
  const candidates = [...stems(thing), ...words.reverse().flatMap((x) => stems(x))];
  for (const q of [...new Set(candidates)]) {
    const r = await run("find_object", { q, origin: origin?.trim() || null });
    if (Array.isArray(r) && r.length) return r;
  }
  return [];
}

async function findPlace(run: ToolRunner, what: string): Promise<EntityRef | null> {
  const places = ["zone", "structure", "space", "storage_location", "external_place"];
  for (const q of stems(strip(what))) {
    const r = await run("search", { q, types: places, limit: 3 });
    if (Array.isArray(r) && r.length) return r[0];
  }
  return null;
}

export const SUGGESTED_QUESTIONS = [
  "Vad behöver jag följa upp idag?",
  "Vad har legat i lager längst?",
  "Vilka har jag inte tackat?",
  "Vad kan bli bra innehåll denna vecka?",
  "Hur mycket har jag köpt och sålt för i år?",
];

export async function answerLocally(question: string, run: ToolRunner, ctx: AskContext = {}): Promise<Answer> {
  const q = question.trim().replace(/\s+/g, " ");
  const t = q.toLocaleLowerCase("sv");
  const now = ctx.now ?? new Date();
  let m: RegExpMatchArray | null;

  // --- åtgärder (förslag som kräver godkännande)
  if ((m = q.match(/^(?:flytta|lägg|ställ)\s+(.+?)\s+(?:till|på|i)\s+(.+?)[.!]?$/i))) {
    const objects = await find(run, m[1].replace(/partiet$|parti$/i, ""));
    const place = await findPlace(run, m[2]);
    if (objects.length && place) {
      const o = objects[0];
      return {
        text: `Jag kan flytta ${o.label.toLocaleLowerCase("sv")} till ${place.title}. Godkänn i förhandsvisningen.`,
        sources: [o.source, place],
        actions: [{ key: "move", command_type: "MoveObject", payload: { object_id: o.source.id, to_place_id: place.id },
                    label: `Flytta ${o.label.toLocaleLowerCase("sv")} till ${place.title}`, effect: "Ändrar var saken finns" }],
        tool: "find_object",
      };
    }
    return { text: objects.length ? `Jag hittar ingen plats som heter "${m[2]}".` : `Jag hittar inget som heter "${m[1]}".`, sources: [] };
  }
  if ((m = q.match(/^(?:skapa\s+(?:en\s+)?uppgift(?:\s+att)?|påminn\s+mig(?:\s+om)?(?:\s+att)?|kom\s+ihåg\s+att)\s+(.+?)[.!]?$/i))) {
    const when = parseWhen(m[1], now);
    const title = (when ? m[1].replace(when.excerpt, "") : m[1]).replace(/\s+/g, " ").trim();
    return {
      text: `Jag skapar uppgiften "${title.charAt(0).toUpperCase() + title.slice(1)}"${when ? ` till ${when.date}` : ""}.`,
      sources: [],
      actions: [{ key: "task", command_type: "CreateTask", payload: { title: title.charAt(0).toUpperCase() + title.slice(1), due_at: when?.date ?? null, subject_entity_id: ctx.screen?.entity_id ?? null },
                  label: `Uppgift: ${title}${when ? ` (${when.date})` : ""}`, effect: "Skapar en uppgift" }],
    };
  }
  if ((m = q.match(/^gör\s+(?:en\s+)?annons\s+(?:av|för|på)\s+(.+?)[.!]?$/i))) {
    const objects = await find(run, m[1]);
    if (objects.length) return { text: `Jag öppnar annonsstudion för ${objects[0].label}.`, sources: [objects[0].source], navigate: `/annons/ny?objekt=${objects[0].source.id}` };
  }
  if ((m = q.match(/^berätta\s+om\s+(.+?)[.!]?$/i))) {
    const objects = await find(run, m[1]);
    if (objects.length) return { text: `Jag öppnar Berätta för ${objects[0].label}.`, sources: [objects[0].source], navigate: `/beratta?kalla=${objects[0].source.id}` };
  }

  // --- frågor
  if ((m = q.match(/^(?:var\s+(?:är|finns|ligger|står)|vart\s+tog)\s+(.+?)(?:\s+vägen)?\??$/i))) {
    const rows = await find(run, m[1]);
    if (!rows.length) return { text: "Jag hittar inget om det.", sources: [], tool: "find_object" };
    const lines = rows.slice(0, 5).map((r) => {
      const parts = Array.isArray(r.allocations) && r.allocations.length > 1
        ? r.allocations.map((a: any) => `${a.quantity} ${a.label.toLocaleLowerCase("sv")}`).join(", ")
        : r.status.toLocaleLowerCase("sv");
      return `${r.label}: ${r.place ? `${r.place}` : "ingen plats registrerad"} (${parts})`;
    });
    return { text: lines.join("\n"), sources: refs(rows), tool: "find_object" };
  }
  if ((m = q.match(/vad\s+har\s+(?:jag|vi)\s+(?:i\s+lager\s+)?(?:fått\s+)?från\s+(.+?)\??$/i))) {
    const r = await run("stock_from_person", { name: strip(m[1]) });
    if (!r?.person) return { text: `Jag hittar ingen person som heter ${m[1]}.`, sources: [] };
    if (!r.objects?.length) return { text: `Det finns inget registrerat från ${r.person.title} just nu.`, sources: [r.person] };
    const lines = r.objects.map((o: any) => `${o.label} – ${o.status.toLocaleLowerCase("sv")}${o.place ? `, ${o.place}` : ""}${o.price != null ? ` (${o.price} kr)` : ""}`);
    return { text: `Från ${r.person.title}:\n${lines.join("\n")}`, sources: [r.person, ...refs(r.objects)], tool: "stock_from_person" };
  }
  if (/(vilka|vem)\s+har\s+(?:bidragit|hjälpt)|inte\s+tackat|tacka/.test(t)) {
    const r: any[] = await run("contributors", {});
    if (!r.length) return { text: "Ingen har registrerade bidrag i år ännu.", sources: [], tool: "contributors" };
    const unthanked = r.filter((x) => x.unthanked > 0);
    const text = [`${r.length} ${r.length === 1 ? "person har" : "personer har"} bidragit i år: ${r.map((x) => x.source.title).join(", ")}.`,
      unthanked.length ? `Inte tackade än: ${unthanked.map((x) => x.source.title).join(", ")}.` : "Alla har fått tack."].join("\n");
    return { text, sources: refs(r), tool: "contributors" };
  }
  if (/intressent/.test(t) && /svar/.test(t)) {
    const r: any[] = await run("unanswered_leads", {});
    if (!r.length) return { text: "Inga intressenter väntar på svar.", sources: [], tool: "unanswered_leads" };
    return { text: r.map((x) => `${x.person?.title ?? "Någon"} om ${x.listing?.title ?? "en annons"}`).join("\n"), sources: [...refs(r, "listing"), ...refs(r, "person")], tool: "unanswered_leads" };
  }
  if (/längst\s+i\s+lager|legat\s+i\s+lager\s+längst|legat\s+längst/.test(t)) {
    const r: any[] = await run("longest_stored", {});
    if (!r.length) return { text: "Det ligger inget i lager just nu.", sources: [] };
    return { text: r.slice(0, 5).map((x) => `${x.label} – sedan ${String(x.since).slice(0, 10)}${x.place ? `, ${x.place}` : ""}`).join("\n"), sources: refs(r), tool: "longest_stored" };
  }
  if (/köpt\s+och\s+sålt|köpt\s+för|sålt\s+för/.test(t)) {
    const year = Number(t.match(/\b(20\d\d)\b/)?.[1] ?? now.getFullYear());
    const r = await run("bought_sold", { year });
    const money = (x: any) => (x?.priced ? `${Math.round(x.sum)} kr` : "inga priser du kan se");
    return { text: `${year}: köpt ${r.bought.count} saker för ${money(r.bought)}, sålt ${r.sold.count} för ${money(r.sold)}.`, sources: [], tool: "bought_sold" };
  }
  if (/följa\s+upp|att\s+göra|göra\s+idag|ha\s+kvar\s+att\s+göra/.test(t)) {
    const r = await run("follow_up", {});
    const items = (r?.items ?? []).slice(0, 8);
    if (!items.length) return { text: "Inget brådskar just nu.", sources: [] };
    return { text: items.map((i: any) => `• ${i.title}${i.subtitle ? ` – ${i.subtitle}` : ""}`).join("\n"), sources: items.map((i: any) => i.entity).filter(Boolean), tool: "follow_up" };
  }
  if (/innehåll|berätta\s+om\s+denna\s+vecka|bra\s+att\s+berätta/.test(t)) {
    const r: any[] = await run("story_ideas", {});
    if (!r.length) return { text: "Jag hittar inga färska ögonblick att berätta om – markera något som bra ögonblick.", sources: [] };
    return { text: r.slice(0, 3).map((e) => `• ${e.summary}`).join("\n"), sources: r.slice(0, 3).map((e) => ({ id: e.id, type: "history_event", title: e.summary })), tool: "story_ideas" };
  }
  if ((m = q.match(/vem\s+(?:känner|tipsade\s+(?:oss\s+)?om)\s+(.+?)\??$/i))) {
    const r = await run("person_network", { name: strip(m[1]) });
    if (!r?.person) return { text: `Jag hittar ingen som heter ${m[1]}.`, sources: [] };
    const rel = (r.relations ?? []) as any[];
    const tipped = rel.filter((x) => x.kind === "introduced" && x.direction === "in");
    const lines = /tipsade/.test(t)
      ? [tipped.length ? `${tipped.map((x) => x.source.title).join(", ")} tipsade oss om ${r.person.title}.` : `Ingen är registrerad som tipsare om ${r.person.title}.`]
      : [rel.length ? `${r.person.title}: ${rel.map((x) => `${x.source.title} (${x.kind})`).join(", ")}` : `Inga relationer registrerade för ${r.person.title}.`];
    return { text: lines.join("\n"), sources: [r.person, ...refs(rel)], tool: "person_network" };
  }
  if ((m = q.match(/(?:hur\s+går\s+det\s+med|vad\s+behövs\s+(?:till|för)|behov\s+(?:till|för|i))\s+(.+?)\??$/i))) {
    const r = await run("project_overview", { name: strip(m[1]).replace(/(et|en)$/i, "") });
    if (!r) return { text: `Jag hittar inget projekt som heter ${m[1]}.`, sources: [] };
    const needs = (r.needs ?? []).filter((n: any) => n.status === "open");
    const text = [`${r.name} – ${r.status_label}.`, needs.length ? `Behov: ${needs.map((n: any) => `${n.title} (${n.progress})`).join("; ")}.` : "Inga öppna behov.",
      r.timeline?.[0] ? `Senast: ${r.timeline[0].summary}.` : ""].filter(Boolean).join("\n");
    return { text, sources: [{ id: r.id, type: "project", title: r.name, route: `/projekt/${r.id}` }], tool: "project_overview" };
  }
  if (/öppna\s+behov|vad\s+behöver\s+vi/.test(t)) {
    const r: any[] = await run("open_needs", {});
    return { text: r.length ? r.map((n) => `${n.title} – ${n.progress} (${n.project?.title ?? ""})`).join("\n") : "Inga öppna behov.", sources: refs(r), tool: "open_needs" };
  }
  if (/hämtning/.test(t)) {
    const r: any[] = await run("pickups", {});
    return { text: r.length ? r.map((p) => `${p.title}: ${p.scheduled_on ?? "inget datum"} – ${p.items.map((i: any) => i.label).join(", ")}`).join("\n") : "Inga planerade hämtningar.",
             sources: r.map((p) => ({ id: p.id, type: "pickup", title: p.title, route: `/hamtning/${p.id}` })), tool: "pickups" };
  }
  if (/vad\s+har\s+hänt\s+med\s+(den\s+här|det\s+här|denna)/.test(t) && ctx.screen?.entity_id) {
    const r: any[] = await run("period_summary", { entity_id: ctx.screen.entity_id, limit: 10 });
    return { text: r.length ? r.map((e) => `${String(e.occurred_at).slice(0, 10)} · ${e.summary}`).join("\n") : "Inget registrerat ännu.", sources: [{ id: ctx.screen.entity_id, type: ctx.screen.entity_type ?? "", title: ctx.screen.title ?? "" }], tool: "period_summary" };
  }
  if ((m = t.match(/vad\s+hände\s+(?:på\s+\w+\s+)?i\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/))) {
    const month = MONTHS.indexOf(m[1]);
    let y = now.getFullYear();
    if (month > now.getMonth()) y--;
    const from = new Date(Date.UTC(y, month, 1)).toISOString();
    const to = new Date(Date.UTC(y, month + 1, 1)).toISOString();
    const r: any[] = await run("period_summary", { from, to });
    return { text: r.length ? `${r.length} händelser i ${m[1]}:\n${r.slice(0, 10).map((e) => `• ${e.summary}`).join("\n")}` : `Inget registrerat i ${m[1]}.`,
             sources: r.slice(0, 10).map((e) => ({ id: e.id, type: "history_event", title: e.summary })), tool: "period_summary" };
  }
  if (/^hur\s+(?:gör|renoverar|lagar|bygger|planterar|tar)\b/.test(t)) {
    const r: any[] = await run("search", { q: q.replace(/^hur\s+\w+\s+(man|jag|vi)\s+/i, "").replace(/\?$/, ""), limit: 5 });
    return {
      text: r.length ? "Det här finns om det i Vretas data:" : "Jag hittar inget om det i Vretas data.",
      sources: r, general_advice: "Allmänna råd kräver att AI är påslaget – det här är bara det som finns registrerat på Vreta.",
    };
  }

  // --- sök
  const words = q.replace(/[?!.]/g, "").split(" ").filter((w) => w.length > 2 && !/^(vad|var|vem|hur|har|finns|jag|vi|det|den|som|och|för|med|till|från|kan)$/i.test(w));
  for (const term of [words.join(" "), ...words.sort((a, b) => b.length - a.length)]) {
    if (!term) continue;
    const r: any[] = await run("search", { q: term, limit: 8 });
    if (r.length) return { text: "Det här hittade jag:", sources: r, tool: "search" };
  }
  return { text: "Jag hittar inget om det.", sources: [] };
}

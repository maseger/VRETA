// Fråga Vreta på klientsidan. Med Supabase svarar Claude via edge-funktionen ask-vreta;
// i demoläge och utan nät tolkas frågan lokalt och samma verktyg svarar med mallsvar.
import type { Repo } from "../data/repo";
import { SupabaseRepo } from "../data/supabaseRepo";
import type { AskMessage, Role } from "../domain/types";
import { planQuestion, runTool, type KStore, type PendingAction, type Screen, type SourceCard } from "../../supabase/functions/_shared/knowledge";
import { proposeForCapture } from "./captureAgent";

export interface AskAnswer {
  text: string;
  cards: SourceCard[];
  action?: PendingAction;
  general: boolean;
  source: "claude" | "lokal";
}

/** Datalagret som KStore: rollreglerna i datalagret filtrerar redan bort det användaren inte får se. */
export function repoStore(repo: Repo, role: Role, today = new Date().toISOString().slice(0, 10)): KStore {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  return {
    role,
    today,
    objects: () => once("objects", () => repo.objects()),
    allocations: () => once("allocations", () => repo.allAllocations()),
    storageLocations: () => once("locs", () => repo.storageLocations()),
    zones: () => once("zones", () => repo.zones()),
    structures: () => once("structures", () => repo.structures()),
    persons: () => once("persons", () => repo.persons()),
    acquisitions: () => once("acqs", () => repo.allAcquisitions()),
    disposals: () => once("disposals", () => repo.disposals()),
    contributions: () => once("contribs", () => repo.contributions()),
    listings: () => once("listings", () => repo.listings()),
    leads: () => once("leads", () => repo.leads()),
    tasks: () => once("tasks", () => repo.tasks()),
    pickups: () => once("pickups", () => repo.pickups()),
    interactions: () => once("interactions", () => repo.followUps()),
    events: () => once("events", async () => {
      const site = await repo.site();
      return site ? repo.eventsFor("site", site.id) : [];
    }),
    eventsFor: (type, id) => repo.eventsFor(type, id),
    notes: () => once("notes", () => repo.allStoryNotes()),
    content: () => once("content", () => repo.allContent()),
    observations: () => once("obs", () => repo.observations()),
    decisions: () => once("decs", () => repo.decisions()),
    projects: () => once("projects", () => repo.projects()),
    needs: () => once("needs", () => repo.needs()),
    needFulfillments: () => once("fulfillments", () => repo.needFulfillments()),
    externalPlaces: () => once("places", async () => (await repo.externalPlaces()).map(({ address: _a, ...p }) => (void _a, p))),
    usage: () => once("usage", () => repo.allUsageEvents()),
    proposalsWaiting: async () => (await repo.proposals()).length + (await repo.capturesWithoutProposal()).length,
  };
}

export async function askLocal(repo: Repo, role: Role, question: string, screen: Screen): Promise<AskAnswer> {
  const store = repoStore(repo, role);
  const plan = planQuestion(question, screen, store.today);
  if (!plan) return { text: "Jag hittar inget om det. Prova till exempel ”Var är tegelpartiet?”", cards: [], general: false, source: "lokal" };
  if ("general" in plan) {
    return { text: "Allmänna frågor om hur man gör besvaras av Claude när appen är kopplad till servern. Jag kan svara på allt som finns registrerat om Vreta.", cards: [], general: true, source: "lokal" };
  }
  const r = await runTool(store, plan.tool, plan.input);
  return { text: r.answer, cards: r.cards, action: r.action, general: false, source: "lokal" };
}

export async function ask(repo: Repo, role: Role, question: string, screen: Screen, history: AskMessage[]): Promise<AskAnswer> {
  if (repo instanceof SupabaseRepo && navigator.onLine) {
    const { data, error } = await repo.client.functions.invoke<{ answer: string; cards: SourceCard[]; action?: PendingAction; general: boolean; error?: string }>("ask-vreta", {
      body: { question, screen, history: history.map((m) => ({ role: m.role, text: m.text })) },
    });
    if (!error && data && !data.error) return { text: data.answer, cards: data.cards, action: data.action, general: data.general, source: "claude" };
    if (data?.error === "cap_reached") {
      const local = await askLocal(repo, role, question, screen);
      return { ...local, text: `Månadens AI-tak är nått, så jag svarar enklare. ${local.text}` };
    }
  }
  return askLocal(repo, role, question, screen);
}

/** Utför en bekräftad åtgärd. Navigering sköts av gränssnittet. */
export async function executeAction(repo: Repo, action: PendingAction): Promise<string> {
  switch (action.kind) {
    case "move": {
      const o = await repo.object(action.object_id);
      if (!o) throw new Error("Objektet finns inte längre");
      const allocs = await repo.allocations(o.id);
      if (o.is_batch && allocs.length > 1) {
        // Bara det som ligger i lager flyttas – delar i bruk eller sålda rörs inte
        for (const a of allocs.filter((a) => ["collected", "stored", "processing"].includes(a.status))) await repo.storeAllocation(a.id, a.quantity, action.location_id);
      } else {
        await repo.storeObject(o.id, action.location_id);
      }
      return "Flyttat.";
    }
    case "task":
      await repo.createTask({ title: action.title, due: action.due, entity_type: action.entity_id ? "object" : "", entity_id: action.entity_id ?? "" });
      return "Uppgiften är skapad.";
    case "capture": {
      const id = crypto.randomUUID();
      const cap = await repo.saveCapture(id, { text: action.text, kind: "find", media_ids: [] });
      await repo.attachProposal(cap.id, await proposeForCapture(repo, cap));
      return "Förslaget ligger under Att granska.";
    }
    case "navigate":
      return "";
  }
}

// Översätter AI-svar eller den lokala tolkningen till ett ProposalContent.
import type { ProposalContent, Person } from "../domain/types";
import type { CaptureProposalOut } from "../../supabase/functions/_shared/agentSchemas";
import type { HeuristicResult } from "../../supabase/functions/_shared/captureHeuristics";

const LOCAL_CONFIDENCE = 0.45;

export function matchPerson(name: string | null | undefined, locality: string | null | undefined, people: Person[]): Person | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const candidates = people.filter((p) => p.name.trim().toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
  if (candidates.length === 1) return candidates[0];
  if (locality) return candidates.find((p) => p.locality.toLowerCase() === locality.toLowerCase()) ?? null;
  return null;
}

export function fromAgent(out: CaptureProposalOut, people: Person[]): ProposalContent {
  const o = out.object;
  const match = out.person ? matchPerson(out.person.name, out.person.locality, people) : null;
  return {
    object: o
      ? {
          title: { value: o.title, confidence: o.title_confidence },
          category: { value: o.category, confidence: o.confidence },
          description: { value: o.description, confidence: o.confidence },
          material: { value: o.material, confidence: o.confidence },
          dimensions: { value: o.dimensions, confidence: o.confidence },
          quantity: { value: o.quantity || 1, confidence: o.confidence },
          unit: { value: o.unit || "st", confidence: o.confidence },
          condition: { value: o.condition, confidence: o.confidence },
        }
      : null,
    person: out.person
      ? { name: { value: out.person.name, confidence: out.person.confidence }, locality: { value: out.person.locality, confidence: out.person.confidence }, existing_person_id: match?.id ?? null }
      : null,
    acquisition: out.acquisition
      ? {
          type: { value: out.acquisition.type, confidence: out.acquisition.confidence },
          price: { value: out.acquisition.price_total_sek, confidence: out.acquisition.confidence },
          deadline: { value: out.acquisition.deadline, confidence: out.acquisition.confidence },
        }
      : null,
    task: out.task ? { title: { value: out.task.title, confidence: out.task.confidence }, due: { value: out.task.due, confidence: out.task.confidence } } : null,
    why: { value: out.why, confidence: out.why ? 0.8 : 0 },
    agent: "claude",
  };
}

export function fromHeuristics(h: HeuristicResult, people: Person[]): ProposalContent {
  const c = LOCAL_CONFIDENCE;
  const match = matchPerson(h.person_name, h.person_locality, people);
  return {
    object: {
      title: { value: h.title, confidence: 0.35 },
      category: { value: h.category, confidence: c },
      description: { value: "", confidence: 0 },
      material: { value: "", confidence: 0 },
      dimensions: { value: "", confidence: 0 },
      quantity: { value: h.quantity, confidence: c },
      unit: { value: h.unit, confidence: c },
      condition: { value: null, confidence: 0 },
    },
    person: h.person_name
      ? { name: { value: h.person_name, confidence: c }, locality: { value: h.person_locality ?? "", confidence: c }, existing_person_id: match?.id ?? null }
      : null,
    acquisition: h.acquisition_type
      ? { type: { value: h.acquisition_type, confidence: c }, price: { value: h.price_total, confidence: c }, deadline: { value: h.deadline, confidence: c } }
      : null,
    task: h.task_title ? { title: { value: h.task_title, confidence: c }, due: { value: h.deadline, confidence: c } } : null,
    why: { value: "", confidence: 0 },
    agent: "local",
  };
}

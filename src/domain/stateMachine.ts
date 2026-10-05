import type { AcquisitionStatus, ObjectStatus, PickupStatus } from "./types";

// Tillåtna övergångar enligt specifikationen avsnitt 5.1. Speglas i databasen
// (supabase/migrations) så att servern nekar samma övergångar.
export const OBJECT_TRANSITIONS: Record<ObjectStatus, ObjectStatus[]> = {
  discovered: ["contacted", "reserved", "collected", "declined", "lost"],
  contacted: ["reserved", "collected", "declined", "lost"],
  reserved: ["pickup_planned", "collected", "declined", "lost"],
  pickup_planned: ["collected", "reserved", "lost"],
  collected: ["stored", "processing", "in_use", "listed"],
  stored: ["processing", "in_use", "listed", "discarded"],
  processing: ["stored", "in_use", "listed", "discarded"],
  in_use: ["stored", "processing", "in_use", "listed", "discarded"],
  listed: ["stored", "reserved_out", "in_use"],
  reserved_out: ["listed", "sold", "donated", "exchanged", "lent"],
  lent: ["stored", "in_use"],
  declined: [],
  lost: [],
  sold: [],
  donated: [],
  exchanged: [],
  discarded: [],
};

export const TERMINAL: ObjectStatus[] = ["declined", "lost", "sold", "donated", "exchanged", "discarded"];

export function canTransition(from: ObjectStatus, to: ObjectStatus): boolean {
  return OBJECT_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ObjectStatus): boolean {
  return TERMINAL.includes(status);
}

export class TransitionError extends Error {
  constructor(public from: ObjectStatus, public to: ObjectStatus) {
    super(`Otillåten statusändring: ${from} → ${to}`);
  }
}

export function assertTransition(from: ObjectStatus, to: ObjectStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/** Det mest sannolika nästa steget, som visas som primär knapp på objektsidan. */
export function nextStep(status: ObjectStatus): { to: ObjectStatus; label: string } | null {
  switch (status) {
    case "discovered":
      return { to: "contacted", label: "Markera som kontaktad" };
    case "contacted":
      return { to: "reserved", label: "Markera som reserverad" };
    case "reserved":
    case "pickup_planned":
      return { to: "collected", label: "Markera som hämtad" };
    case "collected":
      return { to: "stored", label: "Lägg i lager" };
    case "stored":
      return { to: "in_use", label: "Använd – ge nytt liv" };
    case "processing":
      return { to: "in_use", label: "Klar – ge nytt liv" };
    case "listed":
      return { to: "reserved_out", label: "Reservera för köpare" };
    default:
      return null;
  }
}

// Anskaffning (5.2) och hämtning (5.3). Speglas i databasens övergångstabeller.
export const ACQUISITION_TRANSITIONS: Record<AcquisitionStatus, AcquisitionStatus[]> = {
  lead: ["contacted", "negotiating", "agreed", "declined", "lost"],
  contacted: ["negotiating", "agreed", "declined", "lost"],
  negotiating: ["agreed", "declined", "lost"],
  agreed: ["received", "declined", "lost"],
  received: ["settled"],
  settled: [],
  declined: [],
  lost: [],
};

export const PICKUP_TRANSITIONS: Record<PickupStatus, PickupStatus[]> = {
  planned: ["confirmed", "in_progress", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};

export function nextAcquisitionStep(s: AcquisitionStatus): { to: AcquisitionStatus; label: string } | null {
  switch (s) {
    case "lead": return { to: "contacted", label: "Jag har tagit kontakt" };
    case "contacted": return { to: "negotiating", label: "Vi förhandlar" };
    case "negotiating": return { to: "agreed", label: "Vi är överens" };
    case "received": return { to: "settled", label: "Betalt / kvitterat" };
    default: return null;
  }
}

// Kontextmedveten Fånga (2.0): sidan man senast tittade på följer med fångsten som skärmkontext,
// så att "den här" kan kopplas till rätt sak, person eller plats.
export type Screen = { route: string; entity_id?: string; entity_type?: string; title?: string; at: number };

let last: Screen | null = null;

export function setScreen(s: Omit<Screen, "at"> | null) {
  last = s ? { ...s, at: Date.now() } : null;
}

export function recentScreen(maxAgeMs = 15 * 60_000): Screen | null {
  return last && Date.now() - last.at < maxAgeMs ? last : null;
}

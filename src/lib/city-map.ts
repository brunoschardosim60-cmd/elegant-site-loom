import { MIN_CTCS, type CityMetrics, type GroupMetrics } from "./conference-metrics";

/** Outline of each Rio Grande do Sul municipality (see scripts/build-rs-map.mjs). */
export type CityShapes = {
  width: number;
  height: number;
  cities: { id: string; name: string; d: string }[];
};

/**
 * Comparable city key: no accents, case, spaces or punctuation, and no state
 * suffix. "Sant'Ana do Livramento", "SANTANA DO LIVRAMENTO" and
 * "SANTANA DO LIVRAMENTO - RS" all become "SANTANADOLIVRAMENTO".
 */
export function cityKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s*[-/(]\s*RS\)?\s*$/, "")
    .replace(/[^A-Z0-9]/g, "");
}

export type CityLevel = "ok" | "attention" | "critical" | "few";
/** Share of a city's CTCs late now from which it turns red. */
export const CRITICAL_SHARE = 0.2;

/**
 * The situation now: green with nothing late, yellow with some, red when a
 * fifth or more of the city's CTCs are still pending past the deadline.
 * Receiving them turns the city green at once. Cities with fewer than
 * MIN_CTCS CTCs are marked as having too little data.
 */
export function cityLevel(city: Pick<GroupMetrics, "ctcs" | "late">): CityLevel {
  if (city.ctcs < MIN_CTCS) return "few";
  if (!city.late) return "ok";
  return city.late / city.ctcs >= CRITICAL_SHARE ? "critical" : "attention";
}

const counters = [
  "ctcs",
  "received",
  "pending",
  "late",
  "returnedLate",
  "timedReturns",
  "untimedReturns",
  "pendingValueCents",
] as const;

/** Joins the indicators to the map; cities that match no municipality are returned apart. */
export function placeCities(shapes: CityShapes, cities: CityMetrics[]) {
  const byKey = new Map(shapes.cities.map((shape) => [cityKey(shape.name), shape.id]));
  const placed = new Map<string, CityMetrics>();
  const unplaced: CityMetrics[] = [];
  for (const city of cities) {
    const id = byKey.get(cityKey(city.city));
    if (!id) {
      unplaced.push(city);
      continue;
    }
    // Two spellings of one municipality add up.
    const previous = placed.get(id);
    if (!previous) {
      placed.set(id, city);
      continue;
    }
    const merged = { ...previous };
    for (const key of counters) merged[key] += city[key];
    placed.set(id, merged);
  }
  return { placed, unplaced };
}

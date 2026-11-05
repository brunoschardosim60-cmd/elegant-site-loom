import type { CityMetrics } from "./conference-metrics";

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

export type CityLevel = "ok" | "attention" | "critical";
/** Share of a city's CTCs that are late from which it turns red. */
export const CRITICAL_LATE_SHARE = 0.2;

/** Green: nothing late. Yellow: some late. Red: a fifth or more of its CTCs late. */
export function cityLevel(city: Pick<CityMetrics, "ctcs" | "late">): CityLevel {
  if (!city.late) return "ok";
  return city.late / city.ctcs >= CRITICAL_LATE_SHARE ? "critical" : "attention";
}

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
    placed.set(
      id,
      previous
        ? {
            city: previous.city,
            ctcs: previous.ctcs + city.ctcs,
            received: previous.received + city.received,
            pending: previous.pending + city.pending,
            late: previous.late + city.late,
            pendingValueCents: previous.pendingValueCents + city.pendingValueCents,
          }
        : city,
    );
  }
  return { placed, unplaced };
}

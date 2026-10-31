import type { DocumentItem, Manifest } from "./conference";
import { isPendingDocument } from "./conference-routes";
import { manifestAgeDays } from "./manifest-date";

/** A pending CTC this many days after the manifest date counts as late (same as the "old" filter). */
export const LATE_AFTER_DAYS = 2;
const PERISHABLE = /PERECIV/i;
/** Cargo nature from the 108 export marks it perishable (e.g. "PERECIVEL-CONVENCIONAL 48"). */
export const isPerishable = (doc: { nature?: string | undefined }) =>
  !!doc.nature && PERISHABLE.test(doc.nature);

export type DriverMetrics = {
  driver: string;
  pending: number;
  late: number;
  pendingValueCents: number;
  oldestDays: number;
  received: number;
  medianReturnDays: number | undefined;
};
export type CityMetrics = { city: string; pending: number; pendingValueCents: number };
export type ConferenceMetrics = {
  ctcs: number;
  received: number;
  pending: number;
  late: number;
  /** Share of CTCs returned, 0–1; undefined with no CTCs. */
  returnRate: number | undefined;
  pendingValueCents: number;
  /** Pending CTCs without a value (photo or manual entries, older imports). */
  pendingWithoutValue: number;
  pendingWeightGrams: number;
  perishablePending: number;
  medianReturnDays: number | undefined;
  drivers: DriverMetrics[];
  cities: CityMetrics[];
};

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Operational indicators over the manifests shown (already filtered to the
 * user's scope and route-resolved). A CTC moved to a later route counts only
 * on that route, as in the pending list.
 */
export function conferenceMetrics(
  manifests: Manifest[],
  now: string | number | Date = Date.now(),
): ConferenceMetrics {
  const drivers = new Map<string, DriverMetrics & { returns: number[] }>();
  const cities = new Map<string, CityMetrics>();
  const returns: number[] = [];
  const result = {
    ctcs: 0,
    received: 0,
    pending: 0,
    late: 0,
    pendingValueCents: 0,
    pendingWithoutValue: 0,
    pendingWeightGrams: 0,
    perishablePending: 0,
  };
  for (const manifest of manifests) {
    const name = manifest.driver.trim() || "Motorista não informado";
    const driver = drivers.get(name) ?? {
      driver: name,
      pending: 0,
      late: 0,
      pendingValueCents: 0,
      oldestDays: 0,
      received: 0,
      medianReturnDays: undefined,
      returns: [],
    };
    const age = manifestAgeDays(manifest, now);
    for (const doc of manifest.documents as DocumentItem[]) {
      if (doc.reroutedTo) continue;
      result.ctcs++;
      if (doc.received) {
        result.received++;
        driver.received++;
        if (doc.receivedAt) {
          const days = manifestAgeDays(manifest, doc.receivedAt);
          returns.push(days);
          driver.returns.push(days);
        }
        continue;
      }
      if (!isPendingDocument(doc)) continue;
      result.pending++;
      driver.pending++;
      driver.oldestDays = Math.max(driver.oldestDays, age);
      if (age >= LATE_AFTER_DAYS) {
        result.late++;
        driver.late++;
      }
      if (doc.cargoValueCents === undefined) result.pendingWithoutValue++;
      else {
        result.pendingValueCents += doc.cargoValueCents;
        driver.pendingValueCents += doc.cargoValueCents;
      }
      result.pendingWeightGrams += doc.weightGrams ?? 0;
      if (isPerishable(doc)) result.perishablePending++;
      const cityName = doc.city?.trim();
      if (cityName) {
        const city = cities.get(cityName) ?? { city: cityName, pending: 0, pendingValueCents: 0 };
        city.pending++;
        city.pendingValueCents += doc.cargoValueCents ?? 0;
        cities.set(cityName, city);
      }
    }
    drivers.set(name, driver);
  }
  return {
    ...result,
    returnRate: result.ctcs ? result.received / result.ctcs : undefined,
    medianReturnDays: median(returns),
    drivers: [...drivers.values()]
      .map(({ returns: driverReturns, ...driver }) => ({
        ...driver,
        medianReturnDays: median(driverReturns),
      }))
      .filter((driver) => driver.pending || driver.received)
      .sort(
        (a, b) =>
          b.late - a.late ||
          b.pending - a.pending ||
          b.pendingValueCents - a.pendingValueCents ||
          a.driver.localeCompare(b.driver),
      ),
    cities: [...cities.values()].sort(
      (a, b) => b.pending - a.pending || a.city.localeCompare(b.city),
    ),
  };
}

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
/** "R$ 8.971.188" (whole reais; the cents add nothing at this scale). */
export const formatMoney = (cents: number) => money.format(Math.round(cents / 100));
export const formatDays = (days: number | undefined) =>
  days === undefined
    ? "—"
    : `${days.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${days === 1 ? "dia" : "dias"}`;

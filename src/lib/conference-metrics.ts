import type { DocumentItem, Manifest } from "./conference";
import { isPendingDocument } from "./conference-routes";
import { manifestAgeDays } from "./manifest-date";

/** A CTC takes this many days or more to come back (or is still out that long): out of time. */
export const LATE_AFTER_DAYS = 2;
/** Below this many evaluated CTCs a city, client or driver has too little data to rank. */
export const MIN_CTCS = 5;
const PERISHABLE = /PERECIV/i;
/** Cargo nature from the 108 export marks it perishable (e.g. "PERECIVEL-CONVENCIONAL 48"). */
export const isPerishable = (doc: { nature?: string | undefined }) =>
  !!doc.nature && PERISHABLE.test(doc.nature);

/**
 * Counters shared by the whole operation and each driver, city and client.
 * "Out of time" covers CTCs returned after LATE_AFTER_DAYS and those still
 * pending that long; CTCs pending for less are not decided yet and stay out
 * of the rate ("evaluated" excludes them).
 */
export type GroupMetrics = {
  ctcs: number;
  received: number;
  pending: number;
  /** Pending for LATE_AFTER_DAYS or more. */
  late: number;
  outOfTime: number;
  evaluated: number;
  pendingValueCents: number;
};
export type DriverMetrics = GroupMetrics & {
  driver: string;
  oldestDays: number;
  medianReturnDays: number | undefined;
};
export type CityMetrics = GroupMetrics & { city: string };
export type ClientMetrics = GroupMetrics & { client: string };
export type ConferenceMetrics = GroupMetrics & {
  /** Share of CTCs returned, 0–1; undefined with no CTCs. */
  returnRate: number | undefined;
  /** Share of evaluated CTCs out of time, 0–1; undefined with none evaluated. */
  outOfTimeRate: number | undefined;
  /** Pending CTCs without a value (photo or manual entries, older imports). */
  pendingWithoutValue: number;
  pendingWeightGrams: number;
  perishablePending: number;
  medianReturnDays: number | undefined;
  drivers: DriverMetrics[];
  cities: CityMetrics[];
  clients: ClientMetrics[];
};

export const emptyGroup = (): GroupMetrics => ({
  ctcs: 0,
  received: 0,
  pending: 0,
  late: 0,
  outOfTime: 0,
  evaluated: 0,
  pendingValueCents: 0,
});

/** Share of a group's evaluated CTCs that are out of time; undefined without any. */
export const outOfTimeShare = (group: Pick<GroupMetrics, "outOfTime" | "evaluated">) =>
  group.evaluated ? group.outOfTime / group.evaluated : undefined;

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Worst first: groups with enough data by out-of-time share, then the rest by volume. */
function byOutOfTime<T extends GroupMetrics>(name: (item: T) => string) {
  return (a: T, b: T) => {
    const enoughA = a.evaluated >= MIN_CTCS;
    const enoughB = b.evaluated >= MIN_CTCS;
    if (enoughA !== enoughB) return enoughA ? -1 : 1;
    return (
      (outOfTimeShare(b) ?? -1) - (outOfTimeShare(a) ?? -1) ||
      b.outOfTime - a.outOfTime ||
      b.pending - a.pending ||
      b.ctcs - a.ctcs ||
      name(a).localeCompare(name(b), "pt-BR")
    );
  };
}

/**
 * Operational indicators over the manifests shown (already filtered to the
 * user's scope, period and route-resolved). A CTC moved to a later route
 * counts only on that route, as in the pending list.
 */
export function conferenceMetrics(
  manifests: Manifest[],
  now: string | number | Date = Date.now(),
): ConferenceMetrics {
  const drivers = new Map<string, DriverMetrics & { returns: number[] }>();
  const cities = new Map<string, CityMetrics>();
  const clients = new Map<string, ClientMetrics>();
  const returns: number[] = [];
  const total = emptyGroup();
  const extra = { pendingWithoutValue: 0, pendingWeightGrams: 0, perishablePending: 0 };
  for (const manifest of manifests) {
    const name = manifest.driver.trim() || "Motorista não informado";
    const driver = drivers.get(name) ?? {
      ...emptyGroup(),
      driver: name,
      oldestDays: 0,
      medianReturnDays: undefined,
      returns: [],
    };
    drivers.set(name, driver);
    const age = manifestAgeDays(manifest, now);
    for (const doc of manifest.documents as DocumentItem[]) {
      if (doc.reroutedTo) continue;
      const cityName = doc.city?.trim();
      const clientName = doc.client?.trim();
      const city = cityName
        ? (cities.get(cityName) ?? { ...emptyGroup(), city: cityName })
        : undefined;
      if (city) cities.set(city.city, city);
      const client = clientName
        ? (clients.get(clientName) ?? { ...emptyGroup(), client: clientName })
        : undefined;
      if (client) clients.set(client.client, client);
      const groups: GroupMetrics[] = [total, driver];
      if (city) groups.push(city);
      if (client) groups.push(client);
      const add = (key: keyof GroupMetrics, amount = 1) => {
        for (const group of groups) group[key] += amount;
      };
      add("ctcs");
      if (doc.received) {
        add("received");
        add("evaluated");
        if (doc.receivedAt) {
          const days = manifestAgeDays(manifest, doc.receivedAt);
          returns.push(days);
          driver.returns.push(days);
          if (days >= LATE_AFTER_DAYS) add("outOfTime");
        }
        continue;
      }
      if (!isPendingDocument(doc)) continue;
      add("pending");
      driver.oldestDays = Math.max(driver.oldestDays, age);
      if (age >= LATE_AFTER_DAYS) {
        add("late");
        add("outOfTime");
        add("evaluated");
      }
      if (doc.cargoValueCents === undefined) extra.pendingWithoutValue++;
      else add("pendingValueCents", doc.cargoValueCents);
      extra.pendingWeightGrams += doc.weightGrams ?? 0;
      if (isPerishable(doc)) extra.perishablePending++;
    }
  }
  return {
    ...total,
    ...extra,
    returnRate: total.ctcs ? total.received / total.ctcs : undefined,
    outOfTimeRate: outOfTimeShare(total),
    medianReturnDays: median(returns),
    drivers: [...drivers.values()]
      .map(({ returns: driverReturns, ...driver }) => ({
        ...driver,
        medianReturnDays: median(driverReturns),
      }))
      .filter((driver) => driver.pending || driver.received)
      .sort(byOutOfTime((driver) => driver.driver)),
    cities: [...cities.values()].sort(byOutOfTime((city) => city.city)),
    clients: [...clients.values()].sort(byOutOfTime((client) => client.client)),
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
/** "12%" (undefined → "—"). */
export const formatShare = (share: number | undefined) =>
  share === undefined ? "—" : `${Math.round(share * 100)}%`;

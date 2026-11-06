import type { DocumentItem, Manifest } from "./conference";
import { isPendingDocument } from "./conference-routes";
import { manifestAgeDays } from "./manifest-date";

/** Default deadline: a CTC still pending this many days after the manifest date is late. Each team can change it. */
export const LATE_AFTER_DAYS = 2;
/** Below this many CTCs a city, client or driver has too little data to colour or rank. */
export const MIN_CTCS = 5;
const PERISHABLE = /PERECIV/i;
/** Cargo nature from the 108 export marks it perishable (e.g. "PERECIVEL-CONVENCIONAL 48"). */
export const isPerishable = (doc: { nature?: string | undefined }) =>
  !!doc.nature && PERISHABLE.test(doc.nature);

/**
 * Counters shared by the whole operation and each driver, city and client.
 * "late" is the situation now: CTCs still pending LATE_AFTER_DAYS or more, so
 * receiving them clears it at once. How long returns took is history and is
 * kept apart (returnedLate, medianReturnDays).
 */
export type GroupMetrics = {
  ctcs: number;
  received: number;
  pending: number;
  /** Pending for LATE_AFTER_DAYS or more. */
  late: number;
  /** Received LATE_AFTER_DAYS or more after the manifest date. */
  returnedLate: number;
  /** Received CTCs with a reliable receipt time (the base of returnedLate). */
  timedReturns: number;
  /**
   * Received CTCs whose pre was registered only after the deadline had passed:
   * the scan time says when it was entered, not when it came back.
   */
  untimedReturns: number;
  pendingValueCents: number;
  medianReturnDays: number | undefined;
};
export type DriverMetrics = GroupMetrics & { driver: string; oldestDays: number };
export type CityMetrics = GroupMetrics & {
  city: string;
  /** Clients and drivers with the most CTCs pending in the city (up to three each). */
  topClients?: string[] | undefined;
  topDrivers?: string[] | undefined;
};
export type ClientMetrics = GroupMetrics & { client: string };
export type ConferenceMetrics = GroupMetrics & {
  /** Share of CTCs returned, 0–1; undefined with no CTCs. */
  returnRate: number | undefined;
  /** Share of CTCs late now, 0–1. */
  lateRate: number | undefined;
  /** Share of timed returns that took LATE_AFTER_DAYS or more, 0–1. */
  returnedLateRate: number | undefined;
  /** Pending CTCs without a value (photo or manual entries, older imports). */
  pendingWithoutValue: number;
  pendingWeightGrams: number;
  perishablePending: number;
  drivers: DriverMetrics[];
  cities: CityMetrics[];
  clients: ClientMetrics[];
};

type Counting = GroupMetrics & { returns: number[] };
const emptyGroup = (): Counting => ({
  ctcs: 0,
  received: 0,
  pending: 0,
  late: 0,
  returnedLate: 0,
  timedReturns: 0,
  untimedReturns: 0,
  pendingValueCents: 0,
  medianReturnDays: undefined,
  returns: [],
});

/** Share of a group's CTCs late now; undefined without CTCs. */
export const lateShare = (group: Pick<GroupMetrics, "late" | "ctcs">) =>
  group.ctcs ? group.late / group.ctcs : undefined;

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Up to three names with the most pending CTCs. */
const top = (counts: Map<string, number>) =>
  [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .slice(0, 3)
    .map(([name]) => name);

/** Drops the working list and fills the median. */
function settle<T extends Counting>({ returns, ...group }: T): Omit<T, "returns"> {
  return { ...group, medianReturnDays: median(returns) };
}

/** Worst first: groups with enough data by share late now, then the rest by volume. */
function byLate<T extends GroupMetrics>(name: (item: T) => string) {
  return (a: T, b: T) => {
    const enoughA = a.ctcs >= MIN_CTCS;
    const enoughB = b.ctcs >= MIN_CTCS;
    if (enoughA !== enoughB) return enoughA ? -1 : 1;
    return (
      (lateShare(b) ?? -1) - (lateShare(a) ?? -1) ||
      b.late - a.late ||
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
  lateDays = LATE_AFTER_DAYS,
): ConferenceMetrics {
  const drivers = new Map<string, Counting & { driver: string; oldestDays: number }>();
  type CityCounting = Counting & {
    city: string;
    clientPending: Map<string, number>;
    driverPending: Map<string, number>;
  };
  const cities = new Map<string, CityCounting>();
  const clients = new Map<string, Counting & { client: string }>();
  const total = emptyGroup();
  const extra = { pendingWithoutValue: 0, pendingWeightGrams: 0, perishablePending: 0 };
  for (const manifest of manifests) {
    const name = manifest.driver.trim() || "Motorista não informado";
    const driver = drivers.get(name) ?? { ...emptyGroup(), driver: name, oldestDays: 0 };
    drivers.set(name, driver);
    const age = manifestAgeDays(manifest, now);
    // Registered (manifest.date) only after the deadline: receipt times are not return times.
    const reliableTiming = manifestAgeDays(manifest, manifest.date) < lateDays;
    for (const doc of manifest.documents as DocumentItem[]) {
      if (doc.reroutedTo) continue;
      const cityName = doc.city?.trim();
      const clientName = doc.client?.trim();
      const city = cityName
        ? (cities.get(cityName) ?? {
            ...emptyGroup(),
            city: cityName,
            clientPending: new Map<string, number>(),
            driverPending: new Map<string, number>(),
          })
        : undefined;
      if (city) cities.set(city.city, city);
      const client = clientName
        ? (clients.get(clientName) ?? { ...emptyGroup(), client: clientName })
        : undefined;
      if (client) clients.set(client.client, client);
      const groups: Counting[] = [total, driver];
      if (city) groups.push(city);
      if (client) groups.push(client);
      const add = (key: Exclude<keyof GroupMetrics, "medianReturnDays">, amount = 1) => {
        for (const group of groups) group[key] += amount;
      };
      add("ctcs");
      if (doc.received) {
        add("received");
        if (!doc.receivedAt || !reliableTiming) {
          add("untimedReturns");
          continue;
        }
        const days = manifestAgeDays(manifest, doc.receivedAt);
        add("timedReturns");
        for (const group of groups) group.returns.push(days);
        if (days >= lateDays) add("returnedLate");
        continue;
      }
      if (!isPendingDocument(doc)) continue;
      add("pending");
      driver.oldestDays = Math.max(driver.oldestDays, age);
      if (age >= lateDays) add("late");
      if (city) {
        if (clientName)
          city.clientPending.set(clientName, (city.clientPending.get(clientName) ?? 0) + 1);
        city.driverPending.set(name, (city.driverPending.get(name) ?? 0) + 1);
      }
      if (doc.cargoValueCents === undefined) extra.pendingWithoutValue++;
      else add("pendingValueCents", doc.cargoValueCents);
      extra.pendingWeightGrams += doc.weightGrams ?? 0;
      if (isPerishable(doc)) extra.perishablePending++;
    }
  }
  const settled = settle(total);
  return {
    ...settled,
    ...extra,
    returnRate: total.ctcs ? total.received / total.ctcs : undefined,
    lateRate: lateShare(total),
    returnedLateRate: total.timedReturns ? total.returnedLate / total.timedReturns : undefined,
    drivers: [...drivers.values()]
      .map(settle)
      .filter((driver) => driver.pending || driver.received)
      .sort(byLate((driver) => driver.driver)),
    cities: [...cities.values()]
      .map(({ clientPending, driverPending, ...city }) => ({
        ...settle(city),
        topClients: top(clientPending),
        topDrivers: top(driverPending),
      }))
      .sort(byLate((city) => city.city)),
    clients: [...clients.values()].map(settle).sort(byLate((client) => client.client)),
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

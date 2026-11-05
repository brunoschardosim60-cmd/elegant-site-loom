import type { Manifest } from "./conference";
import { calendarDate, manifestReferenceDate } from "./manifest-date";

export type PeriodKind = "7d" | "30d" | "month" | "last-month" | "all";
/** Inclusive range of manifest dates ("YYYY-MM-DD"). */
export type DateRange = { from: string; to: string };
export type Period = {
  kind: PeriodKind;
  label: string;
  range: DateRange | undefined;
  /** The same length right before, for comparison; none for "all". */
  previous: DateRange | undefined;
};

export const periodLabels: Record<PeriodKind, string> = {
  all: "Lista de trabalho atual",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Mês atual",
  "last-month": "Mês anterior",
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
const day = (value: string) => new Date(`${value}T12:00:00Z`);
const addDays = (value: string, days: number) => {
  const date = day(value);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
};
const monthStart = (value: string, offset = 0) => {
  const date = day(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return iso(date);
};
const monthEnd = (value: string) => addDays(monthStart(value, 1), -1);

/** Date ranges for a period, by manifest date in Brasília. */
export function metricsPeriod(kind: PeriodKind, now: string | number | Date = Date.now()): Period {
  const today = calendarDate(now) ?? iso(new Date());
  const base = { kind, label: periodLabels[kind] };
  switch (kind) {
    case "7d":
    case "30d": {
      const length = kind === "7d" ? 7 : 30;
      const from = addDays(today, -(length - 1));
      return {
        ...base,
        range: { from, to: today },
        previous: { from: addDays(from, -length), to: addDays(from, -1) },
      };
    }
    case "month": {
      // Compared with the same days of the previous month (1st to today's day).
      const from = monthStart(today);
      const previousFrom = monthStart(today, -1);
      const elapsed = Math.round((day(today).getTime() - day(from).getTime()) / 86400000);
      const previousTo = addDays(previousFrom, elapsed);
      return {
        ...base,
        range: { from, to: today },
        previous: {
          from: previousFrom,
          to: previousTo > monthEnd(previousFrom) ? monthEnd(previousFrom) : previousTo,
        },
      };
    }
    case "last-month": {
      const from = monthStart(today, -1);
      const previousFrom = monthStart(today, -2);
      return {
        ...base,
        range: { from, to: monthEnd(from) },
        previous: { from: previousFrom, to: monthEnd(previousFrom) },
      };
    }
    default:
      return { ...base, range: undefined, previous: undefined };
  }
}

/** Manifests whose date falls in the range; without a range, all of them. */
export function inRange(manifests: Manifest[], range: DateRange | undefined) {
  if (!range) return manifests;
  return manifests.filter((manifest) => {
    const date = manifestReferenceDate(manifest);
    return !!date && date >= range.from && date <= range.to;
  });
}

/** "01/10 a 31/10/2026" */
export function formatRange(range: DateRange) {
  const short = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
  return `${short(range.from)} a ${short(range.to)}/${range.to.slice(0, 4)}`;
}

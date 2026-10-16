import { normalizeIssueDate } from "./manifest-date";
import type { NfOccurrence } from "./conference";

/** Luft report clock time, not the import time or the manifest issue time. */
export function normalizeReportGeneratedAt(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (
    !match ||
    !normalizeIssueDate(match[1]!) ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59
  )
    return undefined;
  return value;
}
export function reportGeneratedAt(filename: string): string | undefined {
  const match = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*\(\d+\))?\.xlsx$/i.exec(filename);
  return match
    ? normalizeReportGeneratedAt(
        `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`,
      )
    : undefined;
}
/** Match the declared last code; never select a different event just because
 * it appears first, or use a delivery/manifest/receipt date as its event date. */
export function lastOccurrenceDate(code: string, history: string): string | undefined {
  if (!code) return undefined;
  const dates: string[] = [];
  for (const entry of history.split(";")) {
    const match = /^\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*([A-Z0-9]+)\s*-/i.exec(entry);
    if (!match || match[2]!.toUpperCase() !== code.toUpperCase()) continue;
    const date = normalizeIssueDate(match[1]!);
    if (date) dates.push(date);
  }
  return dates.sort().at(-1);
}
export const sameOccurrenceValue = (a: NfOccurrence | undefined, b: NfOccurrence) =>
  a?.nf === b.nf && a.code === b.code && a.description === b.description;

/** Missing references may be retained only for the very same event value. */
export function mergeOccurrenceReference(
  previous: NfOccurrence | undefined,
  incoming: NfOccurrence,
): NfOccurrence {
  return sameOccurrenceValue(previous, incoming) ? { ...previous, ...incoming } : incoming;
}

export function compareOccurrence(
  previous: NfOccurrence | undefined,
  incoming: NfOccurrence,
): "newer" | "equal" | "older" | "uncertain" {
  if (!previous) return "newer";
  const before = normalizeIssueDate(previous.occurredOn ?? "");
  const after = normalizeIssueDate(incoming.occurredOn ?? "");
  const beforeReport = normalizeReportGeneratedAt(previous.reportGeneratedAt ?? "");
  const afterReport = normalizeReportGeneratedAt(incoming.reportGeneratedAt ?? "");
  if (before && after && before !== after) return after > before ? "newer" : "older";
  if (beforeReport && afterReport && beforeReport !== afterReport)
    return afterReport > beforeReport ? "newer" : "older";
  if (sameOccurrenceValue(previous, incoming))
    return (!before && after) || (!beforeReport && afterReport) ? "newer" : "equal";
  // Legacy values have no chronological reference. The first dated export
  // establishes that reference; subsequent imports cannot move backwards.
  if (!before && !beforeReport && (after || afterReport)) return "newer";
  return "uncertain";
}

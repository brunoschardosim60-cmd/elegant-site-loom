import type { Manifest } from "./conference";

type ManifestDates = Pick<Manifest, "date" | "issueDate">;
/** Printed local clock time, independent from registration time and delivery agenda. */
export function normalizeIssueTime(value: string): string | undefined {
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  return match && Number(match[1]) < 24 ? `${match[1]!.padStart(2, "0")}:${match[2]}` : undefined;
}
const brazilDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A printed issue date is a calendar date, never a UTC timestamp. */
export function normalizeIssueDate(value: string): string | undefined {
  const clean = value.trim().replace(/\s*([/.-])\s*/g, "$1");
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  const brazilian = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(clean);
  if (!iso && !brazilian) return undefined;
  const year = Number(iso?.[1] ?? brazilian![3]);
  const month = Number(iso?.[2] ?? brazilian![2]);
  const day = Number(iso?.[3] ?? brazilian![1]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Read only a labelled pre header; delivery dates must never become its issue date. */
export function parsePreIssueDate(text: string): string | undefined {
  const candidates = new Set<string>();
  const datePattern =
    /(?<!\d)(?:\d{4}\s*-\s*\d{2}\s*-\s*\d{2}|\d{2}\s*[/.-]\s*\d{2}\s*[/.-]\s*\d{4})(?!\d)/g;
  for (const label of text.matchAll(/\bDATA(?:\s+(?:DE\s+)?EMISS[AÃ]O)?\b/gi)) {
    const after = text
      .slice(label.index! + label[0].length, label.index! + label[0].length + 180)
      .split(
        /\b(?:PREV\.?\s*ENTREGA|PREVIS[AÃ]O|PREVISTA|ENTREGA|RESTRI[CÇ][AÃ]O|REMETENTE|CTC[Ss]?)\b/i,
      )[0]!;
    for (const match of after.matchAll(datePattern)) {
      const date = normalizeIssueDate(match[0]);
      if (date) candidates.add(date);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function calendarDate(value: string | number | Date): string | undefined {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return normalizeIssueDate(value);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = Object.fromEntries(
    brazilDate.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

export function manifestReferenceDate(manifest: ManifestDates): string | undefined {
  return normalizeIssueDate(manifest.issueDate ?? "") ?? calendarDate(manifest.date);
}

export function formatManifestDate(value: string | undefined): string {
  const date = normalizeIssueDate(value ?? "");
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "—";
}

export function manifestAgeDays(
  manifest: ManifestDates,
  now: string | number | Date = Date.now(),
): number {
  const reference = manifestReferenceDate(manifest);
  const today = calendarDate(now);
  if (!reference || !today) return 0;
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(reference)) / 86400000));
}

export function manifestAgeLabel(
  manifest: ManifestDates,
  now: string | number | Date = Date.now(),
): string {
  const issueDate = normalizeIssueDate(manifest.issueDate ?? "");
  const reference = manifestReferenceDate(manifest);
  const today = calendarDate(now);
  const source = issueDate ? "Emitido" : "Cadastrado";
  if (!reference) return "Data não informada";
  if (reference && today && reference > today)
    return issueDate ? "Emissão futura · conferir" : "Cadastro futuro · conferir";
  const days = manifestAgeDays(manifest, now);
  return days ? `${source} há ${days} ${days === 1 ? "dia" : "dias"}` : `${source} hoje`;
}

export function compareManifestDates(a: ManifestDates, b: ManifestDates): number {
  return (
    (manifestReferenceDate(a) ?? "").localeCompare(manifestReferenceDate(b) ?? "") ||
    a.date.localeCompare(b.date)
  );
}

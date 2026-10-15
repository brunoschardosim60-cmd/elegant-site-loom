import type { DocumentItem, Manifest } from "./conference";

export const normalizeConferenceSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");

export function conferenceTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Keep list, pending-row and report searches consistent, preserving CTC zeros. */
export function matchesConferenceSearch(
  manifest: Manifest,
  query: string,
  document?: DocumentItem,
): boolean {
  const search = normalizeConferenceSearch(query);
  const documents = document ? [document] : manifest.documents;
  if (/^\d{10}$/.test(search)) return documents.some((doc) => doc.ctc === search);
  return normalizeConferenceSearch(
    `${manifest.id} ${manifest.driver} ${manifest.plate} ${documents.map((doc) => `${doc.ctc} ${doc.nf} ${doc.client ?? ""} ${doc.recipient ?? ""}`).join(" ")}`,
  ).includes(search);
}

/** Legacy activity has only a clock time: never pretend it happened today. */
export function activityTimestamp(item: { at?: string | undefined; time: string }): string {
  return (
    conferenceTimestamp(item.at) ?? `${item.time || "Horário não registrado"} · data não registrada`
  );
}

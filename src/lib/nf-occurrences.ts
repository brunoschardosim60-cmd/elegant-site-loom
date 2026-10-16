import type { Manifest, NfOccurrence } from "./conference";
import type { ImportDraft } from "./manifest-import";
import {
  compareOccurrence,
  mergeOccurrenceReference,
  normalizeReportGeneratedAt,
  sameOccurrenceValue,
} from "./nf-occurrence-date";
import { normalizeIssueDate } from "./manifest-date";

type Row = {
  nf: string;
  occurrenceCode?: string | undefined;
  occurrenceDescription?: string | undefined;
  occurrenceDate?: string | undefined;
  reportGeneratedAt?: string | undefined;
};

export function occurrencesFromRows(rows: Row[]): NfOccurrence[] {
  return rows.flatMap((row) => {
    const code = row.occurrenceCode?.trim() ?? "";
    const description = row.occurrenceDescription?.trim() ?? "";
    if (!code && !description) return [];
    const occurredOn = normalizeIssueDate(row.occurrenceDate ?? "");
    const reportGeneratedAt = normalizeReportGeneratedAt(row.reportGeneratedAt ?? "");
    return row.nf.split(/[,;]/).map((nf) => ({
      nf: nf.trim(),
      code,
      description,
      ...(occurredOn ? { occurredOn } : {}),
      ...(reportGeneratedAt ? { reportGeneratedAt } : {}),
    }));
  });
}

/** Join by manifest + CTC + literal NF-series only. Never add records, infer a
 * route, erase missing source values, or change a receipt/owner from this report. */
export function planOccurrenceUpdates(manifests: Manifest[], drafts: ImportDraft[]) {
  const updates = new Map<string, NfOccurrence>();
  for (const draft of drafts)
    for (const row of draft.rows)
      for (const occurrence of occurrencesFromRows([row])) {
        const key = JSON.stringify([draft.id, row.ctc, occurrence.nf]);
        const previous = updates.get(key);
        if (previous && !sameOccurrenceValue(previous, occurrence))
          throw new Error(`Ocorrências conflitantes para o CTC ${row.ctc} / NF ${occurrence.nf}.`);
        if (!previous || compareOccurrence(previous, occurrence) === "newer")
          updates.set(key, mergeOccurrenceReference(previous, occurrence));
      }
  let count = 0;
  let skippedOlder = 0,
    skippedUncertain = 0;
  const ids = new Set<string>();
  const next = manifests.map((manifest) => {
    let changed = false;
    const documents = manifest.documents.map((doc) => {
      const values = new Map((doc.nfOccurrences ?? []).map((item) => [item.nf, item]));
      let docChanged = false;
      for (const nf of doc.nf.split(/[,;]/).map((value) => value.trim())) {
        const incoming = updates.get(JSON.stringify([manifest.id, doc.ctc, nf]));
        if (!incoming) continue;
        const comparison = compareOccurrence(values.get(nf), incoming);
        if (comparison === "older") {
          skippedOlder++;
          continue;
        }
        if (comparison === "uncertain") {
          skippedUncertain++;
          continue;
        }
        if (comparison === "equal") continue;
        values.set(nf, mergeOccurrenceReference(values.get(nf), incoming));
        count++;
        changed = docChanged = true;
      }
      return docChanged ? { ...doc, nfOccurrences: [...values.values()] } : doc;
    });
    if (!changed) return manifest;
    ids.add(manifest.id);
    return { ...manifest, documents };
  });
  return { manifests: next, count, manifestIds: [...ids], skippedOlder, skippedUncertain };
}

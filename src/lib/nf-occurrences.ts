import type { Manifest, NfOccurrence } from "./conference";
import type { ImportDraft } from "./manifest-import";

type Row = {
  nf: string;
  occurrenceCode?: string | undefined;
  occurrenceDescription?: string | undefined;
};
const sameOccurrence = (a: NfOccurrence | undefined, b: NfOccurrence) =>
  a?.nf === b.nf && a.code === b.code && a.description === b.description;

export function occurrencesFromRows(rows: Row[]): NfOccurrence[] {
  return rows.flatMap((row) => {
    const code = row.occurrenceCode?.trim() ?? "";
    const description = row.occurrenceDescription?.trim() ?? "";
    if (!code && !description) return [];
    return row.nf.split(/[,;]/).map((nf) => ({ nf: nf.trim(), code, description }));
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
        if (previous && !sameOccurrence(previous, occurrence))
          throw new Error(`Ocorrências conflitantes para o CTC ${row.ctc} / NF ${occurrence.nf}.`);
        updates.set(key, occurrence);
      }
  let count = 0;
  const ids = new Set<string>();
  const next = manifests.map((manifest) => {
    let changed = false;
    const documents = manifest.documents.map((doc) => {
      const values = new Map((doc.nfOccurrences ?? []).map((item) => [item.nf, item]));
      let docChanged = false;
      for (const nf of doc.nf.split(/[,;]/).map((value) => value.trim())) {
        const incoming = updates.get(JSON.stringify([manifest.id, doc.ctc, nf]));
        if (!incoming || sameOccurrence(values.get(nf), incoming)) continue;
        values.set(nf, incoming);
        count++;
        changed = docChanged = true;
      }
      return docChanged ? { ...doc, nfOccurrences: [...values.values()] } : doc;
    });
    if (!changed) return manifest;
    ids.add(manifest.id);
    return { ...manifest, documents };
  });
  return { manifests: next, count, manifestIds: [...ids] };
}

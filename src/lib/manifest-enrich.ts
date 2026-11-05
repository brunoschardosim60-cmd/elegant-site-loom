import type { DocumentItem, Manifest } from "./conference";
import { applyImports, type ImportDraft } from "./manifest-import";

/** Fields a 108 export brings that older imports may lack. */
const DOC_FIELDS = [
  "cargoValueCents",
  "weightGrams",
  "nature",
  "city",
  "client",
  "recipient",
  "deliveryDates",
] as const;

const missing = (value: unknown) =>
  value === undefined || value === "" || (Array.isArray(value) && !value.length);

/**
 * Completes manifests already registered with what a 108 export brings now
 * (value, weight, nature, city, client, recipient, delivery forecast and the
 * checker), for records imported before those columns were read. Only empty
 * fields are filled: nothing typed or conferred is ever changed, and CTCs
 * are matched by manifest number (including earlier numbers) and CTC.
 */
export function planDetailUpdates(manifests: Manifest[], drafts: ImportDraft[]) {
  const incoming = new Map<string, { checker?: string; docs: Map<string, DocumentItem> }>();
  for (const draft of drafts) {
    // Each pre on its own, so one invalid line does not hold back the rest.
    const { targetId: _target, ...own } = draft;
    const built = applyImports([], [own], new Date(0).toISOString());
    if (!built.ok) continue;
    const manifest = built.manifests[0]!;
    incoming.set(manifest.id, {
      ...(manifest.checker ? { checker: manifest.checker } : {}),
      docs: new Map(manifest.documents.map((doc) => [doc.ctc, doc])),
    });
  }
  let count = 0;
  const ids: string[] = [];
  const next = manifests.map((manifest) => {
    const source = [manifest.id, ...(manifest.previousIds ?? [])]
      .map((id) => incoming.get(id))
      .find(Boolean);
    if (!source) return manifest;
    let changed = false;
    const documents = manifest.documents.map((doc) => {
      const fresh = source.docs.get(doc.ctc);
      if (!fresh) return doc;
      const patch: Partial<DocumentItem> = {};
      for (const field of DOC_FIELDS)
        if (missing(doc[field]) && !missing(fresh[field]))
          (patch as Record<string, unknown>)[field] = fresh[field];
      if (!Object.keys(patch).length) return doc;
      count++;
      changed = true;
      return { ...doc, ...patch };
    });
    const checker = !manifest.checker && source.checker ? source.checker : undefined;
    if (!changed && !checker) return manifest;
    ids.push(manifest.id);
    return { ...manifest, documents, ...(checker ? { checker } : {}) };
  });
  return { manifests: next, count, manifestIds: ids };
}

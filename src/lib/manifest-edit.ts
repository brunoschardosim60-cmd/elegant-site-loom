import type { Manifest } from "./conference";
import { applyImports, type ImportDraft, type ImportOutcome } from "./manifest-import";

/** Preserve stable document IDs and receipt times, and reject stale field edits.
 * A colleague may scan while the editor is open; use their latest receipt state.
 */
export function applyManifestEdit(
  existing: Manifest[],
  base: Manifest,
  draft: ImportDraft,
): ImportOutcome {
  const latest = existing.find((item) => item.id === base.id);
  const fail = (error: string): ImportOutcome => ({ ok: false, error, index: 0 });
  if (!latest)
    return fail("Este pré foi excluído ou renumerado por outra pessoa. Feche e abra novamente.");
  const content = (manifest: Manifest) =>
    JSON.stringify({
      ...manifest,
      finishedAt: undefined,
      documents: manifest.documents.map((doc) => ({
        ...doc,
        received: undefined,
        receivedAt: undefined,
      })),
    });
  if (content(latest) !== content(base))
    return fail(
      "Outra pessoa editou os dados deste pré. Feche e abra novamente para não sobrescrever a alteração.",
    );
  if (draft.rows.length !== base.documents.length)
    return fail("Edite os CTCs existentes; use a importação para incluir novos documentos.");
  const result = applyImports(
    existing.filter((item) => item.id !== base.id),
    [{ ...draft, sourcePhotoHash: undefined }],
    latest.date,
  );
  if (!result.ok) return result;
  const replacement = result.manifests.at(-1)!;
  if (replacement.documents.length !== latest.documents.length)
    return fail("A edição não pode juntar dois CTCs já cadastrados.");
  if (
    replacement.documents.some(
      (doc, index) => latest.documents[index]!.received && latest.documents[index]!.ctc !== doc.ctc,
    )
  )
    return fail("Desfaça a conferência antes de corrigir o número de um CTC recebido.");
  replacement.documents = replacement.documents.map((doc, index) => {
    const old = latest.documents[index]!;
    if (old.received && old.ctc !== doc.ctc)
      throw new Error("Desfaça a conferência antes de corrigir o número de um CTC recebido.");
    return { ...old, ...doc, id: old.id, received: old.received, receivedAt: old.receivedAt };
  });
  const edited: Manifest = {
    ...latest,
    ...replacement,
    sourcePhotoHashes: latest.sourcePhotoHashes,
    previousIds:
      replacement.id === latest.id
        ? latest.previousIds
        : [...(latest.previousIds ?? []), latest.id],
    finishedAt: latest.finishedAt,
  };
  return { ok: true, manifests: existing.map((item) => (item.id === base.id ? edited : item)) };
}

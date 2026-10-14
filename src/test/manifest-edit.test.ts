import { expect, it } from 'vitest';
import { applyManifestEdit } from '@/lib/manifest-edit';
import { applyImports, type ImportDraft } from '@/lib/manifest-import';
import type { Manifest } from '@/lib/conference';
const base: Manifest = { id: 'DI0601869631', driver: 'VARGAS FERNANDES', plate: 'TRB7E25', date: '2026-10-13', finishedAt: '2026-10-14T01:00:00Z', sourcePhotoHashes: ['a'.repeat(64)], documents: [{ id: 'stable-document', ctc: '5602298284', nf: '145194-1', volumes: 1, received: true, receivedAt: '2026-10-14T01:00:00Z' }] };
const draft = (): ImportDraft => ({ id: 'DI00601869631', driver: 'DAVID VARGAS FERNANDES', plate: 'TRB7E25', rows: [{ ctc: '5602298284', nf: '145194-1', volumes: '60' }] });
it('corrects the number, name and volumes without losing stable IDs, receipt times or photo dedupe', () => {
  const result = applyManifestEdit([base], base, draft());
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.manifests[0]).toMatchObject({ id: 'DI00601869631', driver: 'DAVID VARGAS FERNANDES', previousIds: [base.id], finishedAt: base.finishedAt, sourcePhotoHashes: base.sourcePhotoHashes, documents: [{ id: 'stable-document', volumes: 60, received: true, receivedAt: base.documents[0]!.receivedAt }] });
});
it('preserves a receipt by a colleague while rejecting concurrent edits and deletion', () => {
  const pending = { ...base, documents: base.documents.map(doc => ({ ...doc, received: false })) };
  expect(applyManifestEdit([base], pending, draft()).ok).toBe(true);
  expect(applyManifestEdit([{ ...base, driver: 'OUTRO' }], base, draft()).ok).toBe(false);
  expect(applyManifestEdit([], base, draft()).ok).toBe(false);
});
it('rejects duplicate pré/CTC, received CTC renumbering and structural changes', () => {
  const other = { ...base, id: draft().id, documents: [{ ...base.documents[0]!, id: 'other', ctc: '0000000001' }] };
  expect(applyManifestEdit([base, other], base, draft()).ok).toBe(false);
  const changed = draft(); changed.rows[0]!.ctc = '0000000002';
  expect(applyManifestEdit([base], base, changed).ok).toBe(false);
  expect(applyManifestEdit([base], base, { ...draft(), rows: [] }).ok).toBe(false);
});
it('requires explicit totals review and invalidates that review when values are edited in the form', () => {
  const item = { ...draft(), expectedRows: 1, totalVolumes: 98 };
  expect(applyImports([], [item], '2026-10-14').ok).toBe(false);
  expect(applyImports([], [{ ...item, totalsReviewed: true }], '2026-10-14').ok).toBe(true);
});

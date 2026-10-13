import { describe, expect, it } from 'vitest';
import { applyImports, findImportConflicts, type ImportDraft } from '@/lib/manifest-import';
import type { Manifest } from '@/lib/conference';
const draft = (id = 'DI00123456789', ctc = '0012345678'): ImportDraft => ({ id, driver: 'Motorista', plate: 'ABC1D23', rows: [{ ctc, nf: '12345-1', volumes: '3', client: 'Laboratório Alfa', recipient: 'Farmácia Beta' }] });
const hash = 'a'.repeat(64);
const saved = (id = 'DI00123456789', ctc = '0012345678', driver = 'Ana Silva'): Manifest => ({ id, driver, plate: 'ABC1D23', date: '2026-10-11', documents: [{ id: `${id}-${ctc}`, ctc, nf: '12345-1', volumes: 3, received: false }] });
describe('Reviewed batch import', () => {
  it('imports independent manifests and keeps client fields', () => {
    const result = applyImports([], [draft(), draft('DI00123456790', '1234567890')], 'now');
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.manifests).toHaveLength(2); expect(result.manifests[0]?.documents[0]).toMatchObject({ ctc: '0012345678', client: 'Laboratório Alfa', recipient: 'Farmácia Beta', volumes: 3 }); }
  });
  it('rejects the entire batch when a hidden row needs volumes', () => {
    const bad = draft('DI00123456790', '1234567890'); bad.rows.push({ ctc: '2345678901', nf: '', volumes: '' });
    expect(applyImports([], [draft(), bad], 'now')).toMatchObject({ ok: false, index: 1, row: 1 });
  });
  it('rejects repeated pre-manifests but combines multiple NF rows sharing one CTC', () => {
    expect(applyImports([], [draft(), draft()], 'now')).toMatchObject({ ok: false, index: 1 });
    const sharedCtc = draft();
    sharedCtc.rows.push({ ctc: sharedCtc.rows[0]!.ctc, nf: '67890-2', volumes: '2', client: 'Laboratório Alfa', recipient: 'Farmácia Beta' });
    expect(findImportConflicts([], [sharedCtc]).filter(conflict => conflict.kind === 'ctc')).toEqual([]);
    const result = applyImports([], [sharedCtc], 'now');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifests[0]!.documents).toHaveLength(1);
      expect(result.manifests[0]!.documents[0]).toMatchObject({ ctc: '0012345678', nf: '12345-1, 67890-2', volumes: 5 });
    }
  });
  it('appends a DACTE to an explicitly selected pre and reopens completion', () => {
    const first = applyImports([], [{ ...draft(), issueDate: '2026-08-27' }], 'now'); if (!first.ok) throw new Error('setup');
    const original = { ...first.manifests[0]!, finishedAt: 'done' };
    const extra = { ...draft('', '2345678901'), targetId: original.id, issueDate: '2026-10-01' };
    const result = applyImports([original], [extra], 'later');
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.manifests[0]?.documents).toHaveLength(2); expect(result.manifests[0]?.finishedAt).toBeUndefined(); expect(result.manifests[0]?.issueDate).toBe('2026-08-27'); }
    expect(original.documents).toHaveLength(1);
  });
  it('keeps printed issue date separate from registration and leaves missing dates absent', () => {
    const result = applyImports([], [{ ...draft(), issueDate: '28/08/2026' }, draft('DI00123456790', '1234567890')], '2026-10-11T14:00:00Z');
    if (!result.ok) throw new Error(result.error);
    expect(result.manifests[0]).toMatchObject({ issueDate: '2026-08-28', date: '2026-10-11T14:00:00Z' });
    expect(result.manifests[1]).not.toHaveProperty('issueDate');
  });
  it('rejects the whole batch with an invalid issue date without mutating saved data', () => {
    const existing = applyImports([], [draft()], 'now'); if (!existing.ok) throw new Error('setup');
    const result = applyImports(existing.manifests, [{ ...draft('DI00123456790', '1234567890'), issueDate: '31/02/2026' }], 'later');
    expect(result).toMatchObject({ ok: false, index: 0, error: 'Confira a data de emissão do pré.' });
    expect(existing.manifests).toHaveLength(1);
    expect(existing.manifests[0]).not.toHaveProperty('issueDate');
  });

  it.each([false, true])('blocks an existing CTC globally even when its pre is finished: %s', finished => {
    const original = { ...saved(), ...(finished ? { finishedAt: 'done' } : {}) };
    const incoming = { ...draft('DI00123456790'), driver: 'Bruno Souza' };
    const result = applyImports([original], [incoming], 'later');
    expect(result).toMatchObject({ ok: false, index: 0, row: 0 });
    if (result.ok) throw new Error('Duplicate accepted');
    expect(result.error).toContain(original.id); expect(result.error).toContain('Ana Silva');
    expect(original.documents).toHaveLength(1);
  });

  it('reports both copies of a CTC in different incoming pres and rejects the complete batch atomically', () => {
    const incoming = [draft(), { ...draft('DI00123456790'), driver: 'Bruno Souza' }];
    expect(findImportConflicts([], incoming)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ctc', index: 0, row: 0, manifestId: 'DI00123456790', message: expect.stringContaining('Bruno Souza') }),
      expect.objectContaining({ kind: 'ctc', index: 1, row: 0, manifestId: 'DI00123456789', message: expect.stringContaining('Motorista') }),
    ]));
    const original = saved('DI00123456791', '0000000001');
    const before = structuredClone(original);
    expect(applyImports([original], incoming, 'later')).toMatchObject({ ok: false, index: 1, row: 0 });
    expect(original).toEqual(before);
  });

  it('does not report same-CTC NF rows in one pre, and still reports repeated pre IDs in a batch', () => {
    const repeatedRows = draft(); repeatedRows.rows.push({ ...repeatedRows.rows[0]!, nf: '99999-1' });
    expect(findImportConflicts([], [repeatedRows]).filter(conflict => conflict.kind === 'ctc')).toEqual([]);
    const repeatedIds = findImportConflicts([], [draft(), draft(undefined, '0000000002')]).filter(conflict => conflict.kind === 'manifest');
    expect(repeatedIds.map(conflict => conflict.index)).toEqual([0, 1]);
    expect(repeatedIds.every(conflict => conflict.message.includes('Motorista') && conflict.message.includes('DI00123456789'))).toBe(true);
  });

  it('blocks a DACTE CTC already in another pre, or in its selected target', () => {
    const target = saved('DI00123456790', '0000000001', 'Bruno Souza');
    const other = saved();
    for (const [ctc, driver] of [['0012345678', 'Ana Silva'], ['0000000001', 'Bruno Souza']]) {
      const result = applyImports([target, other], [{ ...draft('', ctc), targetId: target.id }], 'later');
      expect(result).toMatchObject({ ok: false, index: 0, row: 0 });
      if (result.ok) throw new Error('Duplicate DACTE accepted');
      expect(result.error).toContain(driver);
    }
    expect(target.documents).toHaveLength(1); expect(other.documents).toHaveLength(1);
  });

  it('rejects duplicate DACTE additions in the same target without leaving the first addition or hash behind', () => {
    const target = saved(); const before = structuredClone(target);
    const extra = { ...draft('', '0000000001'), targetId: target.id, sourcePhotoHash: hash };
    const incoming = [extra, { ...extra, sourcePhotoHash: 'b'.repeat(64) }];
    expect(findImportConflicts([target], incoming).filter(conflict => conflict.kind === 'ctc').map(conflict => conflict.index)).toEqual([0, 1]);
    expect(applyImports([target], incoming, 'later')).toMatchObject({ ok: false, index: 1, row: 0 });
    expect(target).toEqual(before);
  });

  it('preserves leading zeroes and accepts distinct literal CTCs', () => {
    const result = applyImports([saved()], [draft('DI00123456790', '0123456780')], 'later');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.manifests.map(manifest => manifest.documents[0]!.ctc)).toEqual(['0012345678', '0123456780']);
    expect(result.manifests[0]!.documents[0]!.id).toContain('0012345678');
  });

  it('blocks the same registered photo even after the incoming pre ID and CTC are changed', () => {
    const original = { ...saved(), sourcePhotoHashes: [hash.toUpperCase()], finishedAt: 'done' };
    const incoming = { ...draft('DI00123456790', '0000000001'), sourcePhotoHash: hash };
    expect(findImportConflicts([original], [incoming])).toEqual([expect.objectContaining({ kind: 'manifest', index: 0, manifestId: original.id, message: `Esta foto já foi cadastrada no pré ${original.id} · motorista Ana Silva.` })]);
    expect(applyImports([original], [incoming], 'later')).toMatchObject({ ok: false, index: 0 });
  });

  it('reports every copy of a photo repeated across different pres in the batch', () => {
    const incoming = [{ ...draft(), sourcePhotoHash: hash }, { ...draft('DI00123456790', '0000000001'), driver: 'Bruno Souza', sourcePhotoHash: hash.toUpperCase() }];
    const conflicts = findImportConflicts([], incoming);
    expect(conflicts.map(conflict => [conflict.kind, conflict.index])).toEqual([['manifest', 0], ['manifest', 1]]);
    expect(conflicts[0]!.message).toContain('Bruno Souza');
    expect(applyImports([], incoming, 'later')).toMatchObject({ ok: false, index: 1 });
  });

  it('persists only valid registered photo hashes for new pres and subsequent DACTE additions', () => {
    const first = applyImports([], [{ ...draft(), sourcePhotoHash: hash.toUpperCase() }], 'now');
    if (!first.ok) throw new Error(first.error);
    expect(first.manifests[0]!.sourcePhotoHashes).toEqual([hash]);
    const nextHash = 'b'.repeat(64);
    const next = applyImports(first.manifests, [{ ...draft('', '0000000001'), targetId: first.manifests[0]!.id, sourcePhotoHash: nextHash }], 'later');
    if (!next.ok) throw new Error(next.error);
    expect(next.manifests[0]!.sourcePhotoHashes).toEqual([hash, nextHash]);
    expect(first.manifests[0]!.sourcePhotoHashes).toEqual([hash]);
    const manual = applyImports([], [draft()], 'now');
    if (!manual.ok) throw new Error(manual.error);
    expect(manual.manifests[0]).not.toHaveProperty('sourcePhotoHashes');
  });

  it.each(['', 'a'.repeat(63), 'g'.repeat(64), `${'a'.repeat(64)} `])('rejects an invalid photo hash before persisting any import', sourcePhotoHash => {
    const original = saved(); const before = structuredClone(original);
    expect(applyImports([original], [{ ...draft('DI00123456790', '0000000001'), sourcePhotoHash }], 'later')).toMatchObject({ ok: false, index: 0, error: 'Confira a identificação da foto antes de cadastrar novamente.' });
    expect(original).toEqual(before);
  });

  it('loads unrelated new imports without treating legacy duplicate CTCs as new conflicts', () => {
    const legacy = [saved(), saved('DI00123456790')];
    expect(findImportConflicts(legacy, [])).toEqual([]);
    expect(applyImports(legacy, [draft('DI00123456791', '0000000001')], 'later')).toMatchObject({ ok: true });
  });

  it('adds a DACTE to a new pre that appears later in the batch and preserves each registered photo hash', () => {
    const pre = { ...draft('DI00123456790', '0000000001'), sourcePhotoHash: hash, issueDate: '2026-08-28' };
    const dacte = { ...draft('', '0000000002'), targetId: pre.id, sourcePhotoHash: 'b'.repeat(64) };
    expect(findImportConflicts([], [dacte, pre])).toEqual([]);
    const result = applyImports([], [dacte, pre], 'later');
    if (!result.ok) throw new Error(result.error);
    expect(result.manifests).toHaveLength(1);
    expect(result.manifests[0]).toMatchObject({ id: pre.id, issueDate: '2026-08-28', sourcePhotoHashes: [hash, 'b'.repeat(64)] });
    expect(result.manifests[0]!.documents.map(document => document.ctc)).toEqual(['0000000001', '0000000002']);
  });

  it('keeps the photo order of new pres when a DACTE is processed after them', () => {
    const first = draft('DI00123456790', '0000000001'), second = draft('DI00123456791', '0000000002');
    const result = applyImports([], [{ ...draft('', '0000000003'), targetId: second.id }, first, second], 'later');
    if (!result.ok) throw new Error(result.error);
    expect(result.manifests.map(manifest => manifest.id)).toEqual([first.id, second.id]);
    expect(result.manifests[1]!.documents.map(document => document.ctc)).toEqual(['0000000002', '0000000003']);
  });

  it('reports the original DACTE position for a duplicate after reordering without changing saved data', () => {
    const original = saved(); const before = structuredClone(original);
    const pre = draft('DI00123456790', '0000000001');
    const dacte = { ...draft('', '0000000001'), targetId: pre.id };
    expect(applyImports([original], [dacte, pre], 'later')).toMatchObject({ ok: false, index: 0, row: 0, error: expect.stringContaining(pre.id) });
    expect(original).toEqual(before);
  });

  it('reports the original new-pre position when validation fails before a preceding DACTE can be added', () => {
    const pre = { ...draft('DI00123456790', '0000000001'), issueDate: '31/02/2026' };
    const dacte = { ...draft('', '0000000002'), targetId: pre.id };
    expect(applyImports([], [dacte, pre], 'later')).toMatchObject({ ok: false, index: 1, error: 'Confira a data de emissão do pré.' });
  });
});

it('rejects identical CTC/NF rows in one import rather than silently doubling their volumes', () => {
 const incoming = draft(); incoming.rows.push({ ...incoming.rows[0]! });
 expect(findImportConflicts([], [incoming]).filter(c => c.kind === 'ctc')).toHaveLength(2);
 expect(applyImports([], [incoming], 'now')).toMatchObject({ ok: false, row: 0, error: expect.stringContaining('somar volumes duas vezes') });
});
it('rejects unsafe row quantities and overflowing sums for a CTC with multiple NFs', () => {
 const incoming = draft(); incoming.rows[0]!.volumes = '9007199254740993';
 expect(applyImports([], [incoming], 'now')).toMatchObject({ ok: false, row: 0 });
 incoming.rows[0]!.volumes = String(Number.MAX_SAFE_INTEGER); incoming.rows.push({ ...incoming.rows[0]!, nf: '67890-1', volumes: '1' });
 expect(applyImports([], [incoming], 'now')).toMatchObject({ ok: false, row: 0, error: expect.stringContaining('soma de volumes') });
});

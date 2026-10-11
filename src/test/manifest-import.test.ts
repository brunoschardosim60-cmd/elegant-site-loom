import { describe, expect, it } from 'vitest';
import { applyImports, type ImportDraft } from '@/lib/manifest-import';
const draft = (id = 'DI00123456789', ctc = '0012345678'): ImportDraft => ({ id, driver: 'Motorista', plate: 'ABC1D23', rows: [{ ctc, nf: '12345-1', volumes: '3', client: 'Laboratório Alfa', recipient: 'Farmácia Beta' }] });
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
  it('rejects repeated pre-manifests and CTCs', () => {
    expect(applyImports([], [draft(), draft()], 'now')).toMatchObject({ ok: false, index: 1 });
    const duplicated = draft(); duplicated.rows.push({ ...duplicated.rows[0]! });
    expect(applyImports([], [duplicated], 'now')).toMatchObject({ ok: false, row: 1 });
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
});

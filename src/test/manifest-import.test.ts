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
    const first = applyImports([], [draft()], 'now'); if (!first.ok) throw new Error('setup');
    const original = { ...first.manifests[0]!, finishedAt: 'done' };
    const extra = { ...draft('', '2345678901'), targetId: original.id };
    const result = applyImports([original], [extra], 'later');
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.manifests[0]?.documents).toHaveLength(2); expect(result.manifests[0]?.finishedAt).toBeUndefined(); }
    expect(original.documents).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { reconcileDocuments, type PhotoFields } from '@/lib/photo-fields';

const pre = (docs: { nf: string; volumes: string }[], totalVolumes?: number) =>
  ({ kind: 'pre', id: '', plate: '', driver: '', ctcs: [], totalVolumes, expectedRows: docs.length, expectedNfs: docs.length, documents: docs.map((d, i) => ({ ctc: String(5602298260 + i), ...d, review: [] })) }) as unknown as PhotoFields;

describe('reconcileDocuments', () => {
  it('restores the shared NF series when the hyphen was lost', () => {
    const out = reconcileDocuments(pre([{ nf: '145286-1', volumes: '1' }, { nf: '145226-1', volumes: '1' }, { nf: '762458-1', volumes: '1' }, { nf: '722251', volumes: '1' }]));
    expect(out.documents[3]!.nf).toBe('72225-1');
    expect(out.documents[3]!.review).toContain('NF');
  });
  it('fills a single unreadable volume from the header total', () => {
    const out = reconcileDocuments(pre([{ nf: '1-1', volumes: '60' }, { nf: '2-1', volumes: '' }, { nf: '3-1', volumes: '37' }], 98));
    expect(out.documents[1]!.volumes).toBe('1');
  });
  it('leaves volumes blank when more than one is unreadable', () => {
    const out = reconcileDocuments(pre([{ nf: '1-1', volumes: '' }, { nf: '2-1', volumes: '' }], 98));
    expect(out.documents.map(d => d.volumes)).toEqual(['', '']);
  });
  it.each(['expectedRows', 'expectedNfs'] as const)('does not balance an incomplete table with a missing or different %s count', field => {
    const source = pre([{ nf: '1-1', volumes: '60' }, { nf: '2-1', volumes: '' }], 98);
    delete source[field];
    expect(reconcileDocuments(source).documents[1]!.volumes).toBe('');
    source[field] = 3;
    expect(reconcileDocuments(source).documents[1]!.volumes).toBe('');
  });
  it.each(['0', '-1', '1.5', 'NaN'])('does not calculate another row from an invalid volume %s', value => {
    const source = pre([{ nf: '1-1', volumes: value }, { nf: '2-1', volumes: '' }], 98);
    expect(reconcileDocuments(source).documents[1]!.volumes).toBe('');
  });
  it('keeps calculated volumes reviewable and reconciliation idempotent without mutating the input', () => {
    const source = pre([{ nf: '1-1', volumes: '60' }, { nf: '2-1', volumes: '' }, { nf: '3-1', volumes: '37' }], 98);
    const once = reconcileDocuments(source);
    expect(reconcileDocuments(once)).toEqual(once);
    expect(once.documents[1]!.review).toContain('Volumes calculados pelo total do cabeçalho (98). Confira na foto.');
    expect(source.documents[1]!.volumes).toBe('');
  });
  it('does not infer a DACTE volume or reconstruct repeated table rows', () => {
    const source = pre([{ nf: '1-1', volumes: '60' }, { nf: '2-1', volumes: '' }], 98);
    expect(reconcileDocuments({ ...source, kind: 'dacte' }).documents[1]!.volumes).toBe('');
    source.documents[1]!.ctc = source.documents[0]!.ctc;
    source.documents[1]!.nf = source.documents[0]!.nf;
    expect(reconcileDocuments(source).documents[1]!.volumes).toBe('');
  });
});

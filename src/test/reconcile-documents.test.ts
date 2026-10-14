import { describe, expect, it } from 'vitest';
import { reconcileDocuments, type PhotoFields } from '@/lib/photo-fields';

const pre = (docs: { nf: string; volumes: string }[], totalVolumes?: number) =>
  ({ id: '', plate: '', driver: '', ctcs: [], totalVolumes, documents: docs.map((d, i) => ({ ctc: String(5602298260 + i), ...d, review: [] })) }) as unknown as PhotoFields;

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
});

import { expect, it } from 'vitest';
import { markLocalPhoto } from '@/lib/local-photo';
import type { PhotoFields } from '@/lib/photo-fields';

it('marks every browser-read row for review and never claims double-read agreement', () => {
  const pre: PhotoFields = { id: 'DI00601860020', kind: 'pre', plate: 'IXA4F03', driver: 'DIOGO', ctcs: ['0000000001', '0000000002'], documents: [{ ctc: '0000000001', nf: '11-1', volumes: '2', client: 'LAB', recipient: 'CLIENTE', review: ['NF'] }, { ctc: '0000000002', nf: '', volumes: '' }], verification: { status: 'matched', checkedFields: 10, conflicts: 0 } };
  const result = markLocalPhoto(pre);
  expect(result.readingSource).toBe('local');
  expect(result.verification).toEqual({ status: 'unavailable', checkedFields: 0, conflicts: 0 });
  expect(result.documents.every(row => row.review?.some(text => text.startsWith('Leitura local')))).toBe(true);
  expect(result.documents[0]).toMatchObject({ ctc: '0000000001', nf: '11-1', volumes: '2', client: 'LAB', recipient: 'CLIENTE' });
  expect(result.documents[0]?.review).toContain('NF');
  expect(pre.verification?.status).toBe('matched');
  expect(pre.documents[1]?.review).toBeUndefined();
});

it('keeps leading-zero CTCs from a partial page as editable, explicitly unverified rows', () => {
  const result = markLocalPhoto({ id: '', plate: '', driver: '', kind: 'unknown', ctcs: ['0000000001'], documents: [] });
  expect(result.documents).toEqual([expect.objectContaining({ ctc: '0000000001', nf: '', volumes: '', review: expect.any(Array) })]);
  expect(result.headerReview?.join(' ')).toContain('incompleta');
});

it('explains differences from printed counts and volumes without filling the missing values', () => {
  const result = markLocalPhoto({ id: '', plate: '', driver: '', kind: 'pre', ctcs: ['0000000001'],
    expectedRows: 11, totalVolumes: 132, documents: [{ ctc: '0000000001', nf: '', volumes: '20' }] });
  expect(result.headerReview).toEqual(expect.arrayContaining([
    'Cabeçalho informa 11 CTCs; a leitura local encontrou 1. Confira todas as linhas.',
    'Cabeçalho informa 132 volumes; a leitura local somou 20. Confira os volumes na foto.',
  ]));
  expect(result.documents).toHaveLength(1);
  expect(result.documents[0]?.volumes).toBe('20');
});

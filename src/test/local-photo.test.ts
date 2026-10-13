import { expect, it } from 'vitest';
import { markLocalPhoto } from '@/lib/local-photo';
import type { PhotoFields } from '@/lib/photo-fields';

it('flags only uncertain fields on local OCR rows and never claims double-read agreement', () => {
  const pre: PhotoFields = { id: 'DI00601860020', kind: 'pre', plate: 'IXA4F03', driver: 'DIOGO', ctcs: ['0000000001', '0000000002'], documents: [{ ctc: '0000000001', nf: '11-1', volumes: '2', client: 'LAB', recipient: 'CLIENTE', review: ['NF'] }, { ctc: '0000000002', nf: '', volumes: '' }], verification: { status: 'matched', checkedFields: 10, conflicts: 0 } };
  const result = markLocalPhoto(pre);
  expect(result.readingSource).toBe('local');
  expect(result.verification).toEqual({ status: 'unavailable', checkedFields: 0, conflicts: 0 });
  expect(result.documents[0]?.review).toEqual(expect.arrayContaining(['NF']));
  expect(result.documents[0]?.review).not.toContain('Leitura local: confira CTC, NF, volumes, cliente e destinatário na foto.');
  expect(result.documents[1]?.review).toEqual(expect.arrayContaining([
    'NF-série não pôde ser lida com segurança.',
    'Volumes não puderam ser lidos com segurança.',
    'Cliente / laboratório não pôde ser lido.',
    'Destinatário não pôde ser lido.',
  ]));
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

it('compares the printed CTC total with unique identifiers, not NF rows', () => {
  const ctcs = Array.from({ length: 11 }, (_, index) => String(index + 1).padStart(10, '0'));
  const rowCtcs = [...ctcs, ...ctcs.slice(0, 4)];
  const result = markLocalPhoto({ id: 'DI00601869631', plate: '', driver: '', kind: 'pre', ctcs: rowCtcs,
    expectedRows: 11, totalVolumes: 15,
    documents: rowCtcs.map((ctc, index) => ({ ctc, nf: `${10000 + index}-1`, volumes: '1' })) });
  expect(result.documents).toHaveLength(15);
  expect(new Set(result.documents.map(row => row.ctc)).size).toBe(11);
  expect(result.headerReview?.some(message => message.includes('informa 11 CTCs'))).toBe(false);
});

it('does not show a generic sum mismatch when all individual values are present', () => {
  const result = markLocalPhoto({ id: 'DI00601869631', plate: '', driver: '', kind: 'pre',
    ctcs: ['0000000001', '0000000002'], expectedRows: 2, totalVolumes: 98,
    headerReview: ['Cabeçalho informa 98 volumes; a leitura local somou 92. Alguns volumes podem não ter sido reconhecidos. Confira a coluna inteira na foto.'],
    documents: [
      { ctc: '0000000001', nf: '12345-1', volumes: '40', client: 'LAB A', recipient: 'CLIENTE A' },
      { ctc: '0000000002', nf: '12346-1', volumes: '52', client: 'LAB B', recipient: 'CLIENTE B' },
    ] });
  expect(result.headerReview?.some(message => message.includes('somou 92'))).toBe(false);
  expect(result.documents.every(row => !row.review?.length)).toBe(true);
});

it('flags the exact missing volume field instead of a whole-column mismatch message', () => {
  const result = markLocalPhoto({ id: 'DI00601869631', plate: '', driver: '', kind: 'pre',
    ctcs: ['0000000001', '0000000002'], expectedRows: 2, totalVolumes: 98,
    documents: [
      { ctc: '0000000001', nf: '12345-1', volumes: '40', client: 'LAB A', recipient: 'CLIENTE A' },
      { ctc: '0000000002', nf: '12346-1', volumes: '', client: 'LAB B', recipient: 'CLIENTE B' },
    ] });
  expect(result.documents[0]?.review).toBeUndefined();
  expect(result.documents[1]?.review).toContain('Volumes não puderam ser lidos com segurança.');
  expect(result.headerReview?.some(message => message.includes('somou'))).toBe(false);
});

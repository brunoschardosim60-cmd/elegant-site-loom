import { expect, it } from 'vitest';
import { normalizeGeminiPhoto } from '@/lib/gemini-photo';

const example = () => ({ kind: 'pre', id: 'DI00123456789', plate: 'ABC1D23', driver: 'MOTORISTA TESTE', expectedRows: 11, totalVolumes: 66,
  documents: Array.from({ length: 11 }, (_, i) => ({ ctc: String(i + 1).padStart(10, '0'), nf: `${100 + i}-1`, volumes: String(i + 1), client: `LAB ${i}`, recipient: `CLIENTE ${i}`, review: [] })),
});
it('retains all eleven rows, leading zeroes, NF, volumes and laboratories', () => {
  const pre = normalizeGeminiPhoto(example());
  expect(pre.readingSource).toBe('gemini');
  expect(pre.documents).toHaveLength(11);
  expect(pre.documents[10]).toMatchObject({ ctc: '0000000011', nf: '110-1', volumes: '11', client: 'LAB 10', recipient: 'CLIENTE 10', review: [] });
});
it('does not derive CTC from a fiscal key and warns about incomplete rows and totals', () => {
  const input = example(); input.documents[0]!.ctc = '1'.repeat(44); input.documents[0]!.volumes = ''; input.documents.pop();
  const pre = normalizeGeminiPhoto(input);
  expect(pre.documents[0]!.ctc).toBe('');
  expect(pre.documents[0]!.volumes).toBe('');
  expect(pre.documents[1]!.review?.join(' ')).toContain('11 CTCs');
  expect(pre.documents[1]!.review?.join(' ')).toContain('66 volumes');
});

it('retains a complete issue date from the pre header and rejects impossible or partial dates', () => {
  expect(normalizeGeminiPhoto({ ...example(), issueDate: '28/08/2026' }).issueDate).toBe('2026-08-28');
  for (const issueDate of ['2026-02-30', '28/08']) {
    const pre = normalizeGeminiPhoto({ ...example(), issueDate });
    expect(pre.issueDate).toBeUndefined();
    expect(pre.headerReview).toContain('Confira a data de emissão do pré.');
  }
});

it('never uses a DACTE issue date as the pre issue date', () => {
  expect(normalizeGeminiPhoto({ ...example(), kind: 'dacte', issueDate: '2026-08-28' }).issueDate).toBeUndefined();
});

import { normalizePlate } from '@/lib/gemini-photo';
describe('placa', () => {
  it('fixes letter/digit swaps by position', () => expect(normalizePlate('1YA-7J3I')).toBe('IYA7J31'));
  it('does not invent characters on partial plates', () => expect(normalizePlate('IYA7J')).toBe('IYA7J'));
});

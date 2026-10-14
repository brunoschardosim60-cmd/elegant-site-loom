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
it('separates an exact literal NF token from the adjacent order without inventing digits or losing zeros', () => {
  const input=example();input.documents[0]!.nf='0001702-1 8004642984';
  const pre=normalizeGeminiPhoto(input);
  expect(pre.documents[0]!.nf).toBe('0001702-1');
  expect(pre.documents[0]!.review).toContain('NF separada do número adjacente na mesma linha. Confira a NF-série na foto.');
  expect(pre.documents[0]!.ctc).toBe('0000000001');
});
it.each(['111170218004642984','1111702-1 1111714-1','1111702-1 35261052134798001563570010006812351767323304','1111702-1 5'])('does not split an ambiguous NF or a fiscal key (%s)', nf => {
  const input=example();input.documents[0]!.nf=nf;
  expect(normalizeGeminiPhoto(input).documents[0]!.nf).toBe(nf);
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

it('removes only a separate numeric driver code from a pre and preserves literal names', () => {
  expect(normalizeGeminiPhoto({ ...example(), driver: 'MOTORISTA TESTE - 850' }).driver).toBe('MOTORISTA TESTE');
  expect(normalizeGeminiPhoto({ ...example(), driver: 'ANA-MARIA DOS SANTOS' }).driver).toBe('ANA-MARIA DOS SANTOS');
  expect(normalizeGeminiPhoto({ ...example(), driver: 'MOTORISTA TESTE - SILVA' }).driver).toBe('MOTORISTA TESTE - SILVA');
});

it('rejects unsafe quantities and flags missing header totals even if every row has an NF', () => {
  const input = example(); input.expectedRows = 0; input.totalVolumes = 0; input.documents[0]!.volumes = '9007199254740993';
  const pre = normalizeGeminiPhoto(input);
  expect(pre.documents[0]!.volumes).toBe(''); expect(pre.documents[0]!.review).toContain('Confira volumes');
  expect(pre.headerReview).toContain('Confira a quantidade de CTCs no cabeçalho.');
  expect(pre.headerReview).toContain('Confira o total de volumes no cabeçalho.');
});

import { normalizePlate } from '@/lib/gemini-photo';
describe('placa', () => {
  it('fixes letter/digit swaps by position', () => expect(normalizePlate('1YA-7J3I')).toBe('IYA7J31'));
  it('does not invent characters on partial plates', () => expect(normalizePlate('IYA7J')).toBe('IYA7J'));
});

it('counts a CTC with distinct NFs once without treating its fiscal rows as duplicate CTCs', () => {
  const input = example(); input.documents.push({ ...input.documents[0]!, nf: '999-1', volumes: '1' }); input.totalVolumes = 67;
  const result = normalizeGeminiPhoto(input);
  expect(result.documents).toHaveLength(12); expect(result.ctcs).toHaveLength(11); expect(result.headerReview).toEqual([]); expect(result.documents.every(row => !row.review?.length)).toBe(true);
});

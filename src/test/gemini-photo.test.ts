import { expect, it } from 'vitest';
import { normalizeGeminiPhoto } from '@/lib/gemini-photo';

const example = () => ({ kind: 'pre', id: 'DI00123456789', plate: 'ABC1D23', driver: 'MOTORISTA TESTE', expectedRows: 11, totalVolumes: 66,
  documents: Array.from({ length: 11 }, (_, i) => ({ ctc: String(i + 1).padStart(10, '0'), nf: `${100 + i}-1`, volumes: String(i + 1), client: `LAB ${i}`, recipient: `CLIENTE ${i}`, review: [] })),
});
it('retains all eleven rows, leading zeroes, NF, volumes and laboratories', () => {
  const pre = normalizeGeminiPhoto(example());
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

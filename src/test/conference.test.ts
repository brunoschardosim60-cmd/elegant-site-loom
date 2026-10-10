import { describe, expect, it } from 'vitest';
import { findMatches, parsePreText, parseReading, setReceived, type Manifest } from '@/lib/conference';

function key(model: string, number: string) {
  const base = '43' + '2610' + '12345678000195' + model + '001' + number.padStart(9, '0') + '1' + '12345678';
  let sum = 0; let weight = 2;
  for (let i = 42; i >= 0; i--) { sum += Number(base[i]) * weight; weight = weight === 9 ? 2 : weight + 1; }
  const remainder = sum % 11;
  return base + (remainder < 2 ? 0 : 11 - remainder);
}
const manifest: Manifest = { id: 'DI0060186918', driver: 'Luciano', plate: 'IYA7J31', date: '2026-10-08', documents: [
  { id: '1', ctc: '0012345678', nf: '1127276-1', volumes: 27, received: false },
  { id: '2', ctc: '1234567890', nf: '1126736-1', volumes: 45, received: false },
] };
describe('Conferência por CTC', () => {
  it('accepts ten digits preserving leading zeros', () => expect(parseReading('0012345678')).toEqual({ kind: 'ctc', number: '0012345678' }));
  it('rejects CT-e keys rather than converting them into CTC', () => expect(parseReading(key('57', '365569')).kind).toBe('invalid'));
  it('identifies NF-e keys', () => expect(parseReading(key('55', '1127276')).kind).toBe('nfe'));
  it('rejects incorrect lengths and letters', () => { for (const code of ['123456789', '12345678901', '123456789A']) expect(parseReading(code).kind).toBe('invalid'); });
  it('matches exactly and preserves duplicate detection', () => {
    expect(findMatches([manifest], { kind: 'ctc', number: '0012345678' })).toHaveLength(1);
    expect(findMatches([manifest, { ...manifest, id: 'other' }], { kind: 'ctc', number: '0012345678' })).toHaveLength(2);
    expect(findMatches([manifest], { kind: 'ctc', number: '0001234567' })).toHaveLength(0);
  });
  it('finalizes only when all documents are received and reopens on undo', () => {
    const first = setReceived(manifest, '1', true, 'first');
    expect(first.finishedAt).toBeUndefined();
    const done = setReceived(first, '2', true, 'done');
    expect(done.finishedAt).toBe('done');
    expect(findMatches([done], { kind: 'ctc', number: '0012345678' })[0]?.doc.received).toBe(true);
    expect(setReceived(done, '1', false, 'later').finishedAt).toBeUndefined();
  });
  it('extracts labelled CTCs and normalizes OCR noise in header fields', () => {
    expect(parsePreText('Pre D1 0060l86918 Placa IYA 7J31\nCTC: 0012345678\nCT C: 1234567890')).toEqual({ id: 'DI0060186918', plate: 'IYA7J31', ctcs: ['0012345678', '1234567890'] });
  });
  it('does not infer CTC from fiscal keys or other labels', () => {
    expect(parsePreText(key('57', '365569') + '\nCT-e: 1234567890\nNF: 1234567890').ctcs).toEqual([]);
  });
});

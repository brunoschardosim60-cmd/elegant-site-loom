import { describe, expect, it } from 'vitest';
import { findMatches, parseReading, setReceived, type Manifest } from '@/lib/conference';

function key(model: string, number: string) {
  const base = '43' + '2610' + '12345678000195' + model + '001' + number.padStart(9, '0') + '1' + '12345678';
  let sum = 0; let weight = 2;
  for (let i = 42; i >= 0; i--) { sum += Number(base[i]) * weight; weight = weight === 9 ? 2 : weight + 1; }
  const remainder = sum % 11;
  return base + (remainder < 2 ? 0 : 11 - remainder);
}
const manifest: Manifest = { id: 'DI0060186918', driver: 'Luciano', plate: 'IYA7J31', date: '2026-10-08', documents: [
  { id: '1', cte: '365569', nf: '1127276-1', volumes: 27, received: false },
  { id: '2', cte: '365506', nf: '1126736-1', volumes: 45, received: false },
] };
describe('Conferência somente CT-e', () => {
  it('rejects NF-e model 55', () => expect(parseReading(key('55', '1127276')).kind).toBe('nfe'));
  it('reads CT-e number from the model 57 key', () => expect(parseReading(key('57', '365569'))).toEqual({ kind: 'cte', number: '365569', key: key('57', '365569') }));
  it('rejects a corrupted CT-e checksum', () => { const value = key('57', '365569'); expect(parseReading(value.slice(0, 43) + ((Number(value[43]) + 1) % 10)).kind).toBe('invalid'); });
  it('marks the matched document as received automatically', () => expect(setReceived(manifest, '1', true, '2026-10-09T09:00:00').documents[0]?.received).toBe(true));
  it('does not finalize while any document is pending', () => expect(setReceived(manifest, '1', true, 'now').finishedAt).toBeUndefined());
  it('finalizes automatically after all documents arrive', () => { const first = setReceived(manifest, '1', true, 'first'); expect(setReceived(first, '2', true, 'finished').finishedAt).toBe('finished'); });
  it('keeps a duplicate recognizable after completion', () => { const done = setReceived(manifest, '1', true, 'now'); expect(findMatches([done], { kind: 'cte', number: '365569' })[0]?.doc.received).toBe(true); });
  it('reports no match for an unknown CT-e', () => expect(findMatches([manifest], { kind: 'cte', number: '999999' })).toEqual([]));
  it('does not infer CT-e from an internal CTC', () => expect(parseReading('4400365569').kind).toBe('invalid'));
  it('reopens a finalized manifest when a receipt is undone', () => { const done = setReceived(setReceived(manifest, '1', true, 'now'), '2', true, 'now'); expect(setReceived(done, '1', false, 'later').finishedAt).toBeUndefined(); });
  it('does not match different full keys sharing a document number', () => { const full: Manifest = { ...manifest, documents: [{ id: 'full', nf: '1127276-1', volumes: 27, received: false, cte: key('57', '365569') }] }; expect(findMatches([full], { kind: 'cte', number: '365569', key: 'different' })).toEqual([]); });
});
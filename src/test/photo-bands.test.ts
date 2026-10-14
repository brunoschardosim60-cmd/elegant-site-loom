import { afterEach, expect, it, vi } from 'vitest';
import { normalizeGeminiPhoto } from '@/lib/gemini-photo';
import { applyBandRead, needsBandReading, photoBandPayload } from '@/lib/photo-bands';

const row = (ctc: string, nf: string, volumes = '1') => ({ ctc, nf, volumes, client: 'LAB S/A', recipient: 'CLIENTE', review: [] });
const pre = () => normalizeGeminiPhoto({ kind: 'pre', id: 'DI00000000001', plate: 'ABC1D23', driver: 'MOTORISTA', issueDate: '2026-10-14', expectedRows: 2, expectedNfs: 3, totalVolumes: 5,
  documents: [row('0000000001', '100-1'), row('0000000001', '101-1', '3'), row('0000000002', '102-1')] });
afterEach(() => vi.restoreAllMocks());

it('keeps legitimate repeated CTCs with different NFs and does not reread a complete table', () => {
  expect(needsBandReading(pre())).toBe(false);
  const missing = pre(); missing.documents.pop(); expect(needsBandReading(missing)).toBe(true);
  const duplicate = pre(); duplicate.documents.push(duplicate.documents[0]!); expect(needsBandReading(duplicate)).toBe(true);
});

it('uses strips when most rows are uncertain even if compensating errors keep all totals equal', () => {
  const page = pre(); page.documents = Array.from({ length: 6 }, (_, index) => ({ ...row(String(index).padStart(10, '0'), `${100 + index}-1`), review: index < 3 ? ['Confira destinatário'] : [] }));
  page.expectedRows = 6; page.expectedNfs = 6; page.totalVolumes = 6;
  expect(needsBandReading(page)).toBe(true);
  expect(applyBandRead(page, structuredClone(page)).tableRecovery).toBe('bands');
  page.documents[2]!.review = []; expect(needsBandReading(page)).toBe(false);
});

it('independently checks dense multi-NF tables even when plausible substituted rows keep the totals equal', () => {
  const page = pre();
  page.documents.push(row('0000000001', '103-1'), row('0000000001', '104-1'));
  page.expectedNfs = 5; page.totalVolumes = 7;
  expect(needsBandReading(page)).toBe(true);
  expect(applyBandRead(page, structuredClone(page)).documents).toHaveLength(5);
});

it('uses detailed names anchored to a unique CTC while repairing its NF and keeps the conflict visible', () => {
  const first = pre(); first.documents[2]!.nf = '199-1'; first.documents[2]!.recipient = 'CLIENTE COMPLETO';
  const second = pre(); second.documents[2]!.recipient = 'OUTRO NOME';
  const result = applyBandRead(first, second);
  expect(result.documents[2]).toMatchObject({ nf: '102-1', recipient: 'OUTRO NOME' });
  expect(result.documents[2]!.review).toEqual(expect.arrayContaining([expect.stringContaining('Destinatário divergente')]));
});

it('accepts a single B/8 name glyph from the detailed strip while retaining its explicit review', () => {
  const first = pre(); first.documents[0]!.client = 'LABORATORIO B';
  const second = pre(); second.documents[0]!.client = 'LABORATORIO 8';
  const result = applyBandRead(first, second);
  expect(result.documents[0]!.client).toBe('LABORATORIO 8');
  expect(result.documents[0]!.review).toEqual(expect.arrayContaining([expect.stringContaining('Cliente divergente entre leituras')]));
});

it('recovers a missing physical row without merging by array position or rewriting confirmed names', () => {
  const first = pre(); first.documents.splice(1, 1); first.imageRotation = 270;
  const independent = pre(); independent.documents[0]!.client = 'LABORATORIO INVENTADO';
  const result = applyBandRead(first, independent);
  expect(result.documents).toHaveLength(3);
  expect(result.documents[0]!.client).toBe('LAB S/A');
  expect(result.documents[0]!.review).toEqual(expect.arrayContaining([expect.stringContaining('Cliente divergente entre leituras')]));
  expect(result.documents[1]).toMatchObject({ ctc: '0000000001', nf: '101-1', volumes: '3', review: [expect.stringContaining('recuperada')] });
  expect(result).toMatchObject({ tableRecovery: 'bands', imageRotation: 270, verification: { status: 'review' } });
});

it.each(['count', 'header', 'duplicate', 'invalid-nf'] as const)('retains the prior draft when the independent bands have a %s problem', problem => {
  const first = pre(); first.documents.pop();
  const candidate = pre();
  if (problem === 'count') candidate.documents.pop();
  if (problem === 'header') candidate.totalVolumes = 6;
  if (problem === 'duplicate') candidate.documents[2] = candidate.documents[0]!;
  if (problem === 'invalid-nf') candidate.documents[2]!.nf = 'MAT.LAB';
  const result = applyBandRead(first, candidate);
  expect(result.documents).toEqual(first.documents);
  expect(result.tableRecovery).toBeUndefined();
  expect(result.headerReview).toEqual(expect.arrayContaining([expect.stringContaining('não confirmou')]));
});

it('marks a volume change for review even if compensating errors keep the total equal', () => {
  const first = pre(); first.documents[0]!.volumes = '3'; first.documents[1]!.volumes = '1';
  const result = applyBandRead(first, pre());
  expect(result.documents.slice(0, 2).every(row => row.review?.some(note => note.includes('Confira')))).toBe(true);
  expect(result.verification?.status).toBe('review');
});

it('crops six overlapping full-width bands from one rotated bitmap and enforces cancellation', () => {
  const draws: unknown[][] = [], rotations: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ translate: vi.fn(), rotate: (angle: number) => rotations.push(angle), drawImage: (...args: unknown[]) => draws.push(args) } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,' + 'a'.repeat(120));
  const image = { width: 1200, height: 1600, close: vi.fn() } as unknown as ImageBitmap;
  const result = photoBandPayload(image, 270);
  expect(result.bands).toHaveLength(6); expect(rotations).toEqual([1.5 * Math.PI]);
  const crops = draws.slice(2);
  expect(crops.every(args => args[1] === 0 && args[3] === 1600 && args[5] === 0)).toBe(true);
  expect(Number(crops[0]![2]) + Number(crops[0]![4])).toBeGreaterThan(Number(crops[1]![2]));
  expect(image.close).not.toHaveBeenCalled();
  const abort = new AbortController(); abort.abort();
  expect(() => photoBandPayload(image, 270, abort.signal)).toThrow();
});

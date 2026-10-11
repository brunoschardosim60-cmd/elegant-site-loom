import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeGeminiPhoto } from '@/lib/gemini-photo';
import { readAiPhotos } from '@/lib/photo-ai';
import type { requestAiPhoto } from '@/lib/photo-ai-request';

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), decode: vi.fn(), rotate: vi.fn() }));
vi.mock('@/lib/photo-ai-request', () => ({ requestAiPhoto: mocks.request }));
vi.mock('@/lib/supabase-client', () => ({ getSupabaseClient: async () => ({ auth: { getSession: mocks.session } }) }));

type RequestInput = Parameters<typeof requestAiPhoto>[0];
type Response = Awaited<ReturnType<typeof requestAiPhoto>>;
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
type FakeBitmap = ImageBitmap & { name: string };
let bitmaps: FakeBitmap[];
let calls: { name: string; input: RequestInput; pending: Deferred<Response> }[];
let activeRequests: number;
let peakRequests: number;
const photo = (name: string) => new File(['fake image'], name, { type: 'image/jpeg' });
const bitmap = (name: string): FakeBitmap => ({ name, width: 800, height: 1200, close: vi.fn() }) as unknown as FakeBitmap;

function responses(number: number, rotation: 0 | 90 | 180 | 270 = 0) {
  const check = {
    kind: 'pre' as const, clockwiseRotation: rotation, id: `DI${String(number).padStart(9, '0')}`, plate: 'ABC1D23', driver: 'ANA SILVA', expectedRows: 1, totalVolumes: 3,
    documents: [{ ctc: String(number).padStart(10, '0'), nf: `${100 + number}-1`, volumes: '3' }],
  };
  const pre = normalizeGeminiPhoto({ ...check, documents: check.documents.map(row => ({ ...row, client: 'LAB TESTE', recipient: 'CLIENTE TESTE', review: [] })) });
  const survey: Response = { ok: true, pre, check, rotation, text: '' };
  const full: Response = { ok: true, pre, check: null, rotation: 0, text: '' };
  return { survey, full };
}

async function pendingCall(name: string, mode: 'survey' | 'full' | 'verify') {
  await waitFor(() => expect(calls.some(call => call.name === name && call.input.data.mode === mode)).toBe(true));
  return calls.find(call => call.name === name && call.input.data.mode === mode)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  bitmaps = []; calls = []; activeRequests = 0; peakRequests = 0;
  mocks.session.mockResolvedValue({ data: { session: { access_token: 'test-session-token-kept-out-of-results' } } });
  mocks.decode.mockImplementation(async (file: File) => { const image = bitmap(file.name); bitmaps.push(image); return image; });
  vi.stubGlobal('createImageBitmap', mocks.decode);
  // jsdom's AbortSignal lacks the modern static helpers used by browsers.
  // Propagate real controller events, without leaving 75-second timers alive.
  vi.stubGlobal('AbortSignal', {
    timeout: vi.fn(() => new AbortController().signal),
    any: (signals: AbortSignal[]) => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      return controller.signal;
    },
  });
  const sources = new WeakMap<object, string>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    return { translate: vi.fn(), rotate: mocks.rotate, drawImage: (source: FakeBitmap | HTMLCanvasElement) => sources.set(canvas, sources.get(source) ?? ('name' in source ? source.name : 'unknown')) } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    return `data:image/jpeg;base64,${btoa(`${sources.get(this)}|${this.width}x${this.height}`)}`;
  });
  mocks.request.mockImplementation((input: RequestInput) => {
    const pending = deferred<Response>();
    const name = atob(input.data.data).split('|')[0]!;
    calls.push({ name, input, pending });
    activeRequests++; peakRequests = Math.max(peakRequests, activeRequests);
    return pending.promise.finally(() => { activeRequests--; });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('AI photo import pipeline', () => {
  it('limits concurrent photos to two and returns their original indices when they finish out of order', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')], receive, undefined);
    const a = responses(1); const b = responses(2); const c = responses(3);
    await pendingCall('a.jpg', 'survey');
    const bSurvey = await pendingCall('b.jpg', 'survey');
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
    expect(calls.some(call => call.name === 'c.jpg')).toBe(false);
    bSurvey.pending.resolve(b.survey);
    const bFull = await pendingCall('b.jpg', 'full');
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(calls.some(call => call.name === 'c.jpg')).toBe(false);
    bFull.pending.resolve(b.full);
    const cSurvey = await pendingCall('c.jpg', 'survey');
    expect(receive.mock.calls.map(call => call[0])).toEqual([1]);
    expect(bitmaps.find(image => image.name === 'b.jpg')!.close).toHaveBeenCalledOnce();
    cSurvey.pending.resolve(c.survey);
    (await pendingCall('c.jpg', 'full')).pending.resolve(c.full);
    await waitFor(() => expect(receive.mock.calls.map(call => call[0])).toEqual([1, 2]));
    (await pendingCall('a.jpg', 'survey')).pending.resolve(a.survey);
    (await pendingCall('a.jpg', 'full')).pending.resolve(a.full);
    await batch;
    expect(peakRequests).toBe(2);
    expect(activeRequests).toBe(0);
    expect(receive.mock.calls.map(([index, result]) => [index, result.pre.id])).toEqual([[1, 'DI000000002'], [2, 'DI000000003'], [0, 'DI000000001']]);
    expect(mocks.request).toHaveBeenCalledTimes(6);
    expect(bitmaps).toHaveLength(3);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('uses one decode and exactly two reads when the survey and full results agree', async () => {
    const receive = vi.fn(); const progress = vi.fn(); const result = responses(1, 90);
    const batch = readAiPhotos([photo('sideways.jpg')], receive, progress);
    const survey = await pendingCall('sideways.jpg', 'survey');
    expect(atob(survey.input.data.data)).toContain('800x1200');
    survey.pending.resolve(result.survey);
    const full = await pendingCall('sideways.jpg', 'full');
    expect(atob(full.input.data.data)).toContain('1200x800');
    expect(atob(full.input.data.detail!)).toContain('1200x520');
    full.pending.resolve(result.full);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['survey', 'full']);
    calls.forEach(call => expect(call.input.data.accessToken).toBe('test-session-token-kept-out-of-results'));
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(mocks.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0]?.[1].pre).toMatchObject({ verification: { status: 'matched', conflicts: 0 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE' }] });
    expect(receive.mock.calls[0]?.[1].pre.verification.checkedFields).toBeGreaterThanOrEqual(8);
    expect(progress.mock.calls.map(call => call[1])).toEqual(['1/2 · Lendo placa, CTCs, NFs e volumes…', '2/2 · Conferindo todas as linhas e laboratórios…']);
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
  });

  it('suppresses late results and progress after closing, aborts active reads and never starts the queued photo', async () => {
    const abort = new AbortController(); const receive = vi.fn(); const progress = vi.fn();
    const batch = readAiPhotos([photo('a.jpg'), photo('b.jpg'), photo('queued.jpg')], receive, progress, abort.signal);
    (await pendingCall('a.jpg', 'survey')).pending.resolve(responses(1).survey);
    const full = await pendingCall('a.jpg', 'full');
    const survey = await pendingCall('b.jpg', 'survey');
    abort.abort();
    const progressCount = progress.mock.calls.length;
    full.pending.resolve(responses(1).full);
    survey.pending.resolve(responses(2).survey);
    await batch;
    expect(receive).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(progressCount);
    expect(calls.every(call => call.input.signal?.aborted)).toBe(true);
    expect(calls.some(call => call.name === 'queued.jpg')).toBe(false);
    expect(calls.some(call => call.name === 'b.jpg' && call.input.data.mode === 'full')).toBe(false);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('closes bitmaps that finish decoding after cancellation without uploading them', async () => {
    const decoding = deferred<ImageBitmap>();
    const image = bitmap('slow.jpg');
    mocks.decode.mockReturnValue(decoding.promise);
    const abort = new AbortController(); const receive = vi.fn();
    const batch = readAiPhotos([photo('slow.jpg')], receive, undefined, abort.signal);
    await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
    abort.abort(); decoding.resolve(image);
    await batch;
    expect(mocks.request).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
    expect(image.close).toHaveBeenCalledOnce();
  });

  it('continues with the full read after a rejected survey and confirms it with an additional reading', async () => {
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('survey-offline.jpg')], receive, undefined);
    (await pendingCall('survey-offline.jpg', 'survey')).pending.reject(new Error('Survey network failure'));
    (await pendingCall('survey-offline.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('survey-offline.jpg', 'verify')).pending.resolve(result.survey);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['survey', 'full', 'verify']);
    expect(receive).toHaveBeenCalledOnce();
    const reading = receive.mock.calls[0]![1];
    expect(reading).not.toHaveProperty('error');
    expect(reading.pre).toMatchObject({ id: 'DI000000001', verification: { status: 'matched', conflicts: 0 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE' }] });
    expect(reading.pre.headerReview).toEqual([]);
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(activeRequests).toBe(0);
  });

  it('preserves the full read with a review warning when the additional request rejects', async () => {
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('verify-offline.jpg')], receive, undefined);
    const conflictingSurvey: Response = { ...result.survey, check: { ...result.survey.check!, documents: [{ ctc: '0000000001', nf: '999-1', volumes: '3' }] } };
    (await pendingCall('verify-offline.jpg', 'survey')).pending.resolve(conflictingSurvey);
    (await pendingCall('verify-offline.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('verify-offline.jpg', 'verify')).pending.reject(new Error('Verification network failure'));
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['survey', 'full', 'verify']);
    expect(receive).toHaveBeenCalledOnce();
    const reading = receive.mock.calls[0]![1];
    expect(reading).not.toHaveProperty('error');
    expect(reading.pre).toMatchObject({ id: 'DI000000001', plate: 'ABC1D23', driver: 'ANA SILVA', verification: { status: 'review', conflicts: 1 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE', recipient: 'CLIENTE TESTE' }] });
    expect(reading.pre.headerReview).toContain('A conferência adicional não terminou. Confira os campos sinalizados antes de cadastrar.');
    expect(reading.pre.documents[0].review).toContain('NF e série divergente no CTC 0000000001: 101-1 / 999-1.');
    expect(JSON.parse(reading.text).verification.status).toBe('review');
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(activeRequests).toBe(0);
  });

  it('requires a signed-in session before decoding or sending photos', async () => {
    mocks.session.mockResolvedValue({ data: { session: null } });
    const receive = vi.fn();
    await expect(readAiPhotos([photo('private.jpg')], receive, undefined)).rejects.toThrow('Entre na sua conta para ler fotos.');
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
  });
});

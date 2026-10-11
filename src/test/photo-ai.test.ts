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
const quotaMessages = { daily: 'A cota diária do Gemini terminou. Tente novamente amanhã.', minute: 'Limite de leitura por minuto atingido.', unknown: 'Limite do Gemini atingido.' };
const quotaFailure = (quota: keyof typeof quotaMessages) => ({ ok: false as const, error: quotaMessages[quota], quota, retryable: false as const });

function responses(number: number, rotation: 0 | 90 | 180 | 270 = 0) {
  const check = {
    kind: 'pre' as const, clockwiseRotation: rotation, id: `DI${String(number).padStart(9, '0')}`, plate: 'ABC1D23', driver: 'ANA SILVA', expectedRows: 1, totalVolumes: 3,
    documents: [{ ctc: String(number).padStart(10, '0'), nf: `${100 + number}-1`, volumes: '3' }],
  };
  const pre = normalizeGeminiPhoto({ ...check, documents: check.documents.map(row => ({ ...row, client: 'LAB TESTE', recipient: 'CLIENTE TESTE', review: [] })) });
  const verification: Response = { ok: true, pre, check: { ...check, clockwiseRotation: 0 }, rotation: 0, text: '' };
  const full: Response = { ok: true, pre, check: null, rotation, text: '' };
  return { verification, full };
}

async function pendingCall(name: string, mode: 'full' | 'verify', occurrence = 0) {
  await waitFor(() => expect(calls.filter(call => call.name === name && call.input.data.mode === mode).length).toBeGreaterThan(occurrence));
  return calls.filter(call => call.name === name && call.input.data.mode === mode)[occurrence]!;
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
    await pendingCall('a.jpg', 'full');
    const bFull = await pendingCall('b.jpg', 'full');
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
    expect(calls.some(call => call.name === 'c.jpg')).toBe(false);
    bFull.pending.resolve(b.full);
    const bCheck = await pendingCall('b.jpg', 'verify');
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(calls.some(call => call.name === 'c.jpg')).toBe(false);
    bCheck.pending.resolve(b.verification);
    const cFull = await pendingCall('c.jpg', 'full');
    expect(receive.mock.calls.map(call => call[0])).toEqual([1]);
    expect(bitmaps.find(image => image.name === 'b.jpg')!.close).toHaveBeenCalledOnce();
    cFull.pending.resolve(c.full);
    (await pendingCall('c.jpg', 'verify')).pending.resolve(c.verification);
    await waitFor(() => expect(receive.mock.calls.map(call => call[0])).toEqual([1, 2]));
    (await pendingCall('a.jpg', 'full')).pending.resolve(a.full);
    (await pendingCall('a.jpg', 'verify')).pending.resolve(a.verification);
    await batch;
    expect(peakRequests).toBe(2);
    expect(activeRequests).toBe(0);
    expect(receive.mock.calls.map(([index, result]) => [index, result.pre.id])).toEqual([[1, 'DI000000002'], [2, 'DI000000003'], [0, 'DI000000001']]);
    expect(mocks.request).toHaveBeenCalledTimes(6);
    expect(bitmaps).toHaveLength(3);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('uses one decode and exactly two reads when the full read and independent verification agree', async () => {
    const receive = vi.fn(); const progress = vi.fn(); const result = responses(1, 90);
    const batch = readAiPhotos([photo('sideways.jpg')], receive, progress);
    const full = await pendingCall('sideways.jpg', 'full');
    expect(atob(full.input.data.data)).toContain('800x1200');
    full.pending.resolve(result.full);
    const verification = await pendingCall('sideways.jpg', 'verify');
    expect(atob(verification.input.data.data)).toContain('1200x800');
    expect(atob(verification.input.data.detail!)).toContain('1200x520');
    verification.pending.resolve(result.verification);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify']);
    calls.forEach(call => expect(call.input.data.accessToken).toBe('test-session-token-kept-out-of-results'));
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(mocks.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0]?.[1].pre).toMatchObject({ verification: { status: 'matched', conflicts: 0 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE' }] });
    expect(receive.mock.calls[0]?.[1].pre.verification.checkedFields).toBeGreaterThanOrEqual(8);
    expect(progress.mock.calls.map(call => call[1])).toEqual(['1/2 · Lendo todas as linhas e laboratórios…', '2/2 · Conferindo placa, CTCs, NFs e volumes…']);
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
  });

  it('suppresses late results and progress after closing, aborts active reads and never starts the queued photo', async () => {
    const abort = new AbortController(); const receive = vi.fn(); const progress = vi.fn();
    const batch = readAiPhotos([photo('a.jpg'), photo('b.jpg'), photo('queued.jpg')], receive, progress, abort.signal);
    (await pendingCall('a.jpg', 'full')).pending.resolve(responses(1).full);
    const verification = await pendingCall('a.jpg', 'verify');
    const full = await pendingCall('b.jpg', 'full');
    abort.abort();
    const progressCount = progress.mock.calls.length;
    verification.pending.resolve(responses(1).verification);
    full.pending.resolve(responses(2).full);
    await batch;
    expect(receive).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(progressCount);
    expect(calls.every(call => call.input.signal?.aborted)).toBe(true);
    expect(calls.some(call => call.name === 'queued.jpg')).toBe(false);
    expect(calls.some(call => call.name === 'b.jpg' && call.input.data.mode === 'verify')).toBe(false);
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

  it('returns a photo error when the first full read rejects without trying a verification fallback', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('full-offline.jpg')], receive, undefined);
    (await pendingCall('full-offline.jpg', 'full')).pending.reject(new Error('Full read network failure'));
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full']);
    expect(receive).toHaveBeenCalledOnce();
    const reading = receive.mock.calls[0]![1];
    expect(reading).toEqual({ error: 'Full read network failure' });
    expect(reading).not.toHaveProperty('pre');
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(activeRequests).toBe(0);
  });

  it('keeps the full result with unavailable verification and the provider error when the second read fails', async () => {
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('second-offline.jpg')], receive, undefined);
    (await pendingCall('second-offline.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('second-offline.jpg', 'verify')).pending.resolve({ ok: false, retryable: true, error: 'Gemini indisponível (503). Tente novamente.' });
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify']);
    expect(receive).toHaveBeenCalledOnce();
    const reading = receive.mock.calls[0]![1];
    expect(reading).not.toHaveProperty('error');
    expect(reading.pre).toMatchObject({ id: 'DI000000001', verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE' }] });
    expect(reading.pre.headerReview).toContain('Gemini indisponível (503). Tente novamente.');
    expect(reading.pre.headerReview).toContain('Segunda leitura indisponível. Confira os dados antes de cadastrar.');
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(activeRequests).toBe(0);
  });

  it('preserves the full read with a review warning when the additional request rejects', async () => {
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('verify-offline.jpg')], receive, undefined);
    const conflictingCheck: Response = { ...result.verification, check: { ...result.verification.check!, documents: [{ ctc: '0000000001', nf: '999-1', volumes: '3' }] } };
    (await pendingCall('verify-offline.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('verify-offline.jpg', 'verify')).pending.resolve(conflictingCheck);
    (await pendingCall('verify-offline.jpg', 'verify', 1)).pending.reject(new Error('Verification network failure'));
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify', 'verify']);
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

  it('stops queued photos on a daily full-read limit while preserving completed and in-flight results', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('ready.jpg'), photo('limited.jpg'), photo('in-flight.jpg'), photo('queued.jpg')], receive, undefined);
    const ready = responses(1); const inFlight = responses(3);
    (await pendingCall('ready.jpg', 'full')).pending.resolve(ready.full);
    (await pendingCall('ready.jpg', 'verify')).pending.resolve(ready.verification);
    const active = await pendingCall('in-flight.jpg', 'full');
    expect(receive.mock.calls[0]![1].pre.verification.status).toBe('matched');
    (await pendingCall('limited.jpg', 'full')).pending.resolve(quotaFailure('daily'));
    await waitFor(() => expect(receive.mock.calls.map(call => call[0])).toEqual([0, 1, 3]));
    active.pending.resolve(inFlight.full);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, result]) => [index, result]));
    expect(results.get(0).pre.verification.status).toBe('matched');
    expect(results.get(1)).toEqual({ error: quotaMessages.daily });
    expect(results.get(3)).toEqual({ error: quotaMessages.daily });
    expect(results.get(2)).not.toHaveProperty('error');
    expect(results.get(2).pre).toMatchObject({ id: 'DI000000003', verification: { status: 'unavailable' }, documents: [{ ctc: '0000000003', nf: '103-1', volumes: '3' }] });
    expect(results.get(2).pre.headerReview).toContain(quotaMessages.daily);
    expect(calls).toHaveLength(4);
    expect(calls.some(call => call.name === 'queued.jpg')).toBe(false);
    expect(calls.some(call => call.name === 'in-flight.jpg' && call.input.data.mode === 'verify')).toBe(false);
    expect(receive).toHaveBeenCalledTimes(4);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
    expect(activeRequests).toBe(0);
  });

  it('keeps a full read when daily quota is reached by its second read and resolves every waiting slot', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('check-limit.jpg'), photo('in-flight.jpg'), photo('queued.jpg')], receive, undefined);
    (await pendingCall('check-limit.jpg', 'full')).pending.resolve(responses(1).full);
    (await pendingCall('check-limit.jpg', 'verify')).pending.resolve(quotaFailure('daily'));
    await waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    (await pendingCall('in-flight.jpg', 'full')).pending.resolve(responses(2).full);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, result]) => [index, result]));
    expect(results.get(0)).not.toHaveProperty('error');
    expect(results.get(0).pre).toMatchObject({ id: 'DI000000001', verification: { status: 'unavailable' }, documents: [{ nf: '101-1', volumes: '3' }] });
    expect(results.get(0).pre.headerReview).toContain(quotaMessages.daily);
    expect(results.get(1).pre.headerReview).toContain(quotaMessages.daily);
    expect(results.get(2)).toEqual({ error: quotaMessages.daily });
    expect(calls.map(call => [call.name, call.input.data.mode])).toEqual([['check-limit.jpg', 'full'], ['in-flight.jpg', 'full'], ['check-limit.jpg', 'verify']]);
    expect(receive).toHaveBeenCalledTimes(3);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('retains disagreements when daily quota stops a third reading, without leaving queued photos pending', async () => {
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('third-limit.jpg'), photo('in-flight.jpg'), photo('queued.jpg')], receive, undefined);
    const conflicting: Response = { ...result.verification, check: { ...result.verification.check!, documents: [{ ctc: '0000000001', nf: '999-1', volumes: '3' }] } };
    (await pendingCall('third-limit.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('third-limit.jpg', 'verify')).pending.resolve(conflicting);
    (await pendingCall('third-limit.jpg', 'verify', 1)).pending.resolve(quotaFailure('daily'));
    await waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    (await pendingCall('in-flight.jpg', 'full')).pending.resolve(responses(2).full);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, reading]) => [index, reading]));
    expect(results.get(0)).not.toHaveProperty('error');
    expect(results.get(0).pre).toMatchObject({ verification: { status: 'review', conflicts: 1 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3' }] });
    expect(results.get(0).pre.headerReview).toContain(`Conferência adicional: ${quotaMessages.daily}`);
    expect(results.get(0).pre.documents[0].review).toContain('NF e série divergente no CTC 0000000001: 101-1 / 999-1.');
    expect(results.get(2)).toEqual({ error: quotaMessages.daily });
    expect(calls).toHaveLength(4);
    expect(receive).toHaveBeenCalledTimes(3);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it.each(['minute', 'unknown'] as const)('continues queued photos after a %s quota response without retrying the failed photo', async quota => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('limited.jpg'), photo('other.jpg'), photo('queued.jpg')], receive, undefined);
    (await pendingCall('limited.jpg', 'full')).pending.resolve(quotaFailure(quota));
    const queued = await pendingCall('queued.jpg', 'full');
    (await pendingCall('other.jpg', 'full')).pending.resolve(responses(2).full);
    (await pendingCall('other.jpg', 'verify')).pending.resolve(responses(2).verification);
    queued.pending.resolve(responses(3).full);
    (await pendingCall('queued.jpg', 'verify')).pending.resolve(responses(3).verification);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, result]) => [index, result]));
    expect(results.get(0)).toEqual({ error: quotaMessages[quota] });
    expect(results.get(1).pre.verification.status).toBe('matched');
    expect(results.get(2).pre.verification.status).toBe('matched');
    expect(calls.filter(call => call.name === 'limited.jpg')).toHaveLength(1);
    expect(calls).toHaveLength(5);
    expect(receive).toHaveBeenCalledTimes(3);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
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

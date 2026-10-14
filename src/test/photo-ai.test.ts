import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeGeminiPhoto } from '@/lib/gemini-photo';
import { readAiPhotos } from '@/lib/photo-ai';
import type { requestAiPhoto } from '@/lib/photo-ai-request';
import { rememberPhotoProviderBlock } from '@/lib/photo-provider-block';

const mocks = vi.hoisted(() => ({ request: vi.fn(), session: vi.fn(), decode: vi.fn(), rotate: vi.fn(), orient: vi.fn() }));
vi.mock('@/lib/photo-ai-request', () => ({ requestAiPhoto: mocks.request }));
vi.mock('@/lib/supabase-client', () => ({ getSupabaseClient: async () => ({ auth: { getSession: mocks.session } }) }));
vi.mock('@/lib/photo-orientation', () => ({ detectPhotoOrientations: mocks.orient }));

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
let testUser = 0;
const photo = (name: string) => new File(['fake image'], name, { type: 'image/jpeg' });
const bitmap = (name: string): FakeBitmap => ({ name, width: 800, height: 1200, close: vi.fn() }) as unknown as FakeBitmap;
const quotaMessages = { daily: 'A cota diária do Gemini terminou. Tente novamente amanhã.', minute: 'Limite de leitura por minuto atingido.', unknown: 'Limite do Gemini atingido.' };
const quotaFailure = (quota: keyof typeof quotaMessages) => ({ ok: false as const, error: quotaMessages[quota], quota, retryable: false as const });

function responses(number: number, rotation: 0 | 90 | 180 | 270 = 0, needsCheck = true) {
  const check = {
    kind: 'pre' as const, clockwiseRotation: rotation, id: `DI${String(number).padStart(9, '0')}`, plate: 'ABC1D23', driver: 'ANA SILVA', expectedRows: 1, totalVolumes: 3,
    documents: [{ ctc: String(number).padStart(10, '0'), nf: `${100 + number}-1`, volumes: '3' }],
  };
  // A positional plate repair is a concrete reason to request verification.
  const pre = normalizeGeminiPhoto({ ...check, plate: needsCheck ? 'ABCID23' : check.plate, documents: check.documents.map(row => ({ ...row, client: 'LAB TESTE', recipient: 'CLIENTE TESTE', review: [] })) });
  const verification: Response = { ok: true, pre, repair: null, check: { ...check, clockwiseRotation: 0 }, rotation: 0, text: '' };
  const full: Response = { ok: true, pre, repair: null, check: null, rotation, text: '' };
  return { verification, full };
}

async function pendingCall(name: string, mode: 'full' | 'full-lite' | 'verify' | 'repair', occurrence = 0) {
  await waitFor(() => expect(calls.filter(call => call.name === name && call.input.data.mode === mode).length).toBeGreaterThan(occurrence));
  return calls.filter(call => call.name === name && call.input.data.mode === mode)[occurrence]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  bitmaps = []; calls = []; activeRequests = 0; peakRequests = 0;
  mocks.orient.mockImplementation(async (files: File[]) => files.map(() => 0));
  mocks.session.mockResolvedValue({ data: { session: { user: { id: `photo-ai-test-${++testUser}` }, access_token: 'test-session-token-kept-out-of-results' } } });
  mocks.decode.mockImplementation(async (file: File) => { const image = bitmap(file.name); bitmaps.push(image); return image; });
  vi.stubGlobal('createImageBitmap', mocks.decode);
  // jsdom's AbortSignal lacks the modern static helpers used by browsers.
  // Propagate real controller events without leaving photo-deadline timers alive.
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
  it('uses Lite directly even when normal is blocked and makes one independent full read', async () => {
    const session=(await mocks.session()).data.session;
    rememberPhotoProviderBlock(`${session.user.id}:photo-model-stages-v4:full`,quotaFailure('daily'));
    const receive=vi.fn();
    const batch=readAiPhotos([photo('lite-primary.jpg')],receive,undefined,undefined,{preferredModel:'lite',singlePass:true,quotaFallback:true,orientations:[270]});
    (await pendingCall('lite-primary.jpg','full-lite')).pending.resolve(responses(1,0,true).full);await batch;
    expect(calls.map(c=>c.input.data.mode)).toEqual(['full-lite']);
    expect(receive.mock.calls[0]![1].pre.aiReader).toBe('lite');
    expect(mocks.orient).not.toHaveBeenCalled();expect(mocks.decode).toHaveBeenCalledTimes(1);
  });
  it('keeps local fallback after direct Lite quota and skips subsequent photos without calling normal', async () => {
    const options={preferredModel:'lite' as const,singlePass:true,quotaFallback:true,orientations:[0] as const};
    const receive=vi.fn(),first=readAiPhotos([photo('lite-primary-quota.jpg')],receive,undefined,undefined,options);
    (await pendingCall('lite-primary-quota.jpg','full-lite')).pending.resolve(quotaFailure('daily'));await first;
    await readAiPhotos([photo('lite-primary-blocked.jpg')],receive,undefined,undefined,options);
    expect(calls.map(c=>c.input.data.mode)).toEqual(['full-lite']);expect(mocks.decode).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[0]![1].error).toBe(quotaMessages.daily);
    expect(receive.mock.calls[1]![1].error).toMatch(/Cota diária.*leitor gratuito/i);
  });
  it('does not retry direct Lite through normal after a technical failure', async () => {
    const receive=vi.fn(),options={preferredModel:'lite' as const,singlePass:true,quotaFallback:true,orientations:[0] as const};
    const first=readAiPhotos([photo('lite-primary-offline.jpg')],receive,undefined,undefined,options);
    (await pendingCall('lite-primary-offline.jpg','full-lite')).pending.resolve({ok:false,unavailable:true,tryLite:true,retryable:false,error:'Flash Lite indisponível.'});await first;
    await readAiPhotos([photo('lite-primary-cooldown.jpg')],receive,undefined,undefined,options);
    expect(calls.map(c=>c.input.data.mode)).toEqual(['full-lite']);expect(receive).toHaveBeenCalledTimes(2);
  });
  it('keeps one normal full read when its quota is available', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('normal-available.jpg')], receive, undefined, undefined, { singlePass: true, quotaFallback: true, orientations: [90] });
    (await pendingCall('normal-available.jpg', 'full')).pending.resolve(responses(1, 0, false).full);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full']);
    expect(receive.mock.calls[0]![1].pre.aiReader).toBe('normal');
  });

  it.each(['daily', 'minute', 'unknown'] as const)('uses a full Lite transcription after a normal %s quota without decoding or orienting again', async quota => {
    const receive = vi.fn(), progress = vi.fn();
    const batch = readAiPhotos([photo('quota-switch.jpg')], receive, progress, undefined, { singlePass: true, quotaFallback: true, orientations: [270] });
    const normal = await pendingCall('quota-switch.jpg', 'full');
    normal.pending.resolve(quotaFailure(quota));
    const lite = await pendingCall('quota-switch.jpg', 'full-lite');
    expect(lite.input.data).toEqual({ ...normal.input.data, mode: 'full-lite' });
    expect(lite.input.signal).toBe(normal.input.signal);
    lite.pending.resolve(responses(1, 0, false).full);
    await batch;
    expect(mocks.decode).toHaveBeenCalledOnce(); expect(mocks.orient).not.toHaveBeenCalled();
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0]![1].pre).toMatchObject({ aiReader: 'lite', documents: [{ ctc: '0000000001', nf: '101-1', client: 'LAB TESTE' }] });
    expect(progress).toHaveBeenCalledWith(0, 'Cota do Gemini normal atingida · conferindo pelo Flash Lite…');
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'full-lite']);
  });

  it('skips a known daily normal quota on the next import and reuses the independent Lite quota', async () => {
    const options = { singlePass: true, quotaFallback: true, orientations: [0] as const };
    const first = readAiPhotos([photo('normal-limited.jpg')], vi.fn(), undefined, undefined, options);
    (await pendingCall('normal-limited.jpg', 'full')).pending.resolve(quotaFailure('daily'));
    (await pendingCall('normal-limited.jpg', 'full-lite')).pending.resolve(responses(1, 0, false).full);
    await first;
    const receive = vi.fn();
    const second = readAiPhotos([photo('lite-direct.jpg')], receive, undefined, undefined, options);
    (await pendingCall('lite-direct.jpg', 'full-lite')).pending.resolve(responses(2, 0, false).full);
    await second;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'full-lite', 'full-lite']);
    expect(receive.mock.calls[0]![1].pre.aiReader).toBe('lite');
  });

  it('skips both exhausted daily quotas without decoding the next photos and restores normal after renewal', async () => {
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const options = { singlePass: true, quotaFallback: true, orientations: [0] as const };
    const first = readAiPhotos([photo('both-limited.jpg')], vi.fn(), undefined, undefined, options);
    (await pendingCall('both-limited.jpg', 'full')).pending.resolve(quotaFailure('daily'));
    (await pendingCall('both-limited.jpg', 'full-lite')).pending.resolve(quotaFailure('daily'));
    await first;
    const receive = vi.fn();
    await readAiPhotos([photo('local-next.jpg'), photo('local-next-2.jpg')], receive, undefined, undefined, options);
    expect(calls).toHaveLength(2); expect(mocks.decode).toHaveBeenCalledOnce();
    expect(receive.mock.calls.map(([index, result]) => [index, result.error.includes('Flash Lite')])).toEqual([[0, true], [1, true]]);
    now += 26 * 60 * 60 * 1000;
    const restored = readAiPhotos([photo('quota-renewed.jpg')], receive, undefined, undefined, options);
    (await pendingCall('quota-renewed.jpg', 'full')).pending.resolve(responses(3, 0, false).full);
    await restored;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'full-lite', 'full']);
  });

  it('pauses minute quotas independently and tries normal again when the minute expires', async () => {
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const options = { singlePass: true, quotaFallback: true, orientations: [0] as const };
    const first = readAiPhotos([photo('minute-limited.jpg')], vi.fn(), undefined, undefined, options);
    (await pendingCall('minute-limited.jpg', 'full')).pending.resolve(quotaFailure('minute'));
    (await pendingCall('minute-limited.jpg', 'full-lite')).pending.resolve(quotaFailure('minute'));
    await first;
    await readAiPhotos([photo('local-minute.jpg')], vi.fn(), undefined, undefined, options);
    expect(calls).toHaveLength(2);
    now += 60001;
    const restored = readAiPhotos([photo('minute-restored.jpg')], vi.fn(), undefined, undefined, options);
    (await pendingCall('minute-restored.jpg', 'full')).pending.resolve(responses(1, 0, false).full);
    await restored;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'full-lite', 'full']);
  });

  it('returns Lite failure for local review without repeating either AI read', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('lite-offline.jpg')], receive, undefined, undefined, { singlePass: true, quotaFallback: true, orientations: [0] });
    (await pendingCall('lite-offline.jpg', 'full')).pending.resolve(quotaFailure('daily'));
    (await pendingCall('lite-offline.jpg', 'full-lite')).pending.resolve({ ok: false, unavailable: true, retryable: false, error: 'Gemini indisponível (503).' });
    await batch;
    expect(receive).toHaveBeenCalledExactlyOnceWith(0, { error: 'O Gemini normal atingiu a cota. Flash Lite: Gemini indisponível (503).' });
    expect(calls).toHaveLength(2);
  });

  it('does not switch to Lite for a session failure or a technical failure without quota evidence', async () => {
    const failures: Extract<Response, { ok: false }>[] = [{ ok: false, fallback: false, error: 'Entre novamente na sua conta para ler fotos.' }, { ok: false, unavailable: true, retryable: false, error: 'Gemini indisponível (503).' }];
    for (const failure of failures) {
      const receive = vi.fn();
      const name = 'fallback' in failure && failure.fallback === false ? 'auth-stopped.jpg' : 'technical-stopped.jpg';
      const batch = readAiPhotos([photo(name)], receive, undefined, undefined, { singlePass: true, quotaFallback: true, orientations: [0] });
      (await pendingCall(name, 'full')).pending.resolve(failure);
      await batch;
      expect(calls.filter(call => call.name === name).map(call => call.input.data.mode)).toEqual(['full']);
      expect(receive.mock.calls[0]![1].error).toBe(failure.error);
    }
  });

  it('does not start Lite or remember a late normal quota after stopping the photo', async () => {
    const abort = new AbortController(), receive = vi.fn();
    const options = { singlePass: true, quotaFallback: true, orientations: [0] as const };
    const batch = readAiPhotos([photo('stop-before-lite.jpg')], receive, undefined, abort.signal, options);
    const normal = await pendingCall('stop-before-lite.jpg', 'full');
    abort.abort(); normal.pending.resolve(quotaFailure('daily'));
    await batch;
    expect(receive).not.toHaveBeenCalled();
    const next = readAiPhotos([photo('after-stop.jpg')], receive, undefined, undefined, options);
    (await pendingCall('after-stop.jpg', 'full')).pending.resolve(responses(1, 0, false).full);
    await next;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'full']);
  });

  it('ignores Lite results after stopping and keeps the normal quota without caching a late Lite quota', async () => {
    const abort = new AbortController(), receive = vi.fn();
    const options = { singlePass: true, quotaFallback: true, orientations: [0] as const };
    const batch = readAiPhotos([photo('stop-during-lite.jpg')], receive, undefined, abort.signal, options);
    (await pendingCall('stop-during-lite.jpg', 'full')).pending.resolve(quotaFailure('daily'));
    const lite = await pendingCall('stop-during-lite.jpg', 'full-lite');
    abort.abort(); lite.pending.resolve(quotaFailure('daily'));
    await batch;
    expect(lite.input.signal?.aborted).toBe(true); expect(receive).not.toHaveBeenCalled();
    const next = readAiPhotos([photo('lite-after-stop.jpg')], receive, undefined, undefined, options);
    (await pendingCall('lite-after-stop.jpg', 'full-lite')).pending.resolve(responses(2, 0, false).full);
    await next;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'full-lite', 'full-lite']);
  });

  it('switches queued photos to Lite while preserving a successful normal read already in flight', async () => {
    const receive = vi.fn(), files = Array.from({ length: 10 }, (_, index) => photo(`quota-batch-${index}.jpg`));
    const batch = readAiPhotos(files, receive, undefined, undefined, { singlePass: true, quotaFallback: true });
    const normal0 = await pendingCall(files[0]!.name, 'full'), normal1 = await pendingCall(files[1]!.name, 'full');
    normal0.pending.resolve(quotaFailure('daily'));
    (await pendingCall(files[0]!.name, 'full-lite')).pending.resolve(responses(1, 0, false).full);
    normal1.pending.resolve(responses(2, 0, false).full);
    for (let index = 2; index < files.length; index++) (await pendingCall(files[index]!.name, 'full-lite')).pending.resolve(responses(index + 1, 0, false).full);
    await batch;
    expect(receive).toHaveBeenCalledTimes(10); expect(new Set(receive.mock.calls.map(([index]) => index)).size).toBe(10);
    expect(calls.filter(call => call.input.data.mode === 'full')).toHaveLength(2);
    expect(calls.filter(call => call.input.data.mode === 'full-lite')).toHaveLength(9);
    expect(peakRequests).toBe(2); expect(mocks.decode).toHaveBeenCalledTimes(10);
    expect(receive.mock.calls.find(([index]) => index === 1)![1].pre.aiReader).toBe('normal');
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('reuses the local orientation and returns a full independent reading without an extra AI check in single-pass mode', async () => {
    const receive = vi.fn(); const progress = vi.fn();
    const batch = readAiPhotos([photo('local-first.jpg')], receive, progress, undefined, { orientations: [270], singlePass: true });
    const full = await pendingCall('local-first.jpg', 'full');
    expect(atob(full.input.data.data)).toContain('1200x800');
    expect(full.input.data).not.toHaveProperty('detail');
    expect(full.input.data).not.toHaveProperty('localDrafts');
    // The repaired plate normally triggers a second AI call through the old API.
    full.pending.resolve(responses(1).full);
    await batch;
    expect(mocks.orient).not.toHaveBeenCalled();
    expect(calls.map(call => call.input.data.mode)).toEqual(['full']);
    expect(mocks.rotate).toHaveBeenCalledWith(270 * Math.PI / 180);
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0]![1].pre).toMatchObject({ verification: { status: 'single' }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE' }] });
    expect(receive.mock.calls[0]![1].pre.headerReview).toContain('Placa ajustada por formato. Confira letras e números.');
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
  });

  it('can skip only orientation while preserving the old optional verification behavior', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('oriented-check.jpg')], receive, undefined, undefined, { orientations: [90] });
    (await pendingCall('oriented-check.jpg', 'full')).pending.resolve(responses(1).full);
    (await pendingCall('oriented-check.jpg', 'verify')).pending.resolve(responses(1).verification);
    await batch;
    expect(mocks.orient).not.toHaveBeenCalled();
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify']);
    expect(receive.mock.calls[0]![1].pre.verification.status).toBe('matched');
  });

  it('stops waiting for a pending session immediately after closing, ignoring a late authentication failure', async () => {
    const session = deferred<never>();
    mocks.session.mockReturnValue(session.promise);
    const abort = new AbortController(); const receive = vi.fn(); const progress = vi.fn();
    const batch = readAiPhotos([photo('closed-during-session.jpg')], receive, progress, abort.signal);
    await waitFor(() => expect(mocks.session).toHaveBeenCalledOnce());
    abort.abort();
    await batch;
    session.reject(new Error('Late authentication failure'));
    await Promise.resolve();
    expect(mocks.orient).not.toHaveBeenCalled();
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('does no authentication work for an import that is already closed', async () => {
    const abort = new AbortController(); abort.abort();
    await readAiPhotos([photo('already-closed.jpg')], vi.fn(), undefined, abort.signal);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.orient).not.toHaveBeenCalled();
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('propagates a session lookup failure rather than reporting a photo fallback', async () => {
    mocks.session.mockRejectedValue(new Error('Authentication unavailable'));
    const receive = vi.fn();
    await expect(readAiPhotos([photo('auth-failure.jpg')], receive, undefined)).rejects.toThrow('Authentication unavailable');
    expect(mocks.orient).not.toHaveBeenCalled();
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
  });

  it('finishes a complete and locally consistent photo after exactly one AI call', async () => {
    const receive = vi.fn(); const progress = vi.fn();
    const batch = readAiPhotos([photo('complete.jpg')], receive, progress);
    (await pendingCall('complete.jpg', 'full')).pending.resolve(responses(1, 0, false).full);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full']);
    expect(calls[0]!.input.data).not.toHaveProperty('detail');
    expect(receive).toHaveBeenCalledOnce();
    const result = receive.mock.calls[0]![1];
    expect(result.pre.verification).toEqual({ status: 'single', checkedFields: 0, conflicts: 0 });
    expect(result.pre.headerReview).toEqual([]);
    expect(result.pre.documents[0]).toMatchObject({ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE', recipient: 'CLIENTE TESTE' });
    expect(JSON.parse(result.text).verification.status).toBe('single');
    expect(progress).toHaveBeenCalledOnce();
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
  });

  it.each([[270, 90, 0], [180, 270, 90]] as const)('orients the complete image by %s degrees and combines the additional %s-degree correction for verification', async (orientation, additional, combined) => {
    mocks.orient.mockResolvedValue([orientation]);
    const receive = vi.fn(); const progress = vi.fn(); const result = responses(1, additional);
    const batch = readAiPhotos([photo('oriented.jpg')], receive, progress);
    const full = await pendingCall('oriented.jpg', 'full');
    expect(atob(full.input.data.data)).toContain(orientation === 270 ? '1200x800' : '800x1200');
    expect(full.input.data).not.toHaveProperty('detail');
    full.pending.resolve(result.full);
    const verification = await pendingCall('oriented.jpg', 'verify');
    expect(atob(verification.input.data.data)).toContain(combined === 90 ? '1200x800' : '800x1200');
    expect(atob(verification.input.data.detail!)).toContain(combined === 90 ? '1200x520' : '800x780');
    verification.pending.resolve(result.verification);
    await batch;
    expect(mocks.rotate.mock.calls.map(call => call[0])).toEqual([orientation * Math.PI / 180, combined * Math.PI / 180]);
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify']);
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0]![1].pre.verification.status).toBe('matched');
  });

  it('waits for local orientation, suppresses its late callbacks after closing and sends no photo', async () => {
    const orientation = deferred<(0 | 90 | 180 | 270)[]>();
    mocks.orient.mockReturnValue(orientation.promise);
    const abort = new AbortController(); const receive = vi.fn(); const progress = vi.fn();
    const files = [photo('before-upload.jpg')];
    const batch = readAiPhotos(files, receive, progress, abort.signal);
    await waitFor(() => expect(mocks.orient).toHaveBeenCalledOnce());
    const [selected, report, signal] = mocks.orient.mock.calls[0]!;
    expect(selected).toBe(files); expect(signal).toBe(abort.signal);
    report(0, 'Ajustando orientação da foto…');
    expect(progress).toHaveBeenCalledWith(0, 'Ajustando orientação da foto…');
    expect(mocks.decode).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
    abort.abort();
    report(0, 'Callback tardio');
    orientation.resolve([270]);
    await batch;
    expect(progress).toHaveBeenCalledOnce();
    expect(receive).not.toHaveBeenCalled();
    expect(mocks.decode).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });

  it('reads one original image when local orientation fails', async () => {
    mocks.orient.mockRejectedValue(new Error('Orientation worker unavailable'));
    const receive = vi.fn();
    const batch = readAiPhotos([photo('orientation-failed.jpg')], receive, undefined);
    const full = await pendingCall('orientation-failed.jpg', 'full');
    expect(atob(full.input.data.data)).toContain('800x1200');
    expect(full.input.data).not.toHaveProperty('detail');
    full.pending.resolve(responses(1, 0, false).full);
    await batch;
    expect(calls).toHaveLength(1);
    expect(receive.mock.calls[0]![1].pre.verification.status).toBe('single');
  });

  it('includes local preparation in elapsed time while keeping the separate 35-second AI budget and one consistent full read', async () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    mocks.orient.mockImplementation(async () => { now = 6100; return [270]; });
    const receive = vi.fn();
    const batch = readAiPhotos([photo('timed-preparation.jpg')], receive, undefined);
    const full = await pendingCall('timed-preparation.jpg', 'full');
    now = 7100;
    full.pending.resolve(responses(1, 0, false).full);
    await batch;
    expect(receive.mock.calls[0]![1].milliseconds).toBe(7000);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(35000);
    expect(calls.map(call => call.input.data.mode)).toEqual(['full']);
    expect(receive.mock.calls[0]![1].pre.verification.status).toBe('single');
  });

  it('requests the second reading for missing names and recovers them by CTC identity', async () => {
    const response = responses(1, 0, false);
    const missing = { ...response.full, pre: { ...response.full.pre, documents: response.full.pre.documents.map(row => ({ ...row, client: '', review: ['Confira cliente/laboratório'] })) } };
    const receive = vi.fn();
    const batch = readAiPhotos([photo('missing-name.jpg')], receive, undefined);
    (await pendingCall('missing-name.jpg', 'full')).pending.resolve(missing);
    (await pendingCall('missing-name.jpg', 'verify')).pending.resolve({ ...response.verification, check: { ...response.verification.check!, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE', recipient: 'CLIENTE TESTE' }] } });
    await batch;
    expect(calls).toHaveLength(2);
    expect(receive.mock.calls[0]![1].pre.documents[0].client).toBe('LAB TESTE');
    expect(receive.mock.calls[0]![1].pre.verification.status).toBe('review');
  });

  it('limits concurrent photos to two and returns their original indices when they finish out of order', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')], receive, undefined);
    const a = responses(1, 0, false); const b = responses(2, 0, false); const c = responses(3, 0, false);
    await pendingCall('a.jpg', 'full');
    const bFull = await pendingCall('b.jpg', 'full');
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
    expect(calls.some(call => call.name === 'c.jpg')).toBe(false);
    bFull.pending.resolve(b.full);
    const cFull = await pendingCall('c.jpg', 'full');
    expect(receive.mock.calls.map(call => call[0])).toEqual([1]);
    expect(bitmaps.find(image => image.name === 'b.jpg')!.close).toHaveBeenCalledOnce();
    cFull.pending.resolve(c.full);
    await waitFor(() => expect(receive.mock.calls.map(call => call[0])).toEqual([1, 2]));
    (await pendingCall('a.jpg', 'full')).pending.resolve(a.full);
    await batch;
    expect(peakRequests).toBe(2);
    expect(activeRequests).toBe(0);
    expect(receive.mock.calls.map(([index, result]) => [index, result.pre.id])).toEqual([[1, 'DI000000002'], [2, 'DI000000003'], [0, 'DI000000001']]);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    receive.mock.calls.forEach(([, result]) => expect(result.pre.verification.status).toBe('single'));
    expect(bitmaps).toHaveLength(3);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('uses one decode and a second read only to corroborate an automatically repaired plate', async () => {
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
    expect(progress.mock.calls.map(call => call[1])).toEqual(['Lendo todas as linhas e laboratórios…', 'Conferindo campos sinalizados em uma segunda leitura…']);
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
    expect(reading).toEqual({ error: 'Não foi possível concluir a leitura por IA desta foto. A leitura local pode ser usada.' });
    expect(reading).not.toHaveProperty('pre');
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(activeRequests).toBe(0);
  });

  it('keeps the full result with unavailable verification and the provider error when the second read fails', async () => {
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('second-offline.jpg')], receive, undefined);
    (await pendingCall('second-offline.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('second-offline.jpg', 'verify')).pending.resolve({ ok: false, retryable: false, unavailable: true, error: 'Gemini indisponível (503). Tente novamente.' });
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify']);
    expect(receive).toHaveBeenCalledOnce();
    const reading = receive.mock.calls[0]![1];
    expect(reading).not.toHaveProperty('error');
    expect(reading.pre).toMatchObject({ id: 'DI000000001', verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE' }] });
    expect(reading.pre.headerReview).toContain('A conferência adicional está temporariamente indisponível. A leitura completa foi mantida; confira os campos sinalizados.');
    expect(reading.pre.headerReview).toContain('Segunda leitura indisponível. Confira os dados antes de cadastrar.');
    expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
    expect(activeRequests).toBe(0);
  });

  it('preserves the full result if the optional second request throws', async () => {
    const receive = vi.fn();
    const batch = readAiPhotos([photo('verification-offline.jpg')], receive, undefined);
    (await pendingCall('verification-offline.jpg', 'full')).pending.resolve(responses(1).full);
    (await pendingCall('verification-offline.jpg', 'verify')).pending.reject(new Error('Network unavailable'));
    await batch;
    expect(calls).toHaveLength(2);
    expect(receive.mock.calls[0]![1].pre).toMatchObject({ id: 'DI000000001', verification: { status: 'review' }, documents: [{ ctc: '0000000001', nf: '101-1' }] });
    expect(receive.mock.calls[0]![1].pre.headerReview).toContain('A conferência adicional não terminou. Confira os campos sinalizados antes de cadastrar.');
  });

  it('keeps disagreements visible for manual review without spending a third reading', async () => {
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('verify-offline.jpg')], receive, undefined);
    const conflictingCheck: Response = { ...result.verification, check: { ...result.verification.check!, documents: [{ ctc: '0000000001', nf: '999-1', volumes: '3' }] } };
    (await pendingCall('verify-offline.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('verify-offline.jpg', 'verify')).pending.resolve(conflictingCheck);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify']);
    expect(receive).toHaveBeenCalledOnce();
    const reading = receive.mock.calls[0]![1];
    expect(reading).not.toHaveProperty('error');
    expect(reading.pre).toMatchObject({ id: 'DI000000001', plate: 'ABC1D23', driver: 'ANA SILVA', verification: { status: 'review', conflicts: 1 }, documents: [{ ctc: '0000000001', nf: '101-1', volumes: '3', client: 'LAB TESTE', recipient: 'CLIENTE TESTE' }] });
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
    (await pendingCall('in-flight.jpg', 'verify')).pending.resolve(inFlight.verification);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, result]) => [index, result]));
    expect(results.get(0).pre.verification.status).toBe('matched');
    expect(results.get(1)).toEqual({ error: quotaMessages.daily });
    expect(results.get(3)).toEqual({ error: quotaMessages.daily });
    expect(results.get(2)).not.toHaveProperty('error');
    expect(results.get(2).pre).toMatchObject({ id: 'DI000000003', verification: { status: 'matched' }, documents: [{ ctc: '0000000003', nf: '103-1', volumes: '3' }] });
    expect(results.get(2).pre.headerReview).toEqual([]);
    expect(calls).toHaveLength(5);
    expect(calls.some(call => call.name === 'queued.jpg')).toBe(false);
    expect(calls.some(call => call.name === 'in-flight.jpg' && call.input.data.mode === 'verify')).toBe(true);
    expect(receive).toHaveBeenCalledTimes(4);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
    expect(activeRequests).toBe(0);
  });

  it('isolates the verification daily quota from queued full reads and the next import', async () => {
    const receive = vi.fn(); const progress = vi.fn();
    const batch = readAiPhotos([photo('check-limit.jpg'), photo('in-flight.jpg'), photo('queued.jpg')], receive, undefined);
    (await pendingCall('check-limit.jpg', 'full')).pending.resolve(responses(1).full);
    (await pendingCall('check-limit.jpg', 'verify')).pending.resolve(quotaFailure('daily'));
    (await pendingCall('queued.jpg', 'full')).pending.resolve(responses(3).full);
    (await pendingCall('in-flight.jpg', 'full')).pending.resolve(responses(2).full);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, result]) => [index, result]));
    for (const index of [0, 1, 2]) {
      expect(results.get(index)).not.toHaveProperty('error');
      expect(results.get(index).pre).toMatchObject({ id: `DI00000000${index + 1}`, verification: { status: 'unavailable' }, documents: [{ ctc: `000000000${index + 1}`, nf: `${101 + index}-1`, volumes: '3' }] });
      expect(results.get(index).pre.headerReview).toContain('A cota diária da conferência adicional esgotou. A leitura completa foi mantida; confira os campos sinalizados.');
    }
    expect(calls.map(call => [call.name, call.input.data.mode])).toEqual([['check-limit.jpg', 'full'], ['in-flight.jpg', 'full'], ['check-limit.jpg', 'verify'], ['queued.jpg', 'full']]);
    expect(receive).toHaveBeenCalledTimes(3);
    expect(mocks.decode).toHaveBeenCalledTimes(3);
    const nextResult = vi.fn();
    const next = readAiPhotos([photo('next-batch.jpg')], nextResult, progress);
    (await pendingCall('next-batch.jpg', 'full')).pending.resolve(responses(4).full);
    await next;
    expect(calls.filter(call => call.input.data.mode === 'full')).toHaveLength(4);
    expect(calls.filter(call => call.input.data.mode === 'verify')).toHaveLength(1);
    expect(nextResult.mock.calls[0]![1].pre).toMatchObject({ id: 'DI000000004', verification: { status: 'unavailable' }, documents: [{ ctc: '0000000004', nf: '104-1', volumes: '3' }] });
    expect(nextResult.mock.calls[0]![1].pre.headerReview).toContain('A cota diária da conferência adicional esgotou. A leitura completa foi mantida; confira os campos sinalizados.');
    expect(progress.mock.calls.map(call => call[1])).toEqual(['Lendo todas as linhas e laboratórios…']);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('ignores a legacy user-wide quota entry after the models gain independent stage scopes', async () => {
    const { data: { session } } = await mocks.session();
    rememberPhotoProviderBlock(session.user.id, quotaFailure('daily'));
    const receive = vi.fn();
    const batch = readAiPhotos([photo('new-full-model.jpg')], receive, undefined);
    (await pendingCall('new-full-model.jpg', 'full')).pending.resolve(responses(1, 0, false).full);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full']);
    expect(receive.mock.calls[0]![1].pre.id).toBe('DI000000001');
  });

  it('ignores cached stage quotas from the previous reversed full and verification models', async () => {
    const { data: { session } } = await mocks.session();
    for (const stage of ['full', 'verify']) rememberPhotoProviderBlock(`${session.user.id}:photo-model-stages-v2:${stage}`, quotaFailure('daily'));
    const receive = vi.fn();
    const batch = readAiPhotos([photo('restored-full-model.jpg')], receive, undefined);
    (await pendingCall('restored-full-model.jpg', 'full')).pending.resolve(responses(1).full);
    (await pendingCall('restored-full-model.jpg', 'verify')).pending.resolve(responses(1).verification);
    await batch;
    expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'verify']);
    expect(receive.mock.calls[0]![1].pre).toMatchObject({ id: 'DI000000001', verification: { status: 'matched' } });
  });

  it('goes directly to local fallback on the next import after a known daily quota failure', async () => {
    const first = readAiPhotos([photo('limited.jpg')], vi.fn(), undefined);
    (await pendingCall('limited.jpg', 'full')).pending.resolve(quotaFailure('daily'));
    await first;
    const receive = vi.fn(); const progress = vi.fn();
    await readAiPhotos([photo('next-batch.jpg'), photo('next-batch-2.jpg')], receive, progress);
    expect(calls).toHaveLength(1);
    expect(mocks.orient).toHaveBeenCalledOnce();
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(receive.mock.calls.map(([index, result]) => [index, 'error' in result])).toEqual([[0, true], [1, true]]);
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('uses local fallback during a short provider cooldown and tries AI again after it expires', async () => {
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const first = readAiPhotos([photo('timeout.jpg')], vi.fn(), undefined);
    (await pendingCall('timeout.jpg', 'full')).pending.resolve({ ok: false, unavailable: true, retryable: false, error: 'O Gemini excedeu o limite de 20 s; a leitura local pode ser usada.' });
    await first;
    const receive = vi.fn(); const progress = vi.fn();
    await readAiPhotos([photo('next.jpg'), photo('next-2.jpg')], receive, progress);
    expect(calls).toHaveLength(1);
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(receive.mock.calls.map(call => call[0])).toEqual([0, 1]);
    receive.mock.calls.forEach(([, result]) => expect(result.error).toContain('Gemini temporariamente indisponível'));
    expect(progress).toHaveBeenCalledWith(0, 'Gemini temporariamente indisponível · usando o leitor gratuito…');
    now += 2 * 60 * 1000 + 1;
    const recovered = readAiPhotos([photo('recovered.jpg')], receive, progress);
    (await pendingCall('recovered.jpg', 'full')).pending.resolve(responses(2, 0, false).full);
    await recovered;
    expect(calls.map(call => call.name)).toEqual(['timeout.jpg', 'recovered.jpg']);
    expect(receive.mock.calls.at(-1)![1].pre.verification.status).toBe('single');
  });

  it('stops unavailable-provider calls for ten photos after the request helper returns, preserving a valid in-flight full read', async () => {
    const receive = vi.fn();
    const files = Array.from({ length: 10 }, (_, index) => photo(`provider-${index}.jpg`));
    const batch = readAiPhotos(files, receive, undefined);
    const failed = await pendingCall('provider-0.jpg', 'full');
    const active = await pendingCall('provider-1.jpg', 'full');
    const message = 'O Gemini está indisponível. A leitura local pode ser usada.';
    // A provider failure goes directly to local OCR without another AI call.
    failed.pending.resolve({ ok: false, error: message, unavailable: true, retryable: false } as Response);
    await waitFor(() => expect(receive).toHaveBeenCalledTimes(9));
    active.pending.resolve(responses(2).full);
    (await pendingCall('provider-1.jpg', 'verify')).pending.resolve(responses(2).verification);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, result]) => [index, result]));
    expect([...results.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, index) => index));
    for (const index of [0, 2, 3, 4, 5, 6, 7, 8, 9]) expect(results.get(index)).toEqual({ error: message });
    expect(results.get(1)).not.toHaveProperty('error');
    expect(results.get(1).pre).toMatchObject({ id: 'DI000000002', verification: { status: 'matched' }, documents: [{ ctc: '0000000002', nf: '102-1', volumes: '3', client: 'LAB TESTE' }] });
    expect(results.get(1).pre.headerReview).toEqual([]);
    expect(calls.map(call => [call.name, call.input.data.mode])).toEqual([['provider-0.jpg', 'full'], ['provider-1.jpg', 'full'], ['provider-1.jpg', 'verify']]);
    expect(peakRequests).toBe(2);
    expect(activeRequests).toBe(0);
    expect(receive).toHaveBeenCalledTimes(10);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    bitmaps.forEach(image => expect(image.close).toHaveBeenCalledOnce());
  });

  it('isolates verification cooldown from full reads and resumes verification after its short pause', async () => {
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const receive = vi.fn(); const result = responses(1);
    const batch = readAiPhotos([photo('verify-unavailable.jpg'), photo('in-flight.jpg'), photo('queued.jpg')], receive, undefined);
    (await pendingCall('verify-unavailable.jpg', 'full')).pending.resolve(result.full);
    (await pendingCall('verify-unavailable.jpg', 'verify')).pending.resolve({ ok: false, error: 'Gemini indisponível (503).', unavailable: true, retryable: false } as Response);
    (await pendingCall('queued.jpg', 'full')).pending.resolve(responses(3).full);
    (await pendingCall('in-flight.jpg', 'full')).pending.resolve(responses(2).full);
    await batch;
    const results = new Map(receive.mock.calls.map(([index, reading]) => [index, reading]));
    expect(results.get(0).pre).toMatchObject({ id: 'DI000000001', verification: { status: 'unavailable' } });
    expect(results.get(1).pre).toMatchObject({ id: 'DI000000002', verification: { status: 'unavailable' } });
    expect(results.get(2).pre).toMatchObject({ id: 'DI000000003', verification: { status: 'unavailable' } });
    expect(calls.map(call => [call.name, call.input.data.mode])).toEqual([['verify-unavailable.jpg', 'full'], ['in-flight.jpg', 'full'], ['verify-unavailable.jpg', 'verify'], ['queued.jpg', 'full']]);
    expect(receive).toHaveBeenCalledTimes(3);
    const nextResult = vi.fn();
    const next = readAiPhotos([photo('next-batch.jpg')], nextResult, undefined);
    (await pendingCall('next-batch.jpg', 'full')).pending.resolve(responses(4).full);
    await next;
    expect(nextResult.mock.calls[0]![1].pre).toMatchObject({ id: 'DI000000004', verification: { status: 'unavailable' } });
    expect(calls.filter(call => call.input.data.mode === 'verify')).toHaveLength(1);
    expect(calls.filter(call => call.input.data.mode === 'full')).toHaveLength(4);
    now += 2 * 60 * 1000 + 1;
    const recovered = readAiPhotos([photo('recovered.jpg')], nextResult, undefined);
    (await pendingCall('recovered.jpg', 'full')).pending.resolve(responses(5).full);
    (await pendingCall('recovered.jpg', 'verify')).pending.resolve(responses(5).verification);
    await recovered;
    expect(nextResult.mock.calls.at(-1)![1].pre.verification.status).toBe('matched');
    expect(calls.filter(call => call.input.data.mode === 'verify')).toHaveLength(2);
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

it('uses Lite after a transient normal failure, skips the unhealthy normal on the next photo, then restores it', async () => {
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  const options = { singlePass: true, quotaFallback: true, orientations: [0] as const };
  const first = readAiPhotos([photo('transient-normal.jpg')], vi.fn(), undefined, undefined, options);
  (await pendingCall('transient-normal.jpg', 'full')).pending.resolve({ ok: false, unavailable: true, tryLite: true, retryable: false, error: 'Gemini indisponível (503).' });
  (await pendingCall('transient-normal.jpg', 'full-lite')).pending.resolve(responses(1, 0, false).full); await first;
  const receive = vi.fn(), second = readAiPhotos([photo('transient-direct-lite.jpg')], receive, undefined, undefined, options);
  (await pendingCall('transient-direct-lite.jpg', 'full-lite')).pending.resolve(responses(2, 0, false).full); await second;
  expect(receive.mock.calls[0]![1].pre.aiReader).toBe('lite'); expect(mocks.decode).toHaveBeenCalledTimes(2);
  now += 120001;
  const recovered = readAiPhotos([photo('normal-restored.jpg')], vi.fn(), undefined, undefined, options);
  (await pendingCall('normal-restored.jpg', 'full')).pending.resolve(responses(3, 0, false).full); await recovered;
  expect(calls.map(call => call.input.data.mode)).toEqual(['full', 'full-lite', 'full-lite', 'full']);
});
it('returns a transient Lite failure for local review and keeps cancellation instead of looping through models', async () => {
  const receive = vi.fn(), batch = readAiPhotos([photo('both-transient.jpg')], receive, undefined, undefined, { singlePass: true, quotaFallback: true, orientations: [0] });
  (await pendingCall('both-transient.jpg', 'full')).pending.resolve({ ok: false, unavailable: true, tryLite: true, retryable: false, error: 'Modelo temporariamente indisponível.' });
  (await pendingCall('both-transient.jpg', 'full-lite')).pending.resolve({ ok: false, unavailable: true, tryLite: true, retryable: false, error: 'Sem resposta.' }); await batch;
  expect(receive).toHaveBeenCalledExactlyOnceWith(0, { error: 'O Gemini normal ficou indisponível. Flash Lite: Sem resposta.' }); expect(calls).toHaveLength(2);
  await readAiPhotos([photo('both-transient-next.jpg')], receive, undefined, undefined, { singlePass: true, quotaFallback: true, orientations: [0] }); expect(calls).toHaveLength(2);
});

it('rechecks just a flagged NF and preserves unselected fields with one optional call', async () => {
 const data=responses(1,0,false); if(!data.full.ok)return;
 data.full.pre.aiReader='deepseek'; data.full.pre.issueDate='2026-10-13'; data.full.pre.documents[0]!.nf=''; data.full.pre.documents[0]!.review=['Confira NF e série'];
 const receive=vi.fn(), provisional=vi.fn();
 const run=readAiPhotos([photo('selective.jpg')],receive,undefined,undefined,{orientations:[0],preferredModel:'lite',selective:true,onProvisional:provisional});
 (await pendingCall('selective.jpg','full-lite')).pending.resolve(data.full);
 const repair=await pendingCall('selective.jpg','repair');
 expect(provisional).toHaveBeenCalledOnce();
 expect(repair.input.data.repairPlan!.rows).toEqual([{index:0,ctc:'0000000001',nf:'',fields:['nf']}]);
 repair.pending.resolve({ok:true,pre:{...data.full.pre,aiReader:'lite'},text:'',rotation:0,check:null,repair:{header:{},rows:[{index:0,ctc:'0000000001',nf:'101-1',volumes:'99',client:'INVENTADO',recipient:'OUTRO'}]}});
 await run;expect(calls).toHaveLength(2);
 expect(receive.mock.calls[0]![1].pre.aiReader).toBe('lite');
 expect(receive.mock.calls[0]![1].pre.documents[0]).toMatchObject({nf:'101-1',volumes:'3',client:'LAB TESTE',recipient:'CLIENTE TESTE'});
});
it('reuses existing uncertain data for a manual repair rather than rereading the full table', async () => {
 const data=responses(1,0,false);if(!data.full.ok)return;
 data.full.pre.documents[0]!.review=['Confira volumes'];
 const run=readAiPhotos([photo('manual-repair.jpg')],vi.fn(),undefined,undefined,{orientations:[0],preferredModel:'lite',selective:true,initialRead:data.full.pre});
 const repair=await pendingCall('manual-repair.jpg','repair');
 repair.pending.resolve({ok:true,pre:data.full.pre,text:'',rotation:0,check:null,repair:{header:{},rows:[{index:0,ctc:'0000000001',nf:'101-1',volumes:'3',client:'',recipient:''}]}});
 await run;expect(calls).toHaveLength(1);expect(calls[0]!.input.data.mode).toBe('repair');
});

it('checks a complete plausible AI result against independent local numbers and the reported rotation', async () => {
  const data = responses(1, 270, false); if (!data.full.ok) return;
  const local = structuredClone(data.full.pre);
  data.full.pre.documents[0]!.volumes = '4';
  const numericCheck = vi.fn(async () => ({ pre: local, confirmed: [{ ctc: local.documents[0]!.ctc, nf: local.documents[0]!.nf, volumes: '3' }], milliseconds: 2000 }));
  const receive = vi.fn();
  const run = readAiPhotos([photo('numeric.jpg')], receive, undefined, undefined, { orientations: [0], singlePass: true, preferredModel: 'lite', numericCheck });
  (await pendingCall('numeric.jpg', 'full-lite')).pending.resolve(data.full);
  await run;
  expect(numericCheck).toHaveBeenCalledWith(expect.any(File), 270, expect.objectContaining({ aborted: false }), expect.objectContaining({ kind: 'pre' }));
  expect(receive.mock.calls[0]![1].pre.documents[0]).toMatchObject({ volumes: '3', review: expect.arrayContaining([expect.stringContaining('duas leituras locais')]) });
  expect(calls).toHaveLength(1);
});

it('keeps the first AI data if numeric verification fails, and flags the missing check', async () => {
  const receive = vi.fn();
  const run = readAiPhotos([photo('numeric-failed.jpg')], receive, undefined, undefined, { orientations: [0], singlePass: true, numericCheck: async () => { throw new Error('OCR failed'); } });
  (await pendingCall('numeric-failed.jpg', 'full')).pending.resolve(responses(1, 0, false).full);
  await run;
  expect(receive.mock.calls[0]![1].pre.documents[0]!.nf).toBe('101-1');
  expect(receive.mock.calls[0]![1].pre.headerReview).toContain('A conferência local dos números não terminou. Confira CTCs, NFs e volumes na foto.');
});
it('keeps unread local cells highlighted without consuming an automatic extra AI request', async () => {
  const data = responses(1, 0, false); if (!data.full.ok) return; data.full.pre.issueDate = '2026-10-14';
  const receive = vi.fn();
  const run = readAiPhotos([photo('local-unread.jpg')], receive, undefined, undefined, { orientations: [0], selective: true, numericCheck: async () => ({ pre: { ...data.full.pre, documents: [] }, confirmed: [], milliseconds: 2000 }) });
  (await pendingCall('local-unread.jpg', 'full')).pending.resolve(data.full); await run;
  expect(calls).toHaveLength(1);
  expect(receive.mock.calls[0]![1].pre.documents[0]!.review.join(' ')).toContain('sem confirmação local');
});

it('cancels a stalled numeric verifier without late results and releases the photo bitmap', async () => {
  const receive = vi.fn(), started = vi.fn(), controller = new AbortController();
  const run = readAiPhotos([photo('numeric-stop.jpg')], receive, undefined, controller.signal, { orientations: [0], singlePass: true, numericCheck: async () => { started(); return new Promise(() => {}); } });
  (await pendingCall('numeric-stop.jpg', 'full')).pending.resolve(responses(1, 0, false).full);
  await waitFor(() => expect(started).toHaveBeenCalledOnce());
  controller.abort(); await run;
  expect(receive).not.toHaveBeenCalled();
  expect(bitmaps[0]!.close).toHaveBeenCalledOnce();
});

it('uses one full-width strip request for a structural gap, without also running whole-page verification', async () => {
  const data = responses(1, 90, false); if (!data.full.ok) return;
  mocks.orient.mockImplementationOnce(async (_files: File[], _progress: unknown, _signal: unknown, confirmed: (index: number, angle: number) => void) => { confirmed(0, 270); return [270]; });
  data.full.pre.aiReader = 'deepseek';
  data.full.pre.expectedNfs = 2; data.full.pre.totalVolumes = 4;
  const fixed = structuredClone(data.full);
  if (!fixed.ok) return;
  fixed.pre.aiReader = 'lite';
  fixed.pre.documents.push({ ...fixed.pre.documents[0]!, nf: '102-1', volumes: '1' });
  const receive = vi.fn(), numericCheck = vi.fn();
  const run = readAiPhotos([photo('bands.jpg')], receive, undefined, undefined, { orientations: [0], preferredModel: 'lite', selective: true, numericCheck });
  (await pendingCall('bands.jpg', 'full-lite')).pending.resolve(data.full);
  const bandRequest = await pendingCall('bands.jpg', 'full-lite', 1);
  expect(bandRequest.input.data.bands).toHaveLength(6);
  bandRequest.pending.resolve(fixed); await run;
  expect(calls).toHaveLength(2); expect(numericCheck).not.toHaveBeenCalled();
  expect(receive.mock.calls[0]![1].pre).toMatchObject({ tableRecovery: 'bands', imageRotation: 270, aiReader: 'lite' });
  expect(receive.mock.calls[0]![1].pre.documents).toHaveLength(2);
});

it('preserves the first draft on strip quota failure without starting another verification', async () => {
  const data = responses(1, 0, false); if (!data.full.ok) return;
  data.full.pre.expectedNfs = 2;
  const receive = vi.fn();
  const run = readAiPhotos([photo('bands-quota.jpg')], receive, undefined, undefined, { orientations: [0], preferredModel: 'lite', quotaFallback: true, selective: true });
  (await pendingCall('bands-quota.jpg', 'full-lite')).pending.resolve(data.full);
  (await pendingCall('bands-quota.jpg', 'full-lite', 1)).pending.resolve(quotaFailure('daily')); await run;
  expect(calls).toHaveLength(2);
  expect(receive.mock.calls[0]![1].pre.documents).toEqual(data.full.pre.documents);
  expect(receive.mock.calls[0]![1].pre.headerReview.join(' ')).toContain('faixas indisponível');
});

it('keeps the actual DeepSeek provider label returned by the server', async () => {
  const data = responses(1, 0, false); if (!data.full.ok) return;
  data.full.pre.aiReader = 'deepseek';
  const receive = vi.fn(), run = readAiPhotos([photo('deepseek.jpg')], receive, undefined, undefined, { orientations: [0], preferredModel: 'lite', singlePass: true });
  (await pendingCall('deepseek.jpg', 'full-lite')).pending.resolve(data.full); await run;
  expect(receive.mock.calls[0]![1].pre.aiReader).toBe('deepseek');
});

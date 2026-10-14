import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPhotosWithFallback, type PhotoReadResult } from '@/lib/photo-reader';
import type { readPrePhotos } from '@/lib/photo-ocr';
import { markLocalPhoto } from '@/lib/local-photo';

const mocks = vi.hoisted(() => ({ ai: vi.fn(), local: vi.fn(), loadLocal: vi.fn() }));
vi.mock('@/lib/photo-ai', () => ({ readAiPhotos: mocks.ai }));
vi.mock('@/lib/photo-ocr', () => { mocks.loadLocal(); return { readPrePhotos: mocks.local }; });
type OnResult = Parameters<typeof readPrePhotos>[1];
type OnProgress = NonNullable<Parameters<typeof readPrePhotos>[2]>;
type Success = Exclude<PhotoReadResult, { error: string }>;
const photo = (name: string) => new File(['synthetic'], name, { type: 'image/jpeg' });
const files = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg'), photo('d.jpg')];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function reading(index: number, local = false): Success {
  const ctc = String(index + 1).padStart(10, '0');
  const pre: Success['pre'] = { kind: 'pre', id: `DI${String(index + 1).padStart(10, '0')}`, issueDate: '2026-08-28', plate: 'ABC1D23', driver: 'MOTORISTA', ctcs: [ctc],
    readingSource: 'gemini', expectedRows: 1, totalVolumes: 3, headerReview: [], documents: [{ ctc, nf: `${100 + index}-1`, volumes: '3', client: 'LAB TESTE', recipient: 'CLIENTE TESTE', review: [] }] };
  return { text: 'synthetic', milliseconds: 20, angle: 270, pre: local ? markLocalPhoto(pre) : pre };
}
const finals = (receive: ReturnType<typeof vi.fn>) => receive.mock.calls.filter(([, value]) => 'error' in value || !value.pendingVerification);
beforeEach(() => { vi.clearAllMocks(); mocks.ai.mockReset(); mocks.local.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('local-first photo reading with independent AI correction', () => {
  it('does not start either reader or emit callbacks after pre-cancellation', async () => {
    const abort = new AbortController(); abort.abort(); const receive = vi.fn(), progress = vi.fn();
    await readPhotosWithFallback(files, receive, progress, abort.signal);
    expect(mocks.local).not.toHaveBeenCalled(); expect(mocks.ai).not.toHaveBeenCalled(); expect(receive).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });

  it('shows local fields first and starts one AI check before the next local photo finishes', async () => {
    const localGate = deferred(), aiGate = deferred(), receive = vi.fn(), progress = vi.fn(), abort = new AbortController();
    let sendLocal!: OnResult;
    mocks.local.mockImplementation(async (_files: File[], result: OnResult, update: OnProgress) => { sendLocal = result; update(0, 'Lendo'); result(0, reading(0, true)); await localGate.promise; });
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => { await aiGate.promise; result(0, reading(_files[0] === files[0] ? 0 : 1)); });
    const run = readPhotosWithFallback(files.slice(0, 2), receive, progress, abort.signal, true);
    await waitFor(() => expect(mocks.ai).toHaveBeenCalledOnce());
    expect(receive).toHaveBeenCalledExactlyOnceWith(0, expect.objectContaining({ pendingVerification: true, pre: expect.objectContaining({ readingSource: 'local' }) }));
    expect(mocks.local.mock.calls[0]![0]).toEqual(files.slice(0, 2));
    expect(mocks.local.mock.calls[0]![3].aborted).toBe(false); expect(mocks.local.mock.calls[0]![4]).toBe(true);
    expect(mocks.ai.mock.calls[0]![0]).toEqual([files[0]]);
    expect(mocks.ai.mock.calls[0]![4]).toEqual({ singlePass: true, quotaFallback: true, preferredModel: 'lite', orientations: [270] });
    expect(progress).toHaveBeenCalledWith(0, 'Leitura local · Lendo');
    sendLocal(1, reading(1, true)); localGate.resolve(); aiGate.resolve(); await run;
    expect(finals(receive).map(([index]) => index)).toEqual([0, 1]);
    expect(finals(receive)[0]![1].pre.verification.status).toBe('matched');
  });

  it('limits AI corrections to two concurrent photos and retains original file indices', async () => {
    const receive = vi.fn(); const calls: { file: File; result: OnResult; done: () => void }[] = [];
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => _files.forEach((_, index) => result(index, reading(index, true))));
    mocks.ai.mockImplementation((list: File[], result: OnResult) => new Promise<void>(done => calls.push({ file: list[0]!, result, done })));
    const run = readPhotosWithFallback(files, receive);
    await waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.result(0, reading(1)); calls[1]!.done();
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]!.file).toBe(files[2]);
    calls[0]!.result(0, reading(0)); calls[0]!.done();
    await waitFor(() => expect(calls).toHaveLength(4));
    calls[3]!.result(0, reading(3)); calls[3]!.done(); calls[2]!.result(0, reading(2)); calls[2]!.done(); await run;
    expect(finals(receive).map(([index]) => index)).toEqual([1, 0, 3, 2]);
  });

  it('keeps local data without rerunning OCR when the provider quota fails', async () => {
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => _files.forEach((_, index) => result(index, reading(index, true))));
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Cota diária esgotada.' }));
    const receive = vi.fn(); await readPhotosWithFallback(files, receive);
    expect(mocks.local).toHaveBeenCalledOnce(); expect(finals(receive)).toHaveLength(4);
    for (const [, result] of finals(receive)) { expect(result.pre).toMatchObject({ readingSource: 'local', readingFallback: true, verification: { status: 'unavailable' } }); expect(result.pre.headerReview).toContain('Gemini: Cota diária esgotada.'); }
  });

  it('corrects a local NF and quantity by CTC rather than preserving a plausible OCR error', async () => {
    const local = reading(0, true), full = reading(0), ai = { ...full, pre: { ...full.pre, aiReader: 'lite' as const } }; local.pre.documents[0]!.nf = '10-1'; local.pre.documents[0]!.volumes = '8';
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, local));
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, ai));
    const receive = vi.fn(); await readPhotosWithFallback([files[0]!], receive);
    const corrected = finals(receive)[0]![1].pre;
    expect(corrected.documents[0]).toMatchObject({ ctc: '0000000001', nf: '100-1', volumes: '3' });
    expect(corrected.aiReader).toBe('lite');
    expect(corrected.documents[0].review.join(' ')).toContain('corrigido pela IA'); expect(corrected.verification).toMatchObject({ status: 'review', conflicts: 2 });
    expect(local.pre.documents[0]).toMatchObject({ nf: '10-1', volumes: '8' });
  });

  it('allows AI to recover a photo when the local worker fails', async () => {
    mocks.local.mockRejectedValue(new Error('worker internal secret'));
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, reading(0)));
    const receive = vi.fn(); await readPhotosWithFallback([files[0]!], receive);
    expect(receive).toHaveBeenCalledOnce(); expect(finals(receive)[0]![1].pre.readingSource).toBe('gemini');
  });

  it('reports both failures and removes credentials from deliberate provider messages', async () => {
    const credential = `AIza${'x'.repeat(35)}`;
    const alternateCredential = `AQ.${'x'.repeat(40)}`;
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Falha local Bearer private-local-token' }));
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: `Sem cota ${credential}; ${alternateCredential}; access_token=private-ai-token` }));
    const receive = vi.fn(); await readPhotosWithFallback([files[0]!], receive);
    expect(receive).toHaveBeenCalledOnce(); const error = receive.mock.calls[0]![1].error;
    expect(error).toContain('Sem cota'); expect(error).toContain('Falha local');
    for (const value of [credential, alternateCredential, 'private-local-token', 'private-ai-token']) expect(error).not.toContain(value);
  });

  it.each(['callback', 'exception'])('does not label an authentication %s as a successful local fallback', async mode => {
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, reading(0, true)));
    if (mode === 'callback') mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Entre novamente na sua conta.', fallback: false }));
    else mocks.ai.mockRejectedValue(new Error('Entre na sua conta para ler fotos.'));
    const receive = vi.fn(); await readPhotosWithFallback([files[0]!], receive);
    expect(finals(receive)[0]![1]).toMatchObject({ fallback: false, error: expect.stringContaining('Entre') });
  });

  it('returns immediately when stopped during a stalled local worker, ignoring its late result', async () => {
    const gate = deferred(), abort = new AbortController(), receive = vi.fn(), progress = vi.fn(); let send!: OnResult, update!: OnProgress;
    mocks.local.mockImplementation(async (_files: File[], result: OnResult, report: OnProgress) => { send = result; update = report; await gate.promise; });
    const run = readPhotosWithFallback(files, receive, progress, abort.signal);
    await waitFor(() => expect(mocks.local).toHaveBeenCalledOnce()); abort.abort(); await run;
    send(0, reading(0, true)); update(0, 'Tardio'); gate.resolve();
    expect(mocks.ai).not.toHaveBeenCalled(); expect(receive).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });

  it('returns immediately when stopped during a stalled AI request and does not check queued photos', async () => {
    const gate = deferred(), abort = new AbortController(), receive = vi.fn(); let send!: OnResult;
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => _files.forEach((_, index) => result(index, reading(index, true))));
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => { send = result; await gate.promise; });
    const run = readPhotosWithFallback(files, receive, undefined, abort.signal);
    await waitFor(() => expect(mocks.ai).toHaveBeenCalledTimes(2)); abort.abort(); await run;
    send(0, reading(0)); gate.resolve(); await Promise.resolve();
    expect(finals(receive)).toHaveLength(0); expect(mocks.ai).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledTimes(4); // Local drafts remain reviewable.
  });

  it('resolves a reader that returns no result instead of leaving the photo loading', async () => {
    mocks.local.mockResolvedValue(undefined); mocks.ai.mockResolvedValue(undefined);
    const receive = vi.fn(); await readPhotosWithFallback([files[0]!], receive);
    expect(receive).toHaveBeenCalledOnce(); expect(receive.mock.calls[0]![1].error).toContain('terminou sem retornar');
  });

  it('stops a stalled local worker after 60 seconds without progress and lets AI recover the photo', async () => {
    vi.useFakeTimers(); const gate = deferred(); let send!: OnResult;
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => { send = result; await gate.promise; });
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, reading(0)));
    const receive = vi.fn(); const run = readPhotosWithFallback([files[0]!], receive);
    await vi.advanceTimersByTimeAsync(0); expect(mocks.local).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000); await run;
    expect(mocks.local.mock.calls[0]![3].aborted).toBe(true);
    expect(mocks.ai).toHaveBeenCalledOnce(); expect(finals(receive)).toHaveLength(1);
    send(0, reading(0, true)); gate.resolve(); await Promise.resolve();
    expect(receive).toHaveBeenCalledOnce();
  });

  it('keeps drafts only in memory and measures total time through AI confirmation', async () => {
    let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const network = vi.fn(); vi.stubGlobal('fetch', network); const storage = vi.spyOn(Storage.prototype, 'setItem');
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => { clock = 7000; result(0, reading(0, true)); });
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => { clock = 12000; result(0, reading(0)); });
    const receive = vi.fn(); await readPhotosWithFallback([files[0]!], receive);
    expect(receive.mock.calls[0]![1].milliseconds).toBe(7000); expect(finals(receive)[0]![1].milliseconds).toBe(12000);
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });
});

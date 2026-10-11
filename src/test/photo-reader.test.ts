import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPhotosWithFallback } from '@/lib/photo-reader';
import type { readPrePhotos } from '@/lib/photo-ocr';

const mocks = vi.hoisted(() => ({ ai: vi.fn(), local: vi.fn(), loadLocal: vi.fn() }));
vi.mock('@/lib/photo-ai', () => ({ readAiPhotos: mocks.ai }));
vi.mock('@/lib/photo-ocr', () => { mocks.loadLocal(); return { readPrePhotos: mocks.local }; });
type OnResult = Parameters<typeof readPrePhotos>[1];
type OnProgress = NonNullable<Parameters<typeof readPrePhotos>[2]>;
type Result = Parameters<OnResult>[1];
type Success = Exclude<Result, { error: string }>;
const photo = (name: string) => new File(['synthetic image'], name, { type: 'image/jpeg' });
const files = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg'), photo('d.jpg')];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function reading(index: number, source: 'gemini' | 'local' = 'gemini'): Success {
  const ctc = String(index + 1).padStart(10, '0');
  return { text: `synthetic ${index}`, milliseconds: 20, pre: {
    kind: 'pre', id: `DI${String(index + 1).padStart(9, '0')}`, plate: 'ABC1D23', driver: 'MOTORISTA DE TESTE', ctcs: [ctc], readingSource: source,
    documents: [{ ctc, nf: `${100 + index}-1`, volumes: '3', client: 'LABORATÓRIO EXEMPLO', recipient: 'CLIENTE EXEMPLO', review: source === 'local' ? ['Confira os campos da leitura local.'] : [] }],
    headerReview: source === 'local' ? ['Leitura local: confira todos os campos.'] : [],
    verification: { status: source === 'local' ? 'unavailable' : 'matched', checkedFields: source === 'local' ? 0 : 9, conflicts: 0 },
  } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.ai.mockReset(); mocks.local.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('photo reader with local fallback', () => {
  it('does not load a reader or emit callbacks when already cancelled', async () => {
    const abort = new AbortController(); abort.abort();
    const receive = vi.fn(); const progress = vi.fn();
    await readPhotosWithFallback(files, receive, progress, abort.signal);
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.loadLocal).not.toHaveBeenCalled();
    expect(mocks.local).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it('preserves valid AI results immediately and retries only failed photos in original order with remapped progress', async () => {
    const gate = deferred(); const receive = vi.fn(); const progress = vi.fn(); const abort = new AbortController();
    const first = reading(2); const partial = reading(0);
    partial.pre.verification = { status: 'unavailable', checkedFields: 0, conflicts: 0 };
    partial.pre.headerReview = ['A segunda leitura não terminou.'];
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult, update: OnProgress) => {
      update(2, 'Conferindo IA'); result(2, first); result(3, { error: 'Quota Gemini' }); result(0, partial); result(1, { error: 'Gemini indisponível' });
      await gate.promise;
    });
    mocks.local.mockImplementation(async (_files: File[], result: OnResult, update: OnProgress) => {
      update(0, 'Lendo primeira foto local'); result(0, reading(1, 'local'));
      update(1, 'Lendo segunda foto local'); result(1, reading(3, 'local'));
    });
    const run = readPhotosWithFallback(files, receive, progress, abort.signal, true);
    await waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
    expect(receive.mock.calls.map(call => call[0])).toEqual([2, 0]);
    expect(receive.mock.calls[0]![1]).toBe(first);
    expect(receive.mock.calls[1]![1]).toBe(partial);
    expect(mocks.local).not.toHaveBeenCalled();
    gate.resolve(); await run;
    expect(mocks.local).toHaveBeenCalledOnce();
    expect(mocks.local.mock.calls[0]![0]).toEqual([files[1], files[3]]);
    expect(mocks.local.mock.calls[0]![3]).toBe(abort.signal);
    expect(mocks.local.mock.calls[0]![4]).toBe(true);
    expect(receive.mock.calls.map(call => call[0])).toEqual([2, 0, 1, 3]);
    expect(receive.mock.calls[2]![1].pre).toMatchObject({ readingSource: 'local', readingFallback: true, verification: { status: 'unavailable' } });
    expect(receive.mock.calls[2]![1].pre.documents[0].review).toContain('Confira os campos da leitura local.');
    expect(partial.pre.headerReview).toEqual(['A segunda leitura não terminou.']);
    expect(partial.pre).not.toHaveProperty('readingFallback');
    expect(progress).toHaveBeenCalledWith(2, 'Conferindo IA');
    expect(progress).toHaveBeenCalledWith(1, 'Leitura gratuita · Lendo primeira foto local');
    expect(progress).toHaveBeenCalledWith(3, 'Leitura gratuita · Lendo segunda foto local');
  });

  it('reads every photo in one local batch when AI daily quota fails active and queued photos', async () => {
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => { for (const index of [0, 2, 3, 1]) result(index, { error: 'Cota diária do Gemini esgotada.' }); });
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => { _files.forEach((_, index) => result(index, reading(index, 'local'))); });
    const receive = vi.fn();
    await readPhotosWithFallback(files, receive);
    expect(mocks.ai).toHaveBeenCalledOnce();
    expect(mocks.local).toHaveBeenCalledOnce();
    expect(mocks.local.mock.calls[0]![0]).toEqual(files);
    expect(receive.mock.calls.map(call => call[0])).toEqual([0, 1, 2, 3]);
    receive.mock.calls.forEach(([, result]) => expect(result.pre).toMatchObject({ readingSource: 'local', readingFallback: true, verification: { status: 'unavailable' } }));
  });

  it('shows why Gemini failed after a successful local fallback while hiding credentials', async () => {
    const apiKey = `AIza${'x'.repeat(35)}`;
    const jwt = 'eyJsynthetic.payload.signature';
    const cause = `Cota diária do Gemini esgotada; access_token=private-ai-token; ${apiKey}; Bearer private-authorization; ${jwt}`;
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: cause }));
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, reading(0, 'local')));
    const receive = vi.fn();
    await readPhotosWithFallback([files[0]!], receive);
    const result = receive.mock.calls[0]![1];
    expect(result.pre).toMatchObject({ readingSource: 'local', readingFallback: true, verification: { status: 'unavailable' } });
    expect(result.pre.headerReview).toContain('Leitura local: confira todos os campos.');
    const warning = result.pre.headerReview.find((message: string) => message.startsWith('Gemini:'));
    expect(warning).toContain('Gemini: Cota diária do Gemini esgotada');
    expect(warning).toContain('[credencial oculta]');
    for (const credential of [apiKey, jwt, 'private-ai-token', 'private-authorization']) expect(warning).not.toContain(credential);
    expect(result.pre.documents[0].ctc).toBe('0000000001');
  });

  it('does not replace successful AI drafts, including failed verification, with a local read', async () => {
    const partial = reading(0); partial.pre.verification = { status: 'review', checkedFields: 4, conflicts: 1 }; partial.pre.documents[0]!.review = ['Confira NF divergente.'];
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, partial));
    const receive = vi.fn();
    await readPhotosWithFallback([files[0]!], receive);
    expect(receive).toHaveBeenCalledExactlyOnceWith(0, partial);
    expect(mocks.local).not.toHaveBeenCalled();
  });

  it('propagates authentication/session exceptions without starting local OCR', async () => {
    const failure = new Error('Entre na sua conta para ler fotos.');
    mocks.ai.mockRejectedValue(failure);
    const receive = vi.fn();
    await expect(readPhotosWithFallback([files[0]!], receive)).rejects.toBe(failure);
    expect(mocks.local).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
  });

  it('respects fallback:false for permission failures while retrying other eligible photos', async () => {
    const denied = { error: 'Entre novamente na sua conta.', fallback: false };
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => { result(0, denied); result(1, { error: 'Gemini indisponível' }); });
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, reading(1, 'local')));
    const receive = vi.fn();
    await readPhotosWithFallback(files.slice(0, 2), receive);
    expect(receive.mock.calls[0]).toEqual([0, denied]);
    expect(mocks.local.mock.calls[0]![0]).toEqual([files[1]]);
    expect(receive.mock.calls.map(call => call[0])).toEqual([0, 1]);
  });

  it('does not start fallback or emit late AI callbacks after closing the import', async () => {
    const gate = deferred(); const abort = new AbortController(); const receive = vi.fn(); const progress = vi.fn();
    let send!: OnResult; let update!: OnProgress;
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult, onProgress: OnProgress) => { send = result; update = onProgress; await gate.promise; });
    const run = readPhotosWithFallback(files, receive, progress, abort.signal);
    await waitFor(() => expect(mocks.ai).toHaveBeenCalledOnce());
    send(0, { error: 'Gemini indisponível' });
    abort.abort(); const progressCount = progress.mock.calls.length;
    send(1, reading(1)); send(2, { error: 'Quota' }); update(2, 'Resposta tardia'); gate.resolve();
    await run;
    expect(mocks.local).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(progressCount);
  });

  it('ignores late local results and progress after cancellation', async () => {
    const gate = deferred(); const abort = new AbortController(); const receive = vi.fn(); const progress = vi.fn();
    let send!: OnResult; let update!: OnProgress;
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Quota' }));
    mocks.local.mockImplementation(async (_files: File[], result: OnResult, onProgress: OnProgress) => { send = result; update = onProgress; await gate.promise; });
    const run = readPhotosWithFallback([files[0]!], receive, progress, abort.signal);
    await waitFor(() => expect(mocks.local).toHaveBeenCalledOnce());
    abort.abort(); const progressCount = progress.mock.calls.length;
    send(0, reading(0, 'local')); send(0, { error: 'Erro tardio' }); update(0, 'Progresso tardio'); gate.resolve();
    await run;
    expect(receive).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(progressCount);
  });

  it('combines deliberate AI and local failures while hiding credentials', async () => {
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Gemini indisponível; access_token=private-ai-token' }));
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Falha no worker Bearer private-local-token' }));
    const receive = vi.fn();
    await readPhotosWithFallback([files[0]!], receive);
    expect(receive).toHaveBeenCalledOnce();
    const result = receive.mock.calls[0]![1];
    expect(result.fallback).toBe(false);
    expect(result.error).toContain('IA: Gemini indisponível');
    expect(result.error).toContain('Leitura gratuita: Falha no worker');
    expect(result.error).not.toContain('private-ai-token');
    expect(result.error).not.toContain('private-local-token');
  });

  it('keeps finished local drafts and resolves unfinished slots if the local worker throws', async () => {
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => { result(0, { error: 'Falha IA A' }); result(1, { error: 'Falha IA B' }); });
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => { result(0, reading(0, 'local')); throw new Error('internal api_key=do-not-show'); });
    const receive = vi.fn();
    await readPhotosWithFallback(files.slice(0, 2), receive);
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive.mock.calls[0]![1].pre).toMatchObject({ readingSource: 'local', readingFallback: true });
    expect(receive.mock.calls[1]![1].error).toContain('Falha IA B');
    expect(receive.mock.calls[1]![1].error).toContain('Não foi possível iniciar ou concluir o leitor no navegador');
    expect(receive.mock.calls[1]![1].error).not.toContain('do-not-show');
  });

  it('emits reviewable drafts without registering records or writing browser storage', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Quota' }));
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, reading(0, 'local')));
    const drafts: Success[] = [];
    await readPhotosWithFallback([files[0]!], (_, result) => { if (!('error' in result)) drafts.push(result); });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.pre.verification?.status).toBe('unavailable');
    expect(drafts[0]!.pre.documents[0]!.review).not.toEqual([]);
    expect(network).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it('always marks fallback output as local and unverified, even if its reader omitted that metadata', async () => {
    const unmarked = reading(0);
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Quota' }));
    mocks.local.mockImplementation(async (_files: File[], result: OnResult) => result(0, unmarked));
    const receive = vi.fn();
    await readPhotosWithFallback([files[0]!], receive);
    const result = receive.mock.calls[0]![1];
    expect(result.pre).toMatchObject({ readingSource: 'local', readingFallback: true, verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 } });
    expect(result.pre.headerReview.length).toBeGreaterThan(0);
    expect(result.pre.documents[0].review.length).toBeGreaterThan(0);
    expect(unmarked.pre.readingSource).toBe('gemini');
    expect(unmarked.pre.verification?.status).toBe('matched');
  });

  it('resolves an unfinished local slot with its AI cause instead of leaving the photo in the queue', async () => {
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult) => result(0, { error: 'Gemini sem cota' }));
    mocks.local.mockResolvedValue(undefined);
    const receive = vi.fn();
    await readPhotosWithFallback([files[0]!], receive);
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0]![1].error).toContain('IA: Gemini sem cota');
    expect(receive.mock.calls[0]![1].error).toContain('O leitor terminou sem retornar os dados desta foto');
  });

  it('reports AI plus local queue time for fallback photos while leaving valid AI timing unchanged', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const valid = reading(2); valid.milliseconds = 19;
    mocks.ai.mockImplementation(async (_files: File[], result: OnResult, progress: OnProgress) => {
      clock = 1000; progress(0, 'Primeira leitura A');
      clock = 2000; progress(1, 'Primeira leitura B');
      clock = 3000; progress(2, 'Primeira leitura C');
      clock = 20000; progress(0, 'Segunda etapa A');
      clock = 46000; result(0, { error: 'Quota A' });
      clock = 47000; result(1, { error: 'Quota B' });
      clock = 48000; result(2, valid);
      clock = 49000; result(3, { error: 'Foto na fila sem progresso anterior' });
    });
    mocks.local.mockImplementation(async (_files: File[], result: OnResult, progress: OnProgress) => {
      clock = 63000; progress(0, 'OCR A'); clock = 64000; result(0, reading(0, 'local'));
      clock = 80000; progress(1, 'OCR B'); clock = 82000; result(1, reading(1, 'local'));
      clock = 99000; progress(2, 'OCR D'); clock = 100000; result(2, reading(3, 'local'));
    });
    const receive = vi.fn();
    await readPhotosWithFallback(files, receive);
    const results = new Map(receive.mock.calls.map(([index, result]) => [index, result]));
    expect(results.get(0).milliseconds).toBe(63000);
    expect(results.get(1).milliseconds).toBe(80000);
    expect(results.get(3).milliseconds).toBe(51000);
    expect(results.get(2)).toBe(valid);
    expect(results.get(2).milliseconds).toBe(19);
  });
});

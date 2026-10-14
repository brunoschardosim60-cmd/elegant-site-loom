import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestAiPhoto } from '@/lib/photo-ai-request';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/photo-reader.functions', () => ({ readPhotoWithGemini: read }));
const input = { data: { data: 'image', mimeType: 'image/jpeg' as const, accessToken: 'test-token' } };
beforeEach(() => {
  read.mockReset(); vi.useFakeTimers();
  vi.stubGlobal('AbortSignal', {
    timeout: (ms: number) => { const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), ms); return controller.signal; },
    any: (signals: AbortSignal[]) => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    },
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([true, false])('does not repeat a failed AI request even when retryable=%s', async retryable => {
  const failure = { ok: false, retryable, error: 'Gemini indisponível.' };
  read.mockResolvedValue(failure);
  expect(await requestAiPhoto(input)).toBe(failure);
  expect(read).toHaveBeenCalledOnce();
  expect(read.mock.calls[0]?.[0].data).toBe(input.data);
});
it('does not send a cancelled photo', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(requestAiPhoto({ ...input, signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError');
  expect(read).not.toHaveBeenCalled();
});
it.each([['full', 22000], ['full-lite', 27000], ['verify', 12000]] as const)('limits a stalled %s request to %sms and aborts the underlying call', async (mode, budget) => {
  read.mockImplementation(() => new Promise(() => {}));
  let finished = false;
  const run = requestAiPhoto({ data: { ...input.data, mode } }).then(result => { finished = true; return result; });
  await vi.advanceTimersByTimeAsync(budget - 1);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await run).toMatchObject({ ok: false, unavailable: true, retryable: false, error: `A IA excedeu o limite de ${budget / 1000} s; a leitura local pode ser usada.` });
  expect(read.mock.calls[0]?.[0].signal.aborted).toBe(true);
  expect(read).toHaveBeenCalledOnce();
});
it('returns a safe fallback reason after a network exception', async () => {
  read.mockRejectedValue(new Error('internal api_key=private-test-key'));
  const result = await requestAiPhoto(input);
  expect(result).toMatchObject({ ok: false, unavailable: true, retryable: false });
  expect('error' in result && result.error).not.toContain('private-test-key');
});
it('propagates cancellation immediately and never emits a timeout fallback for a closed dialog', async () => {
  read.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const run = requestAiPhoto({ ...input, signal: controller.signal });
  const rejected = expect(run).rejects.toHaveProperty('name', 'AbortError');
  controller.abort();
  await rejected;
  expect(read.mock.calls[0]?.[0].signal.aborted).toBe(true);
  expect(read).toHaveBeenCalledOnce();
});

import { beforeEach, expect, it, vi } from 'vitest';
import { requestAiPhoto } from '@/lib/photo-ai-request';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/photo-reader.functions', () => ({ readPhotoWithGemini: read }));
const input = { data: { data: 'image', mimeType: 'image/jpeg' as const, accessToken: 'test-token' } };
beforeEach(() => read.mockReset());
it('retries a transient error once with the same photo and returns the second result', async () => {
  read.mockResolvedValueOnce({ ok: false, retryable: true }).mockResolvedValueOnce({ ok: true });
  const progress = vi.fn();
  expect(await requestAiPhoto(input, progress)).toEqual({ ok: true });
  expect(read).toHaveBeenCalledTimes(2); expect(read.mock.calls[1]?.[0]).toBe(input); expect(progress).toHaveBeenCalledOnce();
});
it('does not retry credential/quota errors or a canceled photo', async () => {
  read.mockResolvedValue({ ok: false, retryable: false });
  await requestAiPhoto(input); expect(read).toHaveBeenCalledOnce();
  read.mockReset().mockResolvedValue({ ok: false, retryable: true });
  const controller = new AbortController(); controller.abort();
  await requestAiPhoto({ ...input, signal: controller.signal }); expect(read).toHaveBeenCalledOnce();
});
it('stops after two transient failures', async () => {
  read.mockResolvedValue({ ok: false, retryable: true });
  expect(await requestAiPhoto(input)).toEqual({ ok: false, retryable: true });
  expect(read).toHaveBeenCalledTimes(2);
});

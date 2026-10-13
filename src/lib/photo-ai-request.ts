import { readPhotoWithGemini } from './photo-reader.functions';

// Include upload and server/auth overhead in the browser's limit. Provider
// limits are slightly shorter. Quota fallback is coordinated by photo-ai;
// this function makes only one request and preserves cancellation.
export async function requestAiPhoto(input: Parameters<typeof readPhotoWithGemini>[0]) {
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException('Leitura cancelada.', 'AbortError');
  const timeoutMs = input.data.mode === 'verify' || input.data.mode === 'full-lite' ? 12000 : input.data.mode === 'survey' || input.data.orientationOnly ? 10000 : 22000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let rejectAborted!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const onAbort = () => rejectAborted(signal.reason ?? new DOMException('Leitura cancelada.', 'AbortError'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([readPhotoWithGemini({ ...input, signal }), aborted]);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return { ok: false as const, unavailable: true as const, retryable: false as const, error: timeout.aborted
      ? `O Gemini excedeu o limite de ${timeoutMs / 1000} s; a leitura local pode ser usada.`
      : 'Não foi possível conectar ao Gemini. A leitura local pode ser usada para esta foto.' };
  } finally { signal.removeEventListener('abort', onAbort); }
}

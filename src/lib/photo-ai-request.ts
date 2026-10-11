import { readPhotoWithGemini } from './photo-reader.functions';

// Retry only transient provider failures, once, without redoing orientation
// or asking a cheaper model to guess the document's numbers.
export async function requestAiPhoto(input: Parameters<typeof readPhotoWithGemini>[0], onRetry?: () => void) {
  const result = await readPhotoWithGemini(input);
  if (!result.ok && 'retryable' in result && result.retryable && !input.signal?.aborted) {
    onRetry?.();
    return readPhotoWithGemini(input);
  }
  return result;
}

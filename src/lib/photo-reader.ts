import { readAiPhotos } from './photo-ai';
import { markLocalPhoto } from './local-photo';

type LocalReader = typeof import('./photo-ocr').readPrePhotos;
type OnResult = Parameters<LocalReader>[1];
type OnProgress = NonNullable<Parameters<LocalReader>[2]>;

function safeCause(message: string): string {
  return message
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[credencial oculta]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[credencial oculta]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|secret)[\s"'=:]+)(?:Bearer\s+)?[^\s,;"'}]+/gi, '$1[credencial oculta]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credencial oculta]')
    .trim().slice(0, 500) || 'Falha na leitura.';
}

/** Keeps valid AI drafts and retries only unread photos in one local OCR batch. */
export async function readPhotosWithFallback(files: File[], onResult: OnResult, onProgress: OnProgress = () => {}, signal?: AbortSignal, detailed = false) {
  if (signal?.aborted || !files.length) return;
  const failures = new Map<number, string>();
  const completed = new Set<number>();
  const startedAt = new Map<number, number>();
  const trackStart = (index: number) => { if (!startedAt.has(index)) startedAt.set(index, performance.now()); };
  // Authentication/session failures intentionally propagate. A local retry must
  // never disguise an account or permission failure as a successful AI read.
  await readAiPhotos(files, (index, result) => {
    if (signal?.aborted || completed.has(index)) return;
    if ('error' in result && result.fallback !== false) {
      trackStart(index);
      failures.set(index, result.error);
      onProgress(index, 'Preparando leitura gratuita no navegador…');
    } else {
      failures.delete(index); completed.add(index);
      onResult(index, result);
    }
  }, (index, message) => { if (!signal?.aborted && !completed.has(index)) { trackStart(index); onProgress(index, message); } }, signal);
  if (signal?.aborted || !failures.size) return;

  const retries = [...failures].sort(([a], [b]) => a - b).map(([index, cause]) => ({ index, cause }));
  const pending = new Map(retries.map(item => [item.index, item.cause]));
  const finishError = (index: number, cause: string, localError: string) => {
    if (signal?.aborted || !pending.has(index)) return;
    pending.delete(index);
    onResult(index, { error: `IA: ${safeCause(cause)} Leitura gratuita: ${safeCause(localError)}`, fallback: false });
  };
  try {
    const { readPrePhotos } = await import('./photo-ocr');
    if (signal?.aborted) return;
    await readPrePhotos(retries.map(item => files[item.index]!), (localIndex, result) => {
      const item = retries[localIndex];
      if (signal?.aborted || !item || !pending.has(item.index)) return;
      if ('error' in result) finishError(item.index, item.cause, result.error);
      else {
        pending.delete(item.index);
        const milliseconds = Math.max(0, Math.round(performance.now() - startedAt.get(item.index)!));
        onResult(item.index, { ...result, milliseconds, pre: { ...markLocalPhoto(result.pre), readingFallback: true } });
      }
    }, (localIndex, message) => {
      const item = retries[localIndex];
      if (!signal?.aborted && item && pending.has(item.index)) onProgress(item.index, `Leitura gratuita · ${message}`);
    }, signal, detailed);
    for (const [index, cause] of pending) finishError(index, cause, 'O leitor terminou sem retornar os dados desta foto. Tente novamente.');
  } catch {
    // Unexpected loader/worker exceptions may contain URLs or internals. Only
    // the reader's deliberate user-facing failures are included verbatim.
    for (const [index, cause] of pending) finishError(index, cause, 'Não foi possível iniciar ou concluir o leitor no navegador. Tente novamente.');
  }
}

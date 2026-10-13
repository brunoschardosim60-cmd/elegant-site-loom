import { readAiPhotos } from './photo-ai';
import { markLocalPhoto } from './local-photo';
import { correctLocalPhoto } from './photo-local-correction';
import type { PhotoAngle } from './photo-orientation';

type LocalReader = typeof import('./photo-ocr').readPrePhotos;
type LocalResult = Parameters<Parameters<LocalReader>[1]>[1];
type Success = Exclude<LocalResult, { error: string }>;
export type PhotoReadResult = (Success & { pendingVerification?: boolean; angle?: PhotoAngle }) | Extract<LocalResult, { error: string }>;
type OnResult = (index: number, result: PhotoReadResult) => void;
type OnProgress = NonNullable<Parameters<LocalReader>[2]>;

function safeCause(message: string): string {
  return message
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[credencial oculta]')
    .replace(/\bAQ\.[A-Za-z0-9_-]{20,}\b/g, '[credencial oculta]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[credencial oculta]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|secret)[\s"'=:]+)(?:Bearer\s+)?[^\s,;"'}]+/gi, '$1[credencial oculta]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credencial oculta]')
    .trim().slice(0, 500) || 'Falha na leitura.';
}

/** Return promptly even when a decoder/worker does not settle after abort. */
async function untilCancelled(task: Promise<unknown>, signal?: AbortSignal): Promise<void> {
  if (!signal) { await task; return; }
  if (signal.aborted) return;
  let cancel!: () => void;
  const stopped = new Promise<void>(resolve => { cancel = resolve; signal.addEventListener('abort', cancel, { once: true }); });
  try { await Promise.race([task, stopped]); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Local OCR fills the draft first. One independent AI read corrects it by CTC.
 * AI checks overlap the next local photo, with at most two requests in flight.
 * No photo/draft is stored or registered here; stopping retains only UI drafts.
 */
export async function readPhotosWithFallback(files: File[], onResult: OnResult, onProgress: OnProgress = () => {}, signal?: AbortSignal, detailed = false) {
  if (signal?.aborted || !files.length) return;
  const started = performance.now();
  const local = new Map<number, PhotoReadResult>();
  const finished = new Set<number>();
  const queued = new Set<number>();
  const queue: number[] = [];
  const tasks = new Set<Promise<void>>();
  const progress = (index: number, message: string) => { if (!signal?.aborted && !finished.has(index)) onProgress(index, message); };
  const deliver = (index: number, result: PhotoReadResult) => {
    if (signal?.aborted || finished.has(index)) return;
    finished.add(index); onResult(index, result);
  };
  const elapsed = () => Math.max(0, Math.round(performance.now() - started));
  const fallback = (index: number, cause: string) => {
    const reading = local.get(index);
    if (!reading || 'error' in reading) {
      deliver(index, { error: `IA: ${safeCause(cause)} Leitura gratuita: ${safeCause(reading && 'error' in reading ? reading.error : 'Não foi possível concluir a leitura local.')}`, fallback: false });
      return;
    }
    const pre = markLocalPhoto(reading.pre);
    deliver(index, { ...reading, milliseconds: elapsed(), pendingVerification: false, pre: {
      ...pre, readingFallback: true,
      headerReview: [...new Set([...(pre.headerReview ?? []), `Gemini: ${safeCause(cause)}`])],
    } });
  };
  const check = async (index: number) => {
    if (signal?.aborted) return;
    const reading = local.get(index);
    const angle = reading && !('error' in reading) ? reading.angle : undefined;
    progress(index, 'Conferindo e corrigindo os dados pela IA…');
    try {
      await readAiPhotos([files[index]!], (_position, result) => {
        if (signal?.aborted || finished.has(index)) return;
        if ('error' in result) {
          if ('fallback' in result && result.fallback === false && /Entre .*conta|sess[aã]o|autentica/i.test(result.error)) deliver(index, { error: safeCause(result.error), fallback: false });
          else fallback(index, result.error);
        } else {
          const pre = reading && !('error' in reading) ? correctLocalPhoto(reading.pre, result.pre) : result.pre;
          deliver(index, { ...result, pre, text: JSON.stringify(pre, null, 2), milliseconds: elapsed(), pendingVerification: false });
        }
      }, (_position, message) => progress(index, message), signal, { singlePass: true, quotaFallback: true, ...(angle !== undefined ? { orientations: [angle] } : {}) });
      if (!finished.has(index) && !signal?.aborted) fallback(index, 'A conferência por IA terminou sem retornar os dados.');
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof Error && /Entre .*conta|sess[aã]o|autentica/i.test(error.message)) deliver(index, { error: safeCause(error.message), fallback: false });
      else fallback(index, 'Não foi possível concluir a conferência por IA.');
    }
  };
  const pump = () => {
    while (!signal?.aborted && queue.length && tasks.size < 2) {
      const index = queue.shift()!;
      const task = check(index).finally(() => { tasks.delete(task); pump(); });
      tasks.add(task);
    }
  };
  const enqueue = (index: number) => {
    if (queued.has(index) || signal?.aborted) return;
    queued.add(index); queue.push(index); pump();
  };
  const localAbort = new AbortController();
  const stopLocal = () => localAbort.abort();
  signal?.addEventListener('abort', stopLocal, { once: true });
  // A local worker that stays silent for 20 s is stopped; AI then recovers the photo.
  let stall: ReturnType<typeof setTimeout> | undefined;
  const alive = () => { clearTimeout(stall); stall = setTimeout(stopLocal, 20000); };
  alive();
  try {
    const { readPrePhotos } = await import('./photo-ocr');
    if (signal?.aborted) return;
    await untilCancelled(readPrePhotos(files, (index, result) => {
      if (signal?.aborted || localAbort.signal.aborted || local.has(index) || !files[index]) return;
      local.set(index, result); alive();
      if (!('error' in result)) onResult(index, { ...result, pre: markLocalPhoto(result.pre), milliseconds: elapsed(), pendingVerification: true });
      enqueue(index);
    }, (index, message) => { if (!localAbort.signal.aborted) alive(); if (!localAbort.signal.aborted) progress(index, `Leitura local · ${message}`); }, localAbort.signal, detailed), localAbort.signal);
  } catch { /* AI may recover photos that the local worker could not decode. */ }
  finally { clearTimeout(stall); signal?.removeEventListener('abort', stopLocal); }
  if (signal?.aborted) return;
  for (const index of files.keys()) {
    if (!local.has(index)) local.set(index, { error: 'Não foi possível iniciar ou concluir o leitor no navegador. Tente novamente; a foto será mantida na lista.' });
    enqueue(index);
  }
  while (tasks.size && !signal?.aborted) await untilCancelled(Promise.race(tasks), signal);
}

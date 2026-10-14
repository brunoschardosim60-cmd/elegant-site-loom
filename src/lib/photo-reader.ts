import { readAiPhotos } from './photo-ai';
import { markLocalPhoto } from './local-photo';
import type { PhotoAngle } from './photo-orientation';

type LocalReader = typeof import('./photo-ocr').readPrePhotos;
type LocalResult = Parameters<Parameters<LocalReader>[1]>[1];
type Success = Exclude<LocalResult, { error: string }>;
export type PhotoReadResult = (Success & { pendingVerification?: boolean; angle?: PhotoAngle }) | Extract<LocalResult, { error: string }>;
type OnResult = (index: number, result: PhotoReadResult) => void;
type OnProgress = NonNullable<Parameters<LocalReader>[2]>;
export const PHOTO_READING_TARGET_MS = 15000;
export const PHOTO_READING_BUDGET_MS = 45000;
const aiBudgetMs = 27000;

function safeCause(message: string): string {
  return message
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[credencial oculta]')
    .replace(/\bAQ\.[A-Za-z0-9_-]{20,}\b/g, '[credencial oculta]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[credencial oculta]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|secret)[\s"'=:]+)(?:Bearer\s+)?[^\s,;"'}]+/gi, '$1[credencial oculta]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credencial oculta]')
    .trim().slice(0, 500) || 'Falha na leitura.';
}

/** Settle promptly even when a decoder, worker or network request ignores abort. */
async function untilCancelled(task: Promise<unknown>, signal: AbortSignal): Promise<void> {
  const observed = task.catch(() => {});
  if (signal.aborted) return;
  let cancel!: () => void;
  const stopped = new Promise<void>(resolve => { cancel = resolve; signal.addEventListener('abort', cancel, { once: true }); });
  try { await Promise.race([observed, stopped]); }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Flash Lite first. Fifteen seconds is a progress target, not cancellation.
 * Separate technical deadlines protect against stalled requests/workers.
 * Two photos run concurrently; queue waiting is separate from processing.
 */
export async function readPhotosWithFallback(files: File[], onResult: OnResult, onProgress: OnProgress = () => {}, signal?: AbortSignal, detailed = false) {
  if (signal?.aborted || !files.length) return;
  let next = 0;
  const read = async (index: number) => {
    const started = performance.now(), photo = new AbortController();
    const stop = () => photo.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, PHOTO_READING_BUDGET_MS);
    let delivered = false;
    const active = () => !delivered && !photo.signal.aborted && !signal?.aborted;
    const progress = (message: string) => { if (active()) onProgress(index, message); };
    const targetTimer = setTimeout(() => progress('Esta foto está levando mais tempo. Continuamos lendo; você pode usar Parar.'), PHOTO_READING_TARGET_MS);
    const deliver = (result: PhotoReadResult) => {
      if (delivered || signal?.aborted) return;
      delivered = true;
      onResult(index, 'error' in result ? result : { ...result, milliseconds: Math.round(performance.now() - started), pendingVerification: false });
      photo.abort();
    };
    let cause = 'O Flash Lite não concluiu a leitura.';
    try {
      const ai = new AbortController();
      const stopAi = () => ai.abort();
      photo.signal.addEventListener('abort', stopAi, { once: true });
      const aiTimer = setTimeout(stopAi, aiBudgetMs);
      try {
        progress('Lendo a foto pelo Flash Lite…');
        await untilCancelled((async () => {
          try {
            await readAiPhotos([files[index]!], (_position, result) => {
              if (!active() || ai.signal.aborted) return;
              if ('error' in result) {
                cause = safeCause(result.error);
                if ('fallback' in result && result.fallback === false) deliver({ error: cause, fallback: false });
                else ai.abort();
              } else if (result.pre.kind === 'unknown' || !result.pre.documents.some(row => /^\d{10}$/.test(row.ctc))) {
                cause = 'A IA não identificou o documento e seus CTCs. Pontos ilegíveis precisam de revisão.';
                ai.abort();
              } else deliver(result);
            }, (_position, message) => { if (!ai.signal.aborted) progress(message); }, ai.signal, {
              singlePass: true, quotaFallback: true, preferredModel: 'lite', orientations: [0],
            });
          } catch (error) {
            if (!active() || ai.signal.aborted) return;
            cause = safeCause(error instanceof Error ? error.message : 'Não foi possível conectar ao Flash Lite.');
            if (/Entre .*conta|sess[aã]o|autentica/i.test(cause)) deliver({ error: cause, fallback: false });
          }
        })(), ai.signal);
        if (ai.signal.aborted && active() && cause === 'O Flash Lite não concluiu a leitura.') cause = 'O Flash Lite não respondeu dentro do prazo de segurança. Leitura local de reserva acionada.';
      } finally {
        clearTimeout(aiTimer); photo.signal.removeEventListener('abort', stopAi); ai.abort();
      }
      if (!active()) return;
      progress('IA indisponível · lendo no navegador…');
      await untilCancelled((async () => {
        try {
          const { readPrePhotos } = await import('./photo-ocr');
          if (!active()) return;
          await readPrePhotos([files[index]!], (_position, result) => {
            if (!active()) return;
            if ('error' in result) deliver({ error: `IA: ${safeCause(cause)} Leitura gratuita: ${safeCause(result.error)}`, fallback: false });
            else {
              const pre = markLocalPhoto(result.pre);
              deliver({ ...result, pre: { ...pre, readingFallback: true, headerReview: [...new Set([...(pre.headerReview ?? []), `Gemini: ${safeCause(cause)}`])] } });
            }
          }, (_position, message) => progress(`Leitura local de reserva · ${message}`), photo.signal, detailed);
        } catch { if (active()) deliver({ error: `IA: ${safeCause(cause)} Não foi possível iniciar o leitor local. Tente novamente esta foto.`, fallback: false }); }
      })(), photo.signal);
      if (active()) deliver({ error: `IA: ${safeCause(cause)} O leitor local terminou sem retornar dados. Tente novamente esta foto.`, fallback: false });
    } finally {
      clearTimeout(timer); clearTimeout(targetTimer); signal?.removeEventListener('abort', stop);
      if (!delivered && !signal?.aborted) deliver({ error: 'Esta foto excedeu o tempo de segurança. Ela permanece na lista: tente novamente ou selecione Leitura no navegador. Nenhum cadastro foi feito.', fallback: false });
      photo.abort();
    }
  };
  const worker = async () => {
    while (next < files.length && !signal?.aborted) await read(next++);
  };
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
}

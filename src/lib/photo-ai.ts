import { requestAiPhoto } from './photo-ai-request';
import { getSupabaseClient } from './supabase-client';
import { needsPhotoVerification, reconcilePhotoRead } from './photo-verification';
import { getPhotoProviderBlock, rememberPhotoProviderBlock } from './photo-provider-block';
import { detectPhotoOrientations, type PhotoAngle } from './photo-orientation';
import type { PhotoFields } from './photo-fields';

type ProviderFailure = Extract<Awaited<ReturnType<typeof requestAiPhoto>>, { ok: false }>;
type ProviderStage = 'full' | 'lite' | 'verify';
export type PhotoAiOptions = { orientations?: readonly PhotoAngle[]; singlePass?: boolean; quotaFallback?: boolean };
const temporaryBlocks = new Map<string, { until: number; result: ProviderFailure }>();
const providerCooldown = 2 * 60 * 1000;
// Full reading and verification use different models and quota buckets.
// This version also ignores quotas cached before Flash became the full reader
// and Lite became the optional verifier; those stage buckets were reversed.
const providerScope = (userId: string, stage: ProviderStage) => `${userId}:photo-model-stages-v3:${stage}`;
const verificationQuotaMessage = 'A cota diária da conferência adicional esgotou. A leitura completa foi mantida; confira os campos sinalizados.';
const verificationUnavailableMessage = 'A conferência adicional está temporariamente indisponível. A leitura completa foi mantida; confira os campos sinalizados.';
const isQuotaFailure = (failure: ProviderFailure) => 'quota' in failure;
const canUseLite = (failure: ProviderFailure) => !('fallback' in failure && failure.fallback === false) && (isQuotaFailure(failure) || ('tryLite' in failure && failure.tryLite === true));
const fullFailureReason = (failure: ProviderFailure) => isQuotaFailure(failure) ? 'O Gemini normal atingiu a cota.' : 'O Gemini normal ficou indisponível.';

function stageFailure(stage: ProviderStage, failure: ProviderFailure): ProviderFailure {
  if (stage !== 'verify') return failure;
  if ('quota' in failure && failure.quota === 'daily') return { ...failure, error: verificationQuotaMessage };
  if ('unavailable' in failure && failure.unavailable === true) return { ok: false, unavailable: true, retryable: false, error: verificationUnavailableMessage };
  return failure;
}

/** Decode once; an optional second reading reuses the same source pixels. */
function photoPayload(image: ImageBitmap, rotation = 0, detail = false, maxSize = 2600) {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  const swap = rotation === 90 || rotation === 270;
  canvas.width = Math.round((swap ? image.height : image.width) * scale);
  canvas.height = Math.round((swap ? image.width : image.height) * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível abrir a imagem.');
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(rotation * Math.PI / 180);
  context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
  const data = canvas.toDataURL('image/jpeg', .92).split(',')[1]!;
  if (data.length > 2800000) throw new Error('Foto muito grande. Recorte o documento e tente novamente.');
  if (detail) {
    const crop = document.createElement('canvas'); crop.width = canvas.width; crop.height = Math.round(canvas.height * .65);
    crop.getContext('2d')!.drawImage(canvas, 0, 0);
    const zoom = crop.toDataURL('image/jpeg', .95).split(',')[1]!;
    return { data, mimeType: 'image/jpeg' as const, ...(zoom.length <= 1000000 ? { detail: zoom } : {}) };
  }
  return { data, mimeType: 'image/jpeg' as const };
}

export async function readAiPhotos(files: File[], onResult: Parameters<typeof import('./photo-ocr').readPrePhotos>[1], onProgress: Parameters<typeof import('./photo-ocr').readPrePhotos>[2], signal?: AbortSignal, options: PhotoAiOptions = {}) {
  if (signal?.aborted) return;
  const sessionRequest = getSupabaseClient().then(client => client.auth.getSession());
  let stopSessionWait = () => {};
  const interruptedSession = new Promise<undefined>(resolve => { stopSessionWait = () => resolve(undefined); });
  signal?.addEventListener('abort', stopSessionWait, { once: true });
  if (signal?.aborted) stopSessionWait();
  let auth: Awaited<typeof sessionRequest> | undefined;
  try {
    auth = await Promise.race([sessionRequest, interruptedSession]);
  } catch (error) {
    if (signal?.aborted) return;
    throw error;
  } finally {
    signal?.removeEventListener('abort', stopSessionWait);
  }
  if (signal?.aborted || !auth) return;
  const { data: { session } } = auth;
  if (!session) throw new Error('Entre na sua conta para ler fotos.');
  const accessToken = session.access_token;
  const userId = session.user.id;
  const now = Date.now();
  for (const [id, block] of temporaryBlocks) if (block.until <= now) temporaryBlocks.delete(id);
  let next = 0;
  const stageBlock = (stage: ProviderStage) => {
    const scope = providerScope(userId, stage);
    const result = getPhotoProviderBlock(scope) ?? temporaryBlocks.get(scope)?.result;
    return result && stageFailure(stage, result);
  };
  const providerBlocks: Record<ProviderStage, ProviderFailure | undefined> = { full: stageBlock('full'), lite: stageBlock('lite'), verify: stageBlock('verify') };
  const getBlockedError = () => {
    const full = providerBlocks.full;
    if (!full || !options.quotaFallback || !canUseLite(full)) return full;
    const lite = providerBlocks.lite;
    return lite ? { ...lite, error: `${fullFailureReason(full)} Flash Lite: ${lite.error}` } : undefined;
  };
  const initialBlock = getBlockedError();
  if (initialBlock) {
    for (const index of files.keys()) {
      if (signal?.aborted) return;
      onProgress?.(index, 'quota' in initialBlock && initialBlock.quota === 'daily' ? 'Cota diária esgotada · usando o leitor gratuito…' : 'Gemini temporariamente indisponível · usando o leitor gratuito…');
      onResult(index, { error: initialBlock.error });
    }
    return;
  }
  const preparationStarted = performance.now();
  let orientations: readonly PhotoAngle[] = options.orientations ?? [];
  if (!options.orientations) {
    try {
      orientations = await detectPhotoOrientations(files, (index, message) => { if (!signal?.aborted) onProgress?.(index, message); }, signal);
    } catch { /* An unavailable orientation worker must not prevent AI reading. */ }
  }
  if (signal?.aborted) return;
  const preparationMilliseconds = performance.now() - preparationStarted;
  const providerAwareRequest = async (input: Parameters<typeof requestAiPhoto>[0]) => {
    input.signal?.throwIfAborted();
    const stage: ProviderStage = input.data.mode === 'verify' ? 'verify' : input.data.mode === 'full-lite' ? 'lite' : 'full';
    const scope = providerScope(userId, stage);
    // A failure in one model must never block the other model's quota bucket.
    // Keep valid full data even when its optional verification is unavailable.
    if (providerBlocks[stage]) return providerBlocks[stage];
    const result = await requestAiPhoto(input);
    input.signal?.throwIfAborted();
    if (!result.ok) rememberPhotoProviderBlock(scope, result);
    if (!result.ok && isQuotaFailure(result) && options.quotaFallback && stage !== 'verify') {
      // A known normal quota selects Lite without another normal request. A
      // Lite quota selects local OCR. Minute/unknown limits get a short pause;
      // daily metadata already expires at the provider's midnight.
      if (!('quota' in result && result.quota === 'daily')) temporaryBlocks.set(scope, { until: Date.now() + 60000, result });
      return providerBlocks[stage] = result;
    }
    if (!result.ok && 'unavailable' in result && result.unavailable === true) temporaryBlocks.set(scope, { until: Date.now() + providerCooldown, result: stageFailure(stage, { ok: false, unavailable: true, ...('tryLite' in result && result.tryLite ? { tryLite: true } : {}), retryable: false, error: 'Gemini temporariamente indisponível. A leitura local permanece disponível enquanto o serviço se recupera.' }) });
    if (!result.ok && (('quota' in result && result.quota === 'daily') || ('unavailable' in result && result.unavailable === true))) return providerBlocks[stage] = stageFailure(stage, result);
    return result;
  };
  const worker = async () => {
    while (next < files.length && !signal?.aborted && !getBlockedError()) {
      const index = next++;
      const file = files[index]!;
      const start = performance.now() - preparationMilliseconds;
      const orientation = orientations[index] ?? 0;
      const deadline = AbortSignal.timeout(35000);
      const photoSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let image: ImageBitmap | undefined;
      let completedPhoto: PhotoFields | undefined;
      const progress = (message: string) => { if (!photoSignal.aborted) onProgress?.(index, message); };
      try {
        progress('Lendo todas as linhas e laboratórios…');
        image = await createImageBitmap(file);
        if (photoSignal.aborted) throw new Error('Leitura interrompida.');
        const payload = photoPayload(image, orientation);
        let full = await providerAwareRequest({ data: { ...payload, accessToken, mode: 'full' }, signal: photoSignal });
        let usedLite = false;
        let normalFailure = '';
        if (options.quotaFallback && !full.ok && canUseLite(full) && !photoSignal.aborted) {
          usedLite = true; normalFailure = fullFailureReason(full);
          progress(isQuotaFailure(full) ? 'Cota do Gemini normal atingida · conferindo pelo Flash Lite…' : 'Gemini normal indisponível · conferindo pelo Flash Lite…');
          full = await providerAwareRequest({ data: { ...payload, accessToken, mode: 'full-lite' }, signal: photoSignal });
        }
        if (full.ok) completedPhoto = { ...full.pre, aiReader: usedLite ? 'lite' : 'normal', verification: { status: 'single', checkedFields: 0, conflicts: 0 } };
        if (photoSignal.aborted) throw new Error('Leitura interrompida.');
        if (!full.ok) { if (!signal?.aborted) onResult(index, { error: usedLite ? `${normalFailure} Flash Lite: ${full.error}` : full.error, ...('fallback' in full && full.fallback === false ? { fallback: false } : {}) }); continue; }
        let pre = completedPhoto!;
        if (!options.singlePass && needsPhotoVerification(full.pre)) {
          if (!providerBlocks.verify) progress('Conferindo campos sinalizados em uma segunda leitura…');
          // Keep the whole page so every CTC retains its NF, quantities and names.
          const check = providerBlocks.verify ?? await providerAwareRequest({ data: { ...photoPayload(image, (orientation + full.rotation) % 360, full.pre.kind === 'pre'), accessToken, mode: 'verify' }, signal: photoSignal });
          if (photoSignal.aborted) throw new Error('Leitura interrompida.');
          pre = reconcilePhotoRead(pre, check.ok ? check.check : null);
          completedPhoto = pre;
          if (!check.ok) pre.headerReview = [...(pre.headerReview ?? []), check.error];
        }
        if (!signal?.aborted) onResult(index, { pre, text: JSON.stringify(pre, null, 2), milliseconds: performance.now() - start });
      } catch (error) {
        if (!signal?.aborted) {
          if (completedPhoto) {
            const pre: PhotoFields = { ...completedPhoto, headerReview: [...(completedPhoto.headerReview ?? []), 'A conferência adicional não terminou. Confira os campos sinalizados antes de cadastrar.'], verification: { status: 'review', checkedFields: completedPhoto.verification?.checkedFields ?? 0, conflicts: completedPhoto.verification?.conflicts ?? 0 } };
            onResult(index, { pre, text: JSON.stringify(pre, null, 2), milliseconds: performance.now() - start });
          } else onResult(index, { error: deadline.aborted ? 'Esta foto excedeu o tempo de leitura. Tente novamente só ela ou envie um recorte mais próximo.' : error instanceof Error && ['Não foi possível abrir a imagem.', 'Foto muito grande. Recorte o documento e tente novamente.'].includes(error.message) ? error.message : 'Não foi possível concluir a leitura por IA desta foto. A leitura local pode ser usada.' });
        }
      } finally {
        image?.close();
        // Resolve every waiting slot once, with its original index. Already
        // running workers retain their own result and can finish normally.
        const blocked = getBlockedError();
        while (blocked && next < files.length && !signal?.aborted) onResult(next++, { error: blocked.error, ...('fallback' in blocked && blocked.fallback === false ? { fallback: false } : {}) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
}

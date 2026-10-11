import { requestAiPhoto } from './photo-ai-request';
import { getSupabaseClient } from './supabase-client';
import { needsVerificationRecheck, reconcilePhotoRead, reconcileThreePhotoReads } from './photo-verification';
import type { PhotoFields } from './photo-fields';

/** Decode once; the survey and upright detail reuse the same source pixels. */
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

export async function readAiPhotos(files: File[], onResult: Parameters<typeof import('./photo-ocr').readPrePhotos>[1], onProgress: Parameters<typeof import('./photo-ocr').readPrePhotos>[2], signal?: AbortSignal) {
  const { data: { session } } = await (await getSupabaseClient()).auth.getSession();
  if (!session) throw new Error('Entre na sua conta para ler fotos.');
  if (signal?.aborted) return;
  const accessToken = session.access_token;
  let next = 0;
  const worker = async () => {
    while (next < files.length && !signal?.aborted) {
      const index = next++;
      const file = files[index]!;
      const start = performance.now();
      const deadline = AbortSignal.timeout(75000);
      const photoSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let image: ImageBitmap | undefined;
      let completedPhoto: PhotoFields | undefined;
      const progress = (message: string) => { if (!photoSignal.aborted) onProgress?.(index, message); };
      const retryProgress = () => progress('Gemini ocupado. Tentando novamente…');
      try {
        progress('1/2 · Lendo placa, CTCs, NFs e volumes…');
        image = await createImageBitmap(file);
        if (photoSignal.aborted) throw new Error('Leitura interrompida.');
        let survey: Awaited<ReturnType<typeof requestAiPhoto>> | { ok: false; error: string };
        try { survey = await requestAiPhoto({ data: { ...photoPayload(image, 0, false, 1800), accessToken, mode: 'survey' }, signal: photoSignal }, retryProgress); }
        catch { survey = { ok: false, error: 'Primeira conferência indisponível.' }; }
        if (photoSignal.aborted) throw new Error('Leitura interrompida.');
        const rotation = survey.ok ? survey.rotation : 0;
        const payload = photoPayload(image, rotation, survey.ok && survey.pre.kind === 'pre');
        progress('2/2 · Conferindo todas as linhas e laboratórios…');
        const full = await requestAiPhoto({ data: { ...payload, accessToken, mode: 'full' }, signal: photoSignal }, retryProgress);
        const firstCheck = survey.ok ? survey.check : null;
        if (full.ok) completedPhoto = reconcilePhotoRead(full.pre, firstCheck);
        if (photoSignal.aborted) throw new Error('Leitura interrompida.');
        if (!full.ok) { if (!signal?.aborted) onResult(index, { error: full.error }); continue; }
        let pre = completedPhoto!;
        if (needsVerificationRecheck(pre)) {
          progress('Conferindo diferenças entre as leituras…');
          // Keep the whole page: a long table may extend beyond the detail crop.
          const verification = await requestAiPhoto({ data: { ...payload, accessToken, mode: 'verify' }, signal: photoSignal }, retryProgress);
          if (photoSignal.aborted) throw new Error('Leitura interrompida.');
          if (verification.ok) pre = reconcileThreePhotoReads(full.pre, firstCheck, verification.check);
          else pre = { ...pre, headerReview: [...(pre.headerReview ?? []), 'Não foi possível concluir a conferência adicional. Revise as diferenças indicadas.'], verification: { status: 'review', checkedFields: pre.verification?.checkedFields ?? 0, conflicts: pre.verification?.conflicts ?? 0 } };
        }
        if (!signal?.aborted) onResult(index, { pre, text: JSON.stringify(pre, null, 2), milliseconds: performance.now() - start });
      } catch (error) {
        if (!signal?.aborted) {
          if (completedPhoto) {
            const pre: PhotoFields = { ...completedPhoto, headerReview: [...(completedPhoto.headerReview ?? []), 'A conferência adicional não terminou. Confira os campos sinalizados antes de cadastrar.'], verification: { status: 'review', checkedFields: completedPhoto.verification?.checkedFields ?? 0, conflicts: completedPhoto.verification?.conflicts ?? 0 } };
            onResult(index, { pre, text: JSON.stringify(pre, null, 2), milliseconds: performance.now() - start });
          } else onResult(index, { error: deadline.aborted ? 'Esta foto excedeu o tempo de leitura. Tente novamente só ela ou envie um recorte mais próximo.' : error instanceof Error ? error.message : 'Falha na leitura por IA.' });
        }
      } finally { image?.close(); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
}

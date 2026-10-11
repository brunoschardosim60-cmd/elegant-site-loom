import { requestAiPhoto } from './photo-ai-request';
import { getSupabaseClient } from './supabase-client';

async function photoPayload(file: File, rotation = 0, detail = false) {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    const swap = rotation === 90 || rotation === 270;
    canvas.width = Math.round((swap ? image.height : image.width) * scale); canvas.height = Math.round((swap ? image.width : image.height) * scale);
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
  } finally { image.close(); }
}

export async function readAiPhotos(files: File[], onResult: Parameters<typeof import('./photo-ocr').readPrePhotos>[1], onProgress: Parameters<typeof import('./photo-ocr').readPrePhotos>[2], signal?: AbortSignal) {
  for (const [index, file] of files.entries()) {
    if (signal?.aborted) break;
    onProgress?.(index, 'Gemini lendo todas as linhas…');
    const start = performance.now();
    try {
      const { data: { session } } = await (await getSupabaseClient()).auth.getSession();
      if (!session) throw new Error('Entre na sua conta para ler fotos.');
      const accessToken = session.access_token;
      const retryProgress = () => onProgress?.(index, 'Gemini ocupado. Tentando esta foto novamente…');
      let result = await requestAiPhoto({ data: { ...await photoPayload(file), accessToken, orientationOnly: true }, ...(signal ? { signal } : {}) }, retryProgress);
      if (signal?.aborted) break;
      if (result.ok) {
        onProgress?.(index, 'Ajustando orientação e conferindo as linhas…');
        result = await requestAiPhoto({ data: { ...await photoPayload(file, result.rotation, result.pre.kind === 'pre'), accessToken }, ...(signal ? { signal } : {}) }, retryProgress);
      }
      if (signal?.aborted) break;
      onResult(index, result.ok ? { pre: result.pre, text: result.text, milliseconds: performance.now() - start } : { error: result.error });
    } catch (error) {
      if (signal?.aborted) break;
      onResult(index, { error: error instanceof Error ? error.message : 'Falha na leitura por IA.' });
    }
  }
}

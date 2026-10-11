import { readPhotoWithGemini } from './photo-reader.functions';

async function photoPayload(file: File) {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível abrir a imagem.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .92).split(',')[1]!;
    if (data.length > 3800000) throw new Error('Foto muito grande. Recorte o documento e tente novamente.');
    return { data, mimeType: 'image/jpeg' as const };
  } finally { image.close(); }
}

export async function readAiPhotos(files: File[], onResult: Parameters<typeof import('./photo-ocr').readPrePhotos>[1], onProgress: Parameters<typeof import('./photo-ocr').readPrePhotos>[2], signal?: AbortSignal) {
  for (const [index, file] of files.entries()) {
    if (signal?.aborted) break;
    onProgress?.(index, 'Gemini lendo todas as linhas…');
    const start = performance.now();
    try {
      const result = await readPhotoWithGemini({ data: await photoPayload(file), ...(signal ? { signal } : {}) });
      if (signal?.aborted) break;
      onResult(index, result.ok ? { pre: result.pre, text: result.text, milliseconds: performance.now() - start } : { error: result.error });
    } catch (error) {
      if (signal?.aborted) break;
      onResult(index, { error: error instanceof Error ? error.message : 'Falha na leitura por IA.' });
    }
  }
}

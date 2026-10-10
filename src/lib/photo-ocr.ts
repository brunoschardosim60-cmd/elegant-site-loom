import { createWorker, PSM } from 'tesseract.js';
import { parsePhotoFields, photoScore, pageWords, type OcrWord } from './photo-fields';
import { prepareForOcr, preparePrintedField } from './image-prep';

/** Try page layouts and right-angle orientations using one worker per photo. */
export async function readPrePhoto(file: File, progress: (message: string) => void = () => {}) {
  progress('Preparando leitor…');
  const worker = await createWorker('por');
  let best = { text: '', pre: parsePhotoFields({ text: '' }), confidence: 0, angle: 0 as 0 | 90 | 180 | 270, source: file as Blob, words: [] as OcrWord[] };
  let successful = false;
  let failure: unknown;
  const sources: { source: Blob; angle: 0 | 90 | 180 | 270 }[] = [];
  const score = photoScore;
  try {
    const image = await prepareForOcr(file);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
    const attempts = [
      { original: false, angle: 0 as const }, { original: false, angle: 90 as const },
      { original: false, angle: 270 as const }, { original: false, angle: 180 as const },
      ...(image !== file ? [{ original: true, angle: 0 as const }] : []),
    ];
    for (const [index, attempt] of attempts.entries()) {
      progress(`Lendo foto: tentativa ${index + 1} de ${attempts.length}…`);
      try {
        const source = attempt.original ? file : attempt.angle === 0 ? image : await prepareForOcr(file, attempt.angle);
        sources.push({ source, angle: attempt.angle });
        const { data } = await worker.recognize(source, {}, { text: true, blocks: true });
        successful = true;
        const candidate = { text: data.text.trim(), pre: parsePhotoFields(data), confidence: data.confidence, angle: attempt.angle, source, words: pageWords(data) };
        if (score(candidate.pre) > score(best.pre) || (score(candidate.pre) === score(best.pre) && candidate.confidence > best.confidence)) best = candidate;
        if (best.pre.id && best.pre.plate && (best.pre.ctes.length || best.pre.documents.length >= 5)) break;
      } catch (error) { failure = error; }
    }
    if (!best.pre.ctes.length) {
      progress('Procurando campos e tabelas…');
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const tableSources = best.pre.id && best.pre.plate && best.pre.documents.length >= 5 ? [{ source: best.source, angle: best.angle }] : sources;
      for (const { source, angle } of tableSources) { try {
        const { data } = await worker.recognize(source, {}, { text: true, blocks: true });
        successful = true;
        const candidate = { text: data.text.trim(), pre: parsePhotoFields(data), confidence: data.confidence, angle, source, words: pageWords(data) };
        if (score(candidate.pre) > score(best.pre) || (score(candidate.pre) === score(best.pre) && candidate.confidence > best.confidence)) best = candidate;
      } catch (error) { failure = error; } }
    }
    if (!successful) throw failure ?? new Error('Não foi possível processar a foto.');
    const idWord = best.words.find(w => /^D[I1L|][0-9OQIL|SB]{8,12}$/i.test(w.text));
    if (idWord) {
      progress('Conferindo número do pré…');
      try {
        const field = await preparePrintedField(best.source, idWord.bbox);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: 'DI0123456789' });
        const { data } = await worker.recognize(field);
        const id = data.text.trim().match(/^DI\d{8,12}$/)?.[0];
        if (id) { best.pre.id = id; best.text += `\nNúmero do pré (leitura ampliada): ${id}`; }
      } catch { /* Keep the full-page result available for review. */ }
    }
    return { text: best.text, pre: best.pre };
  } finally { await worker.terminate().catch(() => {}); }
}

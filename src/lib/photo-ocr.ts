import { createWorker, PSM } from 'tesseract.js';
import { parsePreText } from './conference';
import { prepareForOcr } from './image-prep';

/** Try page layouts and right-angle orientations using one worker per photo. */
export async function readPrePhoto(file: File, progress: (message: string) => void = () => {}) {
  progress('Preparando leitor…');
  const worker = await createWorker('por');
  let best = { text: '', pre: parsePreText(''), confidence: 0, angle: 0 as 0 | 90 | 180 | 270 };
  let successful = false;
  let failure: unknown;
  const score = (pre: ReturnType<typeof parsePreText>) => Number(!!pre.id) * 4 + Number(!!pre.plate) * 2 + Math.min(pre.ctes.length, 20) * 3;
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
        const { data } = await worker.recognize(source);
        successful = true;
        const candidate = { text: data.text.trim(), pre: parsePreText(data.text), confidence: data.confidence, angle: attempt.angle };
        if (score(candidate.pre) > score(best.pre) || (score(candidate.pre) === score(best.pre) && candidate.confidence > best.confidence)) best = candidate;
        if (best.pre.id && best.pre.plate && best.pre.ctes.length) break;
      } catch (error) { failure = error; }
    }
    if (!best.pre.ctes.length) {
      progress('Procurando campos e tabelas…');
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      try {
        const source = best.angle === 0 ? image : await prepareForOcr(file, best.angle);
        const { data } = await worker.recognize(source);
        successful = true;
        const candidate = { text: data.text.trim(), pre: parsePreText(data.text), confidence: data.confidence, angle: best.angle };
        if (score(candidate.pre) > score(best.pre) || (score(candidate.pre) === score(best.pre) && candidate.confidence > best.confidence)) best = candidate;
      } catch (error) { failure = error; }
    }
    if (!successful) throw failure ?? new Error('Não foi possível processar a foto.');
    return { text: best.text, pre: best.pre };
  } finally { await worker.terminate().catch(() => {}); }
}

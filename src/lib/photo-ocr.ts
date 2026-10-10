import { createWorker, PSM, type Worker } from 'tesseract.js';
import { parsePhotoFields, photoScore, pageWords, tableCellRegions, type OcrPage, type PhotoFields } from './photo-fields';
import { buildDigitTemplates, matchPrintedNumber } from './printed-digits';
import { prepareForOcr, preparePrintedField, prepareTableCells, readGrayImage } from './image-prep';

type Result = { text: string; pre: PhotoFields; milliseconds: number };
type Angle = 0 | 90 | 180 | 270;
async function readWithWorker(worker: Worker, file: File, progress: (message: string) => void, preferred?: Angle, detailed = false): Promise<Result & { angle: Angle }> {
  const started = performance.now();
  let best = { page: { text: '' } as OcrPage, pre: parsePhotoFields({ text: '' }), confidence: 0, angle: 0 as Angle, source: file as Blob };
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '', preserve_interword_spaces: '1' });
  // Find direction on a thumbnail instead of recognizing every full-size rotation.
  const angles = [...new Set<Angle>([0, ...(preferred === undefined ? [] : [preferred]), 270, 90, 180])];
  let angle: Angle = 0;
  let successful = false;
  for (const candidateAngle of angles) {
    progress('Ajustando orientação da foto…');
    try {
      const preview = await prepareForOcr(file, candidateAngle, 1400);
      const { data } = await worker.recognize(preview);
      successful = true;
      const previewFields = parsePhotoFields(data);
      if (photoScore(previewFields) > photoScore(best.pre)) best = { page: data, pre: previewFields, confidence: data.confidence, angle: candidateAngle, source: preview };
      if (/PR[EÉ][- ]?MANIFESTO|DACTE|\bDI\d{8,12}/i.test(data.text)) { angle = candidateAngle; break; }
    } catch { /* A different orientation may still be readable. */ }
  }
  progress('Lendo documento e tabela…');
  const source = await prepareForOcr(file, angle);
  for (const psm of [PSM.SPARSE_TEXT, PSM.AUTO]) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    try {
      const { data } = await worker.recognize(source, {}, { text: true, blocks: true });
      successful = true;
      const candidate = { page: data, pre: parsePhotoFields(data), confidence: data.confidence, angle, source };
      if (best.source !== source || photoScore(candidate.pre) > photoScore(best.pre) || (photoScore(candidate.pre) === photoScore(best.pre) && candidate.confidence > best.confidence)) best = candidate;
      if (candidate.pre.documents.length || candidate.pre.ctcs.length) break;
    } catch { /* Keep a partial result available for manual review. */ }
  }
  if (!successful) throw new Error('Não foi possível processar a foto.');
  if (best.pre.kind === 'pre' && best.pre.documents.length) {
    try {
      const gray = await readGrayImage(best.source);
      const templates = buildDigitTemplates(gray, pageWords(best.page));
      for (const region of tableCellRegions(best.page).filter(r => r.field === 'volumes')) {
        const row = best.pre.documents[region.row]!;
        if (row.volumes && !row.review?.includes('volumes')) continue;
        const reading = matchPrintedNumber(gray, region.box, templates);
        if (reading?.certain) { row.volumes = reading.value; if (reading.certain) row.review = (row.review ?? []).filter(field => field !== 'volumes'); }
      }
    } catch { /* Keep the OCR reading when there are too few clear examples. */ }
  }
  if (detailed && best.pre.kind === 'pre' && best.pre.documents.length) {
    const regions = tableCellRegions(best.page).filter(region => {
      const row = best.pre.documents[region.row];
      return row && (region.field === 'nf' ? !/^\d{2,9}-\d{1,3}$/.test(row.nf) : !row.volumes || row.review?.includes('volumes'));
    });
    if (regions.length) {
      progress('Ampliando NF e volumes…');
      try {
        const cells = await prepareTableCells(best.source, regions.map(region => region.box));
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789-' });
        for (const [i, region] of regions.entries()) {
          const { data } = await worker.recognize(cells[i]!);
          const value = data.text.trim().replace(/\s/g, '');
          const valid = region.field === 'nf' ? /^\d{2,9}-\d{1,3}$/.test(value) : /^\d{1,4}$/.test(value) && Number(value) > 0;
          if (!valid || data.confidence < 60) continue;
          const row = best.pre.documents[region.row]!;
          // Retain an explicit NF-series result; a crop may clip the hyphen.
          if (region.field === 'volumes' || !/^\d{2,9}-\d{1,3}$/.test(row.nf)) row[region.field] = value;
          if (data.confidence >= 95) row.review = (row.review ?? []).filter(field => field !== (region.field === 'nf' ? 'NF' : 'volumes'));
        }
      } catch { /* Full-page readings remain editable. */ }
    }
  }
  const idWord = pageWords(best.page).find(w => /^D[I1L|][0-9OQIL|SB]{4,12}$/i.test(w.text));
  if (idWord && best.pre.kind !== 'dacte') {
    progress('Conferindo número do pré…');
    try {
      const field = await preparePrintedField(best.source, idWord.bbox);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: 'DI0123456789' });
      const { data } = await worker.recognize(field);
      const id = data.text.trim().match(/^DI\d{8,12}$/)?.[0];
      if (id) best.pre.id = id;
    } catch { /* Keep the full-page ID for review. */ }
  }
  return { text: best.page.text.trim(), pre: best.pre, milliseconds: Math.round(performance.now() - started), angle };
}

/** One language download and worker initialization for the entire batch. */
export async function readPrePhotos(files: File[], onResult: (index: number, result: Result | { error: string }) => void, progress: (index: number, message: string) => void = () => {}, signal?: AbortSignal, detailed = false) {
  progress(0, 'Preparando leitor…');
  const worker = await createWorker('por');
  let preferred: Angle | undefined;
  const cancel = () => { void worker.terminate().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (const [index, file] of files.entries()) {
      if (signal?.aborted) break;
      try {
        const result = await readWithWorker(worker, file, message => progress(index, message), preferred, detailed);
        if (signal?.aborted) break;
        if (result.pre.kind === 'pre') preferred = result.angle;
        onResult(index, result);
      } catch { if (signal?.aborted) break; onResult(index, { error: 'Não foi possível ler esta foto. Tente outra foto ou preencha os dados.' }); }
    }
  } finally { signal?.removeEventListener('abort', cancel); await worker.terminate().catch(() => {}); }
}

export async function readPrePhoto(file: File, progress: (message: string) => void = () => {}): Promise<Result> {
  let result: Result | undefined;
  let error = '';
  await readPrePhotos([file], (_, value) => { if ('error' in value) error = value.error; else result = value; }, (_, message) => progress(message));
  if (!result) throw new Error(error);
  return result;
}

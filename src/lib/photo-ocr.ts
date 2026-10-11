import { createWorker, PSM, type Worker } from 'tesseract.js';
import { parsePhotoFields, photoScore, pageWords, tableCellRegions, tableCtcRepairRegions, tableSummaryRegions, tableVolumeRegion, type OcrPage, type PhotoFields, type OcrWord } from './photo-fields';
import { buildDigitTemplates, matchPrintedNumber } from './printed-digits';
import { prepareForOcr, preparePrintedField, prepareNumericMontage, prepareNumericColumn, readGrayImage } from './image-prep';
import { markLocalPhoto } from './local-photo';

type Result = { text: string; pre: PhotoFields; milliseconds: number };
type Angle = 0 | 90 | 180 | 270;
/** Position-based association keeps an unread montage cell from shifting later fields. */
export function montageReadings(page: OcrPage, cells: Awaited<ReturnType<typeof prepareNumericMontage>>['cells']): (OcrWord | undefined)[] {
  const words = pageWords(page);
  return cells.map(({ box, target }) => {
    const found = words.filter(word => {
      const x = (word.bbox.x0 + word.bbox.x1) / 2, y = (word.bbox.y0 + word.bbox.y1) / 2;
      return x >= target.x0 && x <= target.x1 && y >= target.y0 && y <= target.y1;
    }).sort((a, b) => a.bbox.x0 - b.bbox.x0);
    if (!found.length) return;
    const scale = (target.x1 - target.x0) / (box.x1 - box.x0);
    return { text: found.map(word => word.text).join('').replace(/\s/g, ''), confidence: Math.min(...found.map(word => word.confidence)),
      bbox: { x0: box.x0 + (Math.min(...found.map(word => word.bbox.x0)) - target.x0) / scale,
        x1: box.x0 + (Math.max(...found.map(word => word.bbox.x1)) - target.x0) / scale,
        y0: box.y0 + (Math.min(...found.map(word => word.bbox.y0)) - target.y0) / scale,
        y1: box.y0 + (Math.max(...found.map(word => word.bbox.y1)) - target.y0) / scale } };
  });
}

async function readWithWorker(worker: Worker, file: File, progress: (message: string) => void, preferred?: Angle, detailed = false, signal?: AbortSignal): Promise<Result & { angle: Angle }> {
  const started = performance.now();
  const active = () => { if (signal?.aborted) throw new Error('Leitura interrompida.'); };
  let best = { page: { text: '' } as OcrPage, pre: parsePhotoFields({ text: '' }), confidence: 0, angle: 0 as Angle, source: file as Blob };
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '', preserve_interword_spaces: '1' });
  // Find direction on a thumbnail instead of recognizing every full-size rotation.
  const angles = [...new Set<Angle>([preferred ?? 0, 0, 270, 90, 180])];
  let angle: Angle = 0;
  let successful = false;
  for (const candidateAngle of angles) {
    active();
    progress('Ajustando orientação da foto…');
    try {
      const preview = await prepareForOcr(file, candidateAngle, 1400);
      const { data } = await worker.recognize(preview);
      active();
      successful = true;
      const previewFields = parsePhotoFields(data);
      if (photoScore(previewFields) > photoScore(best.pre)) best = { page: data, pre: previewFields, confidence: data.confidence, angle: candidateAngle, source: preview };
      if (/PR[EÉ][- ]?MANIFESTO|DACTE|\bDI\d{8,12}/i.test(data.text)) { angle = candidateAngle; break; }
    } catch { active(); /* A different orientation may still be readable. */ }
  }
  if (best.angle && angle === 0 && !/PR[EÉ][- ]?MANIFESTO|DACTE|\bDI\d{8,12}/i.test(best.page.text)) angle = best.angle;
  active();
  progress('Lendo documento e tabela…');
  const source = await prepareForOcr(file, angle);
  for (const psm of [PSM.SPARSE_TEXT, PSM.AUTO]) {
    active();
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    try {
      const { data } = await worker.recognize(source, {}, { text: true, blocks: true });
      active();
      successful = true;
      const candidate = { page: data, pre: parsePhotoFields(data), confidence: data.confidence, angle, source };
      const score = (pre: PhotoFields) => photoScore(pre) + (pre.expectedRows && pre.documents.length === pre.expectedRows ? 100 : 0);
      if (best.source !== source || score(candidate.pre) > score(best.pre) || (score(candidate.pre) === score(best.pre) && candidate.confidence > best.confidence)) best = candidate;
      if ((candidate.pre.documents.length || candidate.pre.ctcs.length) && (!candidate.pre.expectedRows || candidate.pre.documents.length === candidate.pre.expectedRows)) break;
    } catch { active(); /* Keep a partial result available for manual review. */ }
  }
  if (!successful) throw new Error('Não foi possível processar a foto.');
  if (best.pre.kind === 'pre' && best.pre.documents.length) {
    const repairs = [...tableCtcRepairRegions(best.page), ...tableSummaryRegions(best.page).filter(region => !best.pre[region.field as 'expectedRows' | 'totalVolumes'])].slice(0, 64);
    if (repairs.length) {
      progress('Conferindo CTCs e totais do cabeçalho…');
      try {
        active(); const montage = await prepareNumericMontage(best.source, repairs.map(region => region.box));
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '0123456789', user_defined_dpi: '300' });
        const { data } = await worker.recognize(montage.image, {}, { text: true, blocks: true }); active();
        const recovered = montageReadings(data, montage.cells).filter((word, index): word is OcrWord => Boolean(word && word.confidence >= 75 && (repairs[index]!.field === 'ctc' ? /^\d{10}$/.test(word.text) : /^\d{1,6}$/.test(word.text) && Number(word.text) > 0)));
        if (recovered.length) {
          const words = pageWords(best.page).filter(word => !recovered.some(repair => {
            const x = (word.bbox.x0 + word.bbox.x1) / 2, y = (word.bbox.y0 + word.bbox.y1) / 2;
            return x >= repair.bbox.x0 && x <= repair.bbox.x1 && y >= repair.bbox.y0 && y <= repair.bbox.y1;
          }));
          best.page = { ...best.page, blocks: [{ paragraphs: [{ lines: [{ words: [...words, ...recovered] }] }] }] };
          best.pre = parsePhotoFields(best.page);
          best.pre.headerReview = [...(best.pre.headerReview ?? []), 'CTCs ou totais relidos em recortes. Confira os dados recuperados na foto.'];
        }
      } catch { active(); /* Leave unread fields blank and available for review. */ }
    }
  }
  const confidentVolumes = new Set<string>();
  if (best.pre.kind === 'pre' && best.pre.documents.length) {
    try {
      const gray = await readGrayImage(best.source);
      const templates = buildDigitTemplates(gray, pageWords(best.page));
      for (const region of tableCellRegions(best.page).filter(r => r.field === 'volumes')) {
        const row = best.pre.documents[region.row]!;
        if (row.volumes && !row.review?.includes('volumes')) continue;
        const reading = matchPrintedNumber(gray, region.box, templates);
        if (reading?.certain) { row.volumes = reading.value; confidentVolumes.add(row.ctc); row.review = (row.review ?? []).filter(field => field !== 'volumes'); }
      }
    } catch { /* Keep the OCR reading when there are too few clear examples. */ }
  }
  if (best.pre.kind === 'pre' && best.pre.documents.length) {
    const region = tableVolumeRegion(best.page);
    if (region && best.pre.documents.some(row => !row.volumes || row.review?.includes('volumes'))) {
      progress('Conferindo a coluna de volumes…');
      try {
        active(); const column = await prepareNumericColumn(best.source, region.box);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '0123456789', user_defined_dpi: '300' });
        const { data } = await worker.recognize(column.image, {}, { text: true, blocks: true }); active();
        const words = pageWords(data);
        for (const cell of tableCellRegions(best.page).filter(cell => cell.field === 'volumes')) {
          const row = best.pre.documents[cell.row]!;
          if (confidentVolumes.has(row.ctc) || (row.volumes && !row.review?.includes('volumes'))) continue;
          const candidates = words.filter(word => /^\d{1,4}$/.test(word.text) && Number(word.text) > 0 && word.confidence >= 80
            && (word.bbox.y0 + word.bbox.y1) / 2 + column.y - column.padding > cell.box.y0
            && (word.bbox.y0 + word.bbox.y1) / 2 + column.y - column.padding < cell.box.y1);
          if (candidates.length !== 1) continue;
          const value = candidates[0]!.text;
          if (row.volumes && row.volumes !== value) row.review = [...(row.review ?? []), `Volumes relidos: ${row.volumes} / ${value}. Confira na foto.`];
          row.volumes = value;
        }
      } catch { active(); /* Keep existing numbers when the column is inconclusive. */ }
    }
  }
  if (best.pre.kind === 'pre' && best.pre.documents.length) {
    const regions = tableCellRegions(best.page).filter(region => {
      const row = best.pre.documents[region.row];
      return row && region.field === 'nf' && (!/^\d{2,9}-\d{1,3}$/.test(row.nf) || row.review?.includes('NF'));
    }).slice(0, detailed ? 100 : 60);
    if (regions.length) {
      progress('Ampliando NFs em uma leitura agrupada…');
      try {
        active(); const montage = await prepareNumericMontage(best.source, regions.map(region => region.box));
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '0123456789-', user_defined_dpi: '300' });
        const { data } = await worker.recognize(montage.image, {}, { text: true, blocks: true }); active();
        for (const [i, reading] of montageReadings(data, montage.cells).entries()) {
          if (!reading || !/^\d{2,9}-\d{1,3}$/.test(reading.text) || reading.confidence < 80) continue;
          const region = regions[i]!; const value = reading.text;
          const row = best.pre.documents[region.row]!;
          if (row.nf && row.nf !== value) row.review = [...(row.review ?? []), `NF relida: ${row.nf} / ${value}. Confira na foto.`];
          row.nf = value;
        }
      } catch { active(); /* Full-page readings remain editable. */ }
    }
  }
  const idWord = pageWords(best.page).find(w => /^D[I1L|][0-9OQIL|SB]{4,12}$/i.test(w.text));
  if (idWord && best.pre.kind !== 'dacte') {
    progress('Conferindo número do pré…');
    try {
      active();
      const field = await preparePrintedField(best.source, idWord.bbox);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: 'DI0123456789' });
      const { data } = await worker.recognize(field);
      active();
      const id = data.text.trim().match(/^DI\d{8,12}$/)?.[0];
      if (id) best.pre.id = id;
    } catch { active(); /* Keep the full-page ID for review. */ }
  }
  return { text: best.page.text.trim(), pre: best.pre, milliseconds: Math.round(performance.now() - started), angle };
}

/** One language download and worker initialization for the entire batch. */
export async function readPrePhotos(files: File[], onResult: (index: number, result: Result | { error: string; fallback?: boolean }) => void, progress: (index: number, message: string) => void = () => {}, signal?: AbortSignal, detailed = false) {
  if (signal?.aborted || !files.length) return;
  progress(0, 'Preparando leitor…');
  const starting = createWorker('por');
  let cancelStartup = () => {};
  const aborted = new Promise<undefined>(resolve => { cancelStartup = () => resolve(undefined); signal?.addEventListener('abort', cancelStartup, { once: true }); });
  let worker: Worker | undefined;
  try { worker = await Promise.race([starting, aborted]); }
  finally { signal?.removeEventListener('abort', cancelStartup); }
  if (!worker) { void starting.then(late => late.terminate()).catch(() => {}); return; }
  let preferred: Angle | undefined;
  const cancel = () => { void worker.terminate().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) return;
    for (const [index, file] of files.entries()) {
      if (signal?.aborted) break;
      try {
        const result = await readWithWorker(worker, file, message => progress(index, message), preferred, detailed, signal);
        if (signal?.aborted) break;
        if (result.pre.kind === 'pre') preferred = result.angle;
        onResult(index, { ...result, pre: markLocalPhoto(result.pre) });
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

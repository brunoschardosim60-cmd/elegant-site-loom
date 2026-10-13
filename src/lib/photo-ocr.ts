import { createWorker, PSM, type Worker } from 'tesseract.js';
import { parsePhotoFields, photoScore, pageWords, tableCellRegions, tableCtcRepairRegions, tableSummaryRegions, type OcrPage, type PhotoFields, type OcrWord } from './photo-fields';
import { buildDigitTemplates, matchPrintedNumber, type GrayImage } from './printed-digits';
import { recoverNfSeparator } from './ocr-numeric';
import { prepareForOcr, preparePrintedField, prepareNumericMontage, readGrayImage } from './image-prep';
import { markLocalPhoto } from './local-photo';

type Result = { text: string; pre: PhotoFields; milliseconds: number; angle?: Angle };
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
    const scaleY = (target.y1 - target.y0) / (box.y1 - box.y0);
    return { text: found.map(word => word.text).join('').replace(/\s/g, ''), confidence: Math.min(...found.map(word => word.confidence)),
      bbox: { x0: box.x0 + (Math.min(...found.map(word => word.bbox.x0)) - target.x0) / scale,
        x1: box.x0 + (Math.max(...found.map(word => word.bbox.x1)) - target.x0) / scale,
        y0: box.y0 + (Math.min(...found.map(word => word.bbox.y0)) - target.y0) / scaleY,
        y1: box.y0 + (Math.max(...found.map(word => word.bbox.y1)) - target.y0) / scaleY } };
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
      const preview = await prepareForOcr(file, candidateAngle, 1400, signal);
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
  const source = await prepareForOcr(file, angle, 3840, signal);
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
        active(); const montage = await prepareNumericMontage(best.source, repairs.map(region => region.box), { signal });
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
  let gray: GrayImage | undefined;
  if (best.pre.kind === 'pre' && best.pre.documents.length) {
    try {
      gray = await readGrayImage(best.source);
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
    const regions = tableCellRegions(best.page).filter(region => region.field === 'volumes');
    const sumVolumes = () => best.pre.documents.reduce((total, row) => total + Number(row.volumes || 0), 0);
    const totalMismatch = Boolean(best.pre.totalVolumes && best.pre.totalVolumes !== sumVolumes());
    if (regions.length && (totalMismatch || best.pre.documents.some(row => !row.volumes || row.review?.includes('volumes')))) {
      progress('Relendo todos os volumes em recortes ampliados…');
      // Try two independent image preparations. Keep a pass only when it improves
      // agreement with the printed header total; a poor second OCR must not replace
      // better values already read from the original photo.
      const original = best.pre.documents.map(row => ({ volumes: row.volumes, review: [...(row.review ?? [])] }));
      let bestDistance = best.pre.totalVolumes ? Math.abs(best.pre.totalVolumes - sumVolumes()) : Number.POSITIVE_INFINITY;
      for (const separateDigits of [true, false]) {
        try {
          active();
          const montage = await prepareNumericMontage(best.source, regions.map(region => region.box), { separateDigits, signal });
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '0123456789', user_defined_dpi: '300' });
          const { data } = await worker.recognize(montage.image, {}, { text: true, blocks: true }); active();
          const readings = montageReadings(data, montage.cells);
          const candidate = original.map((row, index) => {
            const reading = readings[index];
            const value = reading && /^\d{1,4}$/.test(reading.text) && Number(reading.text) > 0
              && reading.confidence >= (row.volumes ? 70 : 60) ? reading.text : row.volumes;
            return { ...row, volumes: value ?? '' };
          });
          const candidateSum = candidate.reduce((sum, row) => sum + Number(row.volumes || 0), 0);
          const distance = best.pre.totalVolumes ? Math.abs(best.pre.totalVolumes - candidateSum) : Number.POSITIVE_INFINITY;
          const fillsMore = candidate.filter(row => row.volumes).length > best.pre.documents.filter(row => row.volumes).length;
          if (distance < bestDistance || (!best.pre.totalVolumes && fillsMore)) {
            bestDistance = distance;
            candidate.forEach((value, index) => {
              const row = best.pre.documents[index]!;
              const prior = row.volumes;
              if (value.volumes && value.volumes !== prior) {
                if (prior && prior !== value.volumes) row.review = [...new Set([...(row.review ?? []), `Volumes relidos: ${prior} / ${value.volumes}. Confira na foto.`])];
                if (readings[index] && readings[index]!.confidence < 80) row.review = [...new Set([...(row.review ?? []), 'volumes', 'Volume recuperado com leitura de menor confiança. Confira na foto.'])];
                row.volumes = value.volumes;
              }
            });
          }
        } catch { active(); /* Continue with the next image preparation and retain existing readings. */ }
      }
      if (best.pre.totalVolumes && sumVolumes() !== best.pre.totalVolumes) {
        best.pre.headerReview = [...new Set([...(best.pre.headerReview ?? []),
          `Cabeçalho informa ${best.pre.totalVolumes} volumes; a leitura local somou ${sumVolumes()}. Alguns volumes podem não ter sido reconhecidos. Confira a coluna inteira na foto.`])];
      }
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
        active(); const montage = await prepareNumericMontage(best.source, regions.map(region => region.box), { signal });
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
  if (gray && best.pre.kind === 'pre') {
    for (const region of tableCellRegions(best.page).filter(region => region.field === 'nf')) {
      const row = best.pre.documents[region.row]!;
      const recovered = recoverNfSeparator(gray, region.box, row.nf);
      if (recovered) { row.nf = recovered; row.review = [...new Set([...(row.review ?? []), 'NF', 'Separador da NF recuperado da foto. Confira os números e a série.'])]; }
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
  return { text: best.page.text.trim(), pre: best.pre, milliseconds: Math.round(performance.now() - started), angle: best.angle };
}

/** One language download and worker initialization for the entire batch. */
export async function readPrePhotos(files: File[], onResult: (index: number, result: Result | { error: string; fallback?: boolean }) => void, progress: (index: number, message: string) => void = () => {}, signal?: AbortSignal, detailed = false) {
  if (signal?.aborted || !files.length) return;
  progress(0, 'Preparando leitor…');
  // Batches of many pre-manifests read in parallel on capable devices.
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const poolSize = Math.min(files.length, cores >= 6 ? 3 : cores >= 4 ? 2 : 1);
  const startingAll = Array.from({ length: poolSize }, () => createWorker('por'));
  let cancelStartup = () => {};
  const aborted = new Promise<undefined>(resolve => { cancelStartup = () => resolve(undefined); signal?.addEventListener('abort', cancelStartup, { once: true }); });
  let workers: Worker[] | undefined;
  try { workers = await Promise.race([Promise.all(startingAll), aborted]); }
  finally { signal?.removeEventListener('abort', cancelStartup); }
  if (!workers) { for (const starting of startingAll) void starting.then(late => late.terminate()).catch(() => {}); return; }
  const pool = workers;
  let preferred: Angle | undefined;
  let next = 0;
  const cancel = () => { for (const worker of pool) void worker.terminate().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const run = async (worker: Worker) => {
    while (!signal?.aborted && next < files.length) {
      const index = next++;
      try {
        const result = await readWithWorker(worker, files[index]!, message => progress(index, message), preferred, detailed, signal);
        if (signal?.aborted) return;
        if (result.pre.kind === 'pre') preferred = result.angle;
        onResult(index, { ...result, pre: markLocalPhoto(result.pre) });
      } catch { if (signal?.aborted) return; onResult(index, { error: 'Não foi possível ler esta foto. Tente outra foto ou preencha os dados.' }); }
    }
  };
  try { await Promise.all(pool.map(run)); }
  finally { signal?.removeEventListener('abort', cancel); await Promise.all(pool.map(worker => worker.terminate().catch(() => {}))); }
}

/** Read a single photo with a dedicated worker. */
export async function readPrePhoto(file: File, progress: (message: string) => void = () => {}, detailed = false) {
  const worker = await createWorker('por');
  try { const result = await readWithWorker(worker, file, progress, undefined, detailed); return { ...result, pre: markLocalPhoto(result.pre) }; }
  finally { await worker.terminate().catch(() => {}); }
}

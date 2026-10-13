import { createWorker, PSM, type Worker } from 'tesseract.js';
import { clean, parsePhotoFields, photoScore, pageWords, tableCellRegions, tableCtcRepairRegions, tableSummaryRegions, type OcrPage, type PhotoFields, type OcrWord } from './photo-fields';
import { buildDigitTemplates, matchPrintedNumber, type GrayImage } from './printed-digits';
import { recoverNfSeparator } from './ocr-numeric';
import { prepareForOcr, preparePrintedField, prepareNumericMontage, readGrayImage } from './image-prep';
import { markLocalPhoto } from './local-photo';

type Result = { text: string; pre: PhotoFields; milliseconds: number; angle?: Angle };
type Angle = 0 | 90 | 180 | 270;

/** Mobile browsers have much tighter memory limits than desktop browsers.
 * More OCR workers do not improve a single photo's accuracy and can cause
 * large image buffers/WASM heaps to compete or get killed on phones.
 */
export function getLocalOcrPoolSize(fileCount: number, hardwareConcurrency: number, mobile: boolean, deviceMemory?: number): number {
  if (fileCount <= 0) return 0;
  const memoryLimited = deviceMemory !== undefined && Number.isFinite(deviceMemory) && deviceMemory <= 4;
  const maxWorkers = mobile || memoryLimited ? 1 : hardwareConcurrency >= 6 ? 3 : hardwareConcurrency >= 4 ? 2 : 1;
  return Math.min(fileCount, Math.max(1, maxWorkers));
}

function isMobileOrLowMemoryDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const memory = 'deviceMemory' in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) : undefined;
  return mobile || (memory !== undefined && Number.isFinite(memory) && memory <= 4);
}
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
  const mobileFastPath = isMobileOrLowMemoryDevice();
  // Fast first pass on mobile. Only upscale to the high-resolution path if the
  // first recognition exposes a missing row, field or total mismatch.
  const fullPageMaxSize = mobileFastPath ? 3000 : 3840;
  let source = await prepareForOcr(file, angle, fullPageMaxSize, signal);
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
      // Do not stop just because we found one valid CTC. On real manifests the
      // first segmentation can miss lower rows or volume cells, especially on mobile.
      // If a table is visible, compare both page-segmentation modes unless the printed
      // row count, required row fields, and volume total already agree.
      const words = pageWords(data);
      const normalizeHeading = (word: OcrWord) => clean(word.text);
      const hasCtcHeading = words.some(word => /^CTCS?$/.test(normalizeHeading(word)));
      const hasOtherHeading = words.some(word => /^(?:REMETENTE|NFSERIE|NF|VOLS?)$/.test(normalizeHeading(word)));
      const hasTableEvidence = hasCtcHeading && hasOtherHeading;
      const rowCountMismatch = Boolean(candidate.pre.expectedRows && candidate.pre.documents.length !== candidate.pre.expectedRows);
      const incompleteRows = candidate.pre.documents.some(row => !row.nf || !row.volumes);
      const volumeSum = candidate.pre.documents.reduce((sum, row) => sum + Number(row.volumes || 0), 0);
      const totalMismatch = Boolean(candidate.pre.totalVolumes && candidate.pre.totalVolumes !== volumeSum);
      // Table headings alone are not a reason to repeat a full-page OCR:
      // clean rows can proceed immediately when header totals were not readable.
      const needsMoreWork = rowCountMismatch || totalMismatch || incompleteRows
        || (!candidate.pre.documents.length && hasTableEvidence);
      if (!needsMoreWork) break;
      // A missed row/field on the fast mobile pass gets one high-resolution
      // attempt before the alternate segmentation mode; clean pages skip it.
      if (mobileFastPath && psm === PSM.SPARSE_TEXT && fullPageMaxSize < 3840) {
        source = await prepareForOcr(file, angle, 3840, signal);
        active();
      }
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
  let gray: GrayImage | undefined;
  if (best.pre.kind === 'pre' && best.pre.documents.length) {
    const needsVolumeTemplate = best.pre.documents.some(row => !row.volumes || row.review?.includes('volumes'));
    const needsNfSeparator = best.pre.documents.some(row => /^\d{3,12}$/.test(row.nf));
    // Decoding a full-resolution photo into a grayscale buffer is expensive on
    // phones. Only build it when an actual cell can benefit from pixel analysis.
    if (needsVolumeTemplate || needsNfSeparator) {
      try {
        active();
        gray = await readGrayImage(best.source);
        active();
        if (needsVolumeTemplate) {
          const templates = buildDigitTemplates(gray, pageWords(best.page));
          for (const region of tableCellRegions(best.page).filter(r => r.field === 'volumes')) {
            const row = best.pre.documents[region.row]!;
            if (row.volumes && !row.review?.includes('volumes')) continue;
            const reading = matchPrintedNumber(gray, region.box, templates);
            if (reading?.certain) {
              row.volumes = reading.value;
              row.review = (row.review ?? []).filter(field => field !== 'volumes');
            }
          }
        }
      } catch { active(); /* Pixel recovery is optional; preserve OCR results. */ }
    }
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
      let bestDistance = best.pre.totalVolumes ? Math.abs(best.pre.totalVolumes - sumVolumes()) : Number.POSITIVE_INFINITY;
      for (const separateDigits of [true, false]) {
        try {
          active();
          const montage = await prepareNumericMontage(best.source, regions.map(region => region.box), { separateDigits, signal });
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '0123456789', user_defined_dpi: '300' });
          const { data } = await worker.recognize(montage.image, {}, { text: true, blocks: true }); active();
          const readings = montageReadings(data, montage.cells);
          // Start from the best values accepted so far. A later, weaker montage
          // must not roll back a value recovered by the earlier preparation.
          const current = best.pre.documents.map(row => ({ volumes: row.volumes, review: [...(row.review ?? [])] }));
          const filledBefore = current.filter(row => row.volumes).length;
          const candidate = current.map((row, index) => {
            const reading = readings[index];
            const value = reading && /^\d{1,4}$/.test(reading.text) && Number(reading.text) > 0
              && reading.confidence >= (row.volumes ? 70 : 60) ? reading.text : row.volumes;
            return { ...row, volumes: value ?? '' };
          });
          const candidateSum = candidate.reduce((sum, row) => sum + Number(row.volumes || 0), 0);
          const distance = best.pre.totalVolumes ? Math.abs(best.pre.totalVolumes - candidateSum) : Number.POSITIVE_INFINITY;
          const fillsMore = candidate.filter(row => row.volumes).length > filledBefore;
          if (distance < bestDistance || (distance === bestDistance && fillsMore) || (!best.pre.totalVolumes && fillsMore)) {
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
    for (const region of tableCellRegions(best.page).filter(region => {
      if (region.field !== 'nf') return false;
      const row = best.pre.documents[region.row];
      return Boolean(row && /^\d{3,12}$/.test(row.nf));
    })) {
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
const LOCAL_OCR_IDLE_TIMEOUT_MS = 60000;
const LOCAL_OCR_IDLE_ERROR = 'A leitura local ficou 60 segundos sem progresso. Tente uma foto mais nítida ou aproxime o documento.';

/** Race a read against cancellation so a stuck OCR call cannot hold the UI forever. */
async function withAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('Leitura interrompida.');
  let cancel!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, reject) => { cancel = reject; });
  const onAbort = () => cancel(signal.reason ?? new Error('Leitura interrompida.'));
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  try { return await Promise.race([task, stopped]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** One language download and worker initialization for the entire batch. */
export async function readPrePhotos(files: File[], onResult: (index: number, result: Result | { error: string; fallback?: boolean }) => void, progress: (index: number, message: string) => void = () => {}, signal?: AbortSignal, detailed = false) {
  if (signal?.aborted || !files.length) return;

  const watchdog = new AbortController();
  const readSignal = signal ? AbortSignal.any([signal, watchdog.signal]) : watchdog.signal;
  const delivered = new Set<number>();
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdleTimer = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = undefined; };
  const touch = () => {
    if (signal?.aborted || watchdog.signal.aborted) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      timedOut = true;
      watchdog.abort(new Error(LOCAL_OCR_IDLE_ERROR));
    }, LOCAL_OCR_IDLE_TIMEOUT_MS);
  };
  const emit = (index: number, result: Result | { error: string; fallback?: boolean }) => {
    if (delivered.has(index) || signal?.aborted) return;
    delivered.add(index);
    touch();
    onResult(index, result);
  };
  const reportProgress = (index: number, message: string) => {
    if (readSignal.aborted) return;
    touch();
    progress(index, message);
  };

  reportProgress(0, 'Preparando leitor…');
  // A phone can report 6–8 CPU cores while still having little free memory.
  // Keep one WASM worker on mobile/low-memory devices to avoid competing OCR heaps.
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const mobile = isMobileOrLowMemoryDevice();
  const deviceMemory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    : undefined;
  const poolSize = getLocalOcrPoolSize(files.length, cores, mobile, deviceMemory);
  const startingAll = Array.from({ length: poolSize }, () => createWorker('por'));
  let cancelStartup = () => {};
  const aborted = new Promise<undefined>(resolve => {
    cancelStartup = () => resolve(undefined);
    readSignal.addEventListener('abort', cancelStartup, { once: true });
    if (readSignal.aborted) cancelStartup();
  });
  let workers: Worker[] | undefined;
  try {
    workers = await Promise.race([Promise.all(startingAll), aborted]);
  } catch (error) {
    clearIdleTimer();
    throw error;
  } finally { readSignal.removeEventListener('abort', cancelStartup); }
  if (!workers) {
    for (const starting of startingAll) void starting.then(late => late.terminate()).catch(() => {});
    clearIdleTimer();
    if (timedOut && !signal?.aborted) files.forEach((_, index) => emit(index, { error: LOCAL_OCR_IDLE_ERROR }));
    return;
  }

  const pool = workers;
  let preferred: Angle | undefined;
  let next = 0;
  const cancel = () => { for (const worker of pool) void worker.terminate().catch(() => {}); };
  readSignal.addEventListener('abort', cancel, { once: true });
  const run = async (worker: Worker) => {
    while (!readSignal.aborted && next < files.length) {
      const index = next++;
      try {
        const result = await withAbort(
          readWithWorker(worker, files[index]!, message => reportProgress(index, message), preferred, detailed, readSignal),
          readSignal,
        );
        if (readSignal.aborted) return;
        if (result.pre.kind === 'pre') preferred = result.angle;
        emit(index, { ...result, pre: markLocalPhoto(result.pre) });
      } catch {
        if (readSignal.aborted) return;
        emit(index, { error: 'Não foi possível ler esta foto. Tente outra foto ou preencha os dados.' });
      }
    }
  };
  try { await Promise.all(pool.map(run)); }
  finally {
    readSignal.removeEventListener('abort', cancel);
    clearIdleTimer();
    await Promise.all(pool.map(worker => worker.terminate().catch(() => {})));
  }
  // In local-only mode this guarantees every file receives a terminal state.
  // In local + AI mode the caller can still send timed-out photos to its fallback.
  if (timedOut && !signal?.aborted) {
    files.forEach((_, index) => { if (!delivered.has(index)) emit(index, { error: LOCAL_OCR_IDLE_ERROR }); });
  }
}

/** Read a single photo with a dedicated worker. */
export async function readPrePhoto(file: File, progress: (message: string) => void = () => {}, detailed = false) {
  const worker = await createWorker('por');
  try { const result = await readWithWorker(worker, file, progress, undefined, detailed); return { ...result, pre: markLocalPhoto(result.pre) }; }
  finally { await worker.terminate().catch(() => {}); }
}

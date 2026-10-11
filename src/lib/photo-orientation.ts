import { createWorker, PSM, type Worker } from 'tesseract.js';
import { prepareForOcr } from './image-prep';

export type PhotoAngle = 0 | 90 | 180 | 270;
const orientationBudget = 6000;
const directions: PhotoAngle[] = [0, 270, 90, 180];

/** Only a printed document heading/identifier confirms an upright thumbnail. */
export function hasUprightPhotoHeading(text: string): boolean {
  return /PR[EÉ]\s*[-–—]?\s*MANIFESTO|\bDACTE\b|\bDI\s*\d{8,12}\b/i.test(text);
}

/** One short, local orientation pass for the batch; never reads the full table. */
export async function detectPhotoOrientations(
  files: File[],
  onProgress: (index: number, message: string) => void = () => {},
  signal?: AbortSignal,
): Promise<PhotoAngle[]> {
  const angles: PhotoAngle[] = files.map(() => 0);
  if (!files.length || signal?.aborted) return angles;

  let stopped = false;
  let worker: Worker | undefined;
  const preparation = new AbortController();
  const terminated = new Set<Worker>();
  const dispose = (value: Worker | undefined) => {
    if (!value || terminated.has(value)) return;
    terminated.add(value);
    try { void value.terminate().catch(() => {}); } catch { /* Cleanup cannot delay photo reading. */ }
  };
  let stop = () => {};
  const interrupted = new Promise<undefined>(resolve => {
    stop = () => {
      if (stopped) return;
      stopped = true;
      preparation.abort();
      resolve(undefined);
      dispose(worker);
    };
  });
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, orientationBudget);

  // Every pending operation has a rejection handler through Promise.race.
  // A late language download must also release its worker after timeout/abort.
  const bounded = <T>(operation: Promise<T>) => Promise.race([operation, interrupted]);
  try {
    if (signal?.aborted) { stop(); return angles; }
    onProgress(0, 'Ajustando orientação das fotos…');
    if (signal?.aborted) { stop(); return angles; }
    const starting = createWorker('por');
    void starting.then(value => { if (stopped) dispose(value); }).catch(() => {});
    worker = await bounded(starting);
    if (!worker || stopped) return angles;
    await bounded(worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' }));
    if (stopped) return angles;
    for (const [index, file] of files.entries()) {
      if (stopped) break;
      if (index) onProgress(index, 'Ajustando orientação da foto…');
      if (signal?.aborted) { stop(); break; }
      for (const angle of directions) {
        if (stopped) break;
        try {
          const thumbnail = await bounded(prepareForOcr(file, angle, 1400, preparation.signal));
          if (stopped || !thumbnail) break;
          if (thumbnail === file) continue; // Decoder/canvas fallback is the full photo, not a thumbnail.
          const reading = await bounded(worker.recognize(thumbnail));
          if (stopped || !reading) break;
          if (hasUprightPhotoHeading(reading.data.text)) { angles[index] = angle; break; }
        } catch { /* Another thumbnail angle can still be readable. */ }
      }
    }
  } catch { /* Orientation is optional; preserve zero for unconfirmed photos. */ }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    stopped = true;
    preparation.abort();
    dispose(worker);
  }
  return angles;
}

import { createWorker, PSM, type Worker } from "tesseract.js";
import { ocrWorkerOptions } from "./ocr-worker-options";
import {
  prepareBitmapForOcr as prepareForOcr,
  prepareNumericMontage,
  readGrayImage,
} from "./image-prep";
import {
  parsePhotoFields,
  pageWords,
  tableCellRegions,
  tableCtcRegions,
  tableSummaryRegions,
  type OcrPage,
  type PhotoFields,
} from "./photo-fields";
import { montageReadings } from "./photo-ocr";
import { readPreBarcode } from "./pre-barcode";
import { jpegWithoutExif } from "./ocr-jpeg";
import type { PhotoAngle } from "./photo-orientation";
import { hasUprightPhotoHeading } from "./photo-orientation";

export type NumericPhotoRead = {
  pre: PhotoFields;
  confirmed: Partial<Record<"ctc" | "nf" | "volumes", string>>[];
  confirmedHeaders?: Partial<Record<"expectedRows" | "expectedNfs" | "totalVolumes", number>>;
  barcodeId?: string;
  uprightImage?: Blob;
  angle?: PhotoAngle;
  milliseconds: number;
};

function cellConfidence(page: OcrPage, index: number, field: "ctc" | "nf" | "volumes"): number {
  const region = [...tableCtcRegions(page), ...tableCellRegions(page)].find(
    (item) => item.row === index && item.field === field,
  );
  if (!region) return 0;
  const words = pageWords(page).filter((word) => {
    const x = (word.bbox.x0 + word.bbox.x1) / 2,
      y = (word.bbox.y0 + word.bbox.y1) / 2;
    return (
      /\d/.test(word.text) &&
      x >= region.box.x0 &&
      x <= region.box.x1 &&
      y >= region.box.y0 &&
      y <= region.box.y1
    );
  });
  return words.length ? Math.min(...words.map((word) => word.confidence)) : 0;
}

/** Two independent OCR preparations must agree before a numeric cell can
 * replace an AI value. The AI supplies orientation, never numbers or boxes.
 */
export async function readPhotoNumbers(
  file: File,
  angle: PhotoAngle,
  signal?: AbortSignal,
  existingWorker?: Worker,
  ai?: PhotoFields,
): Promise<NumericPhotoRead> {
  const started = performance.now();
  signal?.throwIfAborted();
  const starting = existingWorker
    ? Promise.resolve(existingWorker)
    : createWorker("por", 1, ocrWorkerOptions);
  let worker: Worker | undefined;
  let original: ImageBitmap | undefined;
  let terminated = false;
  const dispose = async (value: Worker) => {
    if (terminated || existingWorker) return;
    terminated = true;
    await value.terminate().catch(() => {});
  };
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(signal?.reason ?? new Error("Leitura interrompida."));
      if (!existingWorker) void starting.then(dispose).catch(() => {});
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
  try {
    worker = await Promise.race([starting, aborted]);
    await Promise.race([
      worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "",
        user_defined_dpi: "300",
      }),
      aborted,
    ]);
    let nativeSource = false;
    let source: Blob | undefined;
    let data: OcrPage | undefined;
    // Most camera JPEGs already contain an upright table in their pixel data.
    // Read it directly first: no JPEG re-encoding, upscaling or thumbnail pass.
    if (ai && file.size <= 18000000) {
      const raw = await Promise.race([jpegWithoutExif(file), aborted]);
      const direct = await Promise.race([
        worker.recognize(raw, {}, { text: true, blocks: true }),
        aborted,
      ]);
      if (
        hasUprightPhotoHeading(direct.data.text) &&
        parsePhotoFields(direct.data).kind === "pre"
      ) {
        source = raw;
        data = direct.data;
        nativeSource = true;
      }
    }
    if (!source || !data) {
      original = await Promise.race([createImageBitmap(file), aborted]);
      const portrait = original.height > original.width;
      const orientationStarted = performance.now();
      const candidates = [
        ...new Set(portrait ? [270, 90, angle, 0, 180] : [angle, 0, 180, 270, 90]),
      ] as PhotoAngle[];
      candidates.sort(
        (a, b) =>
          Number(portrait === (a === 0 || a === 180)) - Number(portrait === (b === 0 || b === 180)),
      );
      for (const candidate of candidates) {
        if (performance.now() - orientationStarted > 3000) break;
        const thumbnail = await Promise.race([
          prepareForOcr(original, candidate, 1400, signal),
          aborted,
        ]);
        const reading = await Promise.race([worker.recognize(thumbnail), aborted]);
        if (hasUprightPhotoHeading(reading.data.text)) {
          angle = candidate;
          break;
        }
      }
      source = await Promise.race([prepareForOcr(original, angle, 3200, signal), aborted]);
      data = (
        await Promise.race([worker.recognize(source, {}, { text: true, blocks: true }), aborted])
      ).data;
    }
    signal?.throwIfAborted();
    const pre = parsePhotoFields(data);
    const confirmed: NumericPhotoRead["confirmed"] = pre.documents.map(() => ({}));
    let barcodeId: string | undefined;
    const confirmedHeaders: NonNullable<NumericPhotoRead["confirmedHeaders"]> = {};
    if (pre.kind === "pre") {
      try {
        barcodeId = readPreBarcode(await readGrayImage(source), data, signal);
      } catch {
        signal?.throwIfAborted();
      }
      const detail = nativeSource
        ? source
        : await Promise.race([prepareForOcr(original!, angle, 3840, signal), aborted]);
      const secondPage = ai
        ? { text: "" }
        : (
            await Promise.race([
              worker.recognize(detail, {}, { text: true, blocks: true }),
              aborted,
            ])
          ).data;
      const second = parsePhotoFields(secondPage);
      if (second.kind === "pre") {
        for (const [index, row] of pre.documents.entries()) {
          const candidates = second.documents.filter(
            (other) =>
              other.ctc === row.ctc &&
              ((pre.documents.filter((item) => item.ctc === row.ctc).length === 1 &&
                second.documents.filter((item) => item.ctc === row.ctc).length === 1) ||
                other.nf.replace("-", "") === row.nf.replace("-", "")),
          );
          if (candidates.length !== 1) continue;
          const other = candidates[0]!;
          for (const field of ["ctc", "nf", "volumes"] as const) {
            const valid =
              field === "ctc"
                ? /^\d{10}$/
                : field === "nf"
                  ? /^\d{1,9}-\d{1,3}$/
                  : /^[1-9]\d{0,5}$/;
            const value = valid.test(row[field]) ? row[field] : other[field];
            const equal =
              field === "nf"
                ? row.nf.replace("-", "") === other.nf.replace("-", "")
                : row[field] === other[field];
            const confidence = [
              cellConfidence(data, index, field),
              cellConfidence(secondPage, second.documents.indexOf(other), field),
            ];
            if (
              equal &&
              valid.test(value) &&
              Math.min(...confidence) >= 70 &&
              Math.max(...confidence) >= 85
            )
              confirmed[index]![field] = value;
          }
        }
        for (const field of ["expectedRows", "expectedNfs", "totalVolumes"] as const)
          if (pre[field] && pre[field] === second[field]) confirmedHeaders[field] = pre[field]!;
        if (!barcodeId)
          try {
            barcodeId = readPreBarcode(await readGrayImage(detail), secondPage, signal);
          } catch {
            signal?.throwIfAborted();
          }
      }
      const regions = [...tableCtcRegions(data), ...tableCellRegions(data)]
        .filter((region) => {
          if (confirmed[region.row]?.[region.field]) return false;
          if (!ai) return true;
          const row = pre.documents[region.row]!;
          const candidates = ai.documents.filter(
            (other) =>
              other.ctc === row.ctc &&
              ((ai.documents.filter((item) => item.ctc === row.ctc).length === 1 &&
                pre.documents.filter((item) => item.ctc === row.ctc).length === 1) ||
                other.nf.replace("-", "") === row.nf.replace("-", "")),
          );
          if (region.field === "ctc") return !ai.documents.some((other) => other.ctc === row.ctc);
          return (
            candidates.length === 1 &&
            row[region.field].replace("-", "") !== candidates[0]![region.field].replace("-", "")
          );
        })
        .slice(0, 180);
      const summary = tableSummaryRegions(data)
        .filter((region) => !confirmedHeaders[region.field as keyof typeof confirmedHeaders])
        .map((region) => ({ ...region, row: -1 }));
      const remaining = [...regions, ...summary];
      // Keep completed evidence when a slow phone leaves little budget for
      // optional crops. Missing confirmations remain explicit in the form.
      if (remaining.length && performance.now() - started < 6500) {
        // Keep small glyphs from the source resolution. This confirmation uses
        // a higher-resolution crop independently of the page recognition.
        const longest = original ? Math.max(original.width, original.height) : 1,
          swap = angle === 90 || angle === 270;
        const size = (limit: number) => [
          Math.round((swap ? original!.height : original!.width) * Math.min(3, limit / longest)),
          Math.round((swap ? original!.width : original!.height) * Math.min(3, limit / longest)),
        ];
        const small = nativeSource ? [1, 1] : size(3200),
          large = nativeSource ? [1, 1] : size(3840),
          sx = large[0]! / small[0]!,
          sy = large[1]! / small[1]!;
        const boxes = remaining.map(({ box }) => ({
          x0: box.x0 * sx,
          x1: box.x1 * sx,
          y0: box.y0 * sy,
          y1: box.y1 * sy,
        }));
        const montage = await Promise.race([
          prepareNumericMontage(detail, boxes, { separateDigits: false, signal }),
          aborted,
        ]);
        await Promise.race([
          worker.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
            tessedit_char_whitelist: "0123456789-",
            user_defined_dpi: "300",
          }),
          aborted,
        ]);
        const { data: cells } = await Promise.race([
          worker.recognize(montage.image, {}, { text: true, blocks: true }),
          aborted,
        ]);
        montageReadings(cells, montage.cells).forEach((reading, index) => {
          const region = remaining[index]!;
          if (
            region.field === "expectedRows" ||
            region.field === "expectedNfs" ||
            region.field === "totalVolumes"
          ) {
            if (
              reading &&
              reading.confidence >= 85 &&
              /^[1-9]\d{0,5}$/.test(reading.text) &&
              Number(reading.text) === pre[region.field]
            )
              confirmedHeaders[region.field] = Number(reading.text);
            return;
          }
          const row = pre.documents[region.row];
          const valid =
            region.field === "ctc"
              ? /^\d{10}$/
              : region.field === "nf"
                ? /^\d{1,9}-\d{1,3}$/
                : /^[1-9]\d{0,5}$/;
          const sameDigits =
            region.field === "nf" &&
            /^\d{3,12}$/.test(row?.nf ?? "") &&
            row?.nf === reading?.text.replace("-", "");
          if (
            row &&
            reading &&
            reading.confidence >= 85 &&
            valid.test(reading.text) &&
            (row[region.field] === reading.text || sameDigits) &&
            !row.review?.some((note) => /recuper|calcul|infer|separador|série.*outras/i.test(note))
          )
            confirmed[region.row]![region.field] = reading.text;
          else if (
            row &&
            !row[region.field] &&
            reading &&
            reading.confidence >= 85 &&
            valid.test(reading.text)
          )
            row[region.field] = reading.text;
        });
      }
    }
    signal?.throwIfAborted();
    return {
      pre,
      confirmed,
      confirmedHeaders,
      ...(nativeSource ? { uprightImage: source } : { angle }),
      ...(barcodeId ? { barcodeId } : {}),
      milliseconds: Math.round(performance.now() - started),
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
    original?.close();
    if (worker) await dispose(worker);
  }
}

/** Warm a bounded pool while the network read runs, then reuse it for the
 * entire import. Workers and their last image are released when the batch ends.
 */
export function createPhotoNumericVerifier(size: 1 | 2) {
  let closed = false,
    next = 0;
  const released = new Set<Worker>();
  const disposeWorker = async (worker: Worker) => {
    if (!released.has(worker)) {
      released.add(worker);
      await worker.terminate().catch(() => {});
    }
  };
  const start = () => {
    const pending = createWorker("por", 1, ocrWorkerOptions);
    void pending
      .then((worker) => {
        if (closed) void disposeWorker(worker);
      })
      .catch(() => {});
    return pending;
  };
  const slots = Array.from({ length: size }, () => ({
    worker: start() as Promise<Worker> | undefined,
    queue: Promise.resolve() as Promise<unknown>,
  }));
  return {
    read(file: File, angle: PhotoAngle, signal: AbortSignal, ai?: PhotoFields) {
      const slot = slots[next++ % slots.length]!;
      const task = slot.queue
        .catch(() => {})
        .then(async () => {
          signal.throwIfAborted();
          if (closed) throw new Error("Leitura interrompida.");
          const pending = (slot.worker ??= start());
          let rejectStopped!: (reason: unknown) => void;
          const stopped = new Promise<never>((_, reject) => {
            rejectStopped = reject;
          });
          const cancel = () => {
            rejectStopped(signal.reason ?? new Error("Leitura interrompida."));
            if (slot.worker === pending) slot.worker = undefined;
            void pending.then(disposeWorker).catch(() => {});
          };
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) cancel();
          try {
            const worker = await Promise.race([pending, stopped]);
            signal.throwIfAborted();
            if (closed) throw new Error("Leitura interrompida.");
            return await readPhotoNumbers(file, angle, signal, worker, ai);
          } catch (error) {
            cancel();
            throw error;
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        });
      slot.queue = task;
      return task;
    },
    dispose() {
      closed = true;
      for (const slot of slots)
        if (slot.worker) {
          void slot.worker.then(disposeWorker).catch(() => {});
          slot.worker = undefined;
        }
    },
  };
}

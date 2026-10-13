import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap';
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader';
import Code39Reader from '@zxing/library/esm/core/oned/Code39Reader';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource';
import type { OcrPage, OcrWord } from './photo-fields';
import { clean, pageWords } from './photo-fields';
import type { GrayImage } from './printed-digits';

/** Scan only the barcode associated with this page's printed pré heading/ID.
 * Fiscal keys and background sheets must never become a CTC or a pré number.
 */
export function preBarcodeRegions(page: OcrPage, width: number, height: number): OcrWord['bbox'][] {
  const words = pageWords(page);
  const id = words.find(word => /^D[I1L|][A-Z0-9|]{4,14}$/i.test(word.text));
  if (id) {
    const h = id.bbox.y1 - id.bbox.y0;
    return [{ x0: Math.max(0, id.bbox.x0 - h * 2), x1: Math.min(width, id.bbox.x1 + h * 2),
      y0: Math.max(0, id.bbox.y0 - h * 4), y1: Math.min(height, id.bbox.y0 + h * .1) }];
  }
  const title = words.find(word => /^PREMANIFESTO$/.test(clean(word.text)));
  if (!title) return [];
  const h = title.bbox.y1 - title.bbox.y0;
  return [{ x0: title.bbox.x1, x1: width, y0: Math.max(0, title.bbox.y0 - h), y1: Math.min(height, title.bbox.y1 + h * .6) }];
}

export function readPreBarcode(gray: GrayImage, page: OcrPage, signal?: AbortSignal): string | undefined {
  const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
  const readers = [new Code39Reader(), new Code128Reader()];
  for (const box of preBarcodeRegions(page, gray.width, gray.height)) {
    signal?.throwIfAborted();
    const x = Math.floor(box.x0), y = Math.floor(box.y0), width = Math.floor(box.x1) - x, height = Math.floor(box.y1) - y;
    if (width < 50 || height < 5) continue;
    for (const reader of readers) try {
      const source = new RGBLuminanceSource(new Uint8ClampedArray(gray.pixels.buffer, gray.pixels.byteOffset, gray.pixels.byteLength), width, height, gray.width, gray.height, x, y);
      const value = reader.decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText().trim();
      signal?.throwIfAborted();
      if (/^DI\d{8,12}$/.test(value)) return value;
    } catch { signal?.throwIfAborted(); /* Keep the printed OCR ID when the barcode is not decodable. */ }
  }
  return undefined;
}

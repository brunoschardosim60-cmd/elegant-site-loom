import { describe, expect, it } from 'vitest';
import { recoverNfSeparator } from '@/lib/ocr-numeric';

function printedCell(before = 5, after = 1, separator = true, darkPaper = false) {
  const width = 120, height = 24, pixels = new Uint8Array(width * height).fill(darkPaper ? 100 : 220);
  const fill = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) pixels[y * width + x] = darkPaper ? 20 : 40;
  };
  for (let i = 0; i < before; i++) fill(5 + i * 10, 5, 4, 14);
  const dash = 5 + before * 10;
  if (separator) fill(dash, 11, 4, 2);
  for (let i = 0; i < after; i++) fill(dash + 10 + i * 10, 5, 4, 14);
  return { image: { width, height, pixels }, box: { x0: 0, x1: width, y0: 0, y1: height }, fill };
}

describe('Printed NF separator', () => {
  it('inserts a visible separator while preserving every OCR digit and leading zero', () => {
    const { image, box } = printedCell();
    expect(recoverNfSeparator(image, box, '012341')).toBe('01234-1');
  });
  it('uses the visible number of series glyphs rather than assuming series1', () => {
    const { image, box } = printedCell(4, 2);
    expect(recoverNfSeparator(image, box, '123410')).toBe('1234-10');
  });
  it('keeps its contrast relative to dark local paper and ignores border rules', () => {
    const { image, box, fill } = printedCell(5, 1, true, true);
    fill(0, 22, image.width, 1); fill(0, 0, 1, image.height);
    expect(recoverNfSeparator(image, box, '012341')).toBe('01234-1');
  });
  it('does not infer a separator when no dash is visible or when the reading already includes one', () => {
    const { image, box } = printedCell(5, 1, false);
    expect(recoverNfSeparator(image, box, '123451')).toBeUndefined();
    expect(recoverNfSeparator(image, box, '12345-1')).toBeUndefined();
    expect(recoverNfSeparator(image, box, '')).toBeUndefined();
  });
  it('rejects multiple plausible separators instead of choosing one', () => {
    const { image, box, fill } = printedCell(3, 3);
    fill(60, 11, 4, 2);
    expect(recoverNfSeparator(image, box, '123456')).toBeUndefined();
  });
});

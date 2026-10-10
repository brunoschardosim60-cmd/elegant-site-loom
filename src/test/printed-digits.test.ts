import { expect, it } from 'vitest';
import { buildDigitTemplates, matchPrintedNumber, type GrayImage } from '@/lib/printed-digits';
const glyphs = ['01110/10001/10011/10101/11001/10001/01110','00100/01100/00100/00100/00100/00100/01110','01110/10001/00001/00010/00100/01000/11111','11110/00001/00001/01110/00001/00001/11110','00010/00110/01010/10010/11111/00010/00010','11111/10000/10000/11110/00001/00001/11110','01110/10000/10000/11110/10001/10001/01110','11111/00001/00010/00100/01000/01000/01000','01110/10001/10001/01110/10001/10001/01110','01110/10001/10001/01111/00001/00001/01110'];
function print(text: string): GrayImage {
  const width = text.length * 18, height = 27, pixels = new Uint8Array(width * height).fill(255);
  for (const [i, digit] of [...text].entries()) for (const [y, line] of glyphs[Number(digit)]!.split('/').entries()) for (const [x, ink] of [...line].entries()) if (ink === '1') for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) pixels[(y * 3 + dy + 3) * width + i * 18 + x * 3 + dx] = 0;
  return { width, height, pixels };
}
it('recognizes small numbers using clear examples from the page', () => {
  const examples = print('0123456789');
  const templates = buildDigitTemplates(examples, [{ text: '0123456789', confidence: 99, bbox: { x0: 0, y0: 3, x1: examples.width, y1: 24 } }]);
  const image = print('20');
  expect(matchPrintedNumber(image, { x0: 0, y0: 0, x1: image.width, y1: image.height }, templates)?.value).toBe('20');
});
it('does not guess when the page lacks reliable digit examples', () => {
  const image = print('20');
  const templates = buildDigitTemplates(image, [{ text: '1234567890', confidence: 20, bbox: { x0: 0, y0: 0, x1: image.width, y1: image.height } }]);
  expect(matchPrintedNumber(image, { x0: 0, y0: 0, x1: image.width, y1: image.height }, templates)).toBeUndefined();
});

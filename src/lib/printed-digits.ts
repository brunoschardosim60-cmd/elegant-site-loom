/** Match small printed digits against examples read elsewhere on the same page. */
export type GrayImage = { width: number; height: number; pixels: Uint8Array };
export type Box = { x0: number; y0: number; x1: number; y1: number };
type Mask = { width: number; height: number; pixels: Uint8Array };
export type DigitTemplates = Map<string, Uint8Array[]>;
function patch(image: GrayImage, box: Box): Mask {
  const left = Math.max(0, Math.round(box.x0)), top = Math.max(0, Math.round(box.y0));
  const width = Math.max(1, Math.min(image.width, Math.round(box.x1)) - left), height = Math.max(1, Math.min(image.height, Math.round(box.y1)) - top);
  const values = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = image.pixels[(top + y) * image.width + left + x]!;
  const sorted = values.slice().sort();
  const threshold = (sorted[Math.floor(sorted.length * .08)]! + sorted[Math.floor(sorted.length * .7)]!) / 2;
  return { width, height, pixels: values.map(value => Number(value < threshold)) };
}
function normalize(mask: Mask, left = 0, right = mask.width): Uint8Array | undefined {
  let x0 = right, x1 = left, y0 = mask.height, y1 = 0;
  for (let y = 0; y < mask.height; y++) for (let x = left; x < right; x++) if (mask.pixels[y * mask.width + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  if (x1 <= x0 || y1 <= y0) return;
  const output = new Uint8Array(16 * 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) output[y * 16 + x] = mask.pixels[(y0 + Math.min(y1 - y0 - 1, Math.floor((y + .5) * (y1 - y0) / 24))) * mask.width + x0 + Math.min(x1 - x0 - 1, Math.floor((x + .5) * (x1 - x0) / 16))]!;
  return output;
}
export function buildDigitTemplates(image: GrayImage, words: { text: string; confidence: number; bbox: Box }[]): DigitTemplates {
  const templates: DigitTemplates = new Map();
  const candidates = words.filter(word => /^\d{10}$/.test(word.text) && word.confidence >= 80);
  const minX = Math.min(...candidates.map(word => word.bbox.x0));
  for (const word of candidates) {
    if (word.bbox.x0 > minX + (word.bbox.y1 - word.bbox.y0) * 5) continue;
    const step = (word.bbox.x1 - word.bbox.x0) / word.text.length;
    for (const [index, digit] of [...word.text].entries()) {
      const glyph = normalize(patch(image, { ...word.bbox, x0: word.bbox.x0 + index * step, x1: word.bbox.x0 + (index + 1) * step }));
      if (glyph) templates.set(digit, [...(templates.get(digit) ?? []), glyph]);
    }
  }
  return templates;
}
export function matchPrintedNumber(image: GrayImage, box: Box, templates: DigitTemplates): { value: string; certain: boolean } | undefined {
  if (templates.size < 6) return;
  const mask = patch(image, box);
  const groups: { left: number; right: number }[] = [];
  for (let x = 0; x < mask.width; x++) {
    let ink = 0; for (let y = 0; y < mask.height; y++) ink += mask.pixels[y * mask.width + x]!;
    if (ink <= 2) continue;
    const last = groups.at(-1);
    if (last && last.right === x) last.right = x + 1; else groups.push({ left: x, right: x + 1 });
  }
  const pieces: { left: number; right: number }[] = [];
  for (const group of groups) {
    let top = mask.height, bottom = 0;
    for (let y = 0; y < mask.height; y++) for (let x = group.left; x < group.right; x++) if (mask.pixels[y * mask.width + x]) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
    const h = bottom - top, w = group.right - group.left;
    if (h < mask.height * .3 || w < h * .2 || w > h * 3.5) continue;
    const count = w > h * .8 ? Math.max(1, Math.round(w / (h * .52))) : 1;
    for (let i = 0; i < count; i++) pieces.push({ left: group.left + Math.round(i * w / count), right: group.left + Math.round((i + 1) * w / count) });
  }
  if (!pieces.length || pieces.length > 4) return;
  let value = '', certain = true;
  for (const piece of pieces) {
    const glyph = normalize(mask, piece.left, piece.right);
    if (!glyph) return;
    const scores = [...templates.entries()].map(([digit, examples]) => ({ digit, score: Math.min(...examples.map(example => { let mismatch = 0; for (let i = 0; i < glyph.length; i++) mismatch += Number(glyph[i] !== example[i]); return mismatch / glyph.length; })) })).sort((a, b) => a.score - b.score);
    if (!scores[0] || scores[0].score > .34) return;
    const margin = (scores[1]?.score ?? 1) - scores[0].score;
    if (margin < .045) return;
    certain = certain && scores[0].score < .26 && margin > .08;
    value += scores[0].digit;
  }
  return Number(value) > 0 ? { value, certain } : undefined;
}

import type { Box, GrayImage } from "./printed-digits";

/** Recover only the printed separator; never infer or replace an NF digit. */
export function recoverNfSeparator(image: GrayImage, box: Box, value: string): string | undefined {
  if (!/^\d{3,12}$/.test(value)) return;
  const left = Math.max(0, Math.floor(box.x0)),
    top = Math.max(0, Math.floor(box.y0));
  const width = Math.min(image.width, Math.ceil(box.x1)) - left,
    height = Math.min(image.height, Math.ceil(box.y1)) - top;
  if (width <= 0 || height <= 0) return;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      gray[y * width + x] = image.pixels[(top + y) * image.width + left + x]!;
  const sorted = gray.slice().sort();
  const threshold =
    (sorted[Math.floor(sorted.length * 0.08)]! + sorted[Math.floor(sorted.length * 0.8)]!) / 2;
  const ink = gray.map((pixel) => Number(pixel < threshold));
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) count += ink[y * width + x]!;
    if (count > width * 0.7) for (let x = 0; x < width; x++) ink[y * width + x] = 0;
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) count += ink[y * width + x]!;
    if (count > height * 0.85) for (let y = 0; y < height; y++) ink[y * width + x] = 0;
  }
  let textTop = height,
    textBottom = 0;
  const columns = Array.from({ length: width }, (_, x) => {
    let y0 = height,
      y1 = 0,
      count = 0;
    for (let y = 0; y < height; y++)
      if (ink[y * width + x]) {
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y + 1);
        count++;
      }
    if (count > 2) {
      textTop = Math.min(textTop, y0);
      textBottom = Math.max(textBottom, y1);
    }
    return { y0, y1, count };
  });
  const fontHeight = textBottom - textTop;
  if (fontHeight < 4) return;
  const dashes: { left: number; right: number }[] = [];
  for (const [x, column] of columns.entries()) {
    const center = (column.y0 + column.y1) / 2;
    if (
      !column.count ||
      column.y1 - column.y0 > fontHeight * 0.3 ||
      center < textTop + fontHeight * 0.3 ||
      center > textTop + fontHeight * 0.8
    )
      continue;
    const last = dashes.at(-1);
    if (last?.right === x) last.right = x + 1;
    else dashes.push({ left: x, right: x + 1 });
  }
  const digitGroups = (start: number, end: number) => {
    const groups: { left: number; right: number }[] = [];
    for (let x = start; x < end; x++) {
      if (columns[x]!.y1 - columns[x]!.y0 < fontHeight * 0.5) continue;
      const last = groups.at(-1);
      if (last?.right === x) last.right = x + 1;
      else groups.push({ left: x, right: x + 1 });
    }
    return groups;
  };
  const candidates = dashes
    .filter(
      (dash) =>
        dash.right - dash.left >= Math.max(2, fontHeight * 0.14) &&
        dash.right - dash.left < fontHeight * 0.8,
    )
    .map((dash) => ({
      dash,
      before: digitGroups(0, dash.left),
      after: digitGroups(dash.right, width),
    }))
    .filter(
      (item) =>
        item.before.length > 0 &&
        item.after.length >= 1 &&
        item.after.length <= 3 &&
        item.after.every((group) => group.right - group.left >= fontHeight * 0.12),
    );
  if (candidates.length !== 1) return;
  const seriesLength = candidates[0]!.after.length;
  if (value.length - seriesLength < 2) return;
  return `${value.slice(0, -seriesLength)}-${value.slice(-seriesLength)}`;
}

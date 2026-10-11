/** Preserve small printed digits while resizing and rotating the photo. */
export async function prepareForOcr(file: File, rotation: 0 | 90 | 180 | 270 = 0, maxSize = 3840, signal?: AbortSignal): Promise<Blob> {
  let bitmap: ImageBitmap | undefined;
  try {
    signal?.throwIfAborted();
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    signal?.throwIfAborted();
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(3, maxSize / longest);
    const canvas = document.createElement('canvas');
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const sideways = rotation === 90 || rotation === 270;
    canvas.width = sideways ? height : width;
    canvas.height = sideways ? width : height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
    signal?.throwIfAborted();
    const prepared = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b ?? file), 'image/png'));
    signal?.throwIfAborted();
    return prepared;
  } catch { return file; }
  finally { bitmap?.close(); }
}

/** Enhance small table cells; process one decoded bitmap for all regions. */
export async function readGrayImage(source: Blob) {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round((data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]!) / 3);
    return { pixels, width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

export async function prepareTableCells(source: Blob, boxes: { x0: number; y0: number; x1: number; y1: number }[]): Promise<Blob[]> {
  const bitmap = await createImageBitmap(source);
  try {
    const result: Blob[] = [];
    for (const box of boxes) {
      const x = Math.max(0, box.x0), y = Math.max(0, box.y0);
      const w = Math.min(bitmap.width - x, box.x1 - x), h = Math.min(bitmap.height - y, box.y1 - y);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * 2 + 40); canvas.height = Math.ceil(h * 2 + 40);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || w <= 0 || h <= 0) { result.push(source); continue; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, x, y, w, h, 20, 20, w * 2, h * 2);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = new Float32Array(canvas.width * canvas.height);
      for (let i = 0; i < gray.length; i++) gray[i] = (pixels.data[i * 4]! + pixels.data[i * 4 + 1]! + pixels.data[i * 4 + 2]!) / 3;
      for (let yy = 2; yy < canvas.height - 2; yy++) for (let xx = 2; xx < canvas.width - 2; xx++) {
        const i = yy * canvas.width + xx;
        let blur = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blur += gray[i + dy * canvas.width + dx]!;
        const sharp = gray[i]! + 1.8 * (gray[i]! - blur / 25);
        const g = sharp < 155 ? 0 : 255;
        pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = g;
      }
      ctx.putImageData(pixels, 0, 0);
      result.push(await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b ?? source), 'image/png')));
    }
    return result;
  } finally { bitmap.close(); }
}

/** Isolate a small printed field from table lines and nearby barcode bars. */
export async function preparePrintedField(source: Blob, box: { x0: number; y0: number; x1: number; y1: number }): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const height = box.y1 - box.y0;
    const x = Math.max(0, box.x0 - height * 2);
    const y = Math.max(0, box.y0 - height * 0.3);
    const width = Math.min(bitmap.width - x, box.x1 - x + height * 6);
    const cropHeight = Math.min(bitmap.height - y, height * 1.6);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width + 40); canvas.height = Math.ceil(cropHeight + 40);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return source;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, x, y, width, cropHeight, 20, 20, width, cropHeight);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const g = (pixels.data[i]! + pixels.data[i + 1]! + pixels.data[i + 2]!) / 3 < 160 ? 0 : 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = g;
    }
    ctx.putImageData(pixels, 0, 0);
    return await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b ?? source), 'image/png'));
  } finally { bitmap.close(); }
}

type NumericBox = { x0: number; y0: number; x1: number; y1: number };

/** Adapt to the paper's local brightness and remove long rules, keeping glyphs. */
export function cleanNumericPixels(pixels: Uint8ClampedArray, width: number, height: number, contrast = .55): void {
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) { gray[i] = Math.round((pixels[i * 4]! + pixels[i * 4 + 1]! + pixels[i * 4 + 2]!) / 3); histogram[gray[i]!]!++; }
  const percentile = (fraction: number) => { let count = 0; for (let value = 0; value < 256; value++) { count += histogram[value]!; if (count >= gray.length * fraction) return value; } return 255; };
  const ink = percentile(.02); const paper = percentile(.8);
  const threshold = ink + (paper - ink) * contrast;
  const rules = new Set<number>();
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) if (gray[y * width + x]! < threshold) dark++;
    if (dark > width * .72) rules.add(y);
  }
  for (let i = 0; i < gray.length; i++) {
    const value = rules.has(Math.floor(i / width)) || gray[i]! >= threshold ? 255 : 0;
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = value;
  }
}

/** Separate touching printed digits before OCR; this does not classify any digit. */
export function separateNumericGlyphs(pixels: Uint8ClampedArray, width: number, height: number) {
  // Perspective leaves fragments of the neighboring table rule in a cell.
  // Use the tallest band of ink so a one-pixel rule does not join two digits.
  const bands: { top: number; bottom: number }[] = [];
  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4]! < 128) ink++;
    if (ink <= 2) continue;
    const last = bands.at(-1);
    if (last && y - last.bottom <= 2) last.bottom = y + 1;
    else bands.push({ top: y, bottom: y + 1 });
  }
  const band = bands.sort((a, b) => (b.bottom - b.top) - (a.bottom - a.top))[0];
  if (!band || band.bottom - band.top < height * .25) return { pixels, width, height };
  const runs: { left: number; right: number }[] = [];
  for (let x = 0; x < width; x++) {
    let ink = 0;
    for (let y = band.top; y < band.bottom; y++) if (pixels[(y * width + x) * 4]! < 128) ink++;
    if (ink <= 2) continue;
    const last = runs.at(-1);
    if (last && last.right === x) last.right = x + 1;
    else runs.push({ left: x, right: x + 1 });
  }
  const pieces: { left: number; right: number }[] = [];
  for (const run of runs) {
    let top = height, bottom = 0;
    for (let y = band.top; y < band.bottom; y++) for (let x = run.left; x < run.right; x++) if (pixels[(y * width + x) * 4]! < 128) { top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
    const h = bottom - top, w = run.right - run.left;
    if (h < height * .3 || w < h * .12 || w > h * 3.5) continue;
    const count = w > h * .85 ? Math.max(1, Math.round(w / (h * .55))) : 1;
    for (let i = 0; i < count; i++) pieces.push({ left: run.left + Math.round(i * w / count), right: run.left + Math.round((i + 1) * w / count) });
  }
  if (!pieces.length || pieces.length > 4) return { pixels, width, height };
  const gap = 20, outputWidth = pieces.reduce((sum, piece) => sum + piece.right - piece.left, gap * (pieces.length + 1));
  const output = new Uint8ClampedArray(outputWidth * height * 4).fill(255);
  let left = gap;
  for (const piece of pieces) {
    for (let y = band.top; y < band.bottom; y++) for (let x = piece.left; x < piece.right; x++) {
      const from = (y * width + x) * 4, to = (y * outputWidth + left + x - piece.left) * 4;
      for (let c = 0; c < 4; c++) output[to + c] = pixels[from + c]!;
    }
    left += piece.right - piece.left + gap;
  }
  return { pixels: output, width: outputWidth, height };
}

/** One image/recognition for many small fields; positions keep missing reads from shifting rows. */
export async function prepareNumericMontage(source: Blob, boxes: NumericBox[], options: { separateDigits?: boolean; signal?: AbortSignal | undefined } = {}) {
  const active = () => { if (options.signal?.aborted) throw new Error('Leitura interrompida.'); };
  active();
  const bitmap = await createImageBitmap(source);
  try {
    active();
    const scale = options.separateDigits ? 3 : 2; const padding = 16;
    const clipped = boxes.map(box => ({ x0: Math.max(0, Math.floor(box.x0)), y0: Math.max(0, Math.floor(box.y0)),
      x1: Math.min(bitmap.width, Math.ceil(box.x1)), y1: Math.min(bitmap.height, Math.ceil(box.y1)) }));
    if (clipped.some(box => box.x1 <= box.x0 || box.y1 <= box.y0)) throw new Error('Invalid numeric region');
    const slotHeight = Math.max(80, ...clipped.map(box => (box.y1 - box.y0) * scale + padding * 2));
    const width = Math.max(100, ...clipped.map(box => (box.x1 - box.x0) * scale + padding * 2 + (options.separateDigits ? 100 : 0)));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = slotHeight * boxes.length;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cells = clipped.map((box, index) => {
      active();
      const w = box.x1 - box.x0, h = box.y1 - box.y0;
      const cell = document.createElement('canvas'); cell.width = w * scale; cell.height = h * scale;
      const cellContext = cell.getContext('2d', { willReadFrequently: true });
      if (!cellContext) throw new Error('Canvas unavailable');
      cellContext.drawImage(bitmap, box.x0, box.y0, w, h, 0, 0, cell.width, cell.height);
      const data = cellContext.getImageData(0, 0, cell.width, cell.height); cleanNumericPixels(data.data, cell.width, cell.height, options.separateDigits ? .6 : .55);
      if (options.separateDigits) {
        const separated = separateNumericGlyphs(data.data, cell.width, cell.height);
        cell.width = separated.width; cell.height = separated.height;
        cellContext.putImageData(new ImageData(new Uint8ClampedArray(separated.pixels), separated.width, separated.height), 0, 0);
      } else cellContext.putImageData(data, 0, 0);
      const target = { x0: padding, y0: index * slotHeight + padding, x1: padding + cell.width, y1: index * slotHeight + padding + cell.height };
      ctx.drawImage(cell, target.x0, target.y0);
      return { box, target };
    });
    active();
    const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image unavailable')), 'image/png'));
    active();
    return { image, cells };
  } finally { bitmap.close(); }
}

/** Keep a whole numeric column in one recognition instead of one call per row. */
export async function prepareNumericColumn(source: Blob, box: NumericBox) {
  const bitmap = await createImageBitmap(source);
  try {
    const x = Math.max(0, Math.floor(box.x0)), y = Math.max(0, Math.floor(box.y0));
    const width = Math.min(bitmap.width - x, Math.ceil(box.x1) - x), height = Math.min(bitmap.height - y, Math.ceil(box.y1) - y);
    if (width <= 0 || height <= 0) throw new Error('Invalid numeric column');
    const crop = document.createElement('canvas'); crop.width = width; crop.height = height;
    const context = crop.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height); cleanNumericPixels(data.data, width, height); context.putImageData(data, 0, 0);
    const padding = 20; const canvas = document.createElement('canvas'); canvas.width = width + padding * 2; canvas.height = height + padding * 2;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(crop, padding, padding);
    const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image unavailable')), 'image/png'));
    return { image, x, y, padding };
  } finally { bitmap.close(); }
}

/** Preserve small printed digits while resizing and rotating the photo. */
export async function prepareForOcr(file: File, rotation: 0 | 90 | 180 | 270 = 0, maxSize = 3840): Promise<Blob> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
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
    return await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b ?? file), 'image/png'));
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

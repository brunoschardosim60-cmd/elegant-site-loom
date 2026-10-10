/** Prepares a phone photo for OCR: caps/upsamples size, converts to grayscale and stretches contrast. Falls back to the original file. */
export async function prepareForOcr(file: File): Promise<Blob> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(2400 / longest, Math.max(1, 1800 / longest));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data; const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < d.length; i += 4) { const g = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!); d[i] = d[i + 1] = d[i + 2] = g; hist[g]!++; }
    const total = d.length / 4; let acc = 0; let lo = 0; let hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= total * 0.01) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc >= total * 0.01) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const g = Math.max(0, Math.min(255, ((d[i]! - lo) * 255) / range)); d[i] = d[i + 1] = d[i + 2] = g; }
    ctx.putImageData(img, 0, 0);
    return await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b ?? file), 'image/png'));
  } catch { return file; }
  finally { bitmap?.close(); }
}

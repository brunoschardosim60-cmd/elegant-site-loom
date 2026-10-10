/** Preserve small printed digits while resizing and rotating the photo. */
export async function prepareForOcr(file: File, rotation: 0 | 90 | 180 | 270 = 0): Promise<Blob> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(3, 3840 / longest);
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

/** Isolate a small printed field from table lines and nearby barcode bars. */
export async function preparePrintedField(source: Blob, box: { x0: number; y0: number; x1: number; y1: number }): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const height = box.y1 - box.y0;
    const x = Math.max(0, box.x0 - height * 2);
    const y = Math.max(0, box.y0 - height * 0.3);
    const width = Math.min(bitmap.width - x, box.x1 - x + height * 2);
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

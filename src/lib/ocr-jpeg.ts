/** Remove only EXIF metadata, preserving every compressed JPEG pixel byte.
 * This lets the OCR engine and crop decoder use the same coordinate system.
 */
export async function jpegWithoutExif(file: File): Promise<Blob> {
  if (!/jpe?g/i.test(file.type)) return file;
  const bytes = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  if (bytes[0] !== 255 || bytes[1] !== 216) return file;
  const pieces: Blob[] = [];
  let offset = 2, kept = 0, changed = false;
  while (offset + 4 <= bytes.length && bytes[offset] === 255) {
    const marker = bytes[offset + 1]!;
    if (marker === 218 || marker === 217) break;
    const length = bytes[offset + 2]! * 256 + bytes[offset + 3]!;
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return file;
    if (marker === 225 && bytes[offset + 4] === 69 && bytes[offset + 5] === 120 && bytes[offset + 6] === 105 && bytes[offset + 7] === 102 && bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
      pieces.push(file.slice(kept, offset)); kept = end; changed = true;
    }
    offset = end;
  }
  if (!changed) return file;
  pieces.push(file.slice(kept));
  return new Blob(pieces, { type: file.type });
}

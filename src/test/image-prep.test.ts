import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanNumericPixels, prepareForOcr } from '@/lib/image-prep';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Photo preparation', () => {
  it('removes a long horizontal table rule while preserving separate printed strokes', () => {
    const width = 20, height = 20, pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const dark = (x: number, y: number) => { for (let c = 0; c < 3; c++) pixels[(y * width + x) * 4 + c] = 50; };
    for (let x = 0; x < width; x++) dark(x, 18);
    for (let y = 4; y < 12; y++) dark(8, y);
    cleanNumericPixels(pixels, width, height);
    expect(pixels[(18 * width + 8) * 4]).toBe(255);
    expect(pixels[(8 * width + 8) * 4]).toBe(0);
    expect(pixels[(8 * width + 8) * 4 + 3]).toBe(255);
  });
  it('uses local paper brightness so a dark photo does not become one erased rule', () => {
    const width = 20, height = 20, pixels = new Uint8ClampedArray(width * height * 4).fill(100);
    for (let y = 4; y < 12; y++) for (let x = 7; x < 10; x++) for (let c = 0; c < 3; c++) pixels[(y * width + x) * 4 + c] = 20;
    cleanNumericPixels(pixels, width, height);
    expect(pixels[(8 * width + 8) * 4]).toBe(0);
    expect(pixels[(8 * width + 2) * 4]).toBe(255);
  });
  it('keeps the original image when decoding fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
    const file = new File(['image'], 'photo.jpg');
    expect(await prepareForOcr(file)).toBe(file);
  });

  it('releases the decoded bitmap even when a canvas is unavailable', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const file = new File(['image'], 'photo.jpg');
    expect(await prepareForOcr(file)).toBe(file);
    expect(close).toHaveBeenCalledOnce();
  });
});

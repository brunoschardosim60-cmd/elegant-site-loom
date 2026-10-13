import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanNumericPixels, prepareForOcr, separateNumericGlyphs } from '@/lib/image-prep';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Photo preparation', () => {
  it('separates touching numeric glyphs without letting a nearby rule join them', () => {
    const width = 40, height = 40, pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const dark = (x: number, y: number) => { for (let c = 0; c < 3; c++) pixels[(y * width + x) * 4 + c] = 0; };
    for (let y = 8; y < 28; y++) for (let x = 3; x < 23; x++) dark(x, y);
    for (let x = 0; x < 13; x++) dark(x, 37);
    const separated = separateNumericGlyphs(pixels, width, height);
    expect(separated.width).toBe(80);
    expect(separated.pixels[(15 * separated.width + 25) * 4]).toBe(0);
    expect(separated.pixels[(15 * separated.width + 40) * 4]).toBe(255);
    expect(separated.pixels[(15 * separated.width + 55) * 4]).toBe(0);
    expect(separated.pixels.slice(37 * separated.width * 4, 38 * separated.width * 4).every(value => value === 255)).toBe(true);
  });
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
  it('skips decoding an already canceled preparation', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    const abort = new AbortController(); abort.abort();
    const file = new File(['image'], 'photo.jpg');
    await expect(prepareForOcr(file, 0, 1400, abort.signal)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
  it('closes a bitmap that arrives after cancellation without creating or encoding a canvas', async () => {
    let finish!: (value: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>(resolve => { finish = resolve; })));
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    const close = vi.fn(), abort = new AbortController();
    const file = new File(['image'], 'photo.jpg');
    const result = prepareForOcr(file, 270, 1400, abort.signal);
    abort.abort();
    finish({ width: 1000, height: 2000, close } as unknown as ImageBitmap);
    await expect(result).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(getContext).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });
});

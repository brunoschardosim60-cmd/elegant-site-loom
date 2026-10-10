import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareForOcr } from '@/lib/image-prep';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Photo preparation', () => {
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

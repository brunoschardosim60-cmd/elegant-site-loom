import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn(), setParameters: vi.fn() }));
vi.mock('tesseract.js', () => ({
  PSM: { AUTO: '3', SPARSE_TEXT: '11' },
  createWorker: vi.fn(async () => mocks),
}));
vi.mock('@/lib/image-prep', () => ({ prepareForOcr: vi.fn(async (file: File) => file) }));
import { prepareForOcr } from '@/lib/image-prep';
import { readPrePhoto } from '@/lib/photo-ocr';

beforeEach(() => { vi.clearAllMocks(); mocks.recognize.mockReset(); mocks.terminate.mockResolvedValue(undefined); });
const result = (text: string, confidence = 80) => ({ data: { text, confidence } });
describe('Photo OCR retries', () => {
  it('finds a sideways document and terminates the worker', async () => {
    mocks.recognize.mockResolvedValueOnce(result('z £ É', 5))
      .mockResolvedValueOnce(result('DI0060186918 Placa IYA7J31 CT-e: 365569'));
    const reading = await readPrePhoto(new File(['image'], 'photo.jpg'));
    expect(reading.pre).toEqual({ id: 'DI0060186918', plate: 'IYA7J31', ctes: ['365569'] });
    expect(prepareForOcr).toHaveBeenCalledWith(expect.any(File), 90);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('keeps valid fields when later attempts fail or contain higher-confidence noise', async () => {
    mocks.recognize.mockResolvedValueOnce(result('DI0060186918', 50))
      .mockRejectedValueOnce(new Error('retry failed'))
      .mockResolvedValue(result('unrelated text', 99));
    expect((await readPrePhoto(new File(['image'], 'photo.jpg'))).pre.id).toBe('DI0060186918');
    expect(mocks.setParameters).toHaveBeenLastCalledWith({ tessedit_pageseg_mode: '11' });
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('reports processing errors and still terminates the worker', async () => {
    mocks.recognize.mockRejectedValue(new Error('decoder failed'));
    await expect(readPrePhoto(new File(['image'], 'photo.jpg'))).rejects.toThrow('decoder failed');
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
});

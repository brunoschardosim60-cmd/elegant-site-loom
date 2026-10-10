import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn(), setParameters: vi.fn() }));
vi.mock('tesseract.js', () => ({ PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_LINE: '7' }, createWorker: vi.fn(async () => mocks) }));
vi.mock('@/lib/image-prep', () => ({ prepareForOcr: vi.fn(async (file: File) => file), preparePrintedField: vi.fn(async (file: File) => file), prepareTableCells: vi.fn(async () => []) }));
import { createWorker } from 'tesseract.js';
import { prepareForOcr } from '@/lib/image-prep';
import { readPrePhoto, readPrePhotos } from '@/lib/photo-ocr';
beforeEach(() => { vi.clearAllMocks(); mocks.recognize.mockReset(); mocks.terminate.mockResolvedValue(undefined); });
const result = (text: string, confidence = 80) => ({ data: { text, confidence } });
const pre = 'PRÉ-MANIFESTO DI00123456789 Placa ABC1D23 CTC: 1234567890';
describe('Photo OCR batches', () => {
  it('finds orientation using thumbnails and reads the full page once', async () => {
    mocks.recognize.mockResolvedValueOnce(result('unreadable')).mockResolvedValue(result(pre));
    const reading = await readPrePhoto(new File(['image'], 'sideways.jpg'));
    expect(reading.pre).toMatchObject({ id: 'DI00123456789', ctcs: ['1234567890'] });
    expect(prepareForOcr).toHaveBeenCalledWith(expect.any(File), 270, 1400);
    expect(prepareForOcr).toHaveBeenCalledWith(expect.any(File), 270);
    expect(mocks.recognize).toHaveBeenCalledTimes(3);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('reuses one worker and returns each photo separately', async () => {
    mocks.recognize.mockResolvedValue(result(pre));
    const receive = vi.fn();
    await readPrePhotos([new File(['1'], 'a.jpg'), new File(['2'], 'b.jpg')], receive);
    expect(createWorker).toHaveBeenCalledOnce();
    expect(receive.mock.calls.map(call => call[0])).toEqual([0, 1]);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('continues after a failed photo and releases the worker', async () => {
    let calls = 0;
    mocks.recognize.mockImplementation(async () => { if (++calls <= 6) throw new Error('decode'); return result(pre); });
    const receive = vi.fn();
    await readPrePhotos([new File(['1'], 'bad.jpg'), new File(['2'], 'good.jpg')], receive);
    expect(receive.mock.calls[0]?.[1]).toHaveProperty('error');
    expect(receive.mock.calls[1]?.[1].pre.id).toBe('DI00123456789');
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('stops before the next photo after cancellation', async () => {
    mocks.recognize.mockResolvedValue(result(pre));
    const abort = new AbortController();
    const receive = vi.fn(() => abort.abort());
    await readPrePhotos([new File(['1'], 'a.jpg'), new File(['2'], 'b.jpg')], receive, undefined, abort.signal);
    expect(receive).toHaveBeenCalledOnce();
  });
  it('checks the printed ID separately', async () => {
    mocks.recognize.mockResolvedValueOnce(result(pre)).mockResolvedValueOnce({ data: { text: 'PRÉ-MANIFESTO DIS0123456789 Placa ABC1D23 CTC: 1234567890', confidence: 90, blocks: [{ paragraphs: [{ lines: [{ words: [{ text: 'DIS0123456789', confidence: 60, bbox: { x0: 100, y0: 100, x1: 300, y1: 130 } }] }] }] }] } }).mockResolvedValueOnce(result('DI00123456789'));
    expect((await readPrePhoto(new File(['image'], 'photo.jpg'))).pre.id).toBe('DI00123456789');
    expect(mocks.setParameters).toHaveBeenLastCalledWith({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'DI0123456789' });
  });
});

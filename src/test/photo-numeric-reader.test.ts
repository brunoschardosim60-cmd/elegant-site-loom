import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const worker = vi.hoisted(() => ({ recognize: vi.fn(), setParameters: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ createWorker: vi.fn(async () => worker), PSM: { SPARSE_TEXT: '11', SINGLE_BLOCK: '6' } }));
vi.mock('@/lib/pre-barcode', () => ({ readPreBarcode: vi.fn(() => undefined) }));
vi.mock('@/lib/image-prep', () => ({ prepareForOcr: vi.fn(async (file: File) => file), readGrayImage: vi.fn(async () => ({ pixels: new Uint8Array(100), width: 10, height: 10 })),
  prepareNumericMontage: vi.fn(async (image: File, boxes: unknown[]) => ({ image, cells: boxes.map((box, i) => ({ box, target: { x0: 10, x1: 100, y0: i * 80, y1: i * 80 + 50 } })) })) }));
import { createWorker } from 'tesseract.js';
import { readPhotoNumbers } from '@/lib/photo-numeric-reader';
const page = (rows = [['0000000001', '12345-1', '8'], ['0000000002', '23456-1', '7']]) => {
  const word = (text: string, x: number, y: number, width = 50) => ({ text, confidence: 95, bbox: { x0: x, x1: x + width, y0: y, y1: y + 20 } });
  return { data: { text: 'PRÉ-MANIFESTO', blocks: [{ paragraphs: [{ lines: [{ words: [
    word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
    ...rows.flatMap((row, i) => [word(row[0]!, 100, 240 + i * 50, 100), word(row[1]!, 400, 238 + i * 50, 80), word(row[2]!, 610, 235 + i * 50, 20)]),
  ] }] }] }] } };
};
beforeEach(() => { vi.clearAllMocks(); worker.recognize.mockReset(); vi.mocked(createWorker).mockResolvedValue(worker as never); worker.terminate.mockResolvedValue(undefined); worker.setParameters.mockResolvedValue(undefined); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1000, height: 800, close: vi.fn() }))); });
afterEach(() => vi.unstubAllGlobals());

describe('Numeric photo evidence', () => {
  it('confirms literal values across resolutions by identity, keeping NFs and volumes with their CTC', async () => {
    worker.recognize.mockResolvedValueOnce(page()).mockResolvedValueOnce(page([['0000000002', '23456-1', '7'], ['0000000001', '12345-1', '8']]));
    const result = await readPhotoNumbers(new File(['image'], 'pre.jpg'), 0);
    expect(result.confirmed).toEqual([{ ctc: '0000000001', nf: '12345-1', volumes: '8' }, { ctc: '0000000002', nf: '23456-1', volumes: '7' }]);
    expect(worker.recognize).toHaveBeenCalledTimes(2); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('never confirms conflicting values or fills unread montage cells by shifting the next row', async () => {
    worker.recognize.mockResolvedValueOnce(page()).mockResolvedValueOnce(page([['0000000001', '12345-1', '9'], ['0000000002', '23456-1', '7']])).mockResolvedValueOnce({ data: { text: '', blocks: [] } });
    const result = await readPhotoNumbers(new File(['image'], 'pre.jpg'), 0);
    expect(result.confirmed[0]).toEqual({ ctc: '0000000001', nf: '12345-1' });
    expect(result.confirmed[1]!.volumes).toBe('7');
  });
  it('stops a stalled recognition promptly and terminates its worker once', async () => {
    worker.recognize.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const run = readPhotoNumbers(new File(['image'], 'pre.jpg'), 0, controller.signal);
    for (let i = 0; i < 30 && !worker.recognize.mock.calls.length; i++) await Promise.resolve();
    expect(worker.recognize).toHaveBeenCalledOnce(); controller.abort();
    await expect(run).rejects.toBeDefined(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('releases a language worker which finishes starting after cancellation', async () => {
    let finish!: (value: never) => void;
    vi.mocked(createWorker).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController(), run = readPhotoNumbers(new File(['image'], 'pre.jpg'), 0, controller.signal);
    controller.abort(); await expect(run).rejects.toBeDefined(); finish(worker as never); await Promise.resolve();
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.recognize).not.toHaveBeenCalled();
  });
});

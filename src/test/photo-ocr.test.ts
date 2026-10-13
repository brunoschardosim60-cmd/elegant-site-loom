import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn(), setParameters: vi.fn() }));
vi.mock('tesseract.js', () => ({ PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_LINE: '7', SINGLE_BLOCK: '6' }, createWorker: vi.fn(async () => mocks) }));
vi.mock('@/lib/image-prep', () => ({ prepareForOcr: vi.fn(async (file: File) => file), preparePrintedField: vi.fn(async (file: File) => file),
  readGrayImage: vi.fn(async () => { throw new Error('No canvas in fixture'); }),
  prepareNumericMontage: vi.fn(async (image: File, boxes: { x0: number; x1: number; y0: number; y1: number }[]) => ({ image,
    cells: boxes.map((box, index) => ({ box, target: { x0: 16, x1: 116, y0: 16 + index * 80, y1: 56 + index * 80 } })) })),
  prepareTableCells: vi.fn(async () => []) }));
import { createWorker } from 'tesseract.js';
import { prepareForOcr, readGrayImage } from '@/lib/image-prep';
import { getLocalOcrPoolSize, montageReadings, readPrePhoto, readPrePhotos } from '@/lib/photo-ocr';
beforeEach(() => { Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2, configurable: true }); vi.clearAllMocks(); vi.mocked(createWorker).mockResolvedValue(mocks as never); vi.mocked(prepareForOcr).mockImplementation(async (file: File) => file); mocks.recognize.mockReset(); mocks.terminate.mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });
const result = (text: string, confidence = 80) => ({ data: { text, confidence } });
const pre = 'PRÉ-MANIFESTO DI00123456789 Placa ABC1D23 CTC: 1234567890';
describe('Photo OCR batches', () => {
  it('limits OCR concurrency on mobile and low-memory devices', () => {
    expect(getLocalOcrPoolSize(20, 8, true, 8)).toBe(1);
    expect(getLocalOcrPoolSize(20, 8, false, 4)).toBe(1);
    expect(getLocalOcrPoolSize(20, 8, false, 8)).toBe(3);
    expect(getLocalOcrPoolSize(1, 8, false, 8)).toBe(1);
    expect(getLocalOcrPoolSize(0, 8, true, 2)).toBe(0);
  });
  it('returns a terminal error when local OCR stops making progress without AI fallback', async () => {
    vi.useFakeTimers();
    mocks.recognize.mockImplementation(() => new Promise(() => {}));
    const receive = vi.fn();
    const reading = readPrePhotos([new File(['1'], 'slow.jpg')], receive);
    for (let i = 0; i < 20 && mocks.recognize.mock.calls.length === 0; i++) await Promise.resolve();
    expect(mocks.recognize).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    await reading;
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0]?.[1]).toMatchObject({ error: expect.stringContaining('60 segundos') });
    expect(mocks.terminate).toHaveBeenCalled();
  });
  it('uses one full-page OCR pass and skips grayscale recovery when all key fields are readable', async () => {
    const word = (text: string, x: number, y: number, width = 50) => ({ text, confidence: 95, bbox: { x0: x, x1: x + width, y0: y, y1: y + 20 } });
    const source = { data: { text: 'PRÉ-MANIFESTO', confidence: 95, blocks: [{ paragraphs: [{ lines: [{ words: [
      word('CTC', 100, 200), word('Remetente', 250, 200, 90), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('0000000001', 100, 240, 100), word('12345-1', 400, 238, 80), word('8', 610, 235, 20),
    ] }] }] }] } };
    mocks.recognize.mockResolvedValueOnce(result('PRÉ-MANIFESTO')).mockResolvedValueOnce(source);
    const reading = await readPrePhoto(new File(['image'], 'clean.jpg'));
    expect(reading.pre.documents).toMatchObject([{ ctc: '0000000001', nf: '12345-1', volumes: '8' }]);
    expect(mocks.recognize).toHaveBeenCalledTimes(2);
    expect(readGrayImage).not.toHaveBeenCalled();
  });
  it('does not repeat full-page OCR when 15 NF rows contain the 11 CTCs printed in the header', async () => {
    const word = (text: string, x: number, y: number, width = 50) => ({ text, confidence: 95, bbox: { x0: x, x1: x + width, y0: y, y1: y + 20 } });
    const source = { data: { text: 'PRÉ-MANIFESTO', confidence: 95, blocks: [{ paragraphs: [{ lines: [{ words: [
      word('CTCs', 100, 100), word('NFs', 250, 100), word('VOLS', 400, 100), word('PESO', 550, 100),
      word('1', 130, 130, 20), word('2', 280, 130, 20), word('98', 430, 130, 30),
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('0000000001', 100, 240, 100), word('0000000001', 100, 290, 100),
      word('12345-1', 400, 238, 80), word('23456-1', 400, 283, 80),
      word('49', 610, 235, 25), word('49', 610, 280, 25),
    ] }] }] }] } };
    mocks.recognize.mockResolvedValueOnce(result('PRÉ-MANIFESTO')).mockResolvedValueOnce(source);
    const reading = await readPrePhoto(new File(['image'], 'repeated-ctc.jpg'));
    expect(reading.pre.expectedRows).toBe(1);
    expect(reading.pre.documents).toHaveLength(2);
    expect(reading.pre.documents.map(row => row.ctc)).toEqual(['0000000001', '0000000001']);
    expect(mocks.recognize).toHaveBeenCalledTimes(2);
  });

  it('rereads a confident existing volume when the header total disagrees, preserving a conflict notice', async () => {
    const word = (text: string, x: number, y: number, width = 50) => ({ text, confidence: 95, bbox: { x0: x, x1: x + width, y0: y, y1: y + 20 } });
    const source = { data: { text: 'PRÉ-MANIFESTO', confidence: 95, blocks: [{ paragraphs: [{ lines: [{ words: [
      word('CTCs', 100, 100), word('NFs', 250, 100), word('VOLS', 400, 100), word('PESO', 550, 100),
      word('2', 130, 130, 20), word('46', 430, 130, 30),
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('0000000001', 100, 240, 100), word('0000000002', 100, 290, 100),
      word('12345-1', 400, 238, 80), word('23456-1', 400, 283, 80),
      word('10', 610, 235, 20), word('38', 610, 280, 20),
    ] }] }] }] } };
    const checked = { data: { text: '10\n36', confidence: 95, blocks: [{ paragraphs: [{ lines: [{ words: [
      word('10', 20, 20, 30), word('36', 20, 100, 30),
    ] }] }] }] } };
    const weakerPass = { data: { text: '10\n38', confidence: 75, blocks: [{ paragraphs: [{ lines: [{ words: [
      word('10', 20, 20, 30), word('38', 20, 100, 30),
    ] }] }] }] } };
    mocks.recognize.mockResolvedValueOnce(result('PRÉ-MANIFESTO')).mockResolvedValueOnce(source).mockResolvedValueOnce(checked).mockResolvedValueOnce(weakerPass);
    const reading = await readPrePhoto(new File(['image'], 'photo.jpg'));
    expect(reading.pre.documents.map(row => [row.ctc, row.volumes])).toEqual([['0000000001', '10'], ['0000000002', '36']]);
    expect(reading.pre.documents[1]?.review).toContain('Volumes relidos: 38 / 36. Confira na foto.');
    // Targeted high-confidence cells agree with the printed total; no second
    // full-page or numeric montage is needed.
    expect(mocks.recognize).toHaveBeenCalledTimes(3);
  });
  it('stops immediately during worker startup and terminates the worker if it arrives later', async () => {
    let finish!: (value: never) => void;
    vi.mocked(createWorker).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const abort = new AbortController(), receive = vi.fn();
    const reading = readPrePhotos([new File(['1'], 'a.jpg')], receive, undefined, abort.signal);
    abort.abort();
    await reading;
    expect(receive).not.toHaveBeenCalled();
    finish(mocks as never);
    await Promise.resolve();
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('maps numeric montage readings by position without shifting a missing cell', () => {
    const box = { x0: 100, x1: 200, y0: 400, y1: 420 };
    const cells = [0, 1, 2].map(index => ({ box: { ...box, y0: box.y0 + index * 50, y1: box.y1 + index * 50 },
      target: { x0: 16, x1: 216, y0: 16 + index * 80, y1: 56 + index * 80 } }));
    const words = [{ text: '11', confidence: 90, bbox: { x0: 20, x1: 60, y0: 20, y1: 50 } },
      { text: '33', confidence: 91, bbox: { x0: 20, x1: 60, y0: 180, y1: 210 } }];
    const readings = montageReadings({ text: '11\n33', blocks: [{ paragraphs: [{ lines: [{ words }] }] }] }, cells);
    expect(readings.map(word => word?.text)).toEqual(['11', undefined, '33']);
    expect(readings[2]?.bbox.y0).toBe(502);
  });
  it('finds orientation using thumbnails and reads the full page once', async () => {
    vi.mocked(prepareForOcr).mockImplementation(async (_file, angle, maxSize) => new Blob([String(angle), String(maxSize)]));
    mocks.recognize.mockResolvedValueOnce(result('unreadable')).mockResolvedValue(result(pre));
    const reading = await readPrePhoto(new File(['image'], 'sideways.jpg'));
    expect(reading.pre).toMatchObject({ id: 'DI00123456789', ctcs: ['1234567890'] });
    expect(reading.angle).toBe(270);
    expect(prepareForOcr).toHaveBeenCalledWith(expect.any(File), 270, 1400, undefined);
    expect(prepareForOcr).toHaveBeenCalledWith(expect.any(File), 270, 3840, undefined);
    expect(mocks.recognize).toHaveBeenCalledTimes(3);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('keeps recovered NF digits without inventing a separator or a series', async () => {
    const word=(text:string,x:number,y:number,width=50)=>({text,confidence:95,bbox:{x0:x,x1:x+width,y0:y,y1:y+20}});
    const source={data:{text:'PRÉ-MANIFESTO',confidence:95,blocks:[{paragraphs:[{lines:[{words:[
      word('CTC',100,200),word('Remetente',250,200),word('NF-Série',400,200,90),word('Vols.',600,200),
      word('0000000001',100,240,100),word('111170',400,238,80),word('4',610,235,20),
    ]}]}]}]}};
    const cropped={data:{text:'11117021',confidence:74,blocks:[{paragraphs:[{lines:[{words:[
      {...word('11117021',20,20,90),confidence:74},
    ]}]}]}]}};
    mocks.recognize.mockResolvedValueOnce(result('PRÉ-MANIFESTO')).mockResolvedValueOnce(source).mockResolvedValueOnce(cropped);
    const reading=await readPrePhoto(new File(['image'],'nf-crop.jpg'));
    expect(reading.pre.documents[0]).toMatchObject({nf:'11117021',review:expect.arrayContaining(['NF'])});
  });
  it('tries one alternate full-page mode when the printed count exceeds recovered CTCs', async () => {
    const word = (text: string, x: number, y: number, width = 50) => ({ text, confidence: 90, bbox: { x0: x, x1: x + width, y0: y, y1: y + 20 } });
    const source = (complete: boolean) => ({ data: { text: 'PRÉ-MANIFESTO', confidence: 90, blocks: [{ paragraphs: [{ lines: [{ words: [
      word('CTCs', 100, 100), word('NFs', 250, 100), word('2', 130, 130, 20),
      word('CTC', 100, 200), word('Remetente', 250, 200), word('0000000001', 100, 240, 100),
      ...(complete ? [word('0000000002', 100, 290, 100)] : []),
    ] }] }] }] } });
    mocks.recognize.mockResolvedValueOnce(result('PRÉ-MANIFESTO')).mockResolvedValueOnce(source(false)).mockResolvedValueOnce(source(true));
    const reading = await readPrePhoto(new File(['image'], 'photo.jpg'));
    expect(reading.pre.ctcs).toEqual(['0000000001', '0000000002']);
    expect(mocks.recognize).toHaveBeenCalledTimes(3);
    expect(mocks.setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: '3' });
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
    const bad = new File(['1'], 'bad.jpg'), good = new File(['2'], 'good.jpg');
    mocks.recognize.mockImplementation(async (image: Blob) => { if (image === bad) throw new Error('decode'); return result(pre); });
    const receive = vi.fn();
    await readPrePhotos([bad, good], receive);
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

it('releases a completed worker and a late worker when another worker fails during startup', async () => {
 Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true });
 let finish!: (value: never) => void;
 const first = { ...mocks, terminate: vi.fn().mockResolvedValue(undefined) }, late = { ...mocks, terminate: vi.fn().mockResolvedValue(undefined) };
 vi.mocked(createWorker).mockResolvedValueOnce(first as never).mockRejectedValueOnce(new Error('worker startup failed')).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
 const files = [1, 2, 3].map(n => new File([String(n)], `startup-${n}.jpg`));
 await expect(readPrePhotos(files, vi.fn())).rejects.toThrow('worker startup failed');
 await vi.waitFor(() => expect(first.terminate).toHaveBeenCalledOnce()); finish(late as never);
 await vi.waitFor(() => expect(late.terminate).toHaveBeenCalledOnce());
});

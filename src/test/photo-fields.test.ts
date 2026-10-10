import { describe, expect, it } from 'vitest';
import { parsePhotoFields, type OcrWord } from '@/lib/photo-fields';
const word = (text: string, x: number, y: number, width = 50): OcrWord => ({ text, confidence: 80, bbox: { x0: x, y0: y, x1: x + width, y1: y + 20 } });
const page = (words: OcrWord[]) => ({ text: words.map(w => w.text).join('\n'), blocks: [{ paragraphs: [{ lines: [{ words }] }] }] });
describe('Photo table extraction', () => {
  it('keeps CTC separate from CT-e and aligns columns by position', () => {
    const fields = parsePhotoFields(page([
      word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('1234567890', 100, 240, 100), word('2345678901', 100, 290, 100),
      word('12345-1', 400, 238, 80), word('54321-2', 400, 283, 80),
      word('20', 610, 235, 20), word('7', 610, 280, 20),
    ]));
    expect(fields.ctes).toEqual([]);
    expect(fields.documents).toEqual([{ ctc: '1234567890', nf: '12345-1', volumes: '20' }, { ctc: '2345678901', nf: '54321-2', volumes: '7' }]);
  });
  it('does not supply default volumes or invent a missing NF series', () => {
    const fields = parsePhotoFields(page([word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200), word('1234567890', 100, 240, 100), word('123451', 400, 240, 80)]));
    expect(fields.documents).toEqual([{ ctc: '1234567890', nf: '', volumes: '' }]);
  });
  it('reads the driver from the plate/driver field without taking the vehicle suffix', () => {
    const fields = parsePhotoFields(page([word('PLACA/MOTORISTA', 100, 100, 120), word('ABC1D23-JOSE', 100, 130, 180), word('SILVA', 290, 130), word('-', 350, 130, 10), word('999', 370, 130)]));
    expect(fields.plate).toBe('ABC1D23');
    expect(fields.driver).toBe('JOSE SILVA');
  });
  it('leaves uncertain cells empty for manual review', () => {
    const fields = parsePhotoFields(page([word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200), word('1234567890', 100, 240, 100), { ...word('12345-1', 400, 240, 80), confidence: 30 }, { ...word('8', 610, 240, 20), confidence: 40 }]));
    expect(fields.documents).toEqual([{ ctc: '1234567890', nf: '', volumes: '' }]);
  });
});

import { describe, expect, it } from 'vitest';
import { parsePhotoFields, type OcrWord } from '@/lib/photo-fields';
const word = (text: string, x: number, y: number, width = 50): OcrWord => ({ text, confidence: 80, bbox: { x0: x, y0: y, x1: x + width, y1: y + 20 } });
const page = (words: OcrWord[]) => ({ text: words.map(w => w.text).join('\n'), blocks: [{ paragraphs: [{ lines: [{ words }] }] }] });
describe('Photo table extraction', () => {
  it('reads CTC identifiers and aligns columns by position', () => {
    const fields = parsePhotoFields(page([
      word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('1234567890', 100, 240, 100), word('2345678901', 100, 290, 100),
      word('12345-1', 400, 238, 80), word('54321-2', 400, 283, 80),
      word('20', 610, 235, 20), word('7', 610, 280, 20),
    ]));
    expect(fields.ctcs).toEqual(['1234567890', '2345678901']);
    expect(fields.documents).toMatchObject([{ ctc: '1234567890', nf: '12345-1', volumes: '20' }, { ctc: '2345678901', nf: '54321-2', volumes: '7' }]);
  });
  it('does not supply default volumes or invent a missing NF series', () => {
    const fields = parsePhotoFields(page([word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200), word('1234567890', 100, 240, 100), word('123451', 400, 240, 80)]));
    expect(fields.documents).toMatchObject([{ ctc: '1234567890', nf: '123451', volumes: '' }]);
  });
  it('reads the driver from the plate/driver field without taking the vehicle suffix', () => {
    const fields = parsePhotoFields(page([word('PLACA/MOTORISTA', 100, 100, 120), word('ABC1D23-JOSE', 100, 130, 180), word('SILVA', 290, 130), word('-', 350, 130, 10), word('999', 370, 130)]));
    expect(fields.plate).toBe('ABC1D23');
    expect(fields.driver).toBe('JOSE SILVA');
  });
  it('retains uncertain readings and marks them for review', () => {
    const fields = parsePhotoFields(page([word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200), word('1234567890', 100, 240, 100), { ...word('12345-1', 400, 240, 80), confidence: 30 }, { ...word('8', 610, 240, 20), confidence: 40 }]));
    expect(fields.documents).toMatchObject([{ ctc: '1234567890', nf: '12345-1', volumes: '8', review: expect.arrayContaining(['NF', 'volumes']) }]);
  });
  it('retains a driver even when the plate needs manual correction, without mixing the next row', () => {
    const fields = parsePhotoFields(page([word('PLACA/MOTORISTA', 100, 100, 120), word('ABC012345-JOSE', 100, 130, 180), word('SILVA', 290, 130), word('VL.FRETE', 290, 165)]));
    expect(fields.driver).toBe('JOSE SILVA');
  });
});

it('reads laboratories and destinations from their own columns', () => {
  const fields = parsePhotoFields(page([
    word('CTC', 50, 200), word('Remetente', 250, 200, 100), word('Destinatário', 500, 200, 100), word('NF-Série', 800, 200, 90), word('Vols.', 1000, 200),
    word('1234567890', 50, 240, 100), word('ALFA', 200, 240, 60), word('LAB', 270, 240, 60), word('FARMACIA', 480, 240, 100), word('BETA', 590, 240, 60), word('B7859-1', 800, 238, 90), word('20', 1010, 236, 20),
    word('2345678901', 50, 290, 100), word('OUTRO', 200, 290, 80), word('LAB', 290, 290, 60), word('FARMACIA', 480, 286, 100), word('GAMA', 590, 286, 60), word('12345-1', 800, 284, 90), word('7', 1010, 282, 20),
  ]));
  expect(fields.documents).toMatchObject([{ ctc: '1234567890', client: 'ALFA LAB', recipient: 'FARMACIA BETA', nf: '87859-1', volumes: '20' }, { ctc: '2345678901', client: 'OUTRO LAB', recipient: 'FARMACIA GAMA', nf: '12345-1', volumes: '7' }]);
});

it('does not treat a DACTE access key as a CTC or invent a pre', () => {
  const fields = parsePhotoFields({ text: 'DACTE\nID: 1234567890\nREMETENTE: LABORATORIO ALFA\nDESTINATÁRIO: FARMACIA BETA\nDOCUMENTOS ORIGINÁRIOS\n1/00012345\n35261052134798001563570010006812351767323304' });
  expect(fields.kind).toBe('dacte'); expect(fields.id).toBe('');
  expect(fields.documents).toMatchObject([{ ctc: '1234567890', nf: '00012345-1', client: 'LABORATORIO ALFA', recipient: 'FARMACIA BETA' }]);
  expect(parsePhotoFields({ text: 'DACTE\n35261052134798001563570010006812351767323304' }).documents).toEqual([]);
});

it('reads the explicitly printed DACTE ID across separate OCR lines', () => {
  expect(parsePhotoFields({ text: 'DACTE\nCT-E |\n06.10.26\n1234567890\nNRO. DOCUMENTO / SÉRIE\n56789 1' }).ctcs).toEqual(['1234567890']);
});

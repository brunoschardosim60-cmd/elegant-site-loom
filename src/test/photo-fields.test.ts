import { describe, expect, it } from 'vitest';
import { isPreIdWord, preIdDigitsBox, mergeCtcPages, parsePhotoFields, tableCellRegions, tableCtcRepairRegions, type OcrWord } from '@/lib/photo-fields';
const word = (text: string, x: number, y: number, width = 50): OcrWord => ({ text, confidence: 80, bbox: { x0: x, y0: y, x1: x + width, y1: y + 20 } });
const page = (words: OcrWord[]) => ({ text: words.map(w => w.text).join('\n'), blocks: [{ paragraphs: [{ lines: [{ words }] }] }] });

it('does not crop DISTRIBUIÇÃO or a fiscal key as a pré ID and requires observed prefix glyphs', () => {
  expect(isPreIdWord(word('DISTRIBUICAO',100,100))).toBe(false);
  expect(isPreIdWord(word('DISTRIBUIDOR',100,100))).toBe(false);
  expect(isPreIdWord(word('DI00601869631',100,100))).toBe(true);
  expect(preIdDigitsBox(word('DI00601869631',100,100))).toBeUndefined();
  expect(preIdDigitsBox(word('35261052134798001563570010006812351767323304',100,100))).toBeUndefined();
});
it.each([false,true])('reads the NF header despite an inflated label box and splitDigits=%s', split => {
  const fields=parsePhotoFields(page([
    word('CTCs',100,120),{...word('NFs',250,100),bbox:{x0:250,x1:290,y0:100,y1:145}},word('VOLS',400,120),word('PESO',550,120),
    word('11',130,150,20),...(split?[word('1',350,150,8),word('5',360,150,8)]:[word('15',350,150,20)]),word('98',430,150,30),
    word('CTC',100,240),word('Remetente',250,240),word('NF-Série',400,240),word('Vols.',600,240),
    word('0000000001',100,280,100),word('12345-1',400,280,80),word('8',610,280,20),
  ]));
  expect(fields).toMatchObject({expectedRows:11,expectedNfs:15,totalVolumes:98});
});

it('reads the original pré date from the labelled header rather than delivery rows or DACTE dates', () => {
  const fields = parsePhotoFields(page([
    word('PRÉ-MANIFESTO', 200, 20, 200), word('DATA', 200, 60), word('28/08/2026', 200, 85, 100),
    word('16:48:54', 305, 85, 90), word('Prev. Entrega', 900, 200, 100), word('31/08/2026', 900, 240, 100),
  ]));
  expect(fields.issueDate).toBe('2026-08-28');
  expect(parsePhotoFields({ text: 'PRÉ-MANIFESTO\nDATA 28/08/2026 16:48:54\nCTCs 11\nPrev. Entrega 31/08/2026' }).issueDate).toBe('2026-08-28');
  expect(parsePhotoFields({ text: 'PRÉ-MANIFESTO\nPrev. Entrega 31/08/2026' })).not.toHaveProperty('issueDate');
  expect(parsePhotoFields({ text: 'DACTE\nDATA DE EMISSÃO 28/08/2026\nID: 1234567890' })).not.toHaveProperty('issueDate');
});
describe('Photo table extraction', () => {
  it('keeps volumes on their physical rows when OCR includes a rule in the Vol header box', () => {
    const vol = { ...word('Vol:', 600, 140), bbox: { x0: 600, x1: 650, y0: 140, y1: 220 } };
    const fields = parsePhotoFields(page([
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), vol,
      word('0000000001', 100, 240, 100), word('12345-1', 400, 238, 80), word('184', 610, 235, 30),
      word('0000000002', 100, 290, 100), word('23456-1', 400, 288, 80), word('121', 610, 285, 30),
    ]));
    expect(fields.documents.map(row => [row.ctc, row.nf, row.volumes])).toEqual([['0000000001', '12345-1', '184'], ['0000000002', '23456-1', '121']]);
  });
  it('recovers complementary missing CTC rows from two segmentation modes without shifting NFs', () => {
    const headers=[word('CTC',100,200),word('Remetente',250,200),word('NF-Série',400,200,90),word('Vols.',600,200)];
    const first=page([...headers,word('0000000001',100,240,100),word('0000000003',100,340,100),
      ...[0,1,2].flatMap(i=>[word(`${11111+i}-1`,400,238+i*50,80),word(String(i+1),610,235+i*50,20)])]);
    const second=page([...headers,word('0000000001',100,240,100),word('0000000002',100,290,100)]);
    expect(parsePhotoFields(mergeCtcPages(first,second)).documents).toMatchObject([
      {ctc:'0000000001',nf:'11111-1',volumes:'1'},
      {ctc:'0000000002',nf:'11112-1',volumes:'2'},
      {ctc:'0000000003',nf:'11113-1',volumes:'3'},
    ]);
  });
  it('never adds a conflicting CTC on an occupied physical row or removes legitimate repeated CTC rows', () => {
    const headers=[word('CTC',100,200),word('Remetente',250,200)];
    const first=page([...headers,word('0000000001',100,240,100)]);
    const second=page([...headers,word('9999999999',100,240,100),word('0000000001',100,290,100)]);
    expect(parsePhotoFields(mergeCtcPages(first,second)).documents.map(row=>row.ctc)).toEqual(['0000000001','0000000001']);
  });
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
  it('rejoins a CTC split into adjacent numeric OCR tokens without shifting NF and volumes', () => {
    const fields = parsePhotoFields(page([
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('00000', 100, 240, 45), word('00001', 148, 240, 40),
      word('000000000', 100, 290, 90), word('2', 192, 290, 10),
      word('12345-1', 400, 238, 80), word('54321-2', 400, 288, 80),
      word('8', 610, 235, 20), word('4', 610, 285, 20),
    ]));
    expect(fields.documents).toMatchObject([
      { ctc: '0000000001', nf: '12345-1', volumes: '8' },
      { ctc: '0000000002', nf: '54321-2', volumes: '4' },
    ]);
  });
  it('does not supply default volumes or invent a missing NF series', () => {
    const fields = parsePhotoFields(page([word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200), word('1234567890', 100, 240, 100), word('123451', 400, 240, 80)]));
    expect(fields.documents).toMatchObject([{ ctc: '1234567890', nf: '123451', volumes: '' }]);
  });
  it('keeps later NF/volume rows aligned when a middle CTC is unreadable', () => {
    const source = page([
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('0000000001', 100, 240, 100), word('AAQNDASBT75', 100, 290, 100), word('0000000003.', 100, 340, 100),
      word('11111-1', 400, 238, 80), word('22222-1', 400, 283, 80), word('33333-1', 400, 328, 80),
      word('20', 610, 235, 20), word('7', 610, 280, 20), word('15', 610, 325, 20),
    ]);
    expect(parsePhotoFields(source).documents).toMatchObject([
      { ctc: '0000000001', nf: '11111-1', volumes: '20' },
      { ctc: '0000000003', nf: '33333-1', volumes: '15' },
    ]);
    expect(tableCtcRepairRegions(source)).toHaveLength(1);
  });
  it('reads positive printed header totals independently of partial table rows', () => {
    const fields = parsePhotoFields(page([
      word('CTCs', 100, 100), word('NFs', 250, 100), word('VOLS', 400, 100), word('PESO', 550, 100),
      word('11', 130, 130, 20), word('132', 430, 130, 30), word('368,7', 580, 130),
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      word('0000000001', 100, 240, 100), word('11111-1', 400, 238, 80), word('20', 610, 235, 20),
    ]));
    expect(fields).toMatchObject({ expectedRows: 11, totalVolumes: 132 });
    expect(fields.documents).toHaveLength(1);
  });
  it('uses the complete row grid when only every third CTC is readable', () => {
    const words = [word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200)];
    for (let i = 0; i < 7; i++) {
      words.push(word(i % 3 === 0 ? `000000000${i + 1}` : 'AAQNDASBT75', 100, 240 + i * 50, 100),
        word(`${101 + i}-1`, 400, 238 + i * 45, 80), word(`${i + 1}`, 610, 235 + i * 45, 20));
    }
    expect(parsePhotoFields(page(words)).documents).toMatchObject([
      { ctc: '0000000001', nf: '101-1', volumes: '1' },
      { ctc: '0000000004', nf: '104-1', volumes: '4' },
      { ctc: '0000000007', nf: '107-1', volumes: '7' },
    ]);
  });
  it('reads the driver from the plate/driver field without taking the vehicle suffix', () => {
    const fields = parsePhotoFields(page([word('PLACA/MOTORISTA', 100, 100, 120), word('ABC1D23-JOSE', 100, 130, 180), word('SILVA', 290, 130), word('-', 350, 130, 10), word('999', 370, 130)]));
    expect(fields.plate).toBe('ABC1D23');
    expect(fields.driver).toBe('JOSE SILVA');
  });
  it('includes the plate/name token when perspective starts it slightly left of the label', () => {
    const fields = parsePhotoFields(page([
      word('ARO', 100, 10), word('OQ', 160, 10), word('LL', 210, 10),
      word('PLACA/MOTORISTA', 500, 100, 180), word('TRB7E25-DAVID', 456, 132, 200),
      word('VARGAS', 670, 132, 75), word('FERNANDES', 755, 132, 115), word('-', 880, 132, 10), word('0062', 900, 132),
    ]));
    expect(fields.plate).toBe('TRB7E25');
    expect(fields.driver).toBe('DAVID VARGAS FERNANDES');
  });
  it('does not use barcode noise as a plate when the labelled field is unreadable', () => {
    expect(parsePhotoFields(page([word('ABC1D23', 50, 10), word('PLACA/MOTORISTA', 500, 100, 180)])).plate).toBe('');
  });
  it('does not include an unreadable plate token in the driver name', () => {
    const fields=parsePhotoFields(page([word('PLACA/MOTORISTA',100,100,180),word('QUO7IBO-RAFAEL',100,132,180),word('INACIO',290,132,80),word('DA',380,132,40),word('CUNHA',430,132,75)]));
    expect(fields.driver).toBe('RAFAEL INACIO DA CUNHA');
    expect(fields.plate).toBe('');
  });
  it('reads a CTC header whose first letter was doubled by OCR', () => {
    expect(parsePhotoFields(page([
      word('CcTCs', 100, 100), word('NFs', 250, 100), word('11', 130, 130, 20),
      word('CTC', 100, 200), word('Remetente', 250, 200), word('0000000001', 100, 240, 100),
    ])).expectedRows).toBe(11);
  });
  it('projects missing volume cells using nearby column perspective without borrowing NF values', () => {
    const cells = tableCellRegions(page([
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      ...[0,1,2,3,4].flatMap(i => [word(`000000000${i+1}`, 100, 240+i*50, 100), word(`${12345+i}-1`,400,238+i*46,80)]),
    ])).filter(cell=>cell.field==='volumes');
    expect(cells).toHaveLength(5);
    const distance = (cells[4]!.box.y0 + cells[4]!.box.y1 - cells[0]!.box.y0 - cells[0]!.box.y1) / 2;
    expect(distance).toBeLessThan(190);
    expect(distance).toBeGreaterThan(170);
  });
  it('keeps numeric crops inside their columns when right-aligned volumes lean toward Chk', () => {
    const cells = tableCellRegions(page([
      word('CTC', 100, 200), word('Remetente', 250, 200), word('NF-Série', 400, 200, 90),
      word('Vols.', 600, 200), word('Chk', 700, 200),
      ...[0,1,2,3,4].flatMap(i=>[word(`000000000${i+1}`,100,240+i*50,100),word(`${12345+i}-1`,420,238+i*46,75)]),
    ]));
    const nf = cells.filter(cell=>cell.field==='nf'), volumes=cells.filter(cell=>cell.field==='volumes');
    expect(nf[0]!.box.x0).toBeGreaterThan(400);
    expect(volumes[4]!.box.x1).toBeGreaterThan(680);
    expect(volumes[4]!.box.x1).toBeLessThan(700);
    const lastCenter=(volumes[4]!.box.y0+volumes[4]!.box.y1)/2;
    expect(lastCenter).toBeGreaterThan(395);
    expect(lastCenter).toBeLessThan(430);
  });
  it('keeps readable NF crops away from neighbouring order digits and widens incomplete columns', () => {
    const headers=[word('CTC',100,200),word('Remetente',250,200),word('NF-Série',400,200,90),word('Pedido',700,200,80)];
    const rows=[word('0000000001',100,240,100),word('0000000002',100,290,100)];
    const tight=tableCellRegions(page([...headers,...rows,word('12345-1',420,240,75),word('54321-1',420,290,75)])).find(r=>r.field==='nf')!;
    const wide=tableCellRegions(page([...headers,...rows,word('12345',420,240,60)])).find(r=>r.field==='nf')!;
    expect(tight.box.x1).toBeLessThan(550);
    expect(wide.box.x1).toBeGreaterThan(tight.box.x1+50);
  });
  it('flags a low-confidence but well-formed CTC for row-level review', () => {
    const fields = parsePhotoFields(page([
      word('CTC', 100, 200), word('NF-Série', 400, 200, 90), word('Vols.', 600, 200),
      { ...word('5602298260', 100, 240, 100), confidence: 48 },
      word('12345-1', 400, 240, 80), word('8', 610, 240, 20),
    ]));
    expect(fields.documents).toMatchObject([{ ctc: '5602298260', review: expect.arrayContaining(['CTC']) }]);
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

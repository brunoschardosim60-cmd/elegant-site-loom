import { parsePreText } from './conference';

export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type PhotoDocument = { ctc: string; nf: string; volumes: string };
export type PhotoFields = ReturnType<typeof parsePreText> & { driver: string; documents: PhotoDocument[] };
type OcrPage = { text: string; blocks?: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null };
export const pageWords = (page: OcrPage): OcrWord[] => page.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) ?? [];
const cx = (w: OcrWord) => (w.bbox.x0 + w.bbox.x1) / 2;
const cy = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2;

/** Read columns by position: OCR text order does not preserve table rows. */
export function parsePhotoFields(page: OcrPage): PhotoFields {
  const words = pageWords(page);
  const fields: PhotoFields = { ...parsePreText(page.text), driver: '', documents: [] };
  const driverLabel = words.find(w => /PLACA.*MOTOR/i.test(w.text.replace(/[^A-Z]/gi, '')));
  if (driverLabel) {
    const height = driverLabel.bbox.y1 - driverLabel.bbox.y0;
    const line = words.filter(w => w.bbox.x0 >= driverLabel.bbox.x0 - height * 2 && w.bbox.y0 > driverLabel.bbox.y1 && w.bbox.y0 < driverLabel.bbox.y1 + height * 4)
      .sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' ');
    const plate = parsePreText(line).plate;
    if (plate) fields.plate = plate;
    fields.driver = line.replace(/^[A-Z]{3}[0-9OIL][A-Z0-9][0-9OIL]{2}\s*[-–]?\s*/i, '').replace(/\s*[-–]\s*\d+\s*$/, '').trim();
    if (!plate) fields.driver = '';
  }
  let header = words.find(w => /^CTC$/i.test(w.text));
  // A table's CTC heading is often damaged by the grid. The sender column
  // still establishes the row of headings; internal identifiers remain CTCs.
  if (!header && /CTC|PR[EÉ][- ]?MANIFESTO/i.test(page.text)) {
    const sender = words.find(w => /^REMETENTE$/i.test(w.text));
    const first = sender && words.filter(w => /^\d{10}$/.test(w.text) && w.bbox.x0 < sender.bbox.x0 && w.bbox.y0 > sender.bbox.y1).sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    if (sender && first) header = { ...first, text: 'CTC', bbox: { ...first.bbox, y0: sender.bbox.y0, y1: sender.bbox.y1 } };
  }
  if (!header) return fields;
  const rowHeaders = words.filter(w => Math.abs(cy(w) - cy(header)) < (header.bbox.y1 - header.bbox.y0) * 1.5);
  const nfHeader = rowHeaders.find(w => /^NF[-–.]?S[EÉ]RIE$/i.test(w.text));
  const volumesHeader = rowHeaders.find(w => /^VOLS[.]?$/i.test(w.text));
  const ctcWords = words.filter(w => /^\d{10}$/.test(w.text) && w.bbox.y0 > header.bbox.y1 && Math.abs(cx(w) - cx(header)) < (header.bbox.y1 - header.bbox.y0) * 7)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  if (!ctcWords.length) return fields;
  const gaps = ctcWords.slice(1).map((w, i) => cy(w) - cy(ctcWords[i]!)).sort((a, b) => a - b);
  const tolerance = (gaps[Math.floor(gaps.length / 2)] ?? (header.bbox.y1 - header.bbox.y0) * 2) * 0.4;
  const nfCells = nfHeader ? words.filter(w => Math.abs(cx(w) - cx(nfHeader)) < (nfHeader.bbox.x1 - nfHeader.bbox.x0) * 0.8 && w.bbox.y0 > nfHeader.bbox.y1 && /^[0-9OILSB-]{3,}$/i.test(w.text)).sort((a, b) => cy(a) - cy(b)) : [];
  const nfGaps = nfCells.slice(1).map((w, i) => cy(w) - cy(nfCells[i]!)).filter(gap => gap > tolerance * 1.5 && gap < tolerance * 3.5).sort((a, b) => a - b);
  const nfStep = nfGaps[Math.floor(nfGaps.length / 2)];
  for (const [index, row] of ctcWords.entries()) {
    // Complete NF columns provide row baselines despite perspective distortion.
    const projected = nfCells[0] && nfStep ? cy(nfCells[0]) + index * nfStep : cy(row);
    const nfWord = nfCells.length === ctcWords.length ? nfCells[index] : nfCells.find(w => Math.abs(cy(w) - projected) < tolerance);
    const baseline = nfWord ? cy(nfWord) : projected;
    const volumeWord = volumesHeader ? words.filter(w => Math.abs(cx(w) - cx(volumesHeader)) < (volumesHeader.bbox.x1 - volumesHeader.bbox.x0) * 0.8 && Math.abs(cy(w) - baseline) < tolerance && /^\d{1,4}$/.test(w.text))
      .sort((a, b) => Math.abs(cy(a) - baseline) - Math.abs(cy(b) - baseline))[0] : undefined;
    fields.documents.push({ ctc: row.text, nf: nfWord && nfWord.confidence >= 70 && /^\d{2,9}-\d{1,3}$/.test(nfWord.text) ? nfWord.text : '', volumes: volumeWord && volumeWord.confidence >= 80 ? volumeWord.text : '' });
  }
  return fields;
}

export const photoScore = (pre: PhotoFields) => Number(!!pre.id) * 4 + Number(!!pre.plate) * 2 + Number(!!pre.driver) + Math.min(pre.ctes.length + pre.documents.length, 30) * 3
  + pre.documents.reduce((sum, row) => sum + Number(!!row.nf) + Number(!!row.volumes), 0);

import { parsePreText } from './conference';
import { normalizeIssueDate, parsePreIssueDate } from './manifest-date';

export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type PhotoDocument = { ctc: string; nf: string; volumes: string; client?: string; recipient?: string; review?: string[] };
export type PhotoFields = ReturnType<typeof parsePreText> & {
  kind: 'pre' | 'dacte' | 'unknown'; driver: string; documents: PhotoDocument[];
  rawPlate?: string; expectedRows?: number; totalVolumes?: number; headerReview?: string[];
  issueDate?: string;
  readingSource?: 'gemini' | 'local';
  aiReader?: 'normal' | 'lite';
  readingFallback?: boolean;
  verification?: { status: 'single' | 'matched' | 'review' | 'unavailable'; checkedFields: number; conflicts: number };
};
export type OcrPage = { text: string; blocks?: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null };
export type CellRegion = { row: number; field: 'ctc' | 'nf' | 'volumes'; box: OcrWord['bbox'] };
export type NumericTableRegion = { field: 'ctc' | 'nf' | 'volumes' | 'expectedRows' | 'totalVolumes'; box: OcrWord['bbox'] };
export const pageWords = (page: OcrPage): OcrWord[] => page.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) ?? [];
const cx = (w: OcrWord) => (w.bbox.x0 + w.bbox.x1) / 2;
const cy = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2;
const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (s: string) => s.toUpperCase().replace(/[OQ]/g, '0').replace(/[IL|]/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2');
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const nfValue = (s: string) => { const n = digits(s.replace(/\s/g, '').replace(/[–—]/g, '-')); return /^\d{2,9}-\d{1,3}$/.test(n) ? n : ''; };
const literalCtc = (text: string) => text.trim().match(/^(\d{10})[.,;:]?$/)?.[1];

function table(page: OcrPage) {
  const words = pageWords(page);
  const sender = words.find(w => clean(w.text) === 'REMETENTE');
  let header = words.find(w => clean(w.text) === 'CTC');
  if (!header && sender) {
    const first = words.find(w => /^\d{10}$/.test(w.text) && w.bbox.x0 < sender.bbox.x0 && w.bbox.y0 > sender.bbox.y1);
    if (first) header = { ...first, text: 'CTC', bbox: { ...first.bbox, y0: sender.bbox.y0, y1: sender.bbox.y1 } };
  }
  if (!header) return;
  const height = header.bbox.y1 - header.bbox.y0;
  const headings = words.filter(w => Math.abs(cy(w) - cy(header!)) < height * 1.8).sort((a, b) => cx(a) - cx(b));
  const find = (pattern: RegExp) => headings.find(w => pattern.test(clean(w.text)));
  const anchors = { ctc: header, client: find(/^REMETENTE$/), recipient: find(/^DESTINATARIO$/), nf: find(/^NFSERIE$|^NF$/), volumes: find(/^VOLS/), species: find(/^ESPECIE$/), nature: find(/^NATUREZA$/), order: find(/^PEDIDO$|^NPEDIDO$/), check: find(/^CHK/) };
  const sorted = Object.values(anchors).filter((w): w is OcrWord => !!w).sort((a, b) => cx(a) - cx(b));
  const body = words.filter(w => !/^OBSERVA/i.test(w.text));
  const rowWords = body.filter(w => w.bbox.y0 > header!.bbox.y1 && /^[A-Z0-9|]{9,11}[.,;:]?$/i.test(w.text) && /\d.*\d/.test(w.text) && w.bbox.x0 < (sender?.bbox.x0 ?? header!.bbox.x1 + height * 6) && Math.abs(cx(w) - cx(header!)) < height * 9).sort((a, b) => cy(a) - cy(b));
  const ctcWords = rowWords.filter(w => literalCtc(w.text)).map(w => ({ ...w, text: literalCtc(w.text)! }));
  if (!ctcWords.length) return;
  const step = median(rowWords.slice(1).map((w, i) => cy(w) - cy(rowWords[i]!)).filter(gap => gap > height * .7)) || height * 2;
  const bottom = cy(rowWords.at(-1)!) + step * .6;
  function column(anchor: OcrWord | undefined) {
    if (!anchor) return { groups: [] as OcrWord[][], left: 0, right: 0 };
    const index = sorted.indexOf(anchor);
    const left = index > 0 ? (cx(sorted[index - 1]!) + cx(anchor)) / 2 : anchor.bbox.x0 - height * 2;
    const right = index < sorted.length - 1 ? (cx(anchor) + cx(sorted[index + 1]!)) / 2 : anchor.bbox.x1 + height * 2;
    const cells = body.filter(w => w.bbox.y0 > anchor.bbox.y1 && cx(w) >= left && cx(w) < right && cy(w) < bottom).sort((a, b) => cy(a) - cy(b));
    const groups: OcrWord[][] = [];
    for (const w of cells) {
      const last = groups.at(-1);
      if (last && Math.abs(cy(last[0]!) - cy(w)) < height * .55) last.push(w);
      else groups.push([w]);
    }
    return { groups, left, right };
  }
  const columns = { nf: column(anchors.nf), volumes: column(anchors.volumes), client: column(anchors.client), recipient: column(anchors.recipient) };
  return { words, header, height, step, ctcWords, rowWords, anchors, columns };
}

function groupFor(groups: OcrWord[][], index: number, count: number, baseline: number, tolerance: number) {
  return groups.filter(group => Math.abs(cy(group[0]!) - baseline) < tolerance)
    .sort((a, b) => Math.abs(cy(a[0]!) - baseline) - Math.abs(cy(b[0]!) - baseline))[0];
}
const groupText = (group: OcrWord[] | undefined) => group?.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' ').replace(/^[—–-]\s*/, '').trim() ?? '';

function columnBaseline(t: NonNullable<ReturnType<typeof table>>, field: keyof typeof t.columns, row: OcrWord): number {
  const anchor = t.anchors[field];
  if (!anchor) return cy(row);
  const groups = t.columns[field].groups;
  const gaps = groups.slice(1).map((group, i) => cy(group[0]!) - cy(groups[i]![0]!));
  // Missing OCR cells produce gaps of two or more rows. Their spacing still
  // measures perspective; do not treat the next visible cell as the next row.
  const step = median(gaps.filter(gap => gap > t.step * .6).map(gap => gap / Math.max(1, Math.round(gap / t.step)))) || t.step;
  const firstRow = t.rowWords[0]!;
  const projected = cy(anchor) + (cy(firstRow) - cy(t.header)) * step / t.step;
  const first = groups.find(group => Math.abs(cy(group[0]!) - projected) < t.step * .4);
  const start = first ? cy(first[0]!) : projected;
  return start + (cy(row) - cy(firstRow)) * step / t.step;
}

export function tableSummaryRegions(page: OcrPage): NumericTableRegion[] {
  const words = pageWords(page);
  const tableHeading = words.find(w => clean(w.text) === 'REMETENTE') ?? words.find(w => clean(w.text) === 'CTC');
  if (!tableHeading) return [];
  return (['expectedRows', 'totalVolumes'] as const).flatMap(field => {
    const pattern = field === 'expectedRows' ? /^CTCS$/ : /^VOLSS?$/;
    const label = words.filter(w => pattern.test(clean(w.text)) && w.bbox.y1 < tableHeading.bbox.y0).sort((a, b) => b.bbox.y0 - a.bbox.y0)[0];
    if (!label) return [];
    const h = label.bbox.y1 - label.bbox.y0;
    const next = words.filter(w => w.bbox.x0 > label.bbox.x1 && Math.abs(cy(w) - cy(label)) < h).sort((a, b) => a.bbox.x0 - b.bbox.x0)[0];
    const right = next ? next.bbox.x0 - h * .25 : label.bbox.x1 + h * 8;
    const values = words.filter(w => w.bbox.y0 >= label.bbox.y1 && w.bbox.y1 < tableHeading.bbox.y0 && w.bbox.x0 >= label.bbox.x0 - h * .25 && w.bbox.x1 <= right);
    if (values.length !== 1) return [];
    const box = values[0]!.bbox;
    return [{ field, box: { x0: box.x0 - h * .3, y0: box.y0 - h * .2, x1: box.x1 + h * .3, y1: box.y1 + h * .2 } }];
  });
}

function summaryValues(page: OcrPage): Partial<Pick<PhotoFields, 'expectedRows' | 'totalVolumes'>> {
  const values: Partial<Pick<PhotoFields, 'expectedRows' | 'totalVolumes'>> = {};
  for (const region of tableSummaryRegions(page)) {
    const words = pageWords(page).filter(w => cx(w) > region.box.x0 && cx(w) < region.box.x1 && cy(w) > region.box.y0 && cy(w) < region.box.y1);
    const value = words.map(w => w.text).join('').trim();
    if (/^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value))) values[region.field as 'expectedRows' | 'totalVolumes'] = Number(value);
  }
  return values;
}

function preIssueDate(page: OcrPage): string | undefined {
  const words = pageWords(page);
  const label = words.find(word => clean(word.text) === 'DATA' || /^DATA(?:DE)?EMISSAO$/.test(clean(word.text)));
  if (label) {
    const height = label.bbox.y1 - label.bbox.y0;
    const nearby = words.filter(word => word.bbox.y0 >= label.bbox.y1 && word.bbox.y0 < label.bbox.y1 + height * 5
      && Math.abs(word.bbox.x0 - label.bbox.x0) < height * 5)
      .map(word => ({ date: normalizeIssueDate(word.text), y: word.bbox.y0 })).filter(item => item.date)
      .sort((a, b) => a.y - b.y);
    if (nearby[0]) return nearby[0].date;
  }
  return parsePreIssueDate(page.text);
}

/** Columns are aligned using their own baselines to tolerate perspective. */
export function parsePhotoFields(page: OcrPage): PhotoFields {
  const words = pageWords(page);
  const kind = /PR[EÉ][- ]?MANIFESTO/i.test(page.text) ? 'pre' : /DACTE|DOCUMENTO AUXILIAR DO CONHECIMENTO|\bC[TC][-– ]?E\s*[:|\n][\s\S]{0,100}?(?<!\d)\d{10}(?!\d)/i.test(page.text) ? 'dacte' : 'unknown';
  const fields: PhotoFields = { ...parsePreText(page.text), kind, driver: '', documents: [] };
  if (kind === 'pre') {
    const issueDate = preIssueDate(page);
    if (issueDate) fields.issueDate = issueDate;
  }
  const driverLabel = words.find(w => /PLACA.*MOTOR|MOTOR.*PLACA/i.test(clean(w.text)));
  if (driverLabel) {
    const h = Math.max(1, driverLabel.bbox.y1 - driverLabel.bbox.y0);
    // The printed plate and driver's name can occupy separate columns below the same heading.
    const below = words.filter(w => w.bbox.y0 > driverLabel.bbox.y1 - h * .1
      && w.bbox.y0 < driverLabel.bbox.y1 + h * 5
      && w.bbox.x0 >= driverLabel.bbox.x0 - h * 2
      && w.bbox.x0 < driverLabel.bbox.x1 + h * 28)
      .sort((a, b) => cy(a) - cy(b) || a.bbox.x0 - b.bbox.x0);
    const nearest = below[0];
    const lineWords = below.filter(w => nearest && Math.abs(cy(w) - cy(nearest)) < h * .9);
    const line = lineWords.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' ').trim();
    const plate = parsePreText(line).plate || parsePreText(below.map(w => w.text).join(' ')).plate;
    if (plate) fields.plate = plate;
    const withoutPlate = line.replace(/[A-Z]{3}[\s-]?[0-9OIL][\s-]?[A-Z0-9][\s-]?[0-9OIL][\s-]?[0-9OIL]/i, ' ');
    const driver = withoutPlate.replace(/(^|[\s-])\d+(?=[\s-]|$)/g, ' ').replace(/^[\s:;|/–-]+|[\s:;|/–-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
    if (driver && /[A-ZÀ-ÖØ-Þ]{2,}/i.test(driver) && !/^MOTORISTA$/i.test(driver)) fields.driver = driver;
    // Fallback: when the OCR puts plate and driver on separate lines, use the first plausible name below the label.
    if (!fields.driver) {
      const nameWords = below.filter(w => /[A-ZÀ-ÖØ-Þ]{2,}/i.test(w.text) && !/^(PLACA|MOTORISTA|VEICULO|VEÍCULO)$/i.test(w.text) && !parsePreText(w.text).plate);
      const candidate = nameWords.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
      if (candidate && !/^\d+$/.test(candidate)) fields.driver = candidate;
    }
  }
  if (kind === 'dacte') return parseDacte(fields, words, page.text);
  const t = table(page);
  if (!t) return fields;
  fields.kind = 'pre';
  Object.assign(fields, summaryValues(page));
  if (!fields.issueDate) {
    const issueDate = preIssueDate(page);
    if (issueDate) fields.issueDate = issueDate;
  }
  const { ctcWords, columns, step } = t;
  const nfGroups = columns.nf.groups.map(g => g.filter(w => /^[0-9OQILBSZ-]{3,}$/i.test(w.text))).filter(g => g.length);
  for (const [index, row] of ctcWords.entries()) {
    const baseline = columnBaseline(t, 'nf', row);
    const nfGroup = groupFor(nfGroups, index, ctcWords.length, baseline, step * .4);
    const y = nfGroup ? cy(nfGroup[0]!) : baseline;
    const volumeGroup = groupFor(columns.volumes.groups, index, ctcWords.length, columnBaseline(t, 'volumes', row), step * .4);
    const nfRaw = groupText(nfGroup);
    const nf = nfValue(nfRaw);
    const volumeRaw = digits(groupText(volumeGroup).replace(/\s/g, ''));
    const volumes = /^\d{1,4}$/.test(volumeRaw) && Number(volumeRaw) > 0 ? volumeRaw : '';
    const client = groupText(groupFor(columns.client.groups, index, ctcWords.length, columnBaseline(t, 'client', row), step * .45));
    const recipient = groupText(groupFor(columns.recipient.groups, index, ctcWords.length, columnBaseline(t, 'recipient', row), step * .45));
    const review: string[] = [];
    if (!nf || nfGroup?.some(w => w.confidence < 85) || nf !== nfRaw) review.push('NF');
    if (!volumes || volumeGroup?.some(w => w.confidence < 90)) review.push('volumes');
    if (!client) review.push('cliente / laboratório');
    fields.documents.push({ ctc: row.text, nf: nf || (/^\d{2,12}$/.test(digits(nfRaw)) ? digits(nfRaw) : ''), volumes, client, recipient, review });
  }
  fields.ctcs = fields.documents.map(row => row.ctc);
  return fields;
}

/** Tight regions allow inexpensive rereads without processing the whole photo. */
export function tableCellRegions(page: OcrPage): CellRegion[] {
  const t = table(page);
  if (!t) return [];
  const regions: CellRegion[] = [];
  const nfGroups = t.columns.nf.groups.map(g => g.filter(w => /^[0-9OQILBSZ-]{3,}$/i.test(w.text))).filter(g => g.length);
  for (const [row, ctc] of t.ctcWords.entries()) {
    const baseline = columnBaseline(t, 'nf', ctc);
    const nf = groupFor(nfGroups, row, t.ctcWords.length, baseline, t.step * .4);
    for (const field of ['nf', 'volumes'] as const) {
      const col = t.columns[field];
      if (col.right <= col.left) continue;
      const y = field === 'nf' && nf ? cy(nf[0]!) : columnBaseline(t, field, ctc);
      const numericEnds = field === 'volumes' ? col.groups.flat().filter(w => /^\d{1,4}$/.test(w.text)).map(w => w.bbox.x1) : [];
      const end = median(numericEnds) + t.height * .2;
      const nfWords = field === 'nf' ? col.groups.flat().filter(w => /^[0-9OQILBSZ-]{3,}$/i.test(w.text)) : [];
      const nfAnchor = t.anchors.nf;
      const x1 = field === 'nf' && nfAnchor
        ? Math.min(col.right - t.height * .15, Math.max(nfAnchor.bbox.x1, ...nfWords.map(w => w.bbox.x1)) + t.height * .3)
        : numericEnds.length ? end : col.right - t.height * .15;
      const x0 = field === 'nf' && nfAnchor
        ? Math.max(col.left + t.height * .15, Math.min(nfAnchor.bbox.x0, ...nfWords.map(w => w.bbox.x0)) - t.height * .2)
        : Math.max(col.left + t.height * .15, x1 - t.height * 2.5);
      const glyphHeight = median(col.groups.flat().map(w => w.bbox.y1 - w.bbox.y0)) || t.height;
      const halfHeight = field === 'volumes' ? Math.max(glyphHeight * .65, t.step * .42) : glyphHeight * .65;
      regions.push({ row, field, box: { x0, x1, y0: y - halfHeight, y1: y + halfHeight } });
    }
  }
  return regions;
}

/** Recover malformed identifiers from their own pixels, without changing characters in a CTC. */
export function tableCtcRepairRegions(page: OcrPage): NumericTableRegion[] {
  const t = table(page);
  if (!t) return [];
  return t.rowWords.filter(w => !literalCtc(w.text)).map(w => {
    const h = w.bbox.y1 - w.bbox.y0;
    return { field: 'ctc', box: { x0: w.bbox.x0 - h * .25, x1: w.bbox.x1 + h * .25, y0: w.bbox.y0 - h * .1, y1: w.bbox.y1 + h * .1 } };
  });
}

/** A whole-column crop keeps all volumes while one block read removes per-cell latency. */
export function tableVolumeRegion(page: OcrPage): NumericTableRegion | undefined {
  const t = table(page);
  if (!t || !t.anchors.volumes || !t.columns.volumes.groups.length) return;
  const col = t.columns.volumes;
  const ends = col.groups.flat().filter(w => w.bbox.y1 - w.bbox.y0 > t.height * .4).map(w => w.bbox.x1);
  if (!ends.length) return;
  const right = median(ends) + t.height * .5;
  return { field: 'volumes', box: { x0: Math.max(col.left + t.height * .15, right - t.height * 2.7), x1: Math.min(col.right, right),
    y0: columnBaseline(t, 'volumes', t.rowWords[0]!) - t.height,
    y1: columnBaseline(t, 'volumes', t.rowWords.at(-1)!) + t.height } };
}

function parseDacte(fields: PhotoFields, words: OcrWord[], text: string): PhotoFields {
  fields.id = ''; fields.plate = ''; fields.driver = ''; // A DACTE does not supply a pre-manifest number.
  const labelled = text.match(/\bID\s*:\s*(\d{10})\b/i)?.[1] ?? text.match(/\bCTRC\s*[:\n]?\s*(\d{10})\b/i)?.[1];
  const idLabel = words.find(w => /^ID:?$/i.test(w.text));
  const topId = text.match(/\bC[TC][-– ]?E\s*[:|\n][\s\S]{0,100}?(?<!\d)(\d{10})(?!\d)/i)?.[1];
  const ctc = labelled || topId || (idLabel && words.find(w => /^\d{10}$/.test(w.text) && w.bbox.y0 >= idLabel.bbox.y0 && w.bbox.y0 < idLabel.bbox.y1 + (idLabel.bbox.y1 - idLabel.bbox.y0) * 5 && Math.abs(w.bbox.x0 - idLabel.bbox.x0) < (idLabel.bbox.y1 - idLabel.bbox.y0) * 8)?.text) || '';
  const name = (label: string) => text.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'))?.[1]?.replace(/\s+ENDERE[CÇ]O:.*$/i, '').trim() ?? '';
  const origin = text.search(/OR[IÍ1][GÇC][IÍ1][NM][AÁ][RN][IÍ1][O0]S/i);
  const series = origin >= 0 ? text.slice(origin).match(/(?<![\d/])\b(\d{1,3})\s*\/\s*(\d{3,9})\b(?![/\d])/) : null;
  let volumes = '';
  const quantity = words.find(w => /^QTDE?\.?$/i.test(w.text) && words.some(n => /^CARGA$/i.test(n.text) && Math.abs(n.bbox.x0 - w.bbox.x0) < 50 && n.bbox.y0 >= w.bbox.y0 && n.bbox.y0 < w.bbox.y1 + 50));
  if (quantity) {
    const h = quantity.bbox.y1 - quantity.bbox.y0;
    const value = words.filter(w => /^\d+[,.]0{3,4}$/.test(w.text) && w.bbox.y0 > quantity.bbox.y1 && w.bbox.y0 < quantity.bbox.y1 + h * 7 && Math.abs(w.bbox.x0 - quantity.bbox.x0) < h * 5).sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    volumes = value?.text.split(/[,.]/)[0] ?? '';
  }
  if (ctc) fields.documents = [{ ctc, nf: series ? `${series[2]}-${series[1]}` : '', volumes, client: name('REMETENTE'), recipient: name('DESTINAT[AÁ]RIO'), review: ['NF', 'volumes', 'cliente / laboratório'] }];
  fields.ctcs = fields.documents.map(row => row.ctc);
  return fields;
}

export const photoScore = (pre: PhotoFields) => Number(!!pre.id) * 4 + Number(!!pre.plate) * 2 + Number(!!pre.driver) + Math.min(Math.max(pre.ctcs.length, pre.documents.length), 30) * 3 + pre.documents.reduce((sum, row) => sum + Number(!!row.nf) + Number(!!row.volumes) + Number(!!row.client), 0);

import { parsePreText } from './conference';

export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type PhotoDocument = { ctc: string; nf: string; volumes: string; client?: string; recipient?: string; review?: string[] };
export type PhotoFields = ReturnType<typeof parsePreText> & { kind: 'pre' | 'dacte' | 'unknown'; driver: string; documents: PhotoDocument[] };
export type OcrPage = { text: string; blocks?: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null };
export type CellRegion = { row: number; field: 'ctc' | 'nf' | 'volumes'; box: OcrWord['bbox'] };
export const pageWords = (page: OcrPage): OcrWord[] => page.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))) ?? [];
const cx = (w: OcrWord) => (w.bbox.x0 + w.bbox.x1) / 2;
const cy = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2;
const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (s: string) => s.toUpperCase().replace(/[OQ]/g, '0').replace(/[IL|]/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2');
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const nfValue = (s: string) => { const n = digits(s.replace(/\s/g, '').replace(/[–—]/g, '-')); return /^\d{2,9}-\d{1,3}$/.test(n) ? n : ''; };

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
  const ctcWords = body.filter(w => w.bbox.y0 > header!.bbox.y1 && /^\d{10}$/.test(w.text) && w.bbox.x0 < (sender?.bbox.x0 ?? header!.bbox.x1 + height * 6) && Math.abs(cx(w) - cx(header!)) < height * 9).sort((a, b) => cy(a) - cy(b));
  if (!ctcWords.length) return;
  const step = median(ctcWords.slice(1).map((w, i) => cy(w) - cy(ctcWords[i]!))) || height * 2;
  const bottom = cy(ctcWords.at(-1)!) + step * .6;
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
  return { words, header, height, step, ctcWords, anchors, columns };
}

function groupFor(groups: OcrWord[][], index: number, count: number, baseline: number, tolerance: number) {
  return groups.find(group => Math.abs(cy(group[0]!) - baseline) < tolerance);
}
const groupText = (group: OcrWord[] | undefined) => group?.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' ').replace(/^[—–-]\s*/, '').trim() ?? '';

/** Columns are aligned using their own baselines to tolerate perspective. */
export function parsePhotoFields(page: OcrPage): PhotoFields {
  const words = pageWords(page);
  const kind = /PR[EÉ][- ]?MANIFESTO/i.test(page.text) ? 'pre' : /DACTE|DOCUMENTO AUXILIAR DO CONHECIMENTO|\bC[TC][-– ]?E\s*[:|\n][\s\S]{0,100}?(?<!\d)\d{10}(?!\d)/i.test(page.text) ? 'dacte' : 'unknown';
  const fields: PhotoFields = { ...parsePreText(page.text), kind, driver: '', documents: [] };
  const driverLabel = words.find(w => /PLACA.*MOTOR/i.test(clean(w.text)));
  if (driverLabel) {
    const h = driverLabel.bbox.y1 - driverLabel.bbox.y0;
    const below = words.filter(w => w.bbox.x0 >= driverLabel.bbox.x0 - h * 2 && w.bbox.y0 > driverLabel.bbox.y1 && w.bbox.y0 < driverLabel.bbox.y1 + h * 4);
    const nearest = below.sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    const line = below.filter(w => nearest && Math.abs(cy(w) - cy(nearest)) < h * .9).sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(' ');
    const plate = parsePreText(line).plate;
    if (plate) fields.plate = plate;
    const driver = plate ? line.replace(/^[A-Z]{3}[0-9OIL][A-Z0-9][0-9OIL]{2}\s*[-–]?\s*/i, '') : line.replace(/^[A-Z0-9]{6,9}\s*[-–]\s*/i, '');
    if (plate || driver !== line) fields.driver = driver.replace(/\s*[-–]\s*\d+\s*$/, '').trim();
  }
  if (kind === 'dacte') return parseDacte(fields, words, page.text);
  const t = table(page);
  if (!t) return fields;
  fields.kind = 'pre';
  const { ctcWords, columns, step, height } = t;
  const nfGroups = columns.nf.groups.map(g => g.filter(w => /^[0-9OQILBSZ-]{3,}$/i.test(w.text))).filter(g => g.length);
  const nfStep = median(nfGroups.slice(1).map((g, i) => cy(g[0]!) - cy(nfGroups[i]![0]!)).filter(gap => gap > step * .6 && gap < step * 1.4)) || step;
  for (const [index, row] of ctcWords.entries()) {
    const baseline = nfGroups[0] ? cy(nfGroups[0][0]!) + index * nfStep : cy(row);
    const nfGroup = groupFor(nfGroups, index, ctcWords.length, baseline, step * .4);
    const y = nfGroup ? cy(nfGroup[0]!) : baseline;
    const volumeGroup = groupFor(columns.volumes.groups, index, ctcWords.length, y, step * .4);
    const nfRaw = groupText(nfGroup);
    const nf = nfValue(nfRaw);
    const volumeRaw = digits(groupText(volumeGroup).replace(/\s/g, ''));
    const volumes = /^\d{1,4}$/.test(volumeRaw) && Number(volumeRaw) > 0 ? volumeRaw : '';
    const client = groupText(groupFor(columns.client.groups, index, ctcWords.length, cy(row), step * .45));
    const recipient = groupText(groupFor(columns.recipient.groups, index, ctcWords.length, y, step * .45));
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
  const step = median(nfGroups.slice(1).map((g, i) => cy(g[0]!) - cy(nfGroups[i]![0]!))) || t.step;
  for (const [row, ctc] of t.ctcWords.entries()) {
    const baseline = nfGroups[0] ? cy(nfGroups[0][0]!) + row * step : cy(ctc);
    const nf = groupFor(nfGroups, row, t.ctcWords.length, baseline, t.step * .4);
    const y = nf ? cy(nf[0]!) : baseline;
    for (const field of ['nf', 'volumes'] as const) {
      const col = t.columns[field];
      if (col.right <= col.left) continue;
      const known = field === 'nf' ? nf : undefined;
      const numericEnds = field === 'volumes' ? col.groups.flat().filter(w => /^\d{1,4}$/.test(w.text)).map(w => w.bbox.x1) : [];
      const end = median(numericEnds) + t.height * .2;
      const x1 = known ? Math.max(...known.map(w => w.bbox.x1)) + 4 : numericEnds.length ? end : col.right - t.height * .15;
      const x0 = known ? Math.min(...known.map(w => w.bbox.x0)) - 4 : Math.max(col.left + t.height * .15, x1 - t.height * 2.5);
      regions.push({ row, field, box: { x0, x1, y0: y - t.height * .7, y1: y + t.height * .7 } });
    }
  }
  return regions;
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

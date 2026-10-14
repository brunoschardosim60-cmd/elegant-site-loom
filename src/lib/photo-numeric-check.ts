import type { PhotoFields, PhotoDocument } from './photo-fields';
import type { NumericPhotoRead } from './photo-numeric-reader';

const digits = (value: string) => value.replace('-', '');
const pair = (row: PhotoDocument) => JSON.stringify([row.ctc, row.nf]);
const unique = (values: string[]) => [...new Set(values)];
const name = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Independent, positional OCR is evidence, not a replacement table. Never
 * match by row index, append OCR-only rows, or trust the sum to align volumes.
 */
export function checkPhotoNumbers(ai: PhotoFields, local: NumericPhotoRead): PhotoFields {
  const result = structuredClone(ai);
  if (ai.kind !== 'pre') return result;
  if (local.pre.kind !== 'pre') return { ...result, headerReview: unique([...(result.headerReview ?? []), 'A conferência local não conseguiu identificar a tabela do pré. Confira CTCs, NFs e volumes na foto.']), verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 } };
  let checked = 0, conflicts = 0;
  result.headerReview = [...(ai.headerReview ?? [])];
  const warnHeader = (message: string) => { result.headerReview!.push(message); conflicts++; };
  if (local.barcodeId && local.barcodeId !== result.id) {
    result.headerReview.push(`Número do pré recuperado do código de barras: ${result.id} → ${local.barcodeId}. Confira na foto.`);
    result.id = local.barcodeId;
  }
  for (const field of ['expectedRows', 'expectedNfs', 'totalVolumes'] as const) {
    const value = local.pre[field];
    if (value && ai[field] && value !== ai[field]) {
      const label = field === 'expectedRows' ? 'CTCs do cabeçalho' : field === 'expectedNfs' ? 'NFs do cabeçalho' : 'Volumes do cabeçalho';
      warnHeader(`${label} diferente na conferência local: ${ai[field]} / ${value}. Confira o cabeçalho.`);
      const actual = field === 'expectedRows' ? new Set(ai.documents.map(row => row.ctc)).size : field === 'expectedNfs' ? ai.documents.length : ai.documents.reduce((sum, row) => sum + Number(row.volumes || 0), 0);
      if (local.confirmedHeaders?.[field] === value && value === actual) result[field] = value;
    }
  }
  if (local.pre.plate && local.pre.plate !== ai.plate) warnHeader(`Placa diferente na conferência local: ${ai.plate} / ${local.pre.plate}. Confira letras e números.`);
  const localRows = local.pre.documents;
  const localCtcCount = (ctc: string) => localRows.filter(row => row.ctc === ctc).length;
  const aiCtcCount = (ctc: string) => ai.documents.filter(row => row.ctc === ctc).length;
  const claimed = new Set<number>();
  for (let index = 0; index < result.documents.length; index++) {
    const row = result.documents[index]!;
    row.review = [...(row.review ?? [])];
    let candidates = localRows.map((source, i) => ({ source, i })).filter(({ source }) => source.ctc === row.ctc && (aiCtcCount(row.ctc) === 1 && localCtcCount(row.ctc) === 1 || source.nf === row.nf));
    // Correct an identity only through a unique exact NF/volume pair read from
    // this same page. Different NFs of a repeated CTC remain distinct.
    if (!candidates.length && /^\d{1,9}-\d{1,3}$/.test(row.nf) && /^[1-9]\d*$/.test(row.volumes)) {
      const sameAnchor = (other: PhotoDocument) => digits(other.nf) === digits(row.nf) && (other.volumes === row.volumes || !!name(row.client ?? '') && !!name(row.recipient ?? '') && name(other.client ?? '') === name(row.client ?? '') && name(other.recipient ?? '') === name(row.recipient ?? ''));
      if (ai.documents.filter(sameAnchor).length === 1) candidates = localRows.map((source, i) => ({ source, i })).filter(({ source }) => sameAnchor(source));
    }
    if (candidates.length !== 1 || claimed.has(candidates[0]!.i)) {
      row.review.push('CTC / NF sem confirmação local única. Confira esta linha na foto.');
      continue;
    }
    const { source, i } = candidates[0]!;
    claimed.add(i);
    for (const field of ['ctc', 'nf', 'volumes'] as const) {
      const before = row[field], raw = source[field], confirmed = local.confirmed[i]?.[field];
      const valid = field === 'ctc' ? /^\d{10}$/ : field === 'nf' ? /^\d{1,9}-\d{1,3}$/ : /^[1-9]\d{0,5}$/;
      const value = confirmed ?? raw;
      if (field === 'nf' && !confirmed && /^\d{3,12}$/.test(raw) && digits(before) !== raw) {
        row.review.push(`NF-série: dígitos diferentes na conferência local (${before} / ${raw}, separador ilegível). Confira a NF e a série na foto.`);
        conflicts++;
      }
      if (!valid.test(value)) continue;
      checked++;
      if (before === value) continue;
      const label = field === 'ctc' ? 'CTC' : field === 'nf' ? 'NF-série' : 'Volumes';
      // A corrected identity cannot collide with another imported CTC/NF pair.
      const proposed = { ...row, [field]: value };
      const collision = result.documents.some((other, j) => j !== index && pair(other) === pair(proposed));
      if (confirmed && !collision) {
        row[field] = value;
        row.review.push(`${label} corrigido por duas leituras locais: ${before || 'ilegível'} → ${value}. Confira na foto.`);
      } else row.review.push(`${label} diferente na conferência local: ${before || 'ilegível'} / ${value}. Confira na foto.`);
      conflicts++;
    }
    for (const field of ['client', 'recipient'] as const) {
      const before = name(row[field] ?? ''), after = name(source[field] ?? '');
      if (before.length < 8 || after.length < 8 || before === after || Math.abs(before.length - after.length) > 2) continue;
      let prefix = 0; while (before[prefix] && before[prefix] === after[prefix]) prefix++;
      let suffix = 0; while (suffix < Math.min(before.length, after.length) - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
      if (Math.max(before.length, after.length) - prefix - suffix <= 2) {
        row.review.push(`${field === 'client' ? 'Cliente' : 'Destinatário'} diferente na conferência local: ${row[field]} / ${source[field]}. Confira a grafia na foto.`); conflicts++;
      }
    }
    row.review = unique(row.review);
  }
  result.ctcs = unique(result.documents.map(row => row.ctc));
  if (localRows.length !== result.documents.length || claimed.size !== localRows.length) warnHeader('A conferência local não confirmou todas as linhas da tabela. Confira CTCs e NFs na foto.');
  if (result.expectedRows && result.expectedRows !== result.ctcs.length) warnHeader(`Cabeçalho informa ${result.expectedRows} CTCs; foram lidos ${result.ctcs.length}. Confira o cabeçalho.`);
  if (result.totalVolumes && result.documents.reduce((sum, row) => sum + Number(row.volumes || 0), 0) !== result.totalVolumes) warnHeader('Soma de volumes diferente após a conferência local. Confira os volumes sinalizados.');
  result.headerReview = unique(result.headerReview);
  result.verification = { status: result.headerReview.length || result.documents.some(row => row.review?.length) ? 'review' : checked ? 'matched' : 'unavailable', checkedFields: checked, conflicts };
  return result;
}

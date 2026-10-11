import type { PhotoDocument, PhotoFields } from './photo-fields';
import { markLocalPhoto } from './local-photo';
import { normalizeIssueDate } from './manifest-date';

const ctcValid = (value: string) => /^\d{10}$/.test(value);
const nfValid = (value: string) => /^\d{1,9}-\d{1,3}$/.test(value);
const volumeValid = (value: string) => /^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value));
const hasName = (value: string) => /\p{L}/u.test(value) && !/^(?:UNKNOWN|ILEG[IÍ]VEL|N\/A|NULL)$/i.test(value.trim());
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const unique = (values: string[]) => [...new Set(values)];

/** Correct OCR using independently transcribed pixels, never row-index matching.
 * A changed value remains highlighted; two readings are not a guarantee of truth.
 */
export function correctLocalPhoto(local: PhotoFields, ai: PhotoFields): PhotoFields {
  if (ai.kind === 'unknown' || !ai.documents.length || (local.kind !== 'unknown' && local.kind !== ai.kind)) {
    const preserved = markLocalPhoto(local);
    return { ...preserved, readingFallback: true, headerReview: unique([...(preserved.headerReview ?? []), 'A IA não confirmou o documento e suas linhas. Os dados locais foram mantidos.']) };
  }
  const result: PhotoFields = { ...ai, readingSource: 'gemini', readingFallback: false, headerReview: [...(ai.headerReview ?? [])], documents: [] };
  let checkedFields = 0, conflicts = 0;
  const header = (label: string, before: string, after: string) => {
    if (key(before) === key(after)) { if (before) checkedFields++; return; }
    if (before && after) { result.headerReview!.push(`${label} corrigido pela IA: ${before} / ${after}. Confira na foto.`); conflicts++; }
    else if (after) result.headerReview!.push(`${label} identificado somente pela IA. Confira na foto.`);
    else if (before) result.headerReview!.push(`${label} mantido da leitura local; a IA não confirmou esse campo.`);
  };
  if (ai.kind === 'pre') {
    for (const [field, label, valid] of [
      ['id', 'Número do pré', (v: string) => /^DI\d{8,12}$/.test(v)],
      ['plate', 'Placa', (v: string) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(v)],
      ['driver', 'Motorista', hasName],
    ] as const) {
      const before = local[field].trim(), after = ai[field].trim();
      if (!valid(after) && valid(before)) result[field] = before;
      header(label, before, valid(after) ? after : '');
    }
    const before = normalizeIssueDate(local.issueDate ?? '') ?? '';
    const after = normalizeIssueDate(ai.issueDate ?? '') ?? '';
    if (!after && before) result.issueDate = before;
    header('Data de emissão', before, after);
  }
  const counts = (rows: PhotoDocument[]) => {
    const map = new Map<string, number>();
    for (const row of rows) if (ctcValid(row.ctc)) map.set(row.ctc, (map.get(row.ctc) ?? 0) + 1);
    return map;
  };
  const locals = counts(local.documents), ais = counts(ai.documents);
  const byCtc = new Map(local.documents.filter(row => locals.get(row.ctc) === 1).map(row => [row.ctc, row]));
  for (const source of ai.documents) {
    const row = { ...source, review: [...(source.review ?? [])] };
    const original = ais.get(row.ctc) === 1 ? byCtc.get(row.ctc) : undefined;
    if (!original) row.review.push('CTC identificado somente pela IA. Confira CTC, NF e volumes na foto.');
    else {
      checkedFields++;
      for (const [field, label, valid] of [['nf', 'NF', nfValid], ['volumes', 'Volumes', volumeValid], ['client', 'Cliente / laboratório', hasName], ['recipient', 'Destinatário', hasName]] as const) {
        const before = original[field]?.trim() ?? '', after = source[field]?.trim() ?? '';
        if (valid(after) && key(before) === key(after)) checkedFields++;
        else if (valid(after)) {
          if (before) { row.review.push(`${label} corrigido pela IA: ${before} / ${after}. Confira na foto.`); conflicts++; }
          else row.review.push(`${label} identificado somente pela IA. Confira na foto.`);
        } else if (valid(before)) {
          row[field] = before;
          row.review.push(`${label} mantido da leitura local; a IA não confirmou esse campo.`);
        } else row.review.push(`Confira ${label}: não foi possível confirmar esse campo.`);
      }
    }
    row.review = unique(row.review);
    result.documents.push(row);
  }
  // Retain a local CTC absent from the AI result for explicit review, even when
  // the AI header totals happen to match. Never silently discard an OCR row.
  for (const row of local.documents) if (ctcValid(row.ctc) && !ais.has(row.ctc)) {
    result.documents.push({ ...row, review: unique([...(row.review ?? []), 'CTC ausente na leitura da IA. Confira CTC, NF, volumes e nomes na foto.']) });
    conflicts++;
  }
  result.ctcs = result.documents.map(row => row.ctc).filter(ctcValid);
  if (!result.expectedRows && local.expectedRows) result.expectedRows = local.expectedRows;
  if (!result.totalVolumes && local.totalVolumes) result.totalVolumes = local.totalVolumes;
  if (ai.kind === 'pre' && (!ai.expectedRows || !ai.totalVolumes)) result.headerReview!.push('A IA não confirmou os totais do cabeçalho. Confira a quantidade de CTCs e volumes.');
  if (local.expectedRows && ai.expectedRows && local.expectedRows !== ai.expectedRows) result.headerReview!.push(`Quantidade de CTCs diferente entre as leituras: ${local.expectedRows} / ${ai.expectedRows}. Confira o cabeçalho.`);
  if (local.totalVolumes && ai.totalVolumes && local.totalVolumes !== ai.totalVolumes) result.headerReview!.push(`Total de volumes diferente entre as leituras: ${local.totalVolumes} / ${ai.totalVolumes}. Confira o cabeçalho.`);
  if (result.expectedRows && result.expectedRows !== result.documents.length) result.headerReview!.push(`Cabeçalho informa ${result.expectedRows} CTCs; foram mantidos ${result.documents.length}. Confira todas as linhas.`);
  const sum = result.documents.reduce((total, row) => total + (volumeValid(row.volumes) ? Number(row.volumes) : 0), 0);
  if (result.totalVolumes && result.totalVolumes !== sum) result.headerReview!.push(`Cabeçalho informa ${result.totalVolumes} volumes; a soma é ${sum}. Confira os campos de volumes.`);
  if (new Set(result.ctcs).size !== result.documents.length) result.headerReview!.push('Há CTCs repetidos ou ilegíveis. Confira todas as linhas.');
  result.headerReview = unique(result.headerReview!);
  result.verification = { status: result.headerReview.length || result.documents.some(row => row.review?.length) ? 'review' : 'matched', checkedFields, conflicts };
  return result;
}

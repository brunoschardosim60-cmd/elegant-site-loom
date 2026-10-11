import type { PhotoDocument, PhotoFields } from './photo-fields';

export const LOCAL_ROW_NOTICE = 'Leitura local: confira CTC, NF, volumes, cliente e destinatário na foto.';
export const LOCAL_HEADER_NOTICE = 'Leitura feita no navegador. Confira todas as linhas e os dados antes de cadastrar; a leitura pode ficar incompleta.';

/** Browser OCR is a reviewable draft, never an independent AI agreement. */
export function markLocalPhoto(pre: PhotoFields): PhotoFields {
  const documents: PhotoDocument[] = pre.documents.length ? pre.documents : pre.ctcs.map(ctc => ({ ctc, nf: '', volumes: '' }));
  const warnings = [...(pre.headerReview ?? [])];
  if (pre.kind === 'pre') {
    if (pre.expectedRows && pre.expectedRows !== documents.length) warnings.push(`Cabeçalho informa ${pre.expectedRows} CTCs; a leitura local encontrou ${documents.length}. Confira todas as linhas.`);
    const sum = documents.reduce((total, row) => total + (/^\d+$/.test(row.volumes) && Number(row.volumes) > 0 ? Number(row.volumes) : 0), 0);
    if (pre.totalVolumes && pre.totalVolumes !== sum) warnings.push(`Cabeçalho informa ${pre.totalVolumes} volumes; a leitura local somou ${sum}. Confira os volumes na foto.`);
    if (!pre.expectedRows || !pre.totalVolumes) warnings.push('Totais do cabeçalho não foram confirmados na leitura local. Confira a quantidade de CTCs e volumes.');
  }
  return {
    ...pre,
    readingSource: 'local',
    documents: documents.map(row => ({ ...row, review: [...new Set([...(row.review ?? []), LOCAL_ROW_NOTICE])] })),
    headerReview: [...new Set([...warnings, LOCAL_HEADER_NOTICE])],
    verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 },
  };
}

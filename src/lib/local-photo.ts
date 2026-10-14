import type { PhotoDocument, PhotoFields } from './photo-fields';

export const LOCAL_ROW_NOTICE = 'Leitura local: confira CTC, NF, volumes, cliente e destinatário na foto.';
export const LOCAL_HEADER_NOTICE = 'Leitura feita no navegador. Confira todas as linhas e os dados antes de cadastrar; a leitura pode ficar incompleta.';

/** Browser OCR is a reviewable draft, never an independent AI agreement. */
export function markLocalPhoto(pre: PhotoFields): PhotoFields {
  const documents: PhotoDocument[] = pre.documents.length ? pre.documents : pre.ctcs.map(ctc => ({ ctc, nf: '', volumes: '' }));
  const warnings = (pre.headerReview ?? []).filter(message => !/Cabeçalho informa .* volumes; a leitura local somou|Cabeçalho informa \d+ NFs;|Totais do cabeçalho não foram confirmados na leitura local/i.test(message));
  if (pre.kind === 'pre') {
    const uniqueCtcCount = new Set(documents.map(row => row.ctc).filter(Boolean)).size;
    if (pre.expectedRows && pre.expectedRows !== uniqueCtcCount) warnings.push(`Cabeçalho informa ${pre.expectedRows} CTCs; a leitura local encontrou ${uniqueCtcCount}. Confira todas as linhas.`);
    if (pre.expectedNfs && pre.expectedNfs !== documents.length) warnings.push(`Cabeçalho informa ${pre.expectedNfs} NFs; a leitura encontrou ${documents.length} linhas. Confira se falta alguma NF do mesmo CTC.`);
    if (!pre.expectedRows) warnings.push('Quantidade de CTCs do cabeçalho não pôde ser lida.');
    if (!pre.totalVolumes) warnings.push('Total de volumes do cabeçalho não pôde ser lido.');
  }
  return {
    ...pre,
    readingSource: 'local',
    documents: documents.map(row => {
      const review = (row.review ?? []).filter(message => message !== LOCAL_ROW_NOTICE);
      if (!/^\d{10}$/.test(row.ctc || '')) review.push('CTC não pôde ser lido com segurança.');
      if (!/^\d{2,9}-\d{1,3}$/.test(row.nf || '')) review.push('NF-série não pôde ser lida com segurança.');
      if (!/^\d{1,4}$/.test(row.volumes || '') || Number(row.volumes) <= 0) review.push('Volumes não puderam ser lidos com segurança.');
      if (!row.client?.trim()) review.push('Cliente / laboratório não pôde ser lido.');
      if (!row.recipient?.trim()) review.push('Destinatário não pôde ser lido.');
      const uniqueReview = [...new Set(review)];
      const { review: _previousReview, ...fields } = row;
      return { ...fields, ...(uniqueReview.length ? { review: uniqueReview } : {}) };
    }),
    headerReview: [...new Set([...warnings, LOCAL_HEADER_NOTICE])],
    verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 },
  };
}

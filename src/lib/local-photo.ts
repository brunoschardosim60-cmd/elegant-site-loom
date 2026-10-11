import type { PhotoDocument, PhotoFields } from './photo-fields';

/** Browser OCR is a reviewable draft, never an independent AI agreement. */
export function markLocalPhoto(pre: PhotoFields): PhotoFields {
  const documents: PhotoDocument[] = pre.documents.length ? pre.documents : pre.ctcs.map(ctc => ({ ctc, nf: '', volumes: '' }));
  const rowNotice = 'Leitura local: confira CTC, NF, volumes, cliente e destinatário na foto.';
  const headerNotice = 'Leitura feita no navegador. Confira todas as linhas e os dados antes de cadastrar; a leitura pode ficar incompleta.';
  return {
    ...pre,
    readingSource: 'local',
    documents: documents.map(row => ({ ...row, review: [...new Set([...(row.review ?? []), rowNotice])] })),
    headerReview: [...new Set([...(pre.headerReview ?? []), headerNotice])],
    verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 },
  };
}

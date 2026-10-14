import type { PhotoFields } from './photo-fields';
import type { PhotoAngle } from './photo-orientation';

/** A structural error needs an independent table reading, not row-index repair. */
export function needsBandReading(pre: PhotoFields): boolean {
  if (pre.kind !== 'pre' || !pre.documents.length) return false;
  const identities = pre.documents.map(row => JSON.stringify([row.ctc, row.nf]));
  return pre.documents.some(row => !/^\d{10}$/.test(row.ctc))
    || new Set(identities).size !== identities.length
    || !!pre.expectedRows && new Set(pre.documents.map(row => row.ctc)).size !== pre.expectedRows
    || !!pre.expectedNfs && pre.documents.length !== pre.expectedNfs
    || !!pre.totalVolumes && pre.documents.reduce((sum, row) => sum + Number(row.volumes || 0), 0) !== pre.totalVolumes;
}

/** Preserve the entire width, so CTC, NF and volume stay on the same scanline.
 * Overlap prevents a printed row from being cut at a strip boundary. All six
 * strips go in ONE provider request, with the whole page as their context.
 */
export function photoBandPayload(image: ImageBitmap, rotation: PhotoAngle, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const swap = rotation === 90 || rotation === 270;
  const scale = Math.min(1, 2800 / Math.max(image.width, image.height));
  const page = document.createElement('canvas');
  page.width = Math.round((swap ? image.height : image.width) * scale);
  page.height = Math.round((swap ? image.width : image.height) * scale);
  const context = page.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar as faixas da foto.');
  context.translate(page.width / 2, page.height / 2); context.rotate(rotation * Math.PI / 180);
  context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
  const encode = (canvas: HTMLCanvasElement, quality: number) => canvas.toDataURL('image/jpeg', quality).split(',')[1]!;
  const overview = document.createElement('canvas');
  overview.width = Math.round(page.width * Math.min(1, 1400 / Math.max(page.width, page.height)));
  overview.height = Math.round(page.height * overview.width / page.width);
  const overviewContext = overview.getContext('2d');
  if (!overviewContext) throw new Error('Não foi possível preparar as faixas da foto.');
  overviewContext.drawImage(page, 0, 0, overview.width, overview.height);
  const data = encode(overview, .9);
  const bands: string[] = [];
  for (let index = 0; index < 6; index++) {
    signal?.throwIfAborted();
    const top = Math.max(0, Math.floor(page.height * (index / 6 - .035)));
    const bottom = Math.min(page.height, Math.ceil(page.height * ((index + 1) / 6 + .035)));
    const band = document.createElement('canvas'); band.width = page.width; band.height = bottom - top;
    const ctx = band.getContext('2d');
    if (!ctx) throw new Error('Não foi possível preparar as faixas da foto.');
    ctx.drawImage(page, 0, top, page.width, bottom - top, 0, 0, band.width, band.height);
    bands.push(encode(band, .94));
  }
  if (data.length > 2800000 || bands.some(band => band.length > 1000000) || data.length + bands.reduce((sum, band) => sum + band.length, 0) > 3800000) throw new Error('Faixas muito grandes para uma única leitura.');
  return { data, bands, mimeType: 'image/jpeg' as const };
}

const rejected = (pre: PhotoFields, candidate: PhotoFields) => ({ ...pre, headerReview: [...new Set([...(pre.headerReview ?? []), `A leitura por faixas não confirmou a tabela e os totais (${new Set(candidate.documents.map(row => row.ctc).filter(Boolean)).size} CTCs, ${candidate.documents.length} NFs, ${candidate.documents.reduce((sum, row) => sum + Number(row.volumes || 0), 0)} volumes). Dados anteriores preservados; confira as linhas na foto.`])], verification: { status: 'review' as const, checkedFields: 0, conflicts: 1 } });

/** Totals are an admission check, not proof of individual cell accuracy.
 * Never append an extra model row or align tables by their array positions.
 */
export function applyBandRead(pre: PhotoFields, candidate: PhotoFields): PhotoFields {
  if (candidate.kind !== 'pre' || !candidate.documents.length || needsBandReading(candidate)) return rejected(pre, candidate);
  if (candidate.documents.some(row => !/^\d{10}$/.test(row.ctc) || !/^\d{1,9}-\d{1,3}$/.test(row.nf) || !/^[1-9]\d{0,5}$/.test(row.volumes))) return rejected(pre, candidate);
  const headers = ['expectedRows', 'expectedNfs', 'totalVolumes'] as const;
  if (headers.some(field => !candidate[field] || pre[field] && pre[field] !== candidate[field])) return rejected(pre, candidate);
  const result = structuredClone(candidate);
  if (!result.aiReader && pre.aiReader) result.aiReader = pre.aiReader;
  if (pre.imageRotation !== undefined) result.imageRotation = pre.imageRotation;
  result.tableRecovery = 'bands';
  let changed = 0;
  result.documents = result.documents.map(row => {
    const matches = pre.documents.filter(old => old.ctc === row.ctc && old.nf === row.nf);
    const old = matches.length === 1 ? matches[0] : undefined;
    const literalName = (value: string | undefined) => (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nameNotes = old ? (['client', 'recipient'] as const).filter(field => old[field] && row[field] && literalName(old[field]) !== literalName(row[field]))
      .map(field => `${field === 'client' ? 'Cliente' : 'Destinatário'} divergente entre leituras: ${old[field]} / ${row[field]}. Confira na foto.`) : [];
    if (old && old.volumes === row.volumes) {
      // Keep literal names from the first reading; matching totals cannot
      // authorize an unrelated name rewrite during numeric recovery.
      return { ...row, client: old.client || row.client || '', recipient: old.recipient || row.recipient || '',
        review: [...new Set([...(row.review ?? []), ...nameNotes, ...(old.review ?? []).filter(note => !/Cabeçalho informa|Confira a soma|segunda leitura|Volumes divergente|NF e série divergente/i.test(note))])] };
    }
    changed++;
    return { ...row, review: [...new Set([...(row.review ?? []), ...nameNotes, 'Linha recuperada na leitura por faixas. Confira CTC, NF-série e volumes na foto.'])] };
  });
  result.headerReview = [...new Set([...(result.headerReview ?? []), 'Tabela relida em faixas ampliadas; contagens de CTCs, NFs e volumes coincidem com o cabeçalho. Isso não substitui a revisão dos campos sinalizados.',
    ...(['id', 'plate', 'driver', 'issueDate'] as const).filter(field => pre[field] !== result[field]).map(field => `${({ id: 'Número do pré', plate: 'Placa', driver: 'Motorista', issueDate: 'Data de emissão' })[field]} mudou na leitura por faixas. Confira no cabeçalho da foto.`)])];
  result.verification = { status: 'review', checkedFields: result.documents.length * 3, conflicts: changed };
  return result;
}

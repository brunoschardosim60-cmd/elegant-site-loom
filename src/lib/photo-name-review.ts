import type { PhotoDocument } from './photo-fields';
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Similar endings can be clipped at a table border. Flag them for a literal
 * reread; never complete a company name from another row or outside knowledge.
 */
export function flagPhotoNameVariants(rows: PhotoDocument[]): PhotoDocument[] {
  const variants = { client: rows.map(row => key(row.client ?? '')), recipient: rows.map(row => key(row.recipient ?? '')) };
  return rows.map((row, index) => {
    const review = [...(row.review ?? [])];
    for (const field of ['client', 'recipient'] as const) {
      const value = variants[field][index]!;
      if (value.length < 10) continue;
      const similar = variants[field].some(other => {
        if (!other || other === value || Math.abs(other.length - value.length) > 2) return false;
        let common = 0; while (value[common] && value[common] === other[common]) common++;
        return common >= 10 && Math.max(value.length, other.length) - common <= 2;
      });
      if (similar) review.push(`${field === 'client' ? 'Cliente' : 'Destinatário'} com abreviação semelhante e final diferente entre linhas. Confira a última letra na foto.`);
    }
    return { ...row, review: [...new Set(review)] };
  });
}

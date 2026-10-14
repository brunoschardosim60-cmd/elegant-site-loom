import type { ManifestDraftRow } from '@/components/manifest-documents-editor';

export type ManifestTotals = { expectedRows?: number | undefined; totalVolumes?: number | undefined; totalsReviewed?: boolean | undefined };
export function reviewManifestTotals(rows: ManifestDraftRow[], totals: ManifestTotals) {
  const ctcs = new Set(rows.map(row => row.ctc.trim()).filter(value => /^\d{10}$/.test(value))).size;
  const volumes = rows.reduce((sum, row) => sum + (/^\d+$/.test(row.volumes.trim()) ? Number(row.volumes) : 0), 0);
  const messages: string[] = [];
  if (totals.expectedRows && totals.expectedRows !== ctcs) messages.push(`Cabeçalho: ${totals.expectedRows} CTCs · cadastro: ${ctcs}.`);
  if (totals.totalVolumes && totals.totalVolumes !== volumes) messages.push(`Cabeçalho: ${totals.totalVolumes} volumes · cadastro: ${volumes}.`);
  return { ctcs, volumes, messages, blocked: messages.length > 0 && !totals.totalsReviewed };
}

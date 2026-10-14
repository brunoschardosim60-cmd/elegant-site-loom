import type { DocumentItem, Manifest } from './conference';
import { compareManifestDates, manifestAgeDays } from './manifest-date';

export type TrackingStatus = 'all' | 'pending' | 'received';
export type TrackingRow = { manifest: Manifest; doc: DocumentItem };
export type TrackingFilters = { query?: string; filter?: string; status?: TrackingStatus; now?: string | number | Date };
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

/** Consult the saved CTCs, including finalized prés, without changing receipt state. */
export function selectTrackingRows(manifests: Manifest[], { query = '', filter = 'all', status = 'all', now = Date.now() }: TrackingFilters = {}): TrackingRow[] {
  const search = searchable(query.trim());
  const exactCtc = /^\d{10}$/.test(search);
  return manifests.filter(manifest => filter !== 'old' || manifestAgeDays(manifest, now) >= 2)
    .slice().sort((a, b) => filter === 'new' ? compareManifestDates(b, a) : compareManifestDates(a, b))
    .flatMap(manifest => manifest.documents.filter(doc =>
      (status === 'all' || (status === 'received' ? doc.received : !doc.received))
      && (exactCtc ? doc.ctc === search : searchable(`${doc.ctc} ${doc.nf} ${doc.client ?? ''} ${doc.recipient ?? ''} ${manifest.id} ${manifest.driver} ${manifest.plate}`).includes(search)),
    ).map(doc => ({ manifest, doc })));
}

export function conferenceTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

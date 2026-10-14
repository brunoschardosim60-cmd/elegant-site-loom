import type { DocumentItem, Manifest } from './conference';
import { compareManifestDates, manifestAgeDays } from './manifest-date';
import { matchesConferenceSearch } from './conference-display';
export { conferenceTimestamp } from './conference-display';

export type TrackingStatus = 'all' | 'pending' | 'received';
export type TrackingRow = { manifest: Manifest; doc: DocumentItem };
export type TrackingFilters = { query?: string; filter?: string; status?: TrackingStatus; now?: string | number | Date };

/** Consult the saved CTCs, including finalized prés, without changing receipt state. */
export function selectTrackingRows(manifests: Manifest[], { query = '', filter = 'all', status = 'all', now = Date.now() }: TrackingFilters = {}): TrackingRow[] {
  return manifests.filter(manifest => filter !== 'old' || manifestAgeDays(manifest, now) >= 2)
    .slice().sort((a, b) => filter === 'new' ? compareManifestDates(b, a) : compareManifestDates(a, b))
    .flatMap(manifest => manifest.documents.filter(doc =>
      (status === 'all' || (status === 'received' ? doc.received : !doc.received))
      && matchesConferenceSearch(manifest, query, doc),
    ).map(doc => ({ manifest, doc })));
}

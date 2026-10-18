import type { Manifest, PersonalReceipt } from "./conference";
import { selectOwnedRoutes, type DemandOwner } from "./conference-ownership";
import { isPendingDocument, presentRoutes } from "./conference-routes";
import { receiptDocumentVersion, setPersonalReceipt } from "./personal-receipts";

export type TeamReceiptCandidate = {
  manifestId: string;
  driver: string;
  documentId: string;
  ctc: string;
  nf: string;
  volumes: number;
  version: string;
  source: PersonalReceipt;
};

/** Review all personal demands, independently of the visible search and page. */
export function selectTeamReceiptCandidates(manifests: Manifest[], owner: DemandOwner) {
  if (!owner.userId) return [];
  const currentRoutes = new Map<string, { manifestId: string; documentId: string }[]>();
  for (const manifest of presentRoutes(manifests)) {
    for (const doc of manifest.documents) {
      if (doc.reroutedTo) continue;
      const routes = currentRoutes.get(doc.ctc) ?? [];
      routes.push({ manifestId: manifest.id, documentId: doc.id });
      currentRoutes.set(doc.ctc, routes);
    }
  }
  return selectOwnedRoutes(manifests, owner).flatMap((manifest) =>
    manifest.documents.flatMap((doc): TeamReceiptCandidate[] => {
      if (!isPendingDocument(doc) || !doc.peerReceipt?.receivedAt) return [];
      const matches = currentRoutes.get(doc.ctc) ?? [];
      if (
        matches.length !== 1 ||
        matches[0]?.manifestId !== manifest.id ||
        matches[0]?.documentId !== doc.id
      )
        return [];
      return [
        {
          manifestId: manifest.id,
          driver: manifest.driver,
          documentId: doc.id,
          ctc: doc.ctc,
          nf: doc.nf,
          volumes: doc.volumes,
          version: receiptDocumentVersion(doc),
          source: { ...doc.peerReceipt },
        },
      ];
    }),
  );
}

const key = (item: TeamReceiptCandidate) =>
  JSON.stringify([
    item.manifestId,
    item.driver,
    item.documentId,
    item.version,
    item.source.id,
    item.source.receivedAt,
  ]);

/** A changed/revoked source invalidates the review; never silently accept a subset. */
export function acceptReviewedTeamReceipts(
  manifests: Manifest[],
  owner: DemandOwner,
  reviewed: TeamReceiptCandidate[],
  now: string,
): Manifest[] | null {
  if (!owner.userId || !reviewed.length) return null;
  const current = new Map(
    selectTeamReceiptCandidates(manifests, owner).map((item) => [key(item), item]),
  );
  if (
    new Set(reviewed.map(key)).size !== reviewed.length ||
    reviewed.some((item) => !current.has(key(item)))
  )
    return null;
  const byManifest = new Map<string, TeamReceiptCandidate[]>();
  for (const item of reviewed) {
    const items = byManifest.get(item.manifestId) ?? [];
    items.push(current.get(key(item))!);
    byManifest.set(item.manifestId, items);
  }
  return manifests.map((manifest) =>
    (byManifest.get(manifest.id) ?? []).reduce(
      (changed, item) =>
        setPersonalReceipt(changed, item.documentId, owner.userId!, true, now, item.source),
      manifest,
    ),
  );
}

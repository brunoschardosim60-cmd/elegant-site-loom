import type { Manifest } from "./conference";
import { isPendingDocument, presentRoutes } from "./conference-routes";

export type WorkspaceScope = "mine" | "team";
export type DemandOwner = { email: string; userId?: string | undefined };
export const belongsTo = (manifest: Manifest, owner: DemandOwner) =>
  !!(owner.userId && manifest.createdBy
    ? manifest.createdBy === owner.userId
    : owner.email && manifest.createdByEmail?.toLowerCase() === owner.email.toLowerCase());

/** Always resolve reroutes across the whole team before narrowing the display. */
export function selectOwnedRoutes(manifests: Manifest[], owner?: DemandOwner) {
  return presentRoutes(manifests).filter((manifest) => !owner || belongsTo(manifest, owner));
}

export function demandTotals(manifests: Manifest[]) {
  const documents = manifests.flatMap((manifest) => manifest.documents);
  const pending = documents.filter(isPendingDocument);
  return {
    manifests: manifests.length,
    open: manifests.filter((manifest) => !manifest.finishedAt && !manifest.routeResolved).length,
    finished: manifests.filter((manifest) => manifest.finishedAt || manifest.routeResolved).length,
    ctcs: documents.length,
    nfs: documents.reduce(
      (sum, doc) => sum + doc.nf.split(/[,;]/).filter((nf) => /^\d/.test(nf.trim())).length,
      0,
    ),
    pending: pending.length,
    pendingNfs: pending.reduce(
      (sum, doc) => sum + doc.nf.split(/[,;]/).filter((nf) => /^\d/.test(nf.trim())).length,
      0,
    ),
    received: documents.filter((doc) => doc.received && !doc.reroutedTo).length,
    volumes: pending.reduce((sum, doc) => sum + doc.volumes, 0),
  };
}

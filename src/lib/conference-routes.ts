import type { DocumentItem, Manifest } from "./conference";
import { manifestIdPattern } from "./manifest-id";
import { normalizeIssueDate } from "./manifest-date";

type Route = { id: string; issueDate?: string | undefined };

/** Both exported manifests and dated photo prés can identify a new route attempt. */
export function isAnotherRoute(a: Route, b: Route) {
  const first = normalizeIssueDate(a.issueDate ?? "");
  const second = normalizeIssueDate(b.issueDate ?? "");
  return (
    a.id !== b.id &&
    manifestIdPattern.test(a.id) &&
    manifestIdPattern.test(b.id) &&
    !!first &&
    !!second &&
    first !== second
  );
}

/** A presentation only projection. Never save these derived statuses to the database. */
export function presentRoutes(manifests: Manifest[]): Manifest[] {
  const latest = new Map<string, Manifest>();
  for (const manifest of manifests) {
    if (!manifestIdPattern.test(manifest.id) || !normalizeIssueDate(manifest.issueDate ?? ""))
      continue;
    for (const doc of manifest.documents) {
      const prior = latest.get(doc.ctc);
      if (!prior || manifest.issueDate! > prior.issueDate!) latest.set(doc.ctc, manifest);
    }
  }
  return manifests.map((manifest) => {
    const documents = manifest.documents.map((doc) => {
      const target = latest.get(doc.ctc);
      const reroutedTo =
        target && isAnotherRoute(manifest, target) && target.issueDate! > manifest.issueDate!
          ? target.id
          : undefined;
      return { ...doc, reroutedTo };
    });
    return {
      ...manifest,
      documents,
      routeResolved:
        documents.length > 0 && documents.every((doc) => doc.received || doc.reroutedTo),
    };
  });
}

export const isPendingDocument = (doc: DocumentItem) => !doc.received && !doc.reroutedTo;

export function findCurrentMatches(manifests: Manifest[], ctc: string) {
  const activeIds = new Set(
    presentRoutes(manifests).flatMap((manifest) =>
      manifest.documents.filter((doc) => doc.ctc === ctc && !doc.reroutedTo).map((doc) => doc.id),
    ),
  );
  return manifests.flatMap((manifest) =>
    manifest.documents
      .filter((doc) => doc.ctc === ctc && activeIds.has(doc.id))
      .map((doc) => ({ manifest, doc })),
  );
}

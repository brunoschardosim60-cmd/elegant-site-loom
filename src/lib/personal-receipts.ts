import type { DocumentItem, Manifest, PersonalReceipt } from "./conference";
export const receiptDocumentVersion = (doc: DocumentItem) => `${doc.ctc}|${doc.nf}|${doc.volumes}`;
const valid = (doc: DocumentItem, check: PersonalReceipt) =>
  check.received &&
  (!check.documentVersion || check.documentVersion === receiptDocumentVersion(doc));

export function personalDocument(doc: DocumentItem, userId?: string): DocumentItem {
  if (!userId || !doc.receiptChecks) return doc;
  const own = doc.receiptChecks.find((check) => check.id === userId && valid(doc, check));
  const peer = doc.receiptChecks
    .filter((check) => check.id !== userId && !check.legacy && valid(doc, check))
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""))[0];
  return {
    ...doc,
    received: !!own,
    receivedAt: own?.receivedAt,
    receivedBy: own?.legacy ? undefined : own?.id,
    receivedByEmail: own?.email,
    peerReceipt: !own ? peer : undefined,
  };
}

/** Project only for display/export. Persist the complete canonical team state. */
export function personalManifest(manifest: Manifest, userId?: string): Manifest {
  if (!userId || !manifest.documents.some((doc) => doc.receiptChecks)) return manifest;
  const documents = manifest.documents.map((doc) => personalDocument(doc, userId));
  return {
    ...manifest,
    documents,
    finishedAt: documents.every((doc) => doc.received)
      ? documents
          .map((doc) => doc.receivedAt ?? "")
          .sort()
          .at(-1) || manifest.finishedAt
      : undefined,
  };
}

export function setPersonalReceipt(
  manifest: Manifest,
  documentId: string,
  userId: string,
  received: boolean,
  now: string,
  accepted?: PersonalReceipt,
): Manifest {
  const documents = manifest.documents.map((doc) => {
    if (doc.id !== documentId) return doc;
    const check: PersonalReceipt = {
      id: userId,
      received,
      documentVersion: receiptDocumentVersion(doc),
      ...(received ? { receivedAt: now } : {}),
      ...(received && accepted
        ? { acceptedFrom: accepted.id, sourceReceivedAt: accepted.receivedAt }
        : {}),
    };
    const receiptChecks = [
      ...(doc.receiptChecks ?? []).filter((item) => item.id !== userId),
      check,
    ];
    return { ...doc, receiptChecks, received: receiptChecks.some((item) => valid(doc, item)) };
  });
  return {
    ...manifest,
    documents,
    finishedAt: documents.every((doc) => doc.received) ? (manifest.finishedAt ?? now) : undefined,
  };
}

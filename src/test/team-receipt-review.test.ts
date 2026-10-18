import { expect, it } from "vitest";
import type { Manifest } from "@/lib/conference";
import { acceptReviewedTeamReceipts, selectTeamReceiptCandidates } from "@/lib/team-receipt-review";
import { personalDocument, setPersonalReceipt } from "@/lib/personal-receipts";

const owner = { email: "bruno@example.invalid", userId: "bruno" };
const sourceTime = "2026-10-18T11:00:00Z";
const now = "2026-10-18T12:00:00Z";
const manifests = (): Manifest[] =>
  [1, 2].map((n) => ({
    id: `0605221${n}`,
    driver: `MOTORISTA ${n}`,
    plate: "ABC1D23",
    date: "2026-10-17",
    issueDate: "2026-10-17",
    createdBy: "bruno",
    documents: [
      {
        id: `doc${n}`,
        ctc: String(n).padStart(10, "0"),
        nf: `${n}-1`,
        volumes: n,
        received: true,
        receiptChecks: [
          {
            id: "gisele",
            email: "gisele@example.invalid",
            received: true,
            receivedAt: sourceTime,
            documentVersion: `${String(n).padStart(10, "0")}|${n}-1|${n}`,
          },
        ],
      },
    ],
  }));
it("accepts reviewed documents across manifests in one snapshot, preserving sources and untouched personal data", () => {
  const original = manifests();
  const review = selectTeamReceiptCandidates(original, owner);
  expect(review).toHaveLength(2);
  const changed = acceptReviewedTeamReceipts(original, owner, review, now)!;
  expect(changed).toHaveLength(2);
  for (const manifest of changed) {
    expect(manifest.documents[0]!.receiptChecks).toContainEqual(
      expect.objectContaining({
        id: "bruno",
        received: true,
        acceptedFrom: "gisele",
        sourceReceivedAt: sourceTime,
      }),
    );
    expect(personalDocument(manifest.documents[0]!, "gisele").received).toBe(true);
  }
  expect(original[0]!.documents[0]!.receiptChecks).toHaveLength(1);
});
it.each(["revoked", "version", "source-time", "received", "removed", "ownership", "rerouted"])(
  "rejects the whole review if one entry changed: %s",
  (kind) => {
    const current = manifests();
    const review = selectTeamReceiptCandidates(current, owner);
    const doc = current[1]!.documents[0]!;
    if (kind === "revoked") doc.receiptChecks![0]!.received = false;
    if (kind === "version") doc.nf = "999-1";
    if (kind === "source-time") doc.receiptChecks![0]!.receivedAt = now;
    if (kind === "received")
      current[1] = setPersonalReceipt(current[1]!, doc.id, "bruno", true, now);
    if (kind === "removed") current.pop();
    if (kind === "ownership") current[1]!.createdBy = "other";
    if (kind === "rerouted")
      current.push({
        ...current[1]!,
        id: "06052299",
        createdBy: "other",
        issueDate: "2026-10-18",
        documents: [{ ...doc, id: "new-route" }],
      });
    expect(acceptReviewedTeamReceipts(current, owner, review, now)).toBeNull();
    expect(personalDocument(current[0]!.documents[0]!, "bruno").received).toBe(false);
  },
);
it("does not accept newly arrived receipts that were not reviewed", () => {
  const current = manifests();
  const review = selectTeamReceiptCandidates(current.slice(0, 1), owner);
  const changed = acceptReviewedTeamReceipts(current, owner, review, now)!;
  expect(personalDocument(changed[0]!.documents[0]!, "bruno").received).toBe(true);
  expect(personalDocument(changed[1]!.documents[0]!, "bruno").received).toBe(false);
});
it("does not offer legacy, ambiguous or other users' demands", () => {
  const current = manifests();
  current[0]!.documents[0]!.receiptChecks![0]!.legacy = true;
  current[1]!.createdBy = "other";
  expect(selectTeamReceiptCandidates(current, owner)).toHaveLength(0);
  const ambiguous = manifests();
  ambiguous.push({
    ...ambiguous[0]!,
    id: "06052299",
    documents: [{ ...ambiguous[0]!.documents[0]!, id: "ambiguous" }],
  });
  expect(selectTeamReceiptCandidates(ambiguous, owner).map((item) => item.manifestId)).toEqual([
    "06052212",
  ]);
});

import { expect, it } from "vitest";
import { applyDemandImports, demandImportStatus } from "@/lib/shared-demand-import";
import { applyImports, type ImportDraft } from "@/lib/manifest-import";
import { belongsTo, demandTotals, selectOwnedRoutes } from "@/lib/conference-ownership";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = { userId: uid(2), email: "second@example.invalid" };
const draft: ImportDraft = {
  id: "06052233",
  driver: "ANA",
  plate: "ABC1D23",
  issueDate: "2026-10-14",
  rows: [{ ctc: "0000000001", nf: "123-1", volumes: "2" }],
};
function saved() {
  const result = applyImports([], [draft], "2026-10-14T10:00:00Z");
  if (!result.ok) throw new Error(result.error);
  return result.manifests.map((m) => ({
    ...m,
    createdBy: uid(1),
    createdByEmail: "first@example.invalid",
  }));
}
it("links the second personal account without duplicating team totals or resetting receipts", () => {
  const existing = saved();
  existing[0]!.documents[0]!.received = true;
  existing[0]!.documents[0]!.receivedAt = "2026-10-14T11:00:00Z";
  expect(demandImportStatus(existing, draft, owner, true).kind).toBe("link");
  const result = applyDemandImports(existing, [draft], owner, "2026-10-15T10:00:00Z", true);
  if (!result.ok) throw new Error(result.error);
  expect(result.manifests).toHaveLength(1);
  expect(result.manifests[0]).toEqual({ ...existing[0], demandUserIds: [uid(2)] });
  expect(belongsTo(result.manifests[0]!, owner)).toBe(true);
  expect(
    selectOwnedRoutes(result.manifests, { email: "first@example.invalid", userId: uid(1) }),
  ).toHaveLength(1);
  expect(demandTotals(result.manifests)).toEqual(demandTotals(existing));
  expect(demandImportStatus(result.manifests, draft, owner, true).kind).toBe("mine");
  expect(
    applyDemandImports(result.manifests, [draft], owner, "2026-10-16T10:00:00Z", true),
  ).toEqual(result);
});
it.each([
  { ...draft, plate: "DEF2G34" },
  { ...draft, driver: "OTHER" },
  { ...draft, issueDate: "2026-10-15" },
  { ...draft, rows: [{ ...draft.rows[0]!, nf: "999-1" }] },
  { ...draft, rows: [{ ...draft.rows[0]!, volumes: "3" }] },
  { ...draft, rows: [...draft.rows, { ...draft.rows[0]!, ctc: "0000000002" }] },
])("blocks mismatched data instead of linking or overwriting", (changed) => {
  expect(demandImportStatus(saved(), changed, owner, true).kind).toBe("conflict");
  expect(applyDemandImports(saved(), [changed], owner, "2026-10-15T10:00:00Z", true).ok).toBe(
    false,
  );
});
it("fails closed until the database advertises support, while ordinary new imports still work", () => {
  expect(demandImportStatus(saved(), draft, owner).kind).toBe("conflict");
  expect(applyDemandImports([], [draft], owner, "2026-10-14T10:00:00Z", false).ok).toBe(true);
});

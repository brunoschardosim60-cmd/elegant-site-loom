import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { personalDocument, personalManifest, setPersonalReceipt } from "@/lib/personal-receipts";
import type { ConferenceState } from "@/lib/conference-state";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import { selectConferenceReport } from "@/lib/conference-pdf";
afterEach(cleanup);
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
it("preserves an unattributed historical confirmation for its owner without offering it as peer evidence", () => {
  const doc = {
    id: "old",
    ctc: "0000000001",
    nf: "1-1",
    volumes: 1,
    received: true,
    receiptChecks: [{ id: uid(1), received: true, legacy: true }],
  };
  expect(personalDocument(doc, uid(1)).received).toBe(true);
  expect(personalDocument(doc, uid(2))).toMatchObject({ received: false, peerReceipt: undefined });
});
const state = (): ConferenceState => ({
  activity: [],
  issues: [],
  manifests: [
    {
      id: "06052217",
      driver: "TEST DRIVER",
      plate: "ABC1D23",
      date: "2026-10-17",
      createdBy: uid(1),
      createdByEmail: "bruno@example.invalid",
      demandUserIds: [uid(2)],
      finishedAt: "2026-10-17T12:00:00Z",
      documents: [
        {
          id: "document",
          ctc: "0000000001",
          nf: "123-1",
          volumes: 2,
          received: true,
          receivedBy: uid(2),
          receivedByEmail: "teste@example.invalid",
          receiptChecks: [
            {
              id: uid(2),
              received: true,
              receivedAt: "2026-10-17T12:00:00Z",
              email: "teste@example.invalid",
              documentVersion: "0000000001|123-1|2",
            },
          ],
        },
      ],
    },
  ],
});
it("shows a subtle acceptance icon while the personal item stays pending and team stays received", () => {
  const snapshot = vi.fn(),
    original = state();
  render(
    <ConferenceWorkspace
      initialState={original}
      onSnapshot={snapshot}
      accountEmail="bruno@example.invalid"
      accountId={uid(1)}
      personalReceipts
    />,
  );
  expect(screen.getByText("Pendente", { exact: true })).toBeInTheDocument();
  const accept = screen.getByRole("button", {
    name: "Aceitar conferência da equipe para CTC 0000000001",
  });
  expect(accept).toHaveAttribute("title", expect.stringContaining("teste"));
  expect(
    screen.getByRole("button", { name: "Marcar CTC 0000000001 como recebido" }),
  ).toBeInTheDocument();
  fireEvent.click(accept);
  expect(
    screen.queryByRole("button", { name: "Aceitar conferência da equipe para CTC 0000000001" }),
  ).not.toBeInTheDocument();
  const saved = snapshot.mock.calls.at(-1)![0] as ConferenceState;
  expect(saved.manifests).toHaveLength(1);
  expect(saved.manifests[0]!.documents[0]!.receiptChecks).toContainEqual(
    expect.objectContaining({ id: uid(1), received: true, acceptedFrom: uid(2) }),
  );
  expect(original.manifests[0]!.documents[0]!.receiptChecks).toHaveLength(1);
});
it("uses personal receipt state consistently in lists and PDF, with no team duplication", () => {
  const original = state(),
    manifest = original.manifests[0]!;
  expect(personalManifest(manifest, uid(1)).finishedAt).toBeUndefined();
  expect(personalManifest(manifest, uid(2)).finishedAt).toBeTruthy();
  expect(
    selectConferenceReport({
      ...original,
      view: "missing",
      owner: { email: "bruno@example.invalid", userId: uid(1) },
    }).manifests,
  ).toHaveLength(1);
  expect(selectConferenceReport({ ...original, view: "missing" }).manifests).toHaveLength(0);
  const changed = setPersonalReceipt(manifest, "document", uid(1), true, "2026-10-17T13:00:00Z");
  const undone = setPersonalReceipt(changed, "document", uid(1), false, "2026-10-17T14:00:00Z");
  expect(undone.documents[0]!.received).toBe(true);
  expect(personalDocument(undone.documents[0]!, uid(1)).received).toBe(false);
  expect(personalDocument(undone.documents[0]!, uid(2)).received).toBe(true);
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
it("keeps rows compact and accepts team receipts only after reviewing the list", () => {
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
  expect(
    screen.queryByRole("button", { name: /Aceitar conferência da equipe para CTC/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Marcar CTC 0000000001 como recebido" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Conferências da equipe (1)" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("teste@example.invalid");
  expect(dialog).toHaveTextContent("NF 123-1");
  expect(dialog).toHaveTextContent("0000000001");
  fireEvent.click(within(dialog).getByRole("button", { name: "Aceitar todas (1)" }));
  expect(
    screen.queryByRole("button", { name: "Conferências da equipe (1)" }),
  ).not.toBeInTheDocument();
  const saved = snapshot.mock.calls.at(-1)![0] as ConferenceState;
  expect(saved.manifests).toHaveLength(1);
  expect(saved.manifests[0]!.documents[0]!.receiptChecks).toContainEqual(
    expect.objectContaining({ id: uid(1), received: true, acceptedFrom: uid(2) }),
  );
  expect(original.manifests[0]!.documents[0]!.receiptChecks).toHaveLength(1);
});
it("leaves receipts untouched when choosing manual checking and exposes the same review in Pending", () => {
  const snapshot = vi.fn();
  render(
    <ConferenceWorkspace
      initialState={state()}
      onSnapshot={snapshot}
      accountEmail="bruno@example.invalid"
      accountId={uid(1)}
      personalReceipts
    />,
  );
  snapshot.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  fireEvent.click(screen.getByRole("button", { name: "Conferências da equipe (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Conferir manualmente" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Pendente", { exact: true })).toBeInTheDocument();
  expect(snapshot).not.toHaveBeenCalled();
});
it("offers no batch acceptance in the read-only team scope", () => {
  render(
    <ConferenceWorkspace
      initialState={state()}
      accountEmail="bruno@example.invalid"
      accountId={uid(1)}
      personalReceipts
      scope="team"
    />,
  );
  expect(screen.queryByRole("button", { name: /Conferências da equipe/ })).not.toBeInTheDocument();
});
it("locates a shared pre in personal Pending even when the teammate has already finished it", () => {
  const original = state();
  original.manifests[0]!.id = "DI00991700003";
  render(
    <ConferenceWorkspace
      initialState={original}
      accountEmail="bruno@example.invalid"
      accountId={uid(1)}
      personalReceipts
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Código do CTC" }), {
    target: { value: "DI00991700003" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Conferir$/ }));
  expect(screen.getByRole("heading", { name: "Conferência de documentos" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Marcar CTC 0000000001 como recebido" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Pendente", { exact: true })).toBeInTheDocument();
});
it("refreshes an open review without accepting anything when the source is revoked remotely", () => {
  const original = state(),
    snapshot = vi.fn();
  const props = {
    accountEmail: "bruno@example.invalid",
    accountId: uid(1),
    personalReceipts: true,
    onSnapshot: snapshot,
  };
  const mounted = render(
    <ConferenceWorkspace {...props} initialState={original} externalState={original} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conferências da equipe (1)" }));
  const revoked = structuredClone(original);
  revoked.manifests[0]!.documents[0]!.receiptChecks![0]!.received = false;
  mounted.rerender(
    <ConferenceWorkspace {...props} initialState={original} externalState={revoked} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Aceitar todas (1)" }));
  expect(screen.getByRole("button", { name: "Aceitar todas (0)" })).toBeDisabled();
  expect(screen.getByRole("dialog")).toHaveTextContent("Nenhum CTC foi alterado.");
  expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
    "Confira a lista atualizada",
  );
  expect(snapshot).not.toHaveBeenCalled();
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

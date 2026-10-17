import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Manifest } from "@/lib/conference";
import { belongsTo, demandTotals, selectOwnedRoutes } from "@/lib/conference-ownership";
import { selectConferenceReport } from "@/lib/conference-pdf";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import { AccountStatusBar } from "@/components/account-status";
import { useState } from "react";
import type { ConferenceState } from "@/lib/conference-state";
vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
afterEach(cleanup);
function TeamPreview({
  items,
  onSnapshot,
}: {
  items: Manifest[];
  onSnapshot: (state: ConferenceState) => void;
}) {
  const [scope, setScope] = useState<"mine" | "team">("mine");
  return (
    <>
      <AccountStatusBar
        email="bruno@example.test"
        status="Todos os dados salvos"
        pending={false}
        error=""
        conflict={false}
        teamView={scope === "team"}
        onTeam={() => setScope((current) => (current === "team" ? "mine" : "team"))}
        onSignOut={() => {}}
        onRetry={() => {}}
        onReload={() => {}}
      />
      <ConferenceWorkspace
        scope={scope}
        onScopeChange={setScope}
        initialState={{ manifests: items, activity: [], issues: [] }}
        accountEmail="bruno@example.test"
        onSnapshot={onSnapshot}
      />
    </>
  );
}
const manifest = (id: string, email: string, ctc: string): Manifest => ({
  id,
  driver: email === "bruno@example.test" ? "MOTORISTA BRUNO" : "MOTORISTA GISELE",
  plate: "ABC1D23",
  date: "2026-10-16",
  issueDate: "2026-10-16",
  createdByEmail: email,
  documents: [{ id: `doc-${id}`, ctc, nf: "123-1, 456-1", volumes: 4, received: false }],
});
it("resolves remanifestations across owners before filtering personal lists and PDFs", () => {
  const old = {
    ...manifest("06059990", "bruno@example.test", "0000000001"),
    issueDate: "2026-10-15",
  };
  const next = manifest("06059991", "gisele@example.test", "0000000001");
  const owner = { email: "bruno@example.test" };
  const mine = selectOwnedRoutes([old, next], owner);
  expect(mine).toHaveLength(1);
  expect(mine[0]?.documents[0]?.reroutedTo).toBe(next.id);
  expect(demandTotals(mine)).toMatchObject({ pending: 0, finished: 1, nfs: 2, volumes: 0 });
  expect(
    selectConferenceReport({ manifests: [old, next], issues: [], view: "missing", owner })
      .manifests,
  ).toHaveLength(0);
  expect(
    selectConferenceReport({ manifests: [old, next], issues: [], view: "tracking", owner })
      .manifests[0]?.documents[0]?.reroutedTo,
  ).toBe(next.id);
  expect(
    belongsTo(
      { ...old, createdBy: "same-id" },
      { email: "changed@example.test", userId: "same-id" },
    ),
  ).toBe(true);
});
it("switches between personal and team demands without saving a filtered subset", () => {
  const onSnapshot = vi.fn();
  const items = [
    manifest("06059990", "bruno@example.test", "0000000001"),
    manifest("06059991", "gisele@example.test", "0000000002"),
  ];
  render(<TeamPreview items={items} onSnapshot={onSnapshot} />);
  expect(screen.getByRole("heading", { name: "MOTORISTA BRUNO" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "MOTORISTA GISELE" })).not.toBeInTheDocument();
  onSnapshot.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Equipe" }));
  expect(screen.getByRole("heading", { name: "MOTORISTA GISELE" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Resumo por integrante" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Minhas demandas" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Importar planilha" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Marcar CTC 0000000002 como recebido" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Voltar à minha conta" }));
  expect(onSnapshot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Marcar CTC 0000000001 como recebido" }));
  const saved = onSnapshot.mock.lastCall?.[0];
  expect(saved.manifests).toHaveLength(2);
  expect(saved.manifests[0].documents[0].received).toBe(true);
  expect(saved.manifests[1].documents[0].received).toBe(false);
});
it("a teammate CTC scan uses the shared record and exposes the team view", () => {
  const onSnapshot = vi.fn();
  const items = [
    manifest("06059990", "bruno@example.test", "0000000001"),
    manifest("06059991", "gisele@example.test", "0000000002"),
  ];
  render(<TeamPreview items={items} onSnapshot={onSnapshot} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Código do CTC" }), {
    target: { value: "0000000002" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Conferir" }));
  expect(screen.getByRole("button", { name: "Voltar à minha conta" })).toBeInTheDocument();
  expect(onSnapshot.mock.lastCall?.[0].manifests[1]).toMatchObject({
    createdByEmail: "gisele@example.test",
    documents: [{ received: true }],
  });
});

it("keeps authorship out of personal and team lists while preserving receipt authors and history access", () => {
  const audit = vi.fn();
  const item = manifest("06059990", "bruno@example.test", "0000000001");
  item.updatedByEmail = "gisele@example.test";
  item.updatedAt = "2026-10-16T18:30:00Z";
  item.documents[0] = {
    ...item.documents[0]!,
    received: true,
    receivedByEmail: "alan@example.test",
    receivedAt: "2026-10-16T17:00:00Z",
  };
  item.documents.push({ ...item.documents[0], id: "pending", ctc: "0000000002", received: false });
  const view = render(
    <ConferenceWorkspace
      initialState={{ manifests: [item], activity: [], issues: [] }}
      accountEmail="bruno@example.test"
      onAuditManifest={audit}
    />,
  );
  expect(screen.queryByText(/Atualizado por/)).not.toBeInTheDocument();
  expect(screen.getByText(/Conferido por/)).toHaveTextContent(
    "alan@example.test · 16/10/2026, 14:00",
  );
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  expect(screen.queryByText(/Atualizado por/)).not.toBeInTheDocument();
  view.rerender(
    <ConferenceWorkspace
      initialState={{ manifests: [item], activity: [], issues: [] }}
      accountEmail="bruno@example.test"
      scope="team"
      onAuditManifest={audit}
    />,
  );
  expect(screen.queryByText(/Atualizado por|Cadastrado por/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Conferência" }));
  expect(screen.queryByText(/Atualizado por|Cadastrado por/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Histórico do manifesto 06059990" }));
  expect(audit).toHaveBeenCalledWith("06059990");
});

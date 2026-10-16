import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Manifest } from "@/lib/conference";
import { belongsTo, demandTotals, selectOwnedRoutes } from "@/lib/conference-ownership";
import { selectConferenceReport } from "@/lib/conference-pdf";
import { ConferenceWorkspace } from "@/components/conference-workspace";
vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
afterEach(cleanup);
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
  render(
    <ConferenceWorkspace
      initialState={{ manifests: items, activity: [], issues: [] }}
      accountEmail="bruno@example.test"
      onSnapshot={onSnapshot}
    />,
  );
  expect(screen.getByRole("heading", { name: "MOTORISTA BRUNO" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "MOTORISTA GISELE" })).not.toBeInTheDocument();
  onSnapshot.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Equipe" }));
  expect(screen.getByRole("heading", { name: "MOTORISTA GISELE" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Resumo por integrante" })).toHaveTextContent("gisele");
  fireEvent.click(screen.getByRole("button", { name: "Minhas demandas" }));
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
  render(
    <ConferenceWorkspace
      initialState={{ manifests: items, activity: [], issues: [] }}
      accountEmail="bruno@example.test"
      onSnapshot={onSnapshot}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Código do CTC" }), {
    target: { value: "0000000002" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Conferir" }));
  expect(screen.getByRole("button", { name: "Equipe" })).toHaveAttribute("aria-pressed", "true");
  expect(onSnapshot.mock.lastCall?.[0].manifests[1]).toMatchObject({
    createdByEmail: "gisele@example.test",
    documents: [{ received: true }],
  });
});

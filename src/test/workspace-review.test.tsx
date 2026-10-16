import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import type { ConferenceState } from "@/lib/conference-state";

vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
afterEach(cleanup);
const state = (count = 123): ConferenceState => ({
  activity: [],
  issues: [],
  manifests: [
    {
      id: "06050001",
      driver: "MOTORISTA TESTE",
      plate: "ABC1D23",
      date: "2026-10-16",
      issueDate: "2026-10-16",
      createdByEmail: "bruno@example.test",
      documents: Array.from({ length: count }, (_, i) => ({
        id: `doc-${i}`,
        ctc: String(i + 1).padStart(10, "0"),
        nf: `${i + 1}-1`,
        volumes: 1,
        received: false,
      })),
    },
  ],
});

it("does not call another person's open manifests finalized in an empty personal account", () => {
  render(<ConferenceWorkspace initialState={state()} accountEmail="gisele@example.test" />);
  expect(screen.getByRole("heading", { name: "Nenhum manifesto cadastrado" })).toBeInTheDocument();
  expect(
    screen.queryByText("Todos os manifestos cadastrados foram finalizados."),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/cadastre um manifesto na sua conta/)).toBeInTheDocument();
});

it("gives an empty team a consultation message instead of asking to import in a read-only view", () => {
  render(
    <ConferenceWorkspace
      initialState={{ manifests: [], activity: [], issues: [] }}
      accountEmail="bruno@example.test"
      scope="team"
    />,
  );
  expect(screen.getByText("A equipe ainda não cadastrou manifestos.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Importar planilha" })).not.toBeInTheDocument();
});

it("bounds pending rows while searching every document and saving the whole snapshot", () => {
  const onSnapshot = vi.fn();
  render(<ConferenceWorkspace initialState={state()} onSnapshot={onSnapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  const pendingTable = () => screen.getByRole("table", { name: "CTCs pendentes" });
  expect(within(pendingTable()).getAllByRole("row")).toHaveLength(51);
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(pendingTable()).toHaveTextContent("0000000051");
  expect(within(pendingTable()).queryByText("0000000001")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar pré-manifesto" }), {
    target: { value: "0000000123" },
  });
  expect(pendingTable()).toHaveTextContent("0000000123");
  expect(
    screen.queryByRole("navigation", { name: "Páginas das pendências" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Marcar CTC 0000000123 como recebido" }));
  const saved = onSnapshot.mock.lastCall?.[0] as ConferenceState;
  expect(saved.manifests[0]?.documents).toHaveLength(123);
  expect(saved.manifests[0]?.documents.filter((doc) => doc.received)).toHaveLength(1);
});

it("clears search and filters without a write and keeps the scanner draft", () => {
  const onSnapshot = vi.fn();
  render(
    <ConferenceWorkspace
      initialState={state()}
      onSnapshot={onSnapshot}
      accountEmail="bruno@example.test"
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Código do CTC" }), {
    target: { value: "00000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rastreamento" }));
  expect(screen.getByText(/consulta dos seus cadastros/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar CTC no rastreamento" }), {
    target: { value: "nao existe" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Status do CTC" }), {
    target: { value: "received" },
  });
  onSnapshot.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
  expect(screen.getByRole("textbox", { name: "Buscar CTC no rastreamento" })).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "Status do CTC" })).toHaveValue("all");
  expect(screen.getByRole("table")).toHaveTextContent("0000000001");
  expect(onSnapshot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferência" }));
  expect(screen.getByRole("textbox", { name: "Código do CTC" })).toHaveValue("00000");
});

it("clamps a pending page when a colleague receives its last records", () => {
  const original = state(51);
  const { rerender } = render(
    <ConferenceWorkspace initialState={original} externalState={original} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(screen.getByRole("table")).toHaveTextContent("0000000051");
  const changed = structuredClone(original);
  changed.manifests[0]!.documents[50]!.received = true;
  rerender(<ConferenceWorkspace initialState={original} externalState={changed} />);
  expect(screen.getByRole("table")).toHaveTextContent("0000000001");
  expect(screen.queryByRole("button", { name: "Próxima" })).not.toBeInTheDocument();
});

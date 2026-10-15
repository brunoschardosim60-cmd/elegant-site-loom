import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import { CtcTracking } from "@/components/ctc-tracking";
import { conferenceTimestamp, selectTrackingRows } from "@/lib/ctc-tracking";
import type { ConferenceState } from "@/lib/conference-state";

const mocks = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
vi.mock("@/lib/conference-pdf", () => ({ exportConferencePdf: mocks.pdf }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const state: ConferenceState = {
  manifests: [
    {
      id: "DI00000000001",
      driver: "JOÃO SILVA",
      plate: "ABC1D23",
      date: "2026-10-12T14:00:00Z",
      issueDate: "2026-10-10",
      documents: [
        {
          id: "a",
          ctc: "0000000001",
          nf: "123-1",
          volumes: 2,
          client: "LABORATÓRIO ALFA",
          received: false,
          receivedAt: "2026-10-01T14:00:00Z",
        },
        {
          id: "b",
          ctc: "0000000002",
          nf: "124-1",
          volumes: 3,
          received: true,
          receivedAt: "2026-10-13T14:05:00Z",
        },
      ],
    },
    {
      id: "DI00000000002",
      driver: "MARIA",
      plate: "DEF4G56",
      date: "2026-10-11T14:00:00Z",
      finishedAt: "2026-10-12T14:00:00Z",
      documents: [{ id: "c", ctc: "0000000003", nf: "125-1", volumes: 1, received: true }],
    },
  ],
  activity: [],
  issues: [],
};

it("searches every saved CTC, including finalized prés, and preserves literal leading zeros", () => {
  expect(selectTrackingRows(state.manifests).map((row) => row.doc.ctc)).toEqual([
    "0000000001",
    "0000000002",
    "0000000003",
  ]);
  expect(
    selectTrackingRows(state.manifests, { query: "  laboratorio alfa " }).map((row) => row.doc.ctc),
  ).toEqual(["0000000001"]);
  expect(
    selectTrackingRows(state.manifests, { query: "joao", status: "received" }).map(
      (row) => row.doc.ctc,
    ),
  ).toEqual(["0000000002"]);
  expect(selectTrackingRows(state.manifests, { query: "125-1" }).map((row) => row.doc.ctc)).toEqual(
    ["0000000003"],
  );
  expect(selectTrackingRows(state.manifests, { query: "0000000001", status: "received" })).toEqual(
    [],
  );
});

it("uses the original pré date for age and reverses order without mutating saved records", () => {
  expect(
    selectTrackingRows(state.manifests, { filter: "old", now: "2026-10-12T14:00:00Z" }).map(
      (row) => row.doc.ctc,
    ),
  ).toEqual(["0000000001", "0000000002"]);
  expect(selectTrackingRows(state.manifests, { filter: "new" })[0]?.manifest.id).toBe(
    "DI00000000002",
  );
  expect(state.manifests[0]?.documents).toHaveLength(2);
});

it("formats an actual conference timestamp in Brasília and never invents a legacy time", () => {
  expect(conferenceTimestamp("2026-10-13T01:05:00Z")).toContain("12/10/2026");
  expect(conferenceTimestamp("2026-10-13T01:05:00Z")).toContain("22:05");
  expect(conferenceTimestamp(undefined)).toBeUndefined();
  expect(conferenceTimestamp("invalid")).toBeUndefined();
});

it("shows pending and received dates without writing a snapshot or marking documents during consultation", () => {
  const snapshot = vi.fn();
  const audit = vi.fn();
  render(
    <ConferenceWorkspace initialState={state} onSnapshot={snapshot} onAuditManifest={audit} />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Código do CTC" }), {
    target: { value: "00000" },
  });
  snapshot.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Rastreamento" }));
  const table = screen.getByRole("table", { name: "Rastreamento de CTCs" });
  expect(within(table).getByText("0000000001").closest("tr")).toHaveTextContent(
    "Aguardando conferência",
  );
  const received = within(table).getByText("0000000002").closest("tr");
  expect(received).toHaveTextContent("13/10/2026");
  expect(received).toHaveTextContent("11:05");
  expect(within(table).getByText("0000000003").closest("tr")).toHaveTextContent(
    "Horário não registrado",
  );
  expect(screen.queryByRole("button", { name: /Marcar CTC/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Histórico do CTC 0000000002" }));
  expect(audit).toHaveBeenCalledExactlyOnceWith("DI00000000001");
  expect(snapshot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Conferência" }));
  expect(screen.getByRole("textbox", { name: "Código do CTC" })).toHaveValue("00000");
});

it("reflects another device receiving a CTC while keeping the current search and status filter", () => {
  const { rerender } = render(<ConferenceWorkspace initialState={state} externalState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Rastreamento" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar CTC no rastreamento" }), {
    target: { value: "0000000001" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Status do CTC" }), {
    target: { value: "pending" },
  });
  const changed: ConferenceState = {
    ...state,
    manifests: state.manifests.map((manifest) => ({
      ...manifest,
      documents: manifest.documents.map((doc) =>
        doc.id === "a" ? { ...doc, received: true, receivedAt: "2026-10-13T14:10:00Z" } : doc,
      ),
    })),
  };
  rerender(<ConferenceWorkspace initialState={state} externalState={changed} />);
  expect(screen.getByRole("heading", { name: "Nenhum CTC encontrado" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Buscar CTC no rastreamento" })).toHaveValue(
    "0000000001",
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Status do CTC" }), {
    target: { value: "received" },
  });
  expect(screen.getByRole("table")).toHaveTextContent("11:10");
});

it("renders at most 50 rows and resets pagination for a different search", () => {
  const source = state.manifests[0]!;
  const rows = Array.from({ length: 123 }, (_, i) => ({
    manifest: source,
    doc: { ...source.documents[0]!, id: String(i), ctc: String(i + 1).padStart(10, "0") },
  }));
  const props = {
    rows,
    status: "all" as const,
    onStatusChange: vi.fn(),
    scope: "all",
    now: "2026-10-13T14:00:00Z",
  };
  const { rerender } = render(<CtcTracking {...props} />);
  expect(screen.getAllByRole("row")).toHaveLength(51);
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(screen.getByRole("table")).toHaveTextContent("0000000051");
  expect(within(screen.getByRole("table")).queryByText("0000000001")).not.toBeInTheDocument();
  rerender(<CtcTracking {...props} scope="new search" />);
  expect(screen.getByRole("table")).toHaveTextContent("0000000001");
  expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
});

it("exports the tracking status and search without changing conference state", async () => {
  mocks.pdf.mockResolvedValue(undefined);
  render(<ConferenceWorkspace initialState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Rastreamento" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Status do CTC" }), {
    target: { value: "received" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar CTC no rastreamento" }), {
    target: { value: "MARIA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  await vi.waitFor(() =>
    expect(mocks.pdf).toHaveBeenCalledExactlyOnceWith({
      manifests: state.manifests,
      issues: [],
      view: "tracking",
      query: "MARIA",
      filter: "all",
      trackingStatus: "received",
    }),
  );
});

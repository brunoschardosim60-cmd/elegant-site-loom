import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import type { ConferenceState } from "@/lib/conference-state";
import { conferenceSheet, exportFilename } from "@/lib/conference-export";

const mocks = vi.hoisted(() => ({ download: vi.fn(), sound: vi.fn() }));
vi.mock("@/lib/xlsx-writer", () => ({ downloadXlsx: mocks.download }));
vi.mock("@/lib/scan-sound", () => ({
  playScanSound: mocks.sound,
  scanSoundEnabled: () => true,
  setScanSoundEnabled: vi.fn(),
}));

const manifest = (
  id: string,
  driver: string,
  docs: ConferenceState["manifests"][number]["documents"],
) => ({
  id,
  driver,
  plate: "ABC1D23",
  date: "2026-10-20T12:00:00.000Z",
  issueDate: "2026-10-20",
  checker: "SADI",
  documents: docs,
});
const state: ConferenceState = {
  manifests: [
    manifest("26180001", "ANA", [
      {
        id: "a1",
        ctc: "0000000001",
        nf: "1-1",
        volumes: 2,
        received: false,
        city: "CANOAS",
        nature: "PERECIVEL-CONVENCIONAL 48",
        cargoValueCents: 1234567,
        weightGrams: 1500,
      },
      {
        id: "a2",
        ctc: "0000000002",
        nf: "2-1",
        volumes: 1,
        received: false,
        city: "GRAVATAI",
        nature: "MAT.LAB",
      },
    ]),
  ],
  activity: [],
  issues: [],
};
beforeEach(() => {
  mocks.download.mockReset();
  mocks.sound.mockReset();
});
afterEach(cleanup);

it("plays a distinct sound for a received, a repeated and an unknown CTC", () => {
  render(<ConferenceWorkspace initialState={state} />);
  const scan = (value: string) => {
    const input = screen.getByRole("textbox", { name: "Código do CTC" });
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);
  };
  scan("0000000001");
  scan("0000000001");
  scan("0000000099");
  expect(mocks.sound.mock.calls.map(([kind]) => kind)).toEqual(["ok", "warning", "error"]);
});

it("filters Pendências by delivery city and marks perishable CTCs", () => {
  render(<ConferenceWorkspace initialState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  const table = () => screen.getByRole("table", { name: "CTCs pendentes" });
  expect(within(table()).getAllByRole("row")).toHaveLength(3);
  expect(within(table()).getByText("Perecível")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filtrar por cidade de entrega"), {
    target: { value: "GRAVATAI" },
  });
  expect(within(table()).getAllByRole("row")).toHaveLength(2);
  expect(within(table()).getByText("0000000002")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
  expect(within(table()).getAllByRole("row")).toHaveLength(3);
});

it("exports the rows shown in Pendências, with the active filter, to Excel", async () => {
  render(<ConferenceWorkspace initialState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  fireEvent.change(screen.getByLabelText("Filtrar por cidade de entrega"), {
    target: { value: "CANOAS" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Excel" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
  const [filename, sheets] = mocks.download.mock.calls[0]!;
  expect(filename).toMatch(/^confere-pendencias-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(sheets[0].rows).toHaveLength(1);
  expect(sheets[0].rows[0][6]).toBe("0000000001");
});

it("builds spreadsheet rows with text CTCs, numeric values and the situation", () => {
  const rows = state.manifests[0]!.documents.map((doc) => ({ manifest: state.manifests[0]!, doc }));
  const sheet = conferenceSheet("Pendências", rows, "2026-10-30T15:00:00.000Z");
  const columns = Object.fromEntries(sheet.header.map((title, i) => [title, sheet.rows[0]![i]]));
  expect(columns).toMatchObject({
    "Manifesto / pré": "26180001",
    Conferente: "SADI",
    Emissão: "20/10/2026",
    "Dias desde a emissão": 10,
    CTC: "0000000001",
    "Valor da mercadoria (R$)": 12345.67,
    "Peso (kg)": 1.5,
    Situação: "Pendente",
  });
  expect(exportFilename("rastreamento", new Date("2026-10-31T02:00:00Z"))).toBe(
    "confere-rastreamento-2026-10-30.xlsx",
  );
});

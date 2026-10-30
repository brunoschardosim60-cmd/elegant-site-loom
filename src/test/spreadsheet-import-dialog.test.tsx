import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpreadsheetImportDialog } from "@/components/spreadsheet-import-dialog";
import type { ImportDraft } from "@/lib/manifest-import";
import type { LuftExport } from "@/lib/luft-spreadsheet";
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/read-luft-spreadsheet", () => ({ readLuftSpreadsheet: mock.read }));
const data = (): LuftExport => ({
  ignored: 3004,
  repeated: 0,
  selectedRows: 2,
  errors: [],
  drafts: [
    {
      id: "06052233",
      driver: "ANA",
      plate: "ABC1D23",
      issueDate: "2026-10-14",
      expectedRows: 1,
      totalVolumes: 2,
      rows: [{ ctc: "0000000001", nf: "123-1", volumes: "2", client: "LAB", recipient: "CLIENTE" }],
    },
    {
      id: "06052234",
      driver: "BRUNO",
      plate: "DEF2G34",
      issueDate: "2026-10-14",
      expectedRows: 1,
      totalVolumes: 3,
      rows: [{ ctc: "0000000002", nf: "456-1", volumes: "3", client: "LAB", recipient: "CLIENTE" }],
    },
  ],
});
beforeEach(() => {
  mock.read.mockReset().mockResolvedValue(data());
});
afterEach(cleanup);
it("reveals a new import error once without pulling the screen on team updates", async () => {
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  try {
    mock.read.mockRejectedValueOnce(new Error("Arquivo inválido para importação"));
    const props = { onClose: vi.fn(), onCreate: vi.fn() };
    const mounted = render(<SpreadsheetImportDialog {...props} manifests={[]} />);
    upload();
    expect(await screen.findByRole("alert")).toHaveTextContent("Arquivo inválido");
    // The scroll runs in a passive effect, which React may flush after the alert paints.
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    mounted.rerender(<SpreadsheetImportDialog {...props} manifests={[]} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(props.onCreate).not.toHaveBeenCalled();
  } finally {
    if (previous) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", previous);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
it("offers identical teammate manifests explicitly without preselecting or duplicating them", async () => {
  const draft = data().drafts[0]!;
  const save = vi.fn().mockReturnValue({ ok: true, manifests: [] });
  render(
    <SpreadsheetImportDialog
      manifests={[
        {
          id: draft.id,
          driver: draft.driver,
          plate: draft.plate,
          date: "2026-10-14",
          issueDate: draft.issueDate,
          createdBy: "00000000-0000-4000-8000-000000000001",
          createdByEmail: "first@example.invalid",
          documents: [{ id: "d1", ctc: "0000000001", nf: "123-1", volumes: 2, received: true }],
        },
      ]}
      demandOwner={{
        email: "second@example.invalid",
        userId: "00000000-0000-4000-8000-000000000002",
      }}
      sharedDemands
      onClose={vi.fn()}
      onCreate={save}
    />,
  );
  upload();
  await screen.findByText("Adicionar às minhas demandas");
  expect(
    screen.getByRole("checkbox", { name: `Selecionar manifesto ${draft.id}` }),
  ).not.toBeChecked();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Selecionar existentes da equipe" }));
  fireEvent.click(screen.getByRole("button", { name: "Adicionar 1 às minhas demandas" }));
  expect(save).toHaveBeenCalledWith([draft]);
});
it.each(["during-read", "after-preview"])(
  "does not auto-link a manifest saved by another login %s",
  async (timing) => {
    const parsed = data();
    parsed.drafts = parsed.drafts.slice(0, 1);
    const draft = parsed.drafts[0]!;
    let complete!: (result: LuftExport) => void;
    mock.read.mockImplementationOnce(
      () =>
        new Promise<LuftExport>((resolve) => {
          complete = resolve;
        }),
    );
    const props = {
      onClose: vi.fn(),
      onCreate: vi.fn().mockReturnValue({ ok: true, manifests: [] }),
      sharedDemands: true,
      demandOwner: { email: "second@example.invalid", userId: "second" },
    };
    const existing = {
      id: draft.id,
      driver: draft.driver,
      plate: draft.plate,
      date: "2026-10-14",
      issueDate: draft.issueDate,
      createdBy: "first",
      createdByEmail: "first@example.invalid",
      documents: [{ id: "d1", ctc: "0000000001", nf: "123-1", volumes: 2, received: false }],
    };
    const mounted = render(<SpreadsheetImportDialog {...props} manifests={[]} />);
    upload();
    await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
    if (timing === "after-preview") {
      await act(async () => complete(parsed));
      expect(
        screen.getByRole("checkbox", { name: `Selecionar manifesto ${draft.id}` }),
      ).toBeChecked();
      // Choosing a new record is not consent to link a later teammate import.
      fireEvent.click(screen.getByRole("checkbox", { name: `Selecionar manifesto ${draft.id}` }));
      fireEvent.click(screen.getByRole("checkbox", { name: `Selecionar manifesto ${draft.id}` }));
    }
    mounted.rerender(<SpreadsheetImportDialog {...props} manifests={[existing]} />);
    if (timing === "during-read") await act(async () => complete(parsed));
    expect(await screen.findByText("Adicionar às minhas demandas")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: `Selecionar manifesto ${draft.id}` }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Cadastrar manifestos" })).toBeDisabled();
    expect(props.onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: `Selecionar manifesto ${draft.id}` }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar 1 às minhas demandas" }));
    expect(props.onCreate).toHaveBeenCalledWith([draft]);
  },
);
it("explains ignored older and undated occurrences without offering an unsafe refresh", async () => {
  const source = data();
  source.drafts[0]!.rows[0]!.occurrenceCode = "91";
  source.drafts[0]!.rows[0]!.occurrenceDate = "2026-10-14";
  source.drafts[1]!.rows[0]!.occurrenceCode = "91";
  mock.read.mockResolvedValueOnce(source);
  const save = vi.fn(),
    refresh = vi.fn();
  render(
    <SpreadsheetImportDialog
      manifests={source.drafts.map((draft) => ({
        id: draft.id,
        driver: draft.driver,
        plate: draft.plate,
        date: "2026-10-14",
        documents: [
          {
            id: draft.id,
            ctc: draft.rows[0]!.ctc,
            nf: draft.rows[0]!.nf,
            volumes: 2,
            received: true,
            nfOccurrences: [
              {
                nf: draft.rows[0]!.nf,
                code: "01",
                description: "ENTREGUE",
                occurredOn: "2026-10-15",
              },
            ],
          },
        ],
      }))}
      onClose={vi.fn()}
      onCreate={save}
      onUpdateOccurrences={refresh}
    />,
  );
  upload();
  expect(
    await screen.findByText(/1 ocorrência\(s\) antiga\(s\) ignorada\(s\)/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/1 ocorrência\(s\) diferente\(s\) sem referência suficiente/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Atualizar ocorrências das NFs cadastradas" }),
  ).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("previews NF occurrence codes and explicitly refreshes existing NFs without registering duplicates", async () => {
  const source = data();
  source.drafts[0]!.rows[0]!.occurrenceCode = "01";
  source.drafts[0]!.rows[0]!.occurrenceDescription = "ENTREGA REALIZADA NORMALMENTE";
  mock.read.mockResolvedValueOnce(source);
  const save = vi.fn(),
    refresh = vi.fn(() => ({ ok: true as const, manifests: [] }));
  render(
    <SpreadsheetImportDialog
      manifests={[
        {
          id: "06052233",
          driver: "ANA",
          plate: "ABC1D23",
          date: "2026-10-14",
          documents: [{ id: "saved", ctc: "0000000001", nf: "123-1", volumes: 2, received: true }],
        },
      ]}
      onClose={vi.fn()}
      onCreate={save}
      onUpdateOccurrences={refresh}
    />,
  );
  upload();
  const update = await screen.findByRole("button", {
    name: "Atualizar ocorrências das NFs cadastradas",
  });
  expect(screen.getByText(/ENTREGA REALIZADA NORMALMENTE/)).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Selecionar manifesto 06052233")).toBeDisabled();
  fireEvent.click(update);
  expect(refresh).toHaveBeenCalledExactlyOnceWith(source.drafts);
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Selecionar manifesto 06052234")).toBeChecked();
});
it("lets the user remove a newly registered team duplicate while preserving the other selected manifests", async () => {
  const save = vi.fn(() => ({ ok: true as const, manifests: [] }));
  const view = render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  await screen.findByLabelText("Selecionar manifesto 06052233");
  view.rerender(
    <SpreadsheetImportDialog
      manifests={[
        {
          id: "06052233",
          driver: "ANA",
          plate: "ABC1D23",
          date: "2026-10-15",
          documents: [{ id: "saved", ctc: "0000000001", nf: "123-1", volumes: 2, received: true }],
        },
      ]}
      onClose={vi.fn()}
      onCreate={save}
    />,
  );
  expect(screen.getByRole("button", { name: "Cadastrar 2 manifestos" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Remover repetidos da seleção" }));
  expect(screen.getByLabelText("Selecionar manifesto 06052233")).not.toBeChecked();
  expect(screen.getByLabelText("Selecionar manifesto 06052234")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar 1 manifestos" }));
  expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "06052234" })]);
});
const upload = () =>
  fireEvent.change(screen.getByLabelText("Enviar planilha 108"), {
    target: { files: [new File(["xlsx"], "108.xlsx")] },
  });
const droppedFile = () => new File(["xlsx"], "108.xlsx");
it("clears spreadsheet search and day without changing the selected manifests", async () => {
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  await screen.findByLabelText("Selecionar manifesto 06052233");
  fireEvent.click(screen.getByLabelText("Selecionar manifesto 06052233"));
  fireEvent.change(screen.getByLabelText("Buscar motorista, placa ou manifesto na planilha"), {
    target: { value: "nada" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
  expect(screen.getByLabelText("Selecionar manifesto 06052233")).not.toBeChecked();
  expect(screen.getByLabelText("Selecionar manifesto 06052234")).toBeChecked();
  expect(save).not.toHaveBeenCalled();
});
const dropZone = () => screen.getByLabelText("Enviar planilha 108").closest("label")!;
it("highlights a dragged file, keeps the highlight across children and reads a drop exactly once without registering", async () => {
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  const file = droppedFile(),
    transfer = { types: ["Files"], files: [file], dropEffect: "" };
  fireEvent.dragEnter(dropZone(), { dataTransfer: transfer });
  fireEvent.dragEnter(screen.getByText("Solte a planilha aqui"), { dataTransfer: transfer });
  fireEvent.dragLeave(screen.getByText("Solte a planilha aqui"), { dataTransfer: transfer });
  expect(dropZone()).toHaveAttribute("data-dragging", "true");
  fireEvent.drop(dropZone(), { dataTransfer: transfer });
  await screen.findByLabelText("Selecionar manifesto 06052233");
  expect(mock.read).toHaveBeenCalledExactlyOnceWith(file, expect.any(AbortSignal));
  expect(dropZone()).not.toHaveAttribute("data-dragging");
  expect(save).not.toHaveBeenCalled();
});
it("rejects several dropped files and ignores drops during an active read", async () => {
  mock.read.mockImplementation(() => new Promise(() => {}));
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={vi.fn()} />);
  fireEvent.drop(dropZone(), {
    dataTransfer: { types: ["Files"], files: [droppedFile(), droppedFile()] },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("apenas uma planilha");
  expect(mock.read).not.toHaveBeenCalled();
  fireEvent.drop(dropZone(), { dataTransfer: { types: ["Files"], files: [droppedFile()] } });
  await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
  const signal = mock.read.mock.calls[0]![1] as AbortSignal;
  fireEvent.drop(dropZone(), { dataTransfer: { types: ["Files"], files: [droppedFile()] } });
  expect(mock.read).toHaveBeenCalledOnce();
  expect(signal.aborted).toBe(false);
});
it("announces a rejected file from the reader and does not register it", async () => {
  mock.read.mockRejectedValueOnce(new Error("Envie o relatório 108 em XLSX, com até 200 MB."));
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  fireEvent.drop(dropZone(), {
    dataTransfer: { types: ["Files"], files: [new File(["pdf"], "documento.pdf")] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("XLSX, com até 200 MB");
  expect(save).not.toHaveBeenCalled();
});
it("previews all eligible manifests, filters by driver and requires explicit registration", async () => {
  const save = vi.fn(() => ({ ok: true as const, manifests: [] }));
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  await screen.findByLabelText("Selecionar manifesto 06052233");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Buscar motorista, placa ou manifesto na planilha"), {
    target: { value: "BRUNO" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Selecionar resultados" }));
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar 1 manifestos" }));
  expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: "06052234" })]);
});
it("blocks registered CTCs and invalid source rows without mutating saved data", async () => {
  const result = data();
  result.errors = ["Linha 4: confira NF e série."];
  mock.read.mockResolvedValueOnce(result);
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  expect(await screen.findByText("Linha 4: confira NF e série.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cadastrar 2 manifestos" })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});
it("requires a choice for conflicting same-day CTCs, preserves unrelated selection and cannot register both", async () => {
  const result = data();
  result.drafts.push({
    ...result.drafts[0]!,
    id: "06052235",
    issueDate: "2026-10-14",
    rows: result.drafts[0]!.rows.map((row) => ({ ...row })),
  });
  mock.read.mockResolvedValueOnce(result);
  const save = vi.fn(() => ({ ok: true as const, manifests: [] }));
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  await screen.findByText("CTC presente em mais de um manifesto");
  expect(screen.getByLabelText("Selecionar manifesto 06052233")).not.toBeChecked();
  expect(screen.getByLabelText("Selecionar manifesto 06052235")).not.toBeChecked();
  expect(screen.getByLabelText("Selecionar manifesto 06052234")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: /Selecionar 06052235 · 14\/10\/2026/ }));
  expect(screen.getByLabelText("Selecionar manifesto 06052235")).toBeChecked();
  expect(screen.getByRole("button", { name: "Cadastrar 2 manifestos" })).toBeEnabled();
  fireEvent.click(screen.getByLabelText("Selecionar manifesto 06052233"));
  expect(screen.getByRole("button", { name: "Cadastrar 3 manifestos" })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Selecionado 06052233 · 14\/10\/2026/ }));
  expect(screen.getByLabelText("Selecionar manifesto 06052235")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar 2 manifestos" }));
  expect(save).toHaveBeenCalledWith([result.drafts[0], result.drafts[1]]);
});
it("selects both route attempts on different dates even when the driver changes", async () => {
  const result = data();
  result.drafts.push({
    ...result.drafts[0]!,
    id: "06052235",
    issueDate: "2026-10-15",
    driver: "OUTRO MOTORISTA",
    plate: "XYZ1A23",
  });
  mock.read.mockResolvedValueOnce(result);
  const save = vi.fn(() => ({ ok: true as const, manifests: [] }));
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  await screen.findByLabelText("Selecionar manifesto 06052235");
  expect(screen.queryByText("CTC presente em mais de um manifesto")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cadastrar 3 manifestos" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar 3 manifestos" }));
  expect(save).toHaveBeenCalledWith(result.drafts);
});
it("does not let the conflict chooser overwrite a CTC already saved by the team", async () => {
  const result = data();
  result.drafts.push({ ...result.drafts[0]!, id: "06052235" });
  mock.read.mockResolvedValueOnce(result);
  render(
    <SpreadsheetImportDialog
      manifests={[
        {
          id: "06050000",
          driver: "ANTIGO",
          plate: "ABC1D23",
          date: "2026-10-10",
          documents: [{ id: "saved", ctc: "0000000001", nf: "123-1", volumes: 2, received: true }],
        },
      ]}
      onClose={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
  upload();
  await screen.findByText("CTC presente em mais de um manifesto");
  expect(screen.getByRole("button", { name: /Selecionar 06052233 ·/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Selecionar 06052235 ·/ })).toBeDisabled();
});
it("leaves existing CTC conflicts unselected and cannot silently overwrite them", async () => {
  const save = vi.fn();
  render(
    <SpreadsheetImportDialog
      manifests={[
        {
          id: "DI00123456789",
          driver: "ANTIGO",
          plate: "ABC1234",
          date: "now",
          documents: [{ id: "old", ctc: "0000000001", nf: "123-1", volumes: 2, received: true }],
        },
      ]}
      onClose={vi.fn()}
      onCreate={save}
    />,
  );
  upload();
  const repeated = await screen.findByLabelText("Selecionar manifesto 06052233");
  expect(repeated).toBeDisabled();
  expect(repeated).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Cadastrar 1 manifestos" })).toBeEnabled();
  expect(save).not.toHaveBeenCalled();
});
it("aborts immediately on stop and ignores a late parser result", async () => {
  let resolve!: (value: LuftExport) => void;
  mock.read.mockImplementationOnce(
    () =>
      new Promise<LuftExport>((done) => {
        resolve = done;
      }),
  );
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  await waitFor(() => expect(mock.read).toHaveBeenCalled());
  const signal = mock.read.mock.calls[0]![1] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Parar" }));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(data()));
  expect(screen.queryByLabelText("Selecionar manifesto 06052233")).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it("shows original manifesto dates and filters fifty manifests without silently changing selection", async () => {
  const original = data().drafts[0]!;
  const result = {
    ...data(),
    drafts: Array.from({ length: 50 }, (_, i) => ({
      ...original,
      id: String(60000000 + i),
      issueDate: `2026-10-${10 + Math.floor(i / 10)}`,
      rows: original.rows.map((row) => ({ ...row, ctc: String(1000000000 + i) })),
    })),
  };
  mock.read.mockResolvedValueOnce(result);
  const save = vi.fn((_drafts: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload();
  await screen.findByLabelText("Selecionar manifesto 60000000");
  expect(screen.getAllByRole("checkbox")).toHaveLength(50);
  expect(screen.getByText("Manifestado em")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Dia do manifesto"), { target: { value: "2026-10-12" } });
  expect(screen.getAllByRole("checkbox")).toHaveLength(10);
  expect(screen.getByRole("button", { name: "Cadastrar 50 manifestos" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Selecionar resultados" }));
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar 10 manifestos" }));
  expect(save.mock.calls[0]![0]).toHaveLength(10);
  expect(save.mock.calls[0]![0].every((draft) => draft.issueDate === "2026-10-12")).toBe(true);
});

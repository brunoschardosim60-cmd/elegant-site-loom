import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import type { ConferenceState } from "@/lib/conference-state";

const mocks = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock("@/lib/conference-pdf", () => ({ exportConferencePdf: mocks.pdf }));
vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
const initialState = {
  manifests: [
    {
      id: "DI00123456789",
      driver: "MOTORISTA DE TESTE",
      plate: "ABC1D23",
      date: "2026-10-10",
      documents: [{ id: "one", ctc: "0000000001", nf: "123-1", volumes: 3, received: false }],
    },
  ],
  activity: [],
  issues: [],
};
beforeEach(() => {
  mocks.pdf.mockReset();
  mocks.pdf.mockResolvedValue(undefined);
});
afterEach(cleanup);

function submitScan(value: string) {
  const scanner = screen.getByRole("textbox", { name: "Código do CTC" });
  fireEvent.change(scanner, { target: { value } });
  fireEvent.submit(scanner.closest("form")!);
  return scanner;
}

it.each(["spreadsheet", "manual", "edit-cancel", "edit-save", "scan-warning"])(
  "restores scanner focus without pulling the page after closing %s",
  async (flow) => {
    render(<ConferenceWorkspace initialState={initialState} />);
    const scanner = screen.getByRole("textbox", { name: "Código do CTC" });
    if (flow === "spreadsheet")
      fireEvent.click(screen.getByRole("button", { name: "Importar planilha" }));
    else if (flow === "manual") fireEvent.click(screen.getByRole("button", { name: /Novo pré/ }));
    else if (flow.startsWith("edit"))
      fireEvent.click(screen.getByRole("button", { name: "Editar pré DI00123456789" }));
    else submitScan("0000009999");
    await screen.findByRole("dialog");
    const focus = vi.spyOn(scanner, "focus");
    try {
      const name =
        flow === "manual"
          ? "Fechar"
          : flow === "edit-save"
            ? "Salvar alterações"
            : flow === "scan-warning"
              ? /Entendido, continuar/
              : "Cancelar";
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(scanner).toHaveFocus());
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  },
);

it("receives a unique leading-zero CTC once even when two submit events arrive before rendering", () => {
  const onSnapshot = vi.fn<(state: ConferenceState) => void>();
  render(<ConferenceWorkspace initialState={initialState} onSnapshot={onSnapshot} />);
  const scanner = screen.getByRole("textbox", { name: "Código do CTC" });
  fireEvent.change(scanner, { target: { value: "0000000001" } });
  act(() => {
    scanner
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    scanner
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const saved = onSnapshot.mock.lastCall![0];
  expect(saved.manifests[0]?.documents).toMatchObject([{ ctc: "0000000001", received: true }]);
  expect(
    saved.manifests.flatMap((manifest) => manifest.documents).filter((doc) => doc.received),
  ).toHaveLength(1);
  expect(saved.activity.filter((entry) => entry.title === "Pré-manifesto finalizado")).toHaveLength(
    1,
  );
  expect(screen.getByText(/CTC 0000000001 já foi bipado/)).toBeInTheDocument();
  expect(scanner).toHaveValue("");
  expect(scanner).toHaveFocus();

  submitScan("0000000001");
  expect(onSnapshot.mock.lastCall![0].manifests).toEqual(saved.manifests);
  expect(initialState.manifests[0]!.documents[0]!.received).toBe(false);
});

it.each([false, true])(
  "does not receive an ambiguous CTC even if the second pré is finished=%s",
  (finished) => {
    const first = initialState.manifests[0]!;
    const second = {
      ...first,
      id: "DI00987654321",
      driver: "OUTRO MOTORISTA",
      finishedAt: finished ? "2026-10-10T15:00:00Z" : undefined,
      documents: [
        {
          ...first.documents[0]!,
          id: "other",
          received: finished,
          receivedAt: finished ? "2026-10-10T15:00:00Z" : undefined,
        },
      ],
    };
    const onSnapshot = vi.fn<(state: ConferenceState) => void>();
    render(
      <ConferenceWorkspace
        initialState={{ manifests: [first, second], activity: [], issues: [] }}
        onSnapshot={onSnapshot}
      />,
    );
    const scanner = submitScan("0000000001");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "O CTC 0000000001 aparece em mais de um pré.",
    );
    expect(scanner).toBeDisabled();
    expect(onSnapshot.mock.lastCall![0].manifests).toEqual([first, second]);
    expect(onSnapshot.mock.lastCall![0].activity).toMatchObject([
      { title: "CTC com vínculo ambíguo" },
    ]);
  },
);

it("returns focus to an empty scanner after closing the block and accepts the next CTC", async () => {
  const onSnapshot = vi.fn<(state: ConferenceState) => void>();
  render(<ConferenceWorkspace initialState={initialState} onSnapshot={onSnapshot} />);
  const scanner = submitScan("0000009999");
  expect(screen.getByRole("dialog")).toHaveTextContent("0000009999");
  expect(scanner).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Entendido, continuar/ }));
  await waitFor(() => {
    expect(scanner).toBeEnabled();
    expect(scanner).toHaveFocus();
  });
  expect(scanner).toHaveValue("");
  submitScan("0000000001");
  expect(onSnapshot.mock.lastCall![0].manifests[0]?.documents[0]?.received).toBe(true);
});

it.each([
  "0".repeat(20) + "57" + "0".repeat(22),
  "0".repeat(20) + "55" + "0".repeat(22),
  "000000001",
  "000000000A",
])("rejects fiscal keys and invalid identifiers without marking any CTC (%s)", (value) => {
  const onSnapshot = vi.fn<(state: ConferenceState) => void>();
  render(<ConferenceWorkspace initialState={initialState} onSnapshot={onSnapshot} />);
  const scanner = submitScan(value);
  expect(onSnapshot.mock.lastCall![0].manifests).toEqual(initialState.manifests);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByText(
      value.slice(20, 22) === "55"
        ? "Isso é uma NF-e. Bipe somente o CTC."
        : "Código inválido. Confira e bipe o CTC novamente.",
    ),
  ).toBeInTheDocument();
  expect(scanner).toHaveValue("");
});

it("keeps a scanned CTC when another row is marked manually before the next render", () => {
  const first = initialState.manifests[0]!;
  const state = {
    manifests: [
      {
        ...first,
        documents: [
          ...first.documents,
          { id: "two", ctc: "0000000002", nf: "124-1", volumes: 2, received: false },
        ],
      },
    ],
    activity: [],
    issues: [],
  };
  const onSnapshot = vi.fn<(state: ConferenceState) => void>();
  render(<ConferenceWorkspace initialState={state} onSnapshot={onSnapshot} />);
  const scanner = screen.getByRole("textbox", { name: "Código do CTC" });
  const other = screen.getByRole("button", { name: "Marcar CTC 0000000002 como recebido" });
  fireEvent.change(scanner, { target: { value: "0000000001" } });
  act(() => {
    scanner
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    other.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    other.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onSnapshot.mock.lastCall![0].manifests[0]?.documents).toMatchObject([
    { ctc: "0000000001", received: true },
    { ctc: "0000000002", received: true },
  ]);
  expect(onSnapshot.mock.lastCall![0].manifests[0]?.finishedAt).toBeTruthy();
  expect(
    onSnapshot.mock.lastCall![0].activity.filter(
      (entry) => entry.title === "Documento conferido manualmente",
    ),
  ).toHaveLength(1);
});

it("removes CSV and manual divergence actions while keeping automatic operational occurrences", async () => {
  render(<ConferenceWorkspace initialState={initialState} />);
  expect(screen.queryByRole("button", { name: /CSV/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Divergência/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
  const scanner = screen.getByRole("textbox", { name: "Código do CTC" });
  fireEvent.change(scanner, { target: { value: "0000009999" } });
  fireEvent.submit(scanner.closest("form")!);
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "O CTC 0000009999 não está em nenhum pré-manifesto cadastrado.",
  );
  fireEvent.click(screen.getByRole("button", { name: /Entendido, continuar/ }));
  fireEvent.click(screen.getByRole("button", { name: /Ocorrências/ }));
  expect(screen.getByRole("heading", { name: "CTC sem pré-manifesto" })).toBeInTheDocument();
});

it("passes the active view, search and ordering filter to the PDF report", async () => {
  render(<ConferenceWorkspace initialState={initialState} />);
  fireEvent.click(screen.getByRole("button", { name: /Pendências/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar pré-manifesto" }), {
    target: { value: "123-1" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Filtrar pré-manifestos" }), {
    target: { value: "old" },
  });
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  await waitFor(() =>
    expect(mocks.pdf).toHaveBeenCalledExactlyOnceWith({
      manifests: initialState.manifests,
      issues: [],
      view: "missing",
      query: "123-1",
      filter: "old",
    }),
  );
  expect(await screen.findByRole("button", { name: "PDF" })).toBeEnabled();
});

it("shows a clear error and re-enables PDF export if report generation fails", async () => {
  mocks.pdf.mockRejectedValue(new Error("synthetic PDF failure"));
  render(<ConferenceWorkspace initialState={initialState} />);
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  expect(
    await screen.findByText("Não foi possível gerar o PDF. Tente novamente."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled();
});

it("saves an explicitly edited issue date through the existing snapshot and retains conference data", async () => {
  const onSnapshot = vi.fn();
  render(<ConferenceWorkspace initialState={initialState} onSnapshot={onSnapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "Editar data do pré DI00123456789" }));
  expect(screen.getByLabelText("Data de emissão do pré DI00123456789")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Data de emissão do pré DI00123456789"), {
    target: { value: "2026-08-27" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar data" }));
  await waitFor(() =>
    expect(onSnapshot.mock.lastCall?.[0].manifests[0]).toMatchObject({
      ...initialState.manifests[0],
      issueDate: "2026-08-27",
    }),
  );
  expect(initialState.manifests[0]).not.toHaveProperty("issueDate");
  expect(screen.getByText(/Emissão 27\/08\/2026/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Pendências/ }));
  expect(screen.getByText("Emissão 27/08/2026")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Marcar CTC 0000000001 como recebido" }),
  ).toBeInTheDocument();
});

it("finds accented names with pasted whitespace in conference, pending and tracking views", () => {
  const manifest = { ...initialState.manifests[0]!, driver: "JOÃO  DA SILVA" };
  render(<ConferenceWorkspace initialState={{ ...initialState, manifests: [manifest] }} />);
  for (const view of ["Conferência", "Pendências", "Rastreamento"]) {
    fireEvent.click(screen.getByRole("button", { name: view }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: view === "Rastreamento" ? "Buscar CTC no rastreamento" : "Buscar pré-manifesto",
      }),
      { target: { value: "  joao   da silva  " } },
    );
    expect(screen.getByRole("table")).toHaveTextContent("0000000001");
  }
});

it("locates a scanned pré even when the age filter would hide it", () => {
  const manifest = { ...initialState.manifests[0]!, issueDate: "2099-01-01" };
  render(<ConferenceWorkspace initialState={{ ...initialState, manifests: [manifest] }} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Filtrar pré-manifestos" }), {
    target: { value: "old" },
  });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Nenhum resultado para essa busca ou filtro.")).toBeInTheDocument();
  submitScan(manifest.id);
  expect(screen.getByRole("combobox", { name: "Filtrar pré-manifestos" })).toHaveValue("all");
  expect(screen.getByRole("table")).toHaveTextContent("0000000001");
});

it("shows actual activity dates in Brasília and labels legacy timestamps without guessing their day", () => {
  const activity = [
    {
      id: 1,
      title: "Documento conferido",
      description: "MOTORISTA",
      time: "01:05",
      at: "2026-10-13T01:05:00Z",
    },
    { id: 2, title: "Ocorrência antiga", description: "CTC", time: "10:15" },
  ];
  render(<ConferenceWorkspace initialState={{ ...initialState, activity, issues: activity }} />);
  expect(screen.getByText("12/10/2026, 22:05")).toBeInTheDocument();
  expect(screen.getByText("10:15 · data não registrada")).toBeInTheDocument();
  expect(screen.queryByText("Hoje", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Resumo dos cadastros" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ocorrências" }));
  expect(screen.getAllByText("12/10/2026, 22:05")).toHaveLength(2);
});

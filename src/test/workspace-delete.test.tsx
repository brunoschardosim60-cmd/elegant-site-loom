import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import type { ConferenceState } from "@/lib/conference-state";
import { applyImports, findImportConflicts, type ImportDraft } from "@/lib/manifest-import";

vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
afterEach(cleanup);

function fixture(): ConferenceState {
  return {
    manifests: [
      {
        id: "DI00123456789",
        driver: "ANA SILVA",
        plate: "ABC1D23",
        date: "2026-10-10",
        sourcePhotoHashes: ["a".repeat(64)],
        documents: [
          {
            id: "a-one",
            ctc: "0000000001",
            nf: "101-1",
            client: "Laboratório A",
            volumes: 2,
            received: false,
          },
          {
            id: "a-two",
            ctc: "0000000002",
            nf: "102-1",
            client: "Laboratório A",
            volumes: 5,
            received: false,
          },
        ],
      },
      {
        id: "DI00123456790",
        driver: "BRUNO SOUZA",
        plate: "DEF2G34",
        date: "2026-10-11",
        sourcePhotoHashes: ["b".repeat(64)],
        documents: [
          {
            id: "b-one",
            ctc: "0000000003",
            nf: "103-1",
            client: "Laboratório B",
            volumes: 3,
            received: false,
          },
          {
            id: "b-two",
            ctc: "0000000004",
            nf: "104-1",
            client: "Laboratório B",
            volumes: 4,
            received: false,
          },
        ],
      },
      {
        id: "DI00123456791",
        driver: "CARLA LIMA",
        plate: "GHI3J45",
        date: "2026-10-09",
        sourcePhotoHashes: ["c".repeat(64)],
        finishedAt: "2026-10-10T12:00:00Z",
        documents: [
          {
            id: "c-one",
            ctc: "0000000005",
            nf: "105-1",
            volumes: 9,
            received: true,
            receivedAt: "2026-10-10T12:00:00Z",
          },
        ],
      },
    ],
    activity: [
      { id: 1, title: "Atividade anterior", description: "Manter histórico", time: "09:00" },
    ],
    issues: [
      {
        id: 2,
        title: "Ocorrência anterior",
        description: "Manter ocorrência",
        time: "09:01",
        warning: true,
      },
    ],
  };
}
function setup(state = fixture()) {
  const onSnapshot = vi.fn<(snapshot: ConferenceState) => void>();
  render(<ConferenceWorkspace initialState={state} onSnapshot={onSnapshot} />);
  return { state, onSnapshot, scanner: screen.getByRole("textbox", { name: "Código do CTC" }) };
}
function scan(value: string, scanner = screen.getByRole("textbox", { name: "Código do CTC" })) {
  fireEvent.change(scanner, { target: { value } });
  fireEvent.submit(scanner.closest("form")!);
}
function openDelete(id = "DI00123456789") {
  fireEvent.click(screen.getByRole("button", { name: `Excluir pré ${id}` }));
  return screen.getByRole("alertdialog", { name: "Excluir pré-manifesto?" });
}
function confirmDelete() {
  fireEvent.click(screen.getByRole("button", { name: "Excluir pré-manifesto" }));
}
function expectMetric(label: string, value: string) {
  const metric = screen.getByText(label, { selector: ".metric-label" }).closest(".metric")!;
  expect(
    within(metric as HTMLElement).getByText(value, { selector: ".metric-value" }),
  ).toBeInTheDocument();
}

it.each(["confirm", "cancel"])(
  "restores scanner focus without scrolling after deletion dialog %s",
  async (action) => {
    const { scanner } = setup();
    openDelete();
    const focus = vi.spyOn(scanner, "focus");
    if (action === "confirm") confirmDelete();
    else fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(scanner).toHaveFocus());
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    focus.mockRestore();
  },
);

it.each(["Cancelar", "Escape"])(
  "opens the complete warning and dismisses it with %s without changing any saved data",
  async (action) => {
    const { state, onSnapshot, scanner } = setup();
    const snapshotsBefore = onSnapshot.mock.calls.length;
    const dialog = openDelete();
    expect(dialog).toHaveTextContent("DI00123456789");
    expect(dialog).toHaveTextContent("ANA SILVA");
    expect(dialog).toHaveTextContent("ABC1D23");
    expect(
      within(dialog).getByText("CTCs", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent(/^2$/);
    expect(
      within(dialog).getByText("Volumes", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent(/^7$/);
    expect(scanner).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    if (action === "Cancelar")
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    else fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => {
      expect(scanner).toBeEnabled();
      expect(scanner).toHaveFocus();
    });
    expect(onSnapshot).toHaveBeenCalledTimes(snapshotsBefore);
    expect(onSnapshot.mock.lastCall![0]).toEqual(state);
  },
);

it("deletes only the selected open pré, preserving all other records and updating document/volume metrics", async () => {
  const { state, onSnapshot, scanner } = setup();
  openDelete();
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  const saved = onSnapshot.mock.lastCall![0];
  expect(saved.manifests).toEqual(state.manifests.slice(1));
  expect(saved.manifests.flatMap((manifest) => manifest.sourcePhotoHashes ?? [])).toEqual([
    "b".repeat(64),
    "c".repeat(64),
  ]);
  expect(saved.issues).toEqual(state.issues);
  expect(saved.activity.filter((entry) => entry.title === "Pré-manifesto excluído")).toHaveLength(
    1,
  );
  expect(saved.activity).toEqual(expect.arrayContaining(state.activity));
  expectMetric("Manifestos em aberto", "01");
  expectMetric("Documentos pendentes", "02");
  expectMetric("Documentos conferidos", "01");
  expectMetric("Manifestos finalizados", "01");
  expect(screen.getByText("7 volumes a conferir")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: `Excluir pré ${state.manifests[0]!.id}` }),
  ).not.toBeInTheDocument();
  expect(state.manifests).toHaveLength(3);
  expect(state.manifests[0]!.documents).toHaveLength(2);
  await waitFor(() => expect(scanner).toHaveFocus());
});

it("also deletes a completed pré without changing any open conference", async () => {
  const { state, onSnapshot } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Finalizados" }));
  const dialog = openDelete("DI00123456791");
  expect(dialog).toHaveTextContent("CARLA LIMA");
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  const saved = onSnapshot.mock.lastCall![0];
  expect(saved.manifests).toEqual(state.manifests.slice(0, 2));
  expectMetric("Manifestos em aberto", "02");
  expectMetric("Documentos pendentes", "04");
  expectMetric("Documentos conferidos", "00");
  expectMetric("Manifestos finalizados", "00");
  expect(screen.getByRole("heading", { name: "Nenhum pré finalizado" })).toBeInTheDocument();
  expect(saved.issues).toEqual(state.issues);
});

it("blocks even a programmatic scan while confirmation is open and accepts it after cancellation", async () => {
  const { state, onSnapshot, scanner } = setup();
  const snapshotsBefore = onSnapshot.mock.calls.length;
  const dialog = openDelete();
  expect(scanner).toBeDisabled();
  scan("0000000003", scanner);
  expect(onSnapshot).toHaveBeenCalledTimes(snapshotsBefore);
  expect(onSnapshot.mock.lastCall![0]).toEqual(state);
  expect(screen.getByRole("alertdialog")).toBe(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(scanner).toBeEnabled());
  scan("0000000003", scanner);
  expect(onSnapshot.mock.lastCall![0].manifests[1]!.documents[0]!.received).toBe(true);
  expect(onSnapshot.mock.lastCall![0].manifests[0]).toEqual(state.manifests[0]);
});

it("makes duplicate confirmation clicks idempotent", async () => {
  const { state, onSnapshot } = setup();
  openDelete();
  const confirm = screen.getByRole("button", { name: "Excluir pré-manifesto" });
  act(() => {
    confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  const saved = onSnapshot.mock.lastCall![0];
  expect(saved.manifests).toEqual(state.manifests.slice(1));
  expect(saved.activity.filter((entry) => entry.title === "Pré-manifesto excluído")).toHaveLength(
    1,
  );
  expect(saved.issues).toEqual(state.issues);
});

it("releases the deleted CTCs and photo hash for reimport, and the old CTC is no longer found by the scanner", async () => {
  const { state, onSnapshot, scanner } = setup();
  const removed = state.manifests[0]!;
  const draft: ImportDraft = {
    id: removed.id,
    driver: removed.driver,
    plate: removed.plate,
    sourcePhotoHash: removed.sourcePhotoHashes![0]!,
    rows: removed.documents.map((document) => ({
      ctc: document.ctc,
      nf: document.nf,
      volumes: String(document.volumes),
    })),
  };
  expect(findImportConflicts(state.manifests, [draft]).length).toBeGreaterThan(0);
  openDelete(removed.id);
  confirmDelete();
  await waitFor(() => expect(scanner).toBeEnabled());
  const saved = onSnapshot.mock.lastCall![0];
  expect(findImportConflicts(saved.manifests, [draft])).toEqual([]);
  const reimported = applyImports(saved.manifests, [draft], "2026-10-12T12:00:00Z");
  expect(reimported.ok).toBe(true);
  if (!reimported.ok) throw new Error("Expected deleted pré to be available for reimport");
  expect(reimported.manifests.at(-1)).toMatchObject({
    id: removed.id,
    sourcePhotoHashes: removed.sourcePhotoHashes,
    documents: removed.documents.map((document) => ({ ctc: document.ctc })),
  });
  scan("0000000001", scanner);
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "O CTC 0000000001 não está em nenhum pré-manifesto cadastrado.",
  );
  expect(onSnapshot.mock.lastCall![0].manifests).toEqual(saved.manifests);
});

it("clears an exact pré search after deletion so other open prés remain available", async () => {
  const { scanner } = setup();
  scan("DI00123456789", scanner);
  expect(screen.getByRole("textbox", { name: "Buscar pré-manifesto" })).toHaveValue(
    "DI00123456789",
  );
  openDelete();
  confirmDelete();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Buscar pré-manifesto" })).toHaveValue(""),
  );
  expect(screen.getByRole("button", { name: "Excluir pré DI00123456790" })).toBeInTheDocument();
});

it("preserves a general search when deleting one matching pré", async () => {
  setup();
  const search = screen.getByRole("textbox", { name: "Buscar pré-manifesto" });
  fireEvent.change(search, { target: { value: "Laboratório" } });
  openDelete();
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(search).toHaveValue("Laboratório");
  expect(screen.getByRole("button", { name: "Excluir pré DI00123456790" })).toBeInTheDocument();
});

it("keeps a fast scan on another pré when that scan and opening deletion happen before rendering", async () => {
  const { state, onSnapshot, scanner } = setup();
  const deleteButton = screen.getByRole("button", { name: "Excluir pré DI00123456789" });
  fireEvent.change(scanner, { target: { value: "0000000003" } });
  act(() => {
    scanner
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  const saved = onSnapshot.mock.lastCall![0];
  expect(saved.manifests.map((manifest) => manifest.id)).toEqual(
    state.manifests.slice(1).map((manifest) => manifest.id),
  );
  expect(saved.manifests[0]!.documents[0]!.received).toBe(true);
  expect(saved.manifests[0]!.documents[1]!.received).toBe(false);
  expect(saved.activity.some((entry) => entry.title === "CTC 0000000003 conferido")).toBe(true);
  expect(saved.activity.some((entry) => entry.title === "Pré-manifesto excluído")).toBe(true);
});

it("emits an empty registered manifest list when the final pré is deleted", async () => {
  const state = fixture();
  state.manifests = [state.manifests[0]!];
  const { onSnapshot } = setup(state);
  openDelete();
  confirmDelete();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  const saved = onSnapshot.mock.lastCall![0];
  expect(saved.manifests).toEqual([]);
  expect(saved.issues).toEqual(state.issues);
  expect(saved.activity.filter((entry) => entry.title === "Pré-manifesto excluído")).toHaveLength(
    1,
  );
  expect(screen.getByRole("heading", { name: "Nenhum pré pendente" })).toBeInTheDocument();
  expectMetric("Manifestos em aberto", "00");
  expectMetric("Documentos pendentes", "00");
});

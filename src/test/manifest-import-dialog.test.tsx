import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManifestImportDialog } from "@/components/manifest-import-dialog";
import type { ImportDraft } from "@/lib/manifest-import";
import type { Manifest } from "@/lib/conference";
type ReadPhotos = typeof import("@/lib/photo-ocr").readPrePhotos;
type PhotoReadResult = Parameters<Parameters<ReadPhotos>[1]>[1];
import { LOCAL_HEADER_NOTICE, LOCAL_ROW_NOTICE } from "@/lib/local-photo";

const mocks = vi.hoisted(() => ({ read: vi.fn(), unique: vi.fn(), fingerprint: vi.fn() }));
vi.mock("@/lib/photo-ocr", () => ({ readPrePhotos: mocks.read }));
vi.mock("@/lib/photo-files", () => ({
  uniquePhotoFiles: mocks.unique,
  photoFingerprint: mocks.fingerprint,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  mocks.read.mockReset();
  mocks.unique.mockReset().mockImplementation(async (files: File[]) => ({ files, duplicates: 0 }));
  mocks.fingerprint.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = vi.fn(() => "blob:photo");
      static override revokeObjectURL = vi.fn();
    },
  );
});
const result = (id: string, ctc: string, nf: string) => ({
  pre: {
    id,
    issueDate: "2026-08-28",
    plate: "ABC1D23",
    driver: "MOTORISTA",
    kind: "pre" as const,
    readingSource: "local" as const,
    ctcs: [ctc],
    documents: [{ ctc, nf, volumes: "2", client: "LAB", recipient: "CLIENTE" }],
    expectedRows: 1,
    totalVolumes: 2,
    verification: { status: "matched" as const, checkedFields: 6, conflicts: 0 },
  },
  text: "Documento",
  milliseconds: 3200,
});

it("selects a new scanned pre while retaining an edited manual draft", async () => {
  const props = { open: true, onOpenChange: vi.fn(), manifests: [], onCreate: vi.fn() };
  const view = render(<ManifestImportDialog {...props} initialId="DI00000000001" />);
  expect(await screen.findByLabelText("Número do pré")).toHaveValue("DI00000000001");
  fireEvent.change(screen.getByLabelText("Motorista"), {
    target: { value: "RASCUNHO PRESERVADO" },
  });
  view.rerender(<ManifestImportDialog {...props} initialId="DI00000000002" />);
  await waitFor(() => expect(screen.getByLabelText("Número do pré")).toHaveValue("DI00000000002"));
  expect(screen.getByLabelText("Motorista")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Revisar arquivo 1: DI00000000001" }));
  expect(screen.getByLabelText("Motorista")).toHaveValue("RASCUNHO PRESERVADO");
  expect(props.onCreate).not.toHaveBeenCalled();
});

it("blocks registering a mismatched total until explicitly reviewed, and resets review on edit", async () => {
  const create = vi.fn(() => ({ ok: true as const, manifests: [] }));
  const reading = result("DI00000000001", "0000000001", "100-1");
  reading.pre.totalVolumes = 98;
  mocks.read.mockImplementation(
    async (_files: File[], receive: (index: number, value: PhotoReadResult) => void) =>
      receive(0, reading),
  );
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "mismatch.jpg", { type: "image/jpeg" })] },
  });
  expect(await screen.findByText("Cabeçalho: 98 volumes · cadastro: 2.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Cadastrar pré$/ }));
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Confirmar revisão dos totais"));
  fireEvent.change(screen.getByLabelText("Volumes"), { target: { value: "3" } });
  expect(screen.getByLabelText("Confirmar revisão dos totais")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("Confirmar revisão dos totais"));
  fireEvent.click(screen.getByRole("button", { name: /^Cadastrar pré$/ }));
  expect(create).toHaveBeenCalledWith([
    expect.objectContaining({ totalsReviewed: true, totalVolumes: 98 }),
  ]);
});

it("stops immediately, keeps completed photos, removes unread photos and ignores the old run during a new import", async () => {
  vi.mocked(URL.createObjectURL).mockImplementation((source) => `blob:${(source as File).name}`);
  const runs: { args: Parameters<ReadPhotos>; finish: () => void }[] = [];
  mocks.read.mockImplementation(
    (...args: Parameters<ReadPhotos>) =>
      new Promise<void>((resolve) => {
        runs.push({ args, finish: resolve });
      }),
  );
  render(
    <ManifestImportDialog
      open
      onOpenChange={vi.fn()}
      manifests={[]}
      onCreate={() => ({ ok: true, manifests: [] })}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  const files = ["reading.jpg", "ready.jpg", "queued.jpg"].map(
    (name, i) => new File([String(i)], name, { type: "image/jpeg" }),
  );
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), { target: { files } });
  await waitFor(() => expect(runs).toHaveLength(1));
  await act(async () => {
    runs[0]!.args[2]?.(0, "Lendo foto pendente");
    runs[0]!.args[1](1, result("DI00000000002", "0000000002", "22-1"));
  });
  fireEvent.click(screen.getByRole("button", { name: "Parar" }));
  expect(runs[0]!.args[3]?.aborted).toBe(true);
  expect(screen.queryByRole("button", { name: "Parar" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled();
  expect(screen.getByLabelText("NF-série")).toHaveValue("22-1");
  expect(screen.getByRole("button", { name: "Cadastrar pré" })).not.toBeDisabled();
  expect(screen.getAllByRole("button", { name: /Revisar arquivo/ })).toHaveLength(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reading.jpg");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:queued.jpg");
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:ready.jpg");
  const next = new File(["next"], "next.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), { target: { files: [next] } });
  await waitFor(() => expect(runs).toHaveLength(2));
  await act(async () => {
    runs[0]!.args[1](0, result("DI00000000099", "0000000099", "99-1"));
    runs[0]!.args[2]?.(0, "Progresso antigo");
    runs[0]!.finish();
  });
  expect(screen.getByRole("button", { name: "Parar" })).toBeInTheDocument();
  expect(screen.queryByText("Progresso antigo")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /DI00000000099/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Enviar várias fotos")).toBeDisabled();
  await act(async () => {
    runs[1]!.args[1](0, result("DI00000000003", "0000000003", "33-1"));
    runs[1]!.finish();
  });
  expect(screen.getByLabelText("NF-série")).toHaveValue("33-1");
  expect(screen.getByRole("button", { name: "Cadastrar lote (2)" })).not.toBeDisabled();
});

it("stops a duplicate check before upload and permits a new import without waiting for that check", async () => {
  let finishHash: ((value: { files: File[]; duplicates: number }) => void) | undefined;
  mocks.unique.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishHash = resolve;
      }),
  );
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<ReadPhotos>[1]) =>
    onResult(0, result("DI00000000002", "0000000002", "22-1")),
  );
  render(
    <ManifestImportDialog
      open
      onOpenChange={vi.fn()}
      manifests={[]}
      onCreate={() => ({ ok: true, manifests: [] })}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  const first = new File(["a"], "cancelled.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), { target: { files: [first] } });
  await waitFor(() => expect(finishHash).toBeDefined());
  const signal = mocks.unique.mock.calls[0]![2] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Parar" }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["b"], "new.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText(/linha\(s\) com NF, volumes/);
  await act(async () => {
    finishHash!({ files: [first], duplicates: 0 });
  });
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("NF-série")).toHaveValue("22-1");
  expect(screen.getByRole("button", { name: "Cadastrar pré" })).not.toBeDisabled();
});

it("keeps each photo attached to its result while two reads finish out of order, and keeps manual edits", async () => {
  let callbacks: Parameters<ReadPhotos> | undefined;
  let finish: (() => void) | undefined;
  mocks.read.mockImplementation((...args: Parameters<ReadPhotos>) => {
    callbacks = args;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: {
      files: [
        new File(["a"], "primeiro.jpg", { type: "image/jpeg" }),
        new File(["b"], "segundo.jpg", { type: "image/jpeg" }),
      ],
    },
  });
  await waitFor(() => expect(callbacks).toBeDefined());
  await act(async () => {
    callbacks![2]?.(0, "Lendo a primeira foto");
    callbacks![2]?.(1, "Conferindo a segunda foto");
    callbacks![1](1, result("DI00000000002", "0000000002", "22-1"));
  });
  expect(screen.getByRole("button", { name: "Cadastrar lote (2)" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Revisar arquivo 2: DI00000000002" }));
  expect(screen.getByLabelText("NF-série")).toHaveValue("22-1");
  fireEvent.change(screen.getByLabelText("Placa"), { target: { value: "ABC1D24" } });
  await act(async () => {
    callbacks![1](0, result("DI00000000001", "0000000001", "11-1"));
    finish!();
  });
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar lote (2)" }));
  expect(create).toHaveBeenCalledWith([
    expect.objectContaining({
      id: "DI00000000001",
      rows: [expect.objectContaining({ ctc: "0000000001", nf: "11-1" })],
    }),
    expect.objectContaining({
      id: "DI00000000002",
      plate: "ABC1D24",
      rows: [expect.objectContaining({ ctc: "0000000002", nf: "22-1" })],
    }),
  ]);
});

it("aborts an in-flight photo and does not refill a reopened draft with its late result", async () => {
  let callbacks: Parameters<ReadPhotos> | undefined;
  let finish: (() => void) | undefined;
  mocks.read.mockImplementation((...args: Parameters<ReadPhotos>) => {
    callbacks = args;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Reabrir</button>
        <ManifestImportDialog
          open={open}
          onOpenChange={setOpen}
          manifests={[]}
          onCreate={() => ({ ok: true, manifests: [] })}
        />
      </>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "foto.jpg", { type: "image/jpeg" })] },
  });
  await waitFor(() => expect(callbacks).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
  expect(callbacks![3]?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
  await act(async () => {
    callbacks![1](0, result("DI00000000001", "0000000001", "11-1"));
    finish!();
  });
  expect(screen.getByLabelText("Número do pré")).toHaveValue("");
  expect(screen.getByLabelText("Data de emissão do pré")).toHaveValue("");
  expect(screen.getByLabelText("NF-série")).toHaveValue("");
  expect(
    screen.queryByRole("img", { name: "Documento enviado para conferência" }),
  ).not.toBeInTheDocument();
});

it("imports the printed issue date and submits a manually corrected date without replacing it with today", async () => {
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<ReadPhotos>[1]) =>
    onResult(0, result("DI00000000001", "0000000001", "11-1")),
  );
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  expect(screen.getByLabelText("Data de emissão do pré")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "foto.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText(/linha\(s\) com NF, volumes/);
  expect(screen.getByLabelText("Data de emissão do pré")).toHaveValue("2026-08-28");
  fireEvent.change(screen.getByLabelText("Data de emissão do pré"), {
    target: { value: "2026-08-27" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar pré" }));
  expect(create).toHaveBeenCalledWith([expect.objectContaining({ issueDate: "2026-08-27" })]);
});

it("consolidates the local reader notice while retaining specific header and NF warnings", async () => {
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<ReadPhotos>[1]) => {
    const local = result("DI00000000001", "0000000001", "11-1");
    onResult(0, {
      ...local,
      pre: {
        ...local.pre,
        readingSource: "local",
        verification: { status: "unavailable", checkedFields: 0, conflicts: 0 },
        headerReview: [LOCAL_HEADER_NOTICE, "Total de volumes não confere."],
        documents: local.pre.documents.map((row) => ({
          ...row,
          review: ["NF", LOCAL_ROW_NOTICE],
        })),
      },
    });
  });
  render(
    <ManifestImportDialog
      open
      onOpenChange={vi.fn()}
      manifests={[]}
      onCreate={() => ({ ok: true, manifests: [] })}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "foto.jpg", { type: "image/jpeg" })] },
  });
  expect(await screen.findByText("Total de volumes não confere.")).toBeInTheDocument();
  expect(screen.queryByText("Confira este CTC na foto")).not.toBeInTheDocument();
  expect(
    within(screen.getByLabelText("NF-série").closest("label")!).getByText("NF"),
  ).toBeInTheDocument();
  expect(screen.queryByText(LOCAL_HEADER_NOTICE)).not.toBeInTheDocument();
  expect(screen.queryByText(LOCAL_ROW_NOTICE)).not.toBeInTheDocument();
  expect(screen.queryByText("Conferir os dados do pré")).not.toBeInTheDocument();
});

it("ignores repeated photos before creating drafts and keeps the existing draft when every selected photo is repeated", async () => {
  const first = new File(["same photo"], "foto.jpg", { type: "image/jpeg" });
  const duplicate = new File(["same photo"], "outra.jpg", { type: "image/jpeg" });
  const pdf = new File(["pdf"], "documento.pdf", { type: "application/pdf" });
  mocks.unique
    .mockResolvedValueOnce({ files: [first], duplicates: 1 })
    .mockResolvedValueOnce({ files: [], duplicates: 1 });
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<ReadPhotos>[1]) =>
    onResult(0, result("DI00000000001", "0000000001", "11-1")),
  );
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [first, duplicate, pdf] },
  });
  await screen.findByText(/linha\(s\) com NF, volumes/);
  expect(
    screen.getByText(
      "Alguns arquivos foram ignorados. Envie fotos em JPG, PNG ou WebP. 1 foto(s) repetida(s) ignorada(s).",
    ),
  ).toBeInTheDocument();
  expect(mocks.read.mock.calls[0]?.[0]).toEqual([first]);
  expect(screen.queryByRole("button", { name: /Cadastrar lote/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [duplicate] },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Cadastrar pré" })).not.toBeDisabled(),
  );
  expect(mocks.unique.mock.calls[1]?.[1]).toEqual([first]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("NF-série")).toHaveValue("11-1");
  expect(screen.getByText("1 foto(s) repetida(s) ignorada(s).")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar pré" }));
  expect(create.mock.calls[0]?.[0]).toHaveLength(1);
});

it("cancels photo preparation on close and ignores a late duplicate check after reopening", async () => {
  let finishHash: ((result: { files: File[]; duplicates: number }) => void) | undefined;
  mocks.unique.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishHash = resolve;
      }),
  );
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Reabrir</button>
        <ManifestImportDialog
          open={open}
          onOpenChange={setOpen}
          manifests={[]}
          onCreate={() => ({ ok: true, manifests: [] })}
        />
      </>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  const file = new File(["a"], "foto.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), { target: { files: [file] } });
  await waitFor(() => expect(finishHash).toBeDefined());
  const signal = mocks.unique.mock.calls[0]?.[2] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
  expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
  await act(async () => {
    finishHash!({ files: [file], duplicates: 0 });
  });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Número do pré")).toHaveValue("");
  expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled();
  expect(
    screen.queryByRole("img", { name: "Documento enviado para conferência" }),
  ).not.toBeInTheDocument();
});

it("preserves manual changes made while photos are being checked for duplicates", async () => {
  let finishHash: ((result: { files: File[]; duplicates: number }) => void) | undefined;
  mocks.unique.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishHash = resolve;
      }),
  );
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<ReadPhotos>[1]) =>
    onResult(0, result("DI00000000002", "0000000002", "22-1")),
  );
  render(
    <ManifestImportDialog
      open
      onOpenChange={vi.fn()}
      manifests={[]}
      onCreate={() => ({ ok: true, manifests: [] })}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  const file = new File(["a"], "foto.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), { target: { files: [file] } });
  await waitFor(() => expect(finishHash).toBeDefined());
  fireEvent.change(screen.getByLabelText("Número do pré"), { target: { value: "DI00000000001" } });
  fireEvent.change(screen.getByLabelText("Motorista"), { target: { value: "MOTORISTA MANUAL" } });
  await act(async () => {
    finishHash!({ files: [file], duplicates: 0 });
  });
  await screen.findByText(/linha\(s\) com NF, volumes/);
  fireEvent.click(screen.getByRole("button", { name: "Revisar arquivo 1: DI00000000001" }));
  expect(screen.getByLabelText("Número do pré")).toHaveValue("DI00000000001");
  expect(screen.getByLabelText("Motorista")).toHaveValue("MOTORISTA MANUAL");
  expect(screen.getByRole("button", { name: "Cadastrar lote (2)" })).not.toBeDisabled();
});

it.each(["fewer CTCs", "error"] as const)(
  "preserves all previous rows and manual edits when rereading returns %s",
  async (outcome) => {
    const original = result("DI00000000001", "0000000001", "11-1");
    const secondRow = {
      ctc: "0000000002",
      nf: "22-1",
      volumes: "3",
      client: "LAB 2",
      recipient: "CLIENTE 2",
    };
    mocks.read.mockImplementationOnce(
      async (_files: File[], onResult: Parameters<ReadPhotos>[1]) => {
        onResult(0, {
          ...original,
          pre: {
            ...original.pre,
            ctcs: ["0000000001", "0000000002"],
            documents: [...original.pre.documents, secondRow],
            expectedRows: 2,
            totalVolumes: 5,
          },
        });
      },
    );
    let retryCallbacks: Parameters<ReadPhotos> | undefined;
    let finishRetry: (() => void) | undefined;
    mocks.read.mockImplementationOnce((...args: Parameters<ReadPhotos>) => {
      retryCallbacks = args;
      return new Promise<void>((resolve) => {
        finishRetry = resolve;
      });
    });
    const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
    render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
    await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
      target: { files: [new File(["a"], "foto.jpg", { type: "image/jpeg" })] },
    });
    await screen.findByText(/linha\(s\) com NF, volumes/);
    fireEvent.change(screen.getByLabelText("NF-série"), { target: { value: "12-1" } });
    fireEvent.change(screen.getByLabelText("Cliente / laboratório"), {
      target: { value: "LAB CONFERIDO" },
    });
    fireEvent.change(screen.getByLabelText("Motorista"), {
      target: { value: "MOTORISTA CONFERIDO" },
    });
    fireEvent.change(screen.getByLabelText("Placa"), { target: { value: "ABC1D24" } });
    fireEvent.click(screen.getByRole("button", { name: "Reler detalhes desta foto" }));
    await waitFor(() => expect(retryCallbacks).toBeDefined());
    expect(mocks.unique).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cadastrar pré" })).toBeDisabled();
    await act(async () => {
      if (outcome === "error") retryCallbacks![1](0, { error: "Leitor indisponível." });
      else {
        const partial = result("DI00000000099", "0000000099", "99-9");
        retryCallbacks![1](0, {
          ...partial,
          pre: {
            ...partial.pre,
            verification: { status: "unavailable", checkedFields: 0, conflicts: 0 },
          },
        });
      }
      finishRetry!();
    });
    expect(
      screen.getByText(
        "A nova tentativa não melhorou a leitura. Os dados anteriores foram preservados.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Número do pré")).toHaveValue("DI00000000001");
    expect(screen.getByLabelText("Placa")).toHaveValue("ABC1D24");
    expect(screen.getByLabelText("Motorista")).toHaveValue("MOTORISTA CONFERIDO");
    expect(screen.getByLabelText("NF-série")).toHaveValue("12-1");
    expect(screen.getByLabelText("Cliente / laboratório")).toHaveValue("LAB CONFERIDO");
    fireEvent.change(screen.getByLabelText("Selecionar CTC"), { target: { value: "1" } });
    expect(screen.getByLabelText("CTC")).toHaveValue("0000000002");
    expect(screen.getByLabelText("NF-série")).toHaveValue("22-1");
    expect(screen.getByLabelText("Volumes")).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar pré" }));
    expect(create).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "DI00000000001",
        driver: "MOTORISTA CONFERIDO",
        plate: "ABC1D24",
        readingSource: "local",
        edited: true,
        rows: [
          expect.objectContaining({ ctc: "0000000001", nf: "12-1", client: "LAB CONFERIDO" }),
          secondRow,
        ],
      }),
    ]);
  },
);

const registeredManifest = (): Manifest => ({
  id: "DI00000000008",
  driver: "MOTORISTA ORIGINAL",
  plate: "ABC1D23",
  date: "2026-08-28",
  finishedAt: "2026-08-29",
  documents: [{ id: "registered-ctc", ctc: "0000000008", nf: "88-1", volumes: 2, received: true }],
});

it("warns inside the pre and CTC fields before saving, includes the original driver, and clears conflicts immediately after correction", async () => {
  const existing = registeredManifest();
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(
    <ManifestImportDialog open onOpenChange={vi.fn()} manifests={[existing]} onCreate={create} />,
  );
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Número do pré"), { target: { value: existing.id } });
  fireEvent.change(screen.getByLabelText("Motorista"), { target: { value: "NOVO MOTORISTA" } });
  fireEvent.change(screen.getByLabelText("Placa"), { target: { value: "ABC1D24" } });
  fireEvent.change(screen.getByLabelText("CTC"), { target: { value: existing.documents[0]!.ctc } });
  const id = screen.getByLabelText("Número do pré"),
    ctc = screen.getByLabelText("CTC");
  expect(id).toHaveAttribute("aria-invalid", "true");
  expect(ctc).toHaveAttribute("aria-invalid", "true");
  expect(id).toHaveAccessibleDescription(expect.stringContaining("MOTORISTA ORIGINAL"));
  expect(ctc).toHaveAccessibleDescription(expect.stringContaining(existing.id));
  expect(screen.getByRole("button", { name: "Cadastrar pré" })).toBeDisabled();
  fireEvent.submit(ctc.closest("form")!);
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.change(id, { target: { value: "DI00000000009" } });
  expect(id).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("button", { name: "Cadastrar pré" })).toBeDisabled();
  fireEvent.change(ctc, { target: { value: "0000000009" } });
  expect(ctc).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("button", { name: "Cadastrar pré" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar pré" }));
  expect(create.mock.calls[0]![0][0]!.rows[0]).not.toHaveProperty("review");
});

it("blocks both occurrences of a CTC duplicated between draft photos and allows the batch after correcting one", async () => {
  mocks.read.mockImplementation(async (_files: File[], receive: Parameters<ReadPhotos>[1]) => {
    receive(0, result("DI00000000001", "0000000001", "11-1"));
    receive(1, result("DI00000000002", "0000000001", "22-1"));
  });
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: {
      files: [
        new File(["a"], "a.jpg", { type: "image/jpeg" }),
        new File(["b"], "b.jpg", { type: "image/jpeg" }),
      ],
    },
  });
  await waitFor(() => expect(screen.getByLabelText("CTC")).toHaveAttribute("aria-invalid", "true"));
  expect(screen.getByRole("button", { name: "Cadastrar pré" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cadastrar lote (2)" })).toBeDisabled();
  for (const index of [1, 2])
    expect(
      within(
        screen.getByRole("button", { name: `Revisar arquivo ${index}: DI0000000000${index}` }),
      ).getByText("Cadastro duplicado"),
    ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revisar arquivo 2: DI00000000002" }));
  expect(screen.getByLabelText("CTC")).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(screen.getByLabelText("CTC"), { target: { value: "0000000002" } });
  expect(screen.getByLabelText("CTC")).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("button", { name: "Cadastrar lote (2)" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Revisar arquivo 1: DI00000000001" }));
  expect(screen.getByLabelText("CTC")).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("button", { name: "Cadastrar pré" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar lote (2)" }));
  expect(create.mock.calls[0]![0].map((draft) => draft.rows[0]!.ctc)).toEqual([
    "0000000001",
    "0000000002",
  ]);
  expect(create.mock.calls[0]![0].every((draft) => !draft.rows[0]!.review?.length)).toBe(true);
});

it("passes registered photo hashes before OCR and identifies an already registered filename and driver without reading it", async () => {
  const hash = "a".repeat(64),
    existing = { ...registeredManifest(), sourcePhotoHashes: [hash] };
  const file = new File(["registered photo"], "foto-repetida.jpg", { type: "image/jpeg" });
  mocks.unique.mockResolvedValueOnce({
    files: [],
    duplicates: 1,
    registeredDuplicates: [{ filename: file.name, manifestId: existing.id }],
  });
  render(
    <ManifestImportDialog
      open
      onOpenChange={vi.fn()}
      manifests={[existing]}
      onCreate={() => ({ ok: true, manifests: [] })}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), { target: { files: [file] } });
  expect(
    await screen.findByText(
      `${file.name}: foto já cadastrada no pré ${existing.id} · ${existing.driver}. Não foi lida novamente.`,
    ),
  ).toBeInTheDocument();
  expect(mocks.unique.mock.calls[0]![3]).toEqual([{ hash, manifestId: existing.id }]);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.fingerprint).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByText("1 foto(s) repetida(s) ignorada(s).")).not.toBeInTheDocument();
});

it("submits a photo fingerprint only with its own reviewed photo and leaves manual drafts without that hash", async () => {
  const hash = "b".repeat(64);
  mocks.fingerprint.mockResolvedValue(hash);
  mocks.read.mockImplementation(async (_files: File[], receive: Parameters<ReadPhotos>[1]) =>
    receive(0, result("DI00000000001", "0000000001", "11-1")),
  );
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText(/linha\(s\) com NF, volumes/);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Adicionar pré manualmente" }));
  fireEvent.change(screen.getByLabelText("Número do pré"), { target: { value: "DI00000000002" } });
  fireEvent.change(screen.getByLabelText("CTC"), { target: { value: "0000000002" } });
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar pré" }));
  expect(create.mock.calls[0]![0][0]).not.toHaveProperty("sourcePhotoHash");
  fireEvent.click(screen.getByRole("button", { name: "Cadastrar pré" }));
  expect(create.mock.calls[1]![0][0]).toMatchObject({ id: "DI00000000001", sourcePhotoHash: hash });
});

it("discards a late fingerprint after closing and reopening without starting OCR or adding a photo", async () => {
  let finishHash!: (value: string) => void;
  mocks.fingerprint.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finishHash = resolve;
      }),
  );
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Reabrir</button>
        <ManifestImportDialog
          open={open}
          onOpenChange={setOpen}
          manifests={[]}
          onCreate={() => ({ ok: true, manifests: [] })}
        />
      </>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "a.jpg", { type: "image/jpeg" })] },
  });
  await waitFor(() => expect(mocks.fingerprint).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
  fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
  await act(async () => {
    finishHash("c".repeat(64));
  });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Número do pré")).toHaveValue("");
  expect(screen.getByLabelText("CTC")).toHaveValue("");
  expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled();
});

it("locks only the draft being reread during delayed fingerprint preparation and preserves edits to another finished draft", async () => {
  let finishHash!: (hash: string) => void;
  mocks.fingerprint
    .mockResolvedValueOnce("a".repeat(64))
    .mockResolvedValueOnce("b".repeat(64))
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishHash = resolve;
        }),
    );
  mocks.read
    .mockImplementationOnce(async (_files: File[], receive: Parameters<ReadPhotos>[1]) => {
      receive(0, result("DI00000000001", "0000000001", "11-1"));
      receive(1, result("DI00000000002", "0000000002", "22-1"));
    })
    .mockImplementationOnce(async (_files: File[], receive: Parameters<ReadPhotos>[1]) =>
      receive(0, { error: "Releitura indisponível." }),
    );
  render(
    <ManifestImportDialog
      open
      onOpenChange={vi.fn()}
      manifests={[]}
      onCreate={() => ({ ok: true, manifests: [] })}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: {
      files: [
        new File(["a"], "a.jpg", { type: "image/jpeg" }),
        new File(["b"], "b.jpg", { type: "image/jpeg" }),
      ],
    },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Cadastrar lote (2)" })).not.toBeDisabled(),
  );
  fireEvent.change(screen.getByLabelText("NF-série"), { target: { value: "13-1" } });
  fireEvent.change(screen.getByLabelText("Motorista"), {
    target: { value: "MOTORISTA CONFERIDO" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reler detalhes desta foto" }));
  await waitFor(() => expect(finishHash).toBeDefined());
  for (const field of [
    "Número do pré",
    "Motorista",
    "CTC",
    "NF-série",
    "Volumes",
    "Cliente / laboratório",
  ])
    expect(screen.getByLabelText(field)).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Revisar arquivo 2: DI00000000002" }));
  expect(screen.getByLabelText("NF-série")).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText("NF-série"), { target: { value: "23-1" } });
  await act(async () => {
    finishHash("a".repeat(64));
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Cadastrar lote (2)" })).not.toBeDisabled(),
  );
  expect(screen.getByLabelText("NF-série")).toHaveValue("13-1");
  expect(screen.getByLabelText("Motorista")).toHaveValue("MOTORISTA CONFERIDO");
  expect(screen.getByLabelText("NF-série")).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "Revisar arquivo 1: DI00000000001" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Revisar arquivo 2: DI00000000002" }));
  expect(screen.getByLabelText("NF-série")).toHaveValue("23-1");
});

it("keeps clean local rows free of field-review badges", async () => {
  const reading = result("DI00000000001", "0000000001", "100-1");
  mocks.read.mockImplementation(
    async (_files: File[], receive: (index: number, value: PhotoReadResult) => void) =>
      receive(0, {
        ...reading,
        pre: {
          ...reading.pre,
          readingSource: "local",
          headerReview: [LOCAL_HEADER_NOTICE],
          verification: { status: "unavailable", checkedFields: 0, conflicts: 0 },
        },
      }),
  );
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "clean-local.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText(/linha\(s\) com NF, volumes/);
  expect(screen.queryByText("Leitura local · campos a conferir")).not.toBeInTheDocument();
  expect(screen.queryByText(/Gemini|IA/)).not.toBeInTheDocument();
});
it("counts multiple NF lines under one CTC once and flags only an actual total mismatch", async () => {
  const reading = result("DI00000000001", "0000000001", "100-1");
  mocks.read.mockImplementation(
    async (_files: File[], receive: (index: number, value: PhotoReadResult) => void) =>
      receive(0, {
        ...reading,
        pre: {
          ...reading.pre,
          totalVolumes: 5,
          documents: [...reading.pre.documents, { ...reading.pre.documents[0]!, nf: "101-1" }],
        },
      }),
  );
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Enviar várias fotos")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Enviar várias fotos"), {
    target: { files: [new File(["a"], "multiple-nf.jpg", { type: "image/jpeg" })] },
  });
  const totals = await screen.findByRole("group", { name: "Totais da foto" });
  expect(within(totals).getByText("CTCs lidos").textContent).toContain("1");
  expect(within(totals).queryByText("Confira a contagem")).not.toBeInTheDocument();
  expect(within(totals).getByText("Confira a soma")).toBeInTheDocument();
  expect(within(totals).getByText("Confira a soma").parentElement).toHaveAttribute(
    "data-mismatch",
    "true",
  );
});

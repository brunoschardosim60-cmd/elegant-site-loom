import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountWorkspace } from "@/components/account-workspace";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), save: vi.fn(), read: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/supabase-client", () => ({
  getSupabaseClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "account-a", email: "account@example.com" } } },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: mocks.signOut,
    },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: true }),
}));
const saved = {
  manifests: [
    {
      id: "DI00123456789",
      createdByEmail: "account@example.com",
      driver: "Teste",
      plate: "ABC1234",
      date: "2026-10-11",
      documents: [{ id: "doc", ctc: "0000000001", nf: "123-1", volumes: 2, received: false }],
    },
  ],
  activity: [],
  issues: [],
};
const team = (data = saved, revision = 7) => ({
  teamId: "00000000-0000-4000-8000-000000000001",
  name: "Equipe",
  owner: true,
  members: [{ email: "account@example.com", owner: true, pending: false }],
  revision,
  data,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({ data: team(), error: null });
  mocks.save.mockImplementation(async (args) => ({
    data: { revision: 8, data: args.next_data },
    error: null,
  }));
  mocks.rpc.mockImplementation((name, args) =>
    name.startsWith("get_conference_") ? mocks.read(args) : mocks.save(args),
  );
});
afterEach(() => {
  cleanup();
});
it("reports sign-out errors and permits retry without losing the workspace", async () => {
  mocks.signOut
    .mockResolvedValueOnce({ error: { message: "network" } })
    .mockResolvedValueOnce({ error: null });
  render(<AccountWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Sair da conta" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível sair");
  expect(screen.getByRole("textbox", { name: "Código do CTC" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sair da conta" }));
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(2));
  expect(mocks.save).not.toHaveBeenCalled();
});
it("prevents repeated logout and interaction while logout is in flight, then restores it after failure", async () => {
  let reject!: (reason: Error) => void;
  mocks.signOut.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<AccountWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Sair da conta" }));
  const pending = screen.getByRole("button", { name: "Saindo…" });
  expect(pending).toBeDisabled();
  fireEvent.click(pending);
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "Código do CTC" }).closest("[inert]")).not.toBeNull();
  await act(async () => reject(new Error("offline")));
  expect(screen.getByRole("textbox", { name: "Código do CTC" }).closest("[inert]")).toBeNull();
  expect(screen.getByRole("button", { name: "Sair da conta" })).toBeEnabled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("restores shared records and saves only a user action with the loaded base and photo hashes", async () => {
  const photoHash = "a".repeat(64);
  const stored = {
    ...saved,
    manifests: saved.manifests.map((m) => ({ ...m, sourcePhotoHashes: [photoHash] })),
  };
  mocks.read.mockResolvedValue({ data: team(stored), error: null });
  render(<AccountWorkspace />);
  const button = await screen.findByRole("button", { name: "Marcar CTC 0000000001 como recebido" });
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const payload = mocks.save.mock.calls[0]![0];
  expect(payload.base_data).toEqual(stored);
  expect(payload.next_data.manifests[0].documents[0].received).toBe(true);
  expect(payload.next_data.manifests[0].sourcePhotoHashes).toEqual([photoHash]);
  await screen.findByText("Todos os dados salvos");
});
it("keeps unsaved changes visible and retries after a network error", async () => {
  mocks.save.mockResolvedValueOnce({ error: { message: "network" } });
  render(<AccountWorkspace />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Marcar CTC 0000000001 como recebido" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Tentar salvar novamente" }));
  await screen.findByText("Todos os dados salvos");
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1]![0].base_data).toEqual(saved);
});
it("blocks incompatible concurrent edits and duplicates without overwriting or automatic retries", async () => {
  mocks.save.mockResolvedValue({ error: { message: "CONFERENCE_DUPLICATE" } });
  render(<AccountWorkspace />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Marcar CTC 0000000001 como recebido" }),
  );
  expect(
    await screen.findByRole("button", { name: "Recarregar dados salvos" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Nenhuma duplicata foi salva");
  expect(screen.queryByRole("button", { name: "Tentar salvar novamente" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sair da conta" })).toBeDisabled();
  expect(mocks.save).toHaveBeenCalledOnce();
});
it("never replaces records with an empty workspace after a load error", async () => {
  mocks.read.mockResolvedValue({ data: null, error: { message: "network" } });
  render(<AccountWorkspace />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Nenhum dado foi substituído");
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Novo pré/ })).not.toBeInTheDocument();
});
it("saves a confirmed deletion and retains its audit entry without re-registering the pre", async () => {
  render(<AccountWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Excluir pré DI00123456789" }));
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Excluir pré-manifesto" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0]![0].next_data.manifests).toEqual([]);
  expect(mocks.save.mock.calls[0]![0].next_data.activity).toMatchObject([
    { title: "Pré-manifesto excluído" },
  ]);
  await screen.findByText("Todos os dados salvos");
  expect(screen.getByRole("heading", { name: "Nenhum pré pendente" })).toBeInTheDocument();
});
it("updates another persons receipt without remounting the scanner or losing its typed value", async () => {
  render(<AccountWorkspace />);
  const scanner = await screen.findByRole("textbox", { name: "Código do CTC" });
  fireEvent.change(scanner, { target: { value: "00000" } });
  const remote = structuredClone(saved);
  remote.manifests[0]!.documents[0]!.received = true;
  mocks.read.mockResolvedValue({ data: team(remote, 8), error: null });
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Marcar CTC 0000000001 como recebido" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("textbox", { name: "Código do CTC" })).toBe(scanner);
  expect(scanner).toHaveValue("00000");
  expect(mocks.save).not.toHaveBeenCalled();
});

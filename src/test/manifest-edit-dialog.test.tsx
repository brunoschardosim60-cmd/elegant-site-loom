import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManifestEditDialog } from "@/components/manifest-edit-dialog";
import type { Manifest } from "@/lib/conference";
afterEach(cleanup);
const manifest: Manifest = {
  id: "DI00601869631",
  driver: "DAVID",
  plate: "TRB7E25",
  date: "2026-10-13",
  expectedRows: 1,
  totalVolumes: 98,
  documents: [{ id: "one", ctc: "5602298284", nf: "145194-1", volumes: 28, received: true }],
};
it("requires review for unequal totals, resets confirmation on edits and discards unsaved changes", () => {
  const save = vi.fn(() => ({ ok: true as const, manifests: [] })),
    close = vi.fn();
  render(<ManifestEditDialog manifest={manifest} onClose={close} onSave={save} />);
  expect(screen.getByText("Cabeçalho: 98 volumes · cadastro: 28.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Volumes"), { target: { value: "60" } });
  expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Remover CTC" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

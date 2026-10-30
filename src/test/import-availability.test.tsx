import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManifestImportDialog } from "@/components/manifest-import-dialog";

afterEach(cleanup);
const props = {
  open: true,
  onOpenChange: vi.fn(),
  manifests: [],
  onCreate: () => ({ ok: true as const, manifests: [] }),
};

it("enables photo upload immediately with the local reader only", () => {
  render(<ManifestImportDialog {...props} />);
  expect(screen.getByLabelText("Enviar várias fotos")).toBeEnabled();
  expect(screen.getByLabelText("Tirar foto")).toBeEnabled();
  expect(screen.getByText("Leitura local")).toBeInTheDocument();
  expect(screen.queryByLabelText("Leitor de fotos")).not.toBeInTheDocument();
  expect(screen.queryByText(/Gemini|IA \+ reserva/)).not.toBeInTheDocument();
});

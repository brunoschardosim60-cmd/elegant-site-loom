import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountFeedback, AccountStatusBar } from "@/components/account-status";
afterEach(cleanup);
const props = {
  email: "equipe@example.invalid",
  status: "Salvando…",
  pending: true,
  error: "",
  conflict: false,
  onTeam: vi.fn(),
  onSignOut: vi.fn(),
  onRetry: vi.fn(),
  onReload: vi.fn(),
};
it("keeps sign-out disabled while changes are pending and announces the actual save state", () => {
  const view = render(<AccountStatusBar {...props} />);
  expect(screen.getByRole("status")).toHaveTextContent("Salvando…");
  expect(screen.getByRole("button", { name: "Sair da conta" })).toBeDisabled();
  view.rerender(<AccountStatusBar {...props} pending={false} status="Todos os dados salvos" />);
  expect(screen.getByRole("status")).toHaveTextContent("Todos os dados salvos");
  expect(screen.getByRole("button", { name: "Sair da conta" })).toBeEnabled();
});
it("offers only the correct recovery action for unsaved changes versus conflicting records", () => {
  const retry = vi.fn(),
    reload = vi.fn();
  const view = render(
    <AccountStatusBar {...props} error="Sem conexão" onRetry={retry} onReload={reload} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(
    <AccountStatusBar {...props} error="Conflito" conflict onRetry={retry} onReload={reload} />,
  );
  expect(screen.queryByRole("button", { name: "Tentar salvar novamente" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Recarregar dados salvos" }));
  expect(reload).toHaveBeenCalledOnce();
});
it("announces loading and error without presenting an empty operational workspace", () => {
  const view = render(<AccountFeedback message="Carregando seus cadastros…" />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  const retry = vi.fn();
  view.rerender(<AccountFeedback error message="Nenhum dado foi substituído" onRetry={retry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Nenhum dado foi substituído");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(retry).toHaveBeenCalledOnce();
});

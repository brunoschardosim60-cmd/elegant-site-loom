import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Login, PasswordReset } from "@/components/account-auth";

afterEach(cleanup);
function authClient() {
  const session = { user: { id: "synthetic-user" } };
  const login = vi.fn().mockResolvedValue({ data: { session }, error: null });
  const signup = vi.fn().mockResolvedValue({ data: { session }, error: null });
  const reset = vi.fn().mockResolvedValue({ data: {}, error: null });
  const update = vi.fn().mockResolvedValue({ data: { user: session.user }, error: null });
  const client = {
    auth: {
      signInWithPassword: login,
      signUp: signup,
      resetPasswordForEmail: reset,
      updateUser: update,
    },
  } as unknown as SupabaseClient;
  return { client, login, signup, reset, update };
}
const pendingResult = () => {
  let resolve!: (result: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function credentials() {
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "  operator@example.com  " },
  });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "synthetic-password" } });
}
function newPassword(password = "synthetic-new-password", confirmation = password) {
  fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
    target: { value: confirmation },
  });
}

it("switches forgotten password to email only and submits a trimmed email with the permitted origin redirect", async () => {
  const mocks = authClient();
  render(<Login client={mocks.client} />);
  credentials();
  fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
  expect(screen.getByRole("heading", { name: "Recuperar senha" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
  await waitFor(() =>
    expect(mocks.reset).toHaveBeenCalledExactlyOnceWith("operator@example.com", {
      redirectTo: window.location.origin,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Se houver uma conta com esse e-mail, você receberá um link",
  );
  expect(screen.getByRole("status")).toHaveTextContent("spam");
  expect(mocks.login).not.toHaveBeenCalled();
  expect(mocks.signup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
  expect(screen.getByLabelText("Senha")).toHaveValue("");
});

it("uses the same neutral recovery message for an unknown email and supports returning from a parent-selected recovery mode", async () => {
  const mocks = authClient(),
    back = vi.fn();
  mocks.reset.mockResolvedValue({
    data: {},
    error: { code: "user_not_found", message: "private account enumeration details" },
  });
  render(<Login client={mocks.client} initialMode="forgot" onBack={back} />);
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "unknown@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Se houver uma conta com esse e-mail",
  );
  expect(screen.queryByText(/enumeration/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
  expect(back).toHaveBeenCalledOnce();
});

it("blocks synchronous duplicate recovery submissions while the request is pending", async () => {
  const mocks = authClient(),
    gate = pendingResult();
  mocks.reset.mockReturnValue(gate.promise);
  render(<Login client={mocks.client} initialMode="forgot" />);
  const email = screen.getByLabelText("E-mail");
  fireEvent.change(email, { target: { value: "operator@example.com" } });
  fireEvent.submit(email.closest("form")!);
  fireEvent.submit(email.closest("form")!);
  expect(mocks.reset).toHaveBeenCalledOnce();
  expect(email).toBeDisabled();
  expect(screen.getByRole("button", { name: "Aguarde…" })).toBeDisabled();
  await act(async () => {
    gate.resolve({ data: {}, error: null });
  });
  expect(email).not.toBeDisabled();
});

it.each(["limit", "network"] as const)(
  "shows a safe %s recovery failure without raw provider details",
  async (kind) => {
    const mocks = authClient();
    if (kind === "limit")
      mocks.reset.mockResolvedValue({
        data: {},
        error: {
          status: 429,
          code: "over_email_send_rate_limit",
          message: "private-provider-error",
        },
      });
    else mocks.reset.mockRejectedValue(new Error("private-provider-error"));
    render(<Login client={mocks.client} initialMode="forgot" />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "operator@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      kind === "limit" ? "Muitas tentativas" : "Sem conexão",
    );
    expect(screen.queryByText(/private-provider-error/)).not.toBeInTheDocument();
  },
);

it.each(["login", "signup"] as const)(
  "calls authenticated only after a %s session is returned and guards duplicate submission",
  async (mode) => {
    const mocks = authClient(),
      authenticated = vi.fn(),
      gate = pendingResult();
    const method = mode === "login" ? mocks.login : mocks.signup;
    method.mockReturnValue(gate.promise);
    render(<Login client={mocks.client} onAuthenticated={authenticated} />);
    if (mode === "signup")
      fireEvent.click(screen.getByRole("button", { name: "Ainda não tenho conta" }));
    credentials();
    const form = screen.getByLabelText("Senha").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(method).toHaveBeenCalledOnce();
    expect(authenticated).not.toHaveBeenCalled();
    expect(method.mock.calls[0]![0]).toMatchObject({
      email: "operator@example.com",
      password: "synthetic-password",
    });
    if (mode === "signup")
      expect(method.mock.calls[0]![0].options).toEqual({ emailRedirectTo: window.location.origin });
    await act(async () => {
      gate.resolve({ data: { session: { user: { id: "synthetic-user" } } }, error: null });
    });
    expect(authenticated).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Senha")).toHaveValue("");
  },
);

it("keeps signup confirmation without a session separate from authenticated access", async () => {
  const mocks = authClient(),
    authenticated = vi.fn();
  mocks.signup.mockResolvedValue({ data: { session: null }, error: null });
  render(<Login client={mocks.client} onAuthenticated={authenticated} />);
  fireEvent.click(screen.getByRole("button", { name: "Ainda não tenho conta" }));
  credentials();
  fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Confira seu e-mail para confirmar a conta",
  );
  expect(authenticated).not.toHaveBeenCalled();
});

it("offers a new link without password fields or an update call when no recovery session exists", () => {
  const mocks = authClient(),
    request = vi.fn();
  render(
    <PasswordReset
      client={mocks.client}
      hasSession={false}
      onComplete={vi.fn()}
      onRequestLink={request}
    />,
  );
  expect(screen.getByRole("heading", { name: "Link inválido ou expirado" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Solicitar novo link" }));
  expect(request).toHaveBeenCalledOnce();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("requires eight characters and a matching confirmation before changing the password", async () => {
  const mocks = authClient();
  render(
    <PasswordReset
      client={mocks.client}
      hasSession
      email="operator@example.com"
      onComplete={vi.fn()}
      onRequestLink={vi.fn()}
    />,
  );
  expect(screen.getByText("Conta: operator@example.com")).toBeInTheDocument();
  newPassword("short");
  fireEvent.submit(screen.getByLabelText("Nova senha").closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("pelo menos 8 caracteres");
  newPassword("synthetic-password", "synthetic-other-password");
  fireEvent.submit(screen.getByLabelText("Nova senha").closest("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("não coincidem");
  expect(mocks.update).not.toHaveBeenCalled();
});

it("updates once, clears both password fields, and waits for Continue before completing recovery", async () => {
  const mocks = authClient(),
    complete = vi.fn(),
    gate = pendingResult();
  mocks.update.mockReturnValue(gate.promise);
  render(
    <PasswordReset
      client={mocks.client}
      hasSession
      onComplete={complete}
      onRequestLink={vi.fn()}
    />,
  );
  newPassword();
  const password = screen.getByLabelText("Nova senha"),
    confirmation = screen.getByLabelText("Confirmar nova senha"),
    form = password.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ password: "synthetic-new-password" });
  expect(password).toBeDisabled();
  expect(confirmation).toBeDisabled();
  await act(async () => {
    gate.resolve({ data: { user: { id: "synthetic-user" } }, error: null });
  });
  expect(screen.getByRole("heading", { name: "Senha atualizada" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Confirmar nova senha")).not.toBeInTheDocument();
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  expect(complete).toHaveBeenCalledOnce();
});

it("stops offering a password update when the server reports an expired recovery session", async () => {
  const mocks = authClient(),
    request = vi.fn();
  mocks.update.mockResolvedValue({
    data: {},
    error: { code: "session_not_found", status: 401, message: "private-provider-error" },
  });
  render(
    <PasswordReset client={mocks.client} hasSession onComplete={vi.fn()} onRequestLink={request} />,
  );
  newPassword();
  fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
  expect(
    await screen.findByRole("heading", { name: "Link inválido ou expirado" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
  expect(screen.queryByText(/private-provider-error/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Solicitar novo link" }));
  expect(request).toHaveBeenCalledOnce();
});

it("retains the recovery form after a network error with safe feedback and permits a deliberate retry", async () => {
  const mocks = authClient();
  mocks.update.mockRejectedValueOnce(new Error("private-password-provider-error"));
  render(
    <PasswordReset client={mocks.client} hasSession onComplete={vi.fn()} onRequestLink={vi.fn()} />,
  );
  newPassword();
  fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão");
  expect(screen.queryByText(/private-password-provider-error/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salvar nova senha" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
  expect(await screen.findByRole("heading", { name: "Senha atualizada" })).toBeInTheDocument();
  expect(mocks.update).toHaveBeenCalledTimes(2);
});

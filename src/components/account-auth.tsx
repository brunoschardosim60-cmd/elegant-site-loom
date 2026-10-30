import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "./ui/button";
import { LegalFooter } from "./legal-page";

type AuthProblem = { code?: string | undefined; status?: number | undefined } | null;
const rateLimited = (error: AuthProblem) =>
  error?.status === 429 ||
  error?.code === "over_email_send_rate_limit" ||
  error?.code === "over_request_rate_limit";
const limitMessage = "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
const recoveryMessage =
  "Se houver uma conta com esse e-mail, você receberá um link para redefinir a senha. Verifique também a pasta de spam.";

export function AccountPanel({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-background p-5">
      <section className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm grid gap-5">
        <h1 className="text-3xl font-bold text-primary">confere.</h1>
        {children}
      </section>
      <LegalFooter />
    </main>
  );
}

export function Login({
  client,
  initialMode = "login",
  onAuthenticated,
  onBack,
}: {
  client: SupabaseClient;
  initialMode?: "login" | "forgot";
  onAuthenticated?: () => void;
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function changeMode(next: "login" | "signup" | "forgot") {
    if (pending.current) return;
    setMode(next);
    setPassword("");
    setMessage("");
    setFailed(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    if (!email.trim()) {
      setFailed(true);
      setMessage("Informe seu e-mail.");
      return;
    }
    if (mode !== "forgot" && password.length < 8) {
      setFailed(true);
      setMessage("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      if (mode === "forgot") {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (!mounted.current) return;
        if (error && error.code !== "user_not_found" && error.code !== "email_not_found") {
          setFailed(true);
          setMessage(
            rateLimited(error)
              ? limitMessage
              : "Não foi possível solicitar o link. Tente novamente em instantes.",
          );
        } else setMessage(recoveryMessage);
        return;
      }
      const credentials = { email: email.trim(), password };
      const result =
        mode === "login"
          ? await client.auth.signInWithPassword(credentials)
          : await client.auth.signUp({
              ...credentials,
              options: { emailRedirectTo: window.location.origin },
            });
      if (!mounted.current) return;
      if (result.error) {
        setFailed(true);
        setMessage(
          rateLimited(result.error)
            ? limitMessage
            : result.error.code === "email_not_confirmed"
              ? "Confirme seu e-mail antes de entrar."
              : mode === "login"
                ? "Não foi possível entrar. Confira e-mail e senha."
                : "Não foi possível criar a conta. Tente novamente ou use uma conta existente.",
        );
      } else if (result.data.session) {
        setPassword("");
        onAuthenticated?.();
      } else if (mode === "signup")
        setMessage("Confira seu e-mail para confirmar a conta e depois entre.");
      else {
        setFailed(true);
        setMessage("Não foi possível entrar. Confira e-mail e senha.");
      }
    } catch {
      if (mounted.current) {
        setFailed(true);
        setMessage("Sem conexão. Confira sua internet e tente novamente.");
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <AccountPanel>
      <div>
        <h2 className="text-lg font-semibold">
          {mode === "forgot"
            ? "Recuperar senha"
            : mode === "login"
              ? "Entrar na sua conta"
              : "Criar conta"}
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          {mode === "forgot"
            ? "Informe seu e-mail para receber um link e definir uma nova senha."
            : "Seus pré-manifestos e conferências salvos, no computador e no celular."}
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <label className="form-field">
          E-mail
          <input
            aria-label="E-mail"
            type="email"
            required
            autoComplete="email"
            disabled={busy}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setMessage("");
              setFailed(false);
            }}
          />
        </label>
        {mode !== "forgot" && (
          <label className="form-field">
            Senha
            <input
              aria-label="Senha"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={busy}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setMessage("");
                setFailed(false);
              }}
            />
          </label>
        )}
        <Button disabled={busy} type="submit">
          {busy
            ? "Aguarde…"
            : mode === "forgot"
              ? "Enviar link de recuperação"
              : mode === "login"
                ? "Entrar"
                : "Criar conta"}
        </Button>
      </form>
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={`text-sm ${failed ? "text-destructive" : ""}`}
        >
          {message}
        </p>
      )}
      {mode === "login" && (
        <Button type="button" variant="ghost" disabled={busy} onClick={() => changeMode("forgot")}>
          Esqueci minha senha
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (mode === "forgot") {
            changeMode("login");
            onBack?.();
          } else changeMode(mode === "login" ? "signup" : "login");
        }}
      >
        {mode === "forgot"
          ? "Voltar para entrar"
          : mode === "login"
            ? "Ainda não tenho conta"
            : "Já tenho conta"}
      </Button>
    </AccountPanel>
  );
}

export function PasswordReset({
  client,
  hasSession,
  email,
  onComplete,
  onRequestLink,
}: {
  client: SupabaseClient;
  hasSession: boolean;
  email?: string | undefined;
  onComplete: () => void;
  onRequestLink: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [expired, setExpired] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!hasSession) {
      setPassword("");
      setConfirmation("");
    }
  }, [hasSession]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !hasSession || expired || success) return;
    setMessage("");
    if (password.length < 8) {
      setMessage("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setMessage("As senhas não coincidem. Confira a confirmação.");
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (!mounted.current) return;
      if (error) {
        if (
          error.status === 401 ||
          error.status === 403 ||
          [
            "session_not_found",
            "session_expired",
            "refresh_token_not_found",
            "refresh_token_already_used",
            "otp_expired",
            "bad_jwt",
          ].includes(error.code ?? "")
        ) {
          setPassword("");
          setConfirmation("");
          setExpired(true);
        } else
          setMessage(
            rateLimited(error)
              ? limitMessage
              : error.code === "same_password"
                ? "Escolha uma senha diferente da senha atual."
                : error.code === "weak_password"
                  ? "Escolha uma senha mais forte e tente novamente."
                  : "Não foi possível atualizar a senha. Tente novamente em instantes.",
          );
      } else {
        setPassword("");
        setConfirmation("");
        setSuccess(true);
      }
    } catch {
      if (mounted.current) setMessage("Sem conexão. Confira sua internet e tente novamente.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!hasSession || expired)
    return (
      <AccountPanel>
        <div>
          <h2 className="text-lg font-semibold">Link inválido ou expirado</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Solicite outro link de recuperação para definir sua nova senha.
          </p>
        </div>
        <Button type="button" onClick={onRequestLink}>
          Solicitar novo link
        </Button>
      </AccountPanel>
    );
  if (success)
    return (
      <AccountPanel>
        <div>
          <h2 className="text-lg font-semibold">Senha atualizada</h2>
          <p className="text-sm text-muted-foreground mt-2" role="status">
            Sua nova senha foi salva. Você já pode continuar na sua conta.
          </p>
        </div>
        <Button type="button" onClick={onComplete}>
          Continuar
        </Button>
      </AccountPanel>
    );
  return (
    <AccountPanel>
      <div>
        <h2 className="text-lg font-semibold">Definir nova senha</h2>
        {email && <p className="text-sm mt-2 break-words">Conta: {email}</p>}
        <p className="text-sm text-muted-foreground mt-2">
          Use pelo menos 8 caracteres e confirme a nova senha.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <label className="form-field">
          Nova senha
          <input
            aria-label="Nova senha"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            disabled={busy}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setMessage("");
            }}
          />
        </label>
        <label className="form-field">
          Confirmar nova senha
          <input
            aria-label="Confirmar nova senha"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            disabled={busy}
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
              setMessage("");
            }}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Aguarde…" : "Salvar nova senha"}
        </Button>
      </form>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </AccountPanel>
  );
}

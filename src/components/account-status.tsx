import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "./ui/button";

export function AccountFeedback({
  message,
  error = false,
  onRetry,
}: {
  message: string;
  error?: boolean;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div
      className={`account-feedback ${error ? "account-feedback-error" : ""}`}
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      aria-busy={!error}
    >
      {error ? (
        <AlertCircle aria-hidden="true" size={24} />
      ) : (
        <Loader2 aria-hidden="true" size={24} className="animate-spin" />
      )}
      <p>{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

type Props = {
  email: string;
  status: string;
  pending: boolean;
  error: string;
  conflict: boolean;
  invitation?: boolean;
  teamView?: boolean;
  signingOut?: boolean;
  signOutError?: string;
  onTeam: () => void;
  onSignOut: () => void;
  onRetry: () => void;
  onReload: () => void;
};
/** Presentation only; persistence and retry decisions remain in TeamSync. */
export function AccountStatusBar({
  email,
  status,
  pending,
  error,
  conflict,
  invitation,
  teamView = false,
  signingOut = false,
  signOutError = "",
  onTeam,
  onSignOut,
  onRetry,
  onReload,
}: Props) {
  return (
    <div className="account-bar">
      <div className="account-identity">
        <span className="account-email">{email}</span>
        <span
          role="status"
          aria-live="polite"
          className={`account-sync-status ${error ? "account-sync-error" : pending ? "account-sync-pending" : "account-sync-saved"}`}
        >
          {error ? (
            <AlertCircle aria-hidden="true" size={14} />
          ) : pending ? (
            <Loader2 aria-hidden="true" size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 aria-hidden="true" size={14} />
          )}
          {status}
        </span>
      </div>
      <Button size="sm" variant="ghost" disabled={signingOut} onClick={onTeam}>
        {teamView ? "Voltar à minha conta" : invitation ? "Equipe · convite" : "Equipe"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || signingOut} onClick={onSignOut}>
        {signingOut ? "Saindo…" : "Sair da conta"}
      </Button>
      {signOutError && (
        <p role="alert" className="account-save-error text-destructive">
          {signOutError}
        </p>
      )}
      {error && (
        <div role="alert" className="account-save-error">
          <AlertCircle aria-hidden="true" size={18} />
          <p>{error}</p>
          {conflict ? (
            <Button size="sm" variant="outline" onClick={onReload}>
              Recarregar dados salvos
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onRetry}>
              {pending ? "Tentar salvar novamente" : "Tentar sincronizar novamente"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { type SupabaseClient, type Session } from "@supabase/supabase-js";
import { AccountFeedback, AccountStatusBar } from "./account-status";
import { ConferenceWorkspace } from "./conference-workspace";
import { getSupabaseClient } from "@/lib/supabase-client";
import type { ConferenceState } from "@/lib/conference-state";
import { AccountPanel, Login, PasswordReset } from "./account-auth";
import { passwordRecoveryLocation, setPasswordRecoveryMarker } from "@/lib/password-recovery";
import {
  isReadOnlyMember,
  isTransientFailure,
  TeamSync,
  teamSchema,
  type TeamSyncView,
} from "@/lib/conference-team";
import { TeamPanel } from "./team-panel";
import { teamRequest } from "@/lib/team-request";
import type { WorkspaceScope } from "@/lib/conference-ownership";
import {
  ARCHIVE_AFTER_DAYS,
  ARCHIVE_EARLY_DAYS,
  ARCHIVE_WARNING_BYTES,
  archiveFinished,
  conferenceBytes,
  findArchived,
  type ArchiveQuery,
} from "@/lib/conference-archive";
import { Button } from "./ui/button";
import { watchErrors } from "@/lib/error-report";

export function AccountWorkspace() {
  const [client, setClient] = useState<SupabaseClient>();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [authScreen, setAuthScreen] = useState<"normal" | "recovery" | "forgot">("normal");
  const [invalidRecoveryLink, setInvalidRecoveryLink] = useState(false);
  const [awaitingRecovery, setAwaitingRecovery] = useState(false);
  const recoveryAccountId = useRef<string | undefined>(undefined);
  const recoveryActive = useRef(false);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let authVersion = 0;
    recoveryAccountId.current = undefined;
    // The SDK can consume the fragment before getSession resolves or its
    // PASSWORD_RECOVERY notification arrives. Capture intent first.
    const recovery = passwordRecoveryLocation(window.location);
    recoveryActive.current = recovery.requested;
    if (recovery.requested) {
      setAuthScreen("recovery");
      setPasswordRecoveryMarker(true, recovery.invalidLink, recovery.requiresVerification);
    }
    setInvalidRecoveryLink(recovery.invalidLink);
    setAwaitingRecovery(recovery.requiresVerification);
    getSupabaseClient()
      .then(async (supabase) => {
        if (!active) return;
        setClient(supabase);
        const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
          if (!active) return;
          authVersion++;
          if (event === "PASSWORD_RECOVERY") {
            recoveryActive.current = true;
            recoveryAccountId.current = next?.user.id;
            setAuthScreen("recovery");
            setInvalidRecoveryLink(false);
            setAwaitingRecovery(false);
            setPasswordRecoveryMarker(true);
          } else if (event === "SIGNED_OUT") {
            recoveryActive.current = false;
            recoveryAccountId.current = undefined;
            setAuthScreen("normal");
            setInvalidRecoveryLink(false);
            setAwaitingRecovery(false);
            setPasswordRecoveryMarker(false);
          } else if (
            recoveryActive.current &&
            next &&
            recoveryAccountId.current &&
            next.user.id !== recoveryAccountId.current
          ) {
            // A sign-in from another tab must not reuse a password typed for the
            // account that opened this recovery link.
            setInvalidRecoveryLink(true);
            setPasswordRecoveryMarker(true, true);
          } else if (
            next &&
            recoveryActive.current &&
            !recovery.requiresVerification &&
            !recoveryAccountId.current
          ) {
            recoveryAccountId.current = next.user.id;
          }
          setSession(next);
        });
        unsubscribe = () => listener.subscription.unsubscribe();
        const initialVersion = authVersion;
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (authVersion === initialVersion) {
          if (error) throw error;
          if (recovery.requested && !recovery.requiresVerification)
            recoveryAccountId.current = data.session?.user.id;
          setSession(data.session);
        }
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setError(
            "Não foi possível conectar à sua conta. Recarregue a página para tentar novamente.",
          );
          setReady(true);
        }
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  if (!ready)
    return (
      <AccountPanel>
        <AccountFeedback message="Conectando à sua conta…" />
      </AccountPanel>
    );
  if (!client || error)
    return (
      <AccountPanel>
        <AccountFeedback error message={error} onRetry={() => window.location.reload()} />
      </AccountPanel>
    );
  const finishAuth = () => {
    recoveryActive.current = false;
    recoveryAccountId.current = undefined;
    setAuthScreen("normal");
    setInvalidRecoveryLink(false);
    setAwaitingRecovery(false);
    setPasswordRecoveryMarker(false);
  };
  if (authScreen === "recovery")
    return (
      <PasswordReset
        key={session?.user.id ?? "no-session"}
        client={client}
        hasSession={!!session && !invalidRecoveryLink && !awaitingRecovery}
        email={session?.user.email}
        onComplete={finishAuth}
        onRequestLink={() => {
          recoveryActive.current = false;
          recoveryAccountId.current = undefined;
          setPasswordRecoveryMarker(false);
          setInvalidRecoveryLink(false);
          setAwaitingRecovery(false);
          setAuthScreen("forgot");
        }}
      />
    );
  if (!session || authScreen === "forgot")
    return (
      <Login
        client={client}
        initialMode={authScreen === "forgot" ? "forgot" : "login"}
        onAuthenticated={finishAuth}
        onBack={finishAuth}
      />
    );
  return <SavedWorkspace key={session.user.id} client={client} session={session} />;
}

function SavedWorkspace({ client, session }: { client: SupabaseClient; session: Session }) {
  const [view, setView] = useState<TeamSyncView>();
  const [loadError, setLoadError] = useState("");
  const [notInvited, setNotInvited] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [scope, setScope] = useState<WorkspaceScope>("mine");
  const [auditPre, setAuditPre] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const signOutPending = useRef(false);
  const sync = useRef<TeamSync | undefined>(undefined);
  const [archiving, setArchiving] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState("");
  const request = useCallback(
    (name: string, args: Record<string, unknown>) => teamRequest(client, name, args),
    [client],
  );
  // Uncaught browser errors go to the database log (report_client_error).
  useEffect(() => watchErrors(request), [request]);
  const lookupArchive = useCallback(
    (query: ArchiveQuery) => findArchived(request, query),
    [request],
  );
  useEffect(() => {
    let active = true;
    // A cold server or a brief network drop must not greet the user with an error:
    // retry transient failures twice (2 s, then 5 s) before showing one.
    const load = async (): Promise<{ data: unknown; error: { message?: string } | null }> => {
      for (const wait of [2000, 5000, 0]) {
        try {
          const result = await teamRequest(client, "get_conference_team", {
            accept_invitation: false,
          });
          if (!result.error || !wait || !isTransientFailure(result.error.message ?? ""))
            return result;
        } catch (error) {
          if (!wait || !isTransientFailure(String((error as Error)?.message ?? error))) throw error;
        }
        await new Promise((done) => setTimeout(done, wait));
        if (!active) break;
      }
      return { data: null, error: { message: "cancelled" } };
    };
    load()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          if (/CONFERENCE_NOT_INVITED/.test(error.message ?? "")) setNotInvited(true);
          else
            setLoadError("Não foi possível carregar seus cadastros. Nenhum dado foi substituído.");
          return;
        }
        const parsed = teamSchema.safeParse(data);
        if (!parsed.success) {
          setLoadError("Os dados salvos precisam de revisão. Nenhum dado foi substituído.");
          return;
        }
        sync.current = new TeamSync(parsed.data, request, (next) => {
          if (active) setView(next);
        });
        setView({
          team: parsed.data,
          state: parsed.data.data,
          status: "Todos os dados salvos",
          error: "",
          conflict: false,
          pending: false,
        });
        // Keep the live row small: finished manifests leave it after a waiting
        // period. Idempotent on the server; the next poll picks up the change.
        archiveFinished(request, ARCHIVE_AFTER_DAYS).catch(() => {});
      })
      .catch(() => {
        if (active)
          setLoadError("Sem conexão com o banco. Tente novamente; nenhum dado foi substituído.");
      });
    const refresh = () => {
      if (document.visibilityState === "visible") void sync.current?.refresh();
    };
    const timer = window.setInterval(refresh, 2000);
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (sync.current?.pending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventLoss);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      sync.current?.stop();
      sync.current = undefined;
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", preventLoss);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [client, request, session.user.id]);
  function changed(snapshot: ConferenceState) {
    sync.current?.change(snapshot);
  }
  async function archiveEarly() {
    if (archiving) return;
    setArchiving(true);
    setArchiveMessage("");
    try {
      const moved = await archiveFinished(request, ARCHIVE_EARLY_DAYS);
      setArchiveMessage(
        moved
          ? `${moved} pré(s) finalizado(s) arquivado(s). Eles continuam disponíveis no Rastreamento.`
          : `Nenhum pré finalizado há mais de ${ARCHIVE_EARLY_DAYS} dias para arquivar.`,
      );
      void sync.current?.refresh(true);
    } catch {
      setArchiveMessage("Não foi possível arquivar agora. Tente novamente em instantes.");
    } finally {
      setArchiving(false);
    }
  }
  async function signOut() {
    if (signOutPending.current || sync.current?.pending()) return;
    signOutPending.current = true;
    setSigningOut(true);
    setSignOutError("");
    try {
      const result = await client.auth.signOut();
      if (result?.error) throw result.error;
    } catch {
      setSignOutError("Não foi possível sair da conta. Confira sua conexão e tente novamente.");
    } finally {
      signOutPending.current = false;
      setSigningOut(false);
    }
  }
  if (notInvited)
    return (
      <AccountPanel>
        <div className="grid gap-3 text-sm" role="status">
          <strong>Sua conta ainda não tem acesso</strong>
          <p className="text-muted-foreground">
            O confere. funciona por convite. Peça ao responsável pela sua equipe para incluir o
            e-mail <strong>{session.user.email}</strong> em Equipe e depois entre de novo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => window.location.reload()}>
              Já fui convidado
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void signOut()}>
              Sair da conta
            </Button>
          </div>
        </div>
      </AccountPanel>
    );
  if (loadError)
    return (
      <AccountPanel>
        <AccountFeedback error message={loadError} onRetry={() => window.location.reload()} />
      </AccountPanel>
    );
  if (!view)
    return (
      <AccountPanel>
        <AccountFeedback message="Carregando seus cadastros…" />
      </AccountPanel>
    );
  const liveBytes = conferenceBytes(view.state);
  return (
    <div className="account-shell">
      <div className="account-top">
        <AccountStatusBar
          email={session.user.email || ""}
          status={view.status}
          pending={view.pending}
          error={view.error}
          conflict={view.conflict}
          reconnecting={view.reconnecting === true}
          invitation={!!view.team.invitation}
          teamView={scope === "team"}
          onTeam={() => {
            setScope((current) => (current === "team" ? "mine" : "team"));
            if (view.team.invitation) {
              setAuditPre("");
              setTeamOpen(true);
            }
            void sync.current?.refresh(true);
          }}
          signingOut={signingOut}
          signOutError={signOutError}
          onSignOut={() => void signOut()}
          onRetry={() => sync.current?.retry()}
          onReload={() => window.location.reload()}
        />
        {liveBytes > ARCHIVE_WARNING_BYTES && (
          <div className="archive-warning" role="status">
            <div>
              <strong>
                Os cadastros em andamento estão perto do limite do banco (
                {(liveBytes / 1_000_000).toFixed(1).replace(".", ",")} de 5 MB).
              </strong>
              <p>
                Prés finalizados há mais de {ARCHIVE_AFTER_DAYS} dias são arquivados
                automaticamente. Para liberar espaço agora, arquive os finalizados há mais de{" "}
                {ARCHIVE_EARLY_DAYS} dias; eles continuam consultáveis no Rastreamento.
              </p>
              {archiveMessage && <p>{archiveMessage}</p>}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={archiving}
              onClick={() => void archiveEarly()}
            >
              {archiving
                ? "Arquivando…"
                : `Arquivar finalizados há mais de ${ARCHIVE_EARLY_DAYS} dias`}
            </Button>
          </div>
        )}
      </div>
      <div className="account-workspace-content" inert={signingOut || undefined}>
        <ConferenceWorkspace
          initialState={view.state}
          externalState={view.state}
          onSnapshot={changed}
          accountEmail={session.user.email || ""}
          accountId={session.user.id}
          sharedDemands={view.team.sharedDemands === true}
          personalReceipts={view.team.personalReceipts === true}
          scope={scope}
          onScopeChange={setScope}
          onManageTeam={() => {
            setAuditPre("");
            setTeamOpen(true);
            void sync.current?.refresh(true);
          }}
          onAuditManifest={(id) => {
            setAuditPre(id);
            setTeamOpen(true);
          }}
          findArchived={lookupArchive}
          readOnly={isReadOnlyMember(view.team)}
          importFilter={view.team.settings}
        />
      </div>
      <TeamPanel
        client={client}
        team={view.team}
        open={teamOpen}
        onOpenChange={setTeamOpen}
        onRefresh={() => void sync.current?.refresh(true)}
        selectedPre={auditPre}
        canJoin={!view.pending}
        accountId={session.user.id}
      />
    </div>
  );
}

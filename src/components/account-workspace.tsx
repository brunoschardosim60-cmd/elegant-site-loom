import { useEffect, useRef, useState } from "react";
import { type SupabaseClient, type Session } from "@supabase/supabase-js";
import { AccountFeedback, AccountStatusBar } from "./account-status";
import { ConferenceWorkspace } from "./conference-workspace";
import { getSupabaseClient } from "@/lib/supabase-client";
import type { ConferenceState } from "@/lib/conference-state";
import { AccountPanel, Login, PasswordReset } from "./account-auth";
import { passwordRecoveryLocation, setPasswordRecoveryMarker } from "@/lib/password-recovery";
import { TeamSync, teamSchema, type TeamSyncView } from "@/lib/conference-team";
import { TeamPanel } from "./team-panel";
import { teamRequest } from "@/lib/team-request";
import type { WorkspaceScope } from "@/lib/conference-ownership";

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
  const [teamOpen, setTeamOpen] = useState(false);
  const [scope, setScope] = useState<WorkspaceScope>("mine");
  const [auditPre, setAuditPre] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const signOutPending = useRef(false);
  const sync = useRef<TeamSync | undefined>(undefined);
  useEffect(() => {
    let active = true;
    Promise.resolve(teamRequest(client, "get_conference_team", { accept_invitation: false }))
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setLoadError("Não foi possível carregar seus cadastros. Nenhum dado foi substituído.");
          return;
        }
        const parsed = teamSchema.safeParse(data);
        if (!parsed.success) {
          setLoadError("Os dados salvos precisam de revisão. Nenhum dado foi substituído.");
          return;
        }
        sync.current = new TeamSync(
          parsed.data,
          (name, args) => teamRequest(client, name, args),
          (next) => {
            if (active) setView(next);
          },
        );
        setView({
          team: parsed.data,
          state: parsed.data.data,
          status: "Todos os dados salvos",
          error: "",
          conflict: false,
          pending: false,
        });
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
  }, [client, session.user.id]);
  function changed(snapshot: ConferenceState) {
    sync.current?.change(snapshot);
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
  return (
    <div className="account-shell">
      <AccountStatusBar
        email={session.user.email || ""}
        status={view.status}
        pending={view.pending}
        error={view.error}
        conflict={view.conflict}
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
      <div className="account-workspace-content" inert={signingOut || undefined}>
        <ConferenceWorkspace
          initialState={view.state}
          externalState={view.state}
          onSnapshot={changed}
          accountEmail={session.user.email || ""}
          accountId={session.user.id}
          sharedDemands={view.team.sharedDemands === true}
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
      />
    </div>
  );
}

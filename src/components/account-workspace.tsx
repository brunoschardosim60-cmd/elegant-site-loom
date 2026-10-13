import { useEffect, useRef, useState } from 'react';
import { type SupabaseClient, type Session } from '@supabase/supabase-js';
import { Button } from './ui/button';
import { ConferenceWorkspace } from './conference-workspace';
import { getSupabaseClient } from '@/lib/supabase-client';
import type { ConferenceState } from '@/lib/conference-state';
import { AccountPanel, Login, PasswordReset } from './account-auth';
import { passwordRecoveryLocation, setPasswordRecoveryMarker } from '@/lib/password-recovery';
import { TeamSync, teamSchema, type TeamSyncView } from '@/lib/conference-team';
import { TeamPanel } from './team-panel';
import { teamRequest } from '@/lib/team-request';

export function AccountWorkspace() {
  const [client, setClient] = useState<SupabaseClient>();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [authScreen, setAuthScreen] = useState<'normal' | 'recovery' | 'forgot'>('normal');
  const [invalidRecoveryLink, setInvalidRecoveryLink] = useState(false);
  const [awaitingRecovery, setAwaitingRecovery] = useState(false);
  const recoveryAccountId = useRef<string | undefined>(undefined);
  const recoveryActive = useRef(false);
  useEffect(() => {
    let active = true; let unsubscribe: (() => void) | undefined;
    let authVersion = 0;
    recoveryAccountId.current = undefined;
    // The SDK can consume the fragment before getSession resolves or its
    // PASSWORD_RECOVERY notification arrives. Capture intent first.
    const recovery = passwordRecoveryLocation(window.location);
    recoveryActive.current = recovery.requested;
    if (recovery.requested) { setAuthScreen('recovery'); setPasswordRecoveryMarker(true, recovery.invalidLink, recovery.requiresVerification); }
    setInvalidRecoveryLink(recovery.invalidLink);
    setAwaitingRecovery(recovery.requiresVerification);
    getSupabaseClient().then(async supabase => {
      if (!active) return;
      setClient(supabase);
      const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
        if (!active) return;
        authVersion++;
        if (event === 'PASSWORD_RECOVERY') {
          recoveryActive.current = true;
          recoveryAccountId.current = next?.user.id;
          setAuthScreen('recovery'); setInvalidRecoveryLink(false); setAwaitingRecovery(false); setPasswordRecoveryMarker(true);
        } else if (event === 'SIGNED_OUT') {
          recoveryActive.current = false;
          recoveryAccountId.current = undefined;
          setAuthScreen('normal'); setInvalidRecoveryLink(false); setAwaitingRecovery(false); setPasswordRecoveryMarker(false);
        } else if (recoveryActive.current && next && recoveryAccountId.current && next.user.id !== recoveryAccountId.current) {
          // A sign-in from another tab must not reuse a password typed for the
          // account that opened this recovery link.
          setInvalidRecoveryLink(true); setPasswordRecoveryMarker(true, true);
        } else if (next && recoveryActive.current && !recovery.requiresVerification && !recoveryAccountId.current) {
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
        if (recovery.requested && !recovery.requiresVerification) recoveryAccountId.current = data.session?.user.id;
        setSession(data.session);
      }
      setReady(true);
    }).catch(() => { if (active) { setError('Não foi possível conectar à sua conta. Recarregue a página para tentar novamente.'); setReady(true); } });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  if (!ready) return <AccountPanel><p>Conectando à sua conta…</p></AccountPanel>;
  if (!client || error) return <AccountPanel><p role="alert">{error}</p><Button onClick={() => window.location.reload()}>Tentar novamente</Button></AccountPanel>;
  const finishAuth = () => { recoveryActive.current = false; recoveryAccountId.current = undefined; setAuthScreen('normal'); setInvalidRecoveryLink(false); setAwaitingRecovery(false); setPasswordRecoveryMarker(false); };
  if (authScreen === 'recovery') return <PasswordReset key={session?.user.id ?? 'no-session'} client={client} hasSession={!!session && !invalidRecoveryLink && !awaitingRecovery} email={session?.user.email} onComplete={finishAuth} onRequestLink={() => { recoveryActive.current = false; recoveryAccountId.current = undefined; setPasswordRecoveryMarker(false); setInvalidRecoveryLink(false); setAwaitingRecovery(false); setAuthScreen('forgot'); }} />;
  if (!session || authScreen === 'forgot') return <Login client={client} initialMode={authScreen === 'forgot' ? 'forgot' : 'login'} onAuthenticated={finishAuth} onBack={finishAuth} />;
  return <SavedWorkspace key={session.user.id} client={client} session={session} />;
}

function SavedWorkspace({ client, session }: { client: SupabaseClient; session: Session }) {
  const [view, setView] = useState<TeamSyncView>();
  const [loadError, setLoadError] = useState('');
  const [teamOpen, setTeamOpen] = useState(false); const [auditPre, setAuditPre] = useState('');
  const sync = useRef<TeamSync | undefined>(undefined);
  useEffect(() => {
    let active = true;
    Promise.resolve(teamRequest(client, 'get_conference_team', { accept_invitation: false })).then(({ data, error }) => {
      if (!active) return;
      if (error) { setLoadError('Não foi possível carregar seus cadastros. Nenhum dado foi substituído.'); return; }
      const parsed = teamSchema.safeParse(data);
      if (!parsed.success) { setLoadError('Os dados salvos precisam de revisão. Nenhum dado foi substituído.'); return; }
      sync.current = new TeamSync(parsed.data, (name, args) => teamRequest(client, name, args), next => { if (active) setView(next); });
      setView({ team: parsed.data, state: parsed.data.data, status: 'Todos os dados salvos', error: '', conflict: false, pending: false });
    }).catch(() => { if (active) setLoadError('Sem conexão com o banco. Tente novamente; nenhum dado foi substituído.'); });
    const refresh = () => { if (document.visibilityState === 'visible') void sync.current?.refresh(); };
    const timer = window.setInterval(refresh, 2000);
    const preventLoss = (event: BeforeUnloadEvent) => { if (sync.current?.pending()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventLoss);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { active = false; sync.current?.stop(); sync.current = undefined; window.clearInterval(timer); window.removeEventListener('beforeunload', preventLoss); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [client, session.user.id]);
  function changed(snapshot: ConferenceState) { sync.current?.change(snapshot); }
  if (loadError) return <AccountPanel><p role="alert">{loadError}</p><Button onClick={() => window.location.reload()}>Tentar novamente</Button></AccountPanel>;
  if (!view) return <AccountPanel><p>Carregando seus cadastros…</p></AccountPanel>;
  return <div className="account-shell"><div className="account-bar"><span className="account-identity">{session.user.email} · <span role="status">{view.status}</span></span><Button size="sm" variant="ghost" onClick={() => { setAuditPre(''); setTeamOpen(true); void sync.current?.refresh(true); }}>{view.team.invitation ? 'Equipe · convite' : 'Equipe'}</Button><Button size="sm" variant="ghost" disabled={view.pending} onClick={() => void client.auth.signOut()}>Sair da conta</Button>{view.error && <div role="alert" className="account-save-error text-destructive">{view.error} {view.conflict ? <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Recarregar dados salvos</Button> : <Button size="sm" variant="outline" onClick={() => sync.current?.retry()}>Tentar salvar novamente</Button>}</div>}</div><ConferenceWorkspace initialState={view.state} externalState={view.state} onSnapshot={changed} accountEmail={session.user.email || ''} onAuditManifest={id => { setAuditPre(id); setTeamOpen(true); }} /><TeamPanel client={client} team={view.team} open={teamOpen} onOpenChange={setTeamOpen} onRefresh={() => void sync.current?.refresh(true)} selectedPre={auditPre} canJoin={!view.pending} /></div>;
}

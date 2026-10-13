import { useEffect, useRef, useState } from 'react';
import { type SupabaseClient, type Session } from '@supabase/supabase-js';
import { Button } from './ui/button';
import { ConferenceWorkspace } from './conference-workspace';
import { getSupabaseClient } from '@/lib/supabase-client';
import { conferenceStateSchema, emptyConference, type ConferenceState } from '@/lib/conference-state';
import { AccountPanel, Login, PasswordReset } from './account-auth';
import { passwordRecoveryLocation, setPasswordRecoveryMarker } from '@/lib/password-recovery';

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
  const [initial, setInitial] = useState<ConferenceState>();
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState('Todos os dados salvos');
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const revision = useRef(0); const latest = useRef<ConferenceState | undefined>(undefined);
  const saved = useRef(''); const saving = useRef(false); const failed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    Promise.resolve(client.from('conference_states').select('data,revision').eq('user_id', session.user.id).maybeSingle()).then(({ data, error }) => {
      if (!mounted.current) return;
      if (error) { setLoadError('Não foi possível carregar seus cadastros. Nenhum dado foi substituído.'); return; }
      const parsed = conferenceStateSchema.safeParse(data?.data ?? emptyConference);
      if (!parsed.success) { setLoadError('Os dados salvos precisam de revisão. Nenhum dado foi substituído.'); return; }
      revision.current = data?.revision ?? 0; saved.current = JSON.stringify(parsed.data); latest.current = parsed.data; setInitial(parsed.data);
    }).catch(() => { if (mounted.current) setLoadError('Sem conexão com o banco. Tente novamente; nenhum dado foi substituído.'); });
    const preventLoss = (event: BeforeUnloadEvent) => { if (saving.current || failed.current || (latest.current && JSON.stringify(latest.current) !== saved.current)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventLoss);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', preventLoss); };
  }, [client, session.user.id]);
  async function flush() {
    if (saving.current || failed.current || !latest.current) return;
    saving.current = true; setStatus('Salvando…');
    try {
      while (latest.current && JSON.stringify(latest.current) !== saved.current) {
        const snapshot = latest.current; const encoded = JSON.stringify(snapshot);
        const { data, error } = await client.rpc('save_conference', { expected_revision: revision.current, next_data: snapshot });
        if (error) throw error;
        revision.current = Number(data); saved.current = encoded;
      }
      if (mounted.current) { setStatus('Todos os dados salvos'); setSaveError(''); }
    } catch (error) {
      failed.current = true;
      if (mounted.current) {
        const collision = String((error as { message?: string }).message).includes('CONFERENCE_CONFLICT');
        setConflict(collision); setStatus('Alterações ainda não salvas');
        setSaveError(collision ? 'Outro dispositivo salvou alterações. Gere o PDF desta página antes de recarregar para guardar uma cópia das alterações locais.' : 'Não foi possível salvar. Mantenha esta página aberta e tente novamente.');
      }
    } finally { saving.current = false; }
  }
  function changed(snapshot: ConferenceState) { latest.current = snapshot; void flush(); }
  if (loadError) return <AccountPanel><p role="alert">{loadError}</p><Button onClick={() => window.location.reload()}>Tentar novamente</Button></AccountPanel>;
  if (!initial) return <AccountPanel><p>Carregando seus cadastros…</p></AccountPanel>;
  return <div className="account-shell"><div className="account-bar"><span className="account-identity">{session.user.email} · <span role="status">{status}</span></span><Button size="sm" variant="ghost" disabled={status !== 'Todos os dados salvos'} onClick={() => void client.auth.signOut()}>Sair da conta</Button>{saveError && <div role="alert" className="account-save-error text-destructive">{saveError} {conflict ? <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Recarregar dados salvos</Button> : <Button size="sm" variant="outline" onClick={() => { failed.current = false; void flush(); }}>Tentar salvar novamente</Button>}</div>}</div><ConferenceWorkspace initialState={initial} onSnapshot={changed} accountEmail={session.user.email || ''} /></div>;
}

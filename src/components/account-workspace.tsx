import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type SupabaseClient, type Session } from '@supabase/supabase-js';
import { Button } from './ui/button';
import { ConferenceWorkspace } from './conference-workspace';
import { getSupabaseClient } from '@/lib/supabase-client';
import { conferenceStateSchema, emptyConference, type ConferenceState } from '@/lib/conference-state';

export function AccountWorkspace() {
  const [client, setClient] = useState<SupabaseClient>();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let unsubscribe: (() => void) | undefined;
    getSupabaseClient().then(async supabase => {
      if (!active) return;
      setClient(supabase);
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!active) return;
      setSession(data.session); setReady(true);
      const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { if (active) setSession(next); });
      unsubscribe = () => listener.subscription.unsubscribe();
    }).catch(() => { if (active) { setError('Não foi possível conectar à sua conta. Recarregue a página para tentar novamente.'); setReady(true); } });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  if (!ready) return <AccountPanel><p>Conectando à sua conta…</p></AccountPanel>;
  if (!client || error) return <AccountPanel><p role="alert">{error}</p><Button onClick={() => window.location.reload()}>Tentar novamente</Button></AccountPanel>;
  if (!session) return <Login client={client} />;
  return <SavedWorkspace key={session.user.id} client={client} session={session} />;
}

function AccountPanel({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh flex items-center justify-center bg-background p-5"><section className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm grid gap-5"><h1 className="text-3xl font-bold text-primary">confere.</h1>{children}</section></main>;
}

function Login({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const credentials = { email: email.trim(), password };
      const result = mode === 'login' ? await client.auth.signInWithPassword(credentials) : await client.auth.signUp({ ...credentials, options: { emailRedirectTo: window.location.origin } });
      if (result.error) {
        setMessage(result.error.code === 'email_not_confirmed' ? 'Confirme seu e-mail antes de entrar.' : mode === 'login' ? 'Não foi possível entrar. Confira e-mail e senha.' : 'Não foi possível criar a conta. Tente novamente ou use uma conta existente.');
      } else if (mode === 'signup' && !result.data.session) setMessage('Confira seu e-mail para confirmar a conta e depois entre.');
    } catch { setMessage('Sem conexão. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <AccountPanel><div><h2 className="text-lg font-semibold">{mode === 'login' ? 'Entrar na sua conta' : 'Criar conta'}</h2><p className="text-sm text-muted-foreground mt-2">Seus pré-manifestos e conferências salvos, no computador e no celular.</p></div><form onSubmit={submit} className="grid gap-4"><label className="form-field">E-mail<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label><label className="form-field">Senha<input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label><Button disabled={busy} type="submit">{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</Button></form>{message && <p role="status" className="text-sm">{message}</p>}<Button variant="ghost" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); setPassword(''); }}>{mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta'}</Button></AccountPanel>;
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

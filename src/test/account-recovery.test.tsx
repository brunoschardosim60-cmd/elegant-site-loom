import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountWorkspace } from '@/components/account-workspace';

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;
const mocks = vi.hoisted(() => ({
  getClient: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn(), unsubscribe: vi.fn(),
  read: vi.fn(), from: vi.fn(), rpc: vi.fn(), signOut: vi.fn(), resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(), signUp: vi.fn(), updateUser: vi.fn(),
  listener: undefined as AuthListener | undefined,
}));
vi.mock('@/lib/supabase-client', () => ({ getSupabaseClient: mocks.getClient }));
vi.mock('@/components/conference-workspace', () => ({
  ConferenceWorkspace: () => <main aria-label="Conferência carregada">Conferência carregada</main>,
}));

const session = { user: { id: 'recovery-user', email: 'recovery@example.test' } } as Session;
const client = {
  auth: {
    getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange,
    signOut: mocks.signOut, resetPasswordForEmail: mocks.resetPasswordForEmail,
    signInWithPassword: mocks.signInWithPassword, signUp: mocks.signUp, updateUser: mocks.updateUser,
  },
  from: mocks.from, rpc: mocks.rpc,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function expectNoConferenceAccess() {
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(screen.queryByRole('main', { name: 'Conferência carregada' })).not.toBeInTheDocument();
}
async function emit(event: AuthChangeEvent, value: Session | null) {
  await act(async () => { mocks.listener?.(event, value); });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listener = undefined;
  window.history.replaceState(null, '', '/');
  mocks.getClient.mockResolvedValue(client);
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  mocks.onAuthStateChange.mockImplementation((listener: AuthListener) => {
    mocks.listener = listener;
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) });
  mocks.read.mockResolvedValue({ data: { revision: 0, data: { manifests: [], activity: [], issues: [] } }, error: null });
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.updateUser.mockResolvedValue({ data: { user: session.user }, error: null });
});
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

it('captures the recovery hash before client initialization clears it but waits for token confirmation', async () => {
  window.history.replaceState(null, '', '/#type=recovery&access_token=synthetic-access&refresh_token=synthetic-refresh');
  mocks.getClient.mockImplementation(async () => {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, '', url);
    return client;
  });
  render(<AccountWorkspace />);
  expect(await screen.findByRole('button', { name: 'Solicitar novo link' })).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('recovery')).toBe('pending');
  expect(window.location.href).not.toContain('synthetic-access');
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  expectNoConferenceAccess();
  expect(mocks.updateUser).not.toHaveBeenCalled();
  expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  await emit('PASSWORD_RECOVERY', session);
  expect(await screen.findByRole('heading', { name: 'Definir nova senha' })).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('recovery')).toBe('1');
  expectNoConferenceAccess();
});

it('does not allow an invalid recovery token to use an older signed-in session', async () => {
  window.history.replaceState(null, '', '/#type=recovery&access_token=invalid-token&refresh_token=invalid-refresh');
  render(<AccountWorkspace />);
  expect(await screen.findByRole('button', { name: 'Solicitar novo link' })).toBeInTheDocument();
  await emit('INITIAL_SESSION', session);
  await emit('SIGNED_IN', session);
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  expectNoConferenceAccess();
  expect(mocks.updateUser).not.toHaveBeenCalled();
  expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
});

it('keeps unconfirmed recovery pending after refresh despite an older signed-in session', async () => {
  window.history.replaceState(null, '', '/?recovery=pending');
  render(<AccountWorkspace />);
  expect(await screen.findByRole('button', { name: 'Solicitar novo link' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get('recovery')).toBe('pending');
  expectNoConferenceAccess();
  expect(mocks.updateUser).not.toHaveBeenCalled();
});

it('keeps password recovery after a reload with only the harmless URL marker and a valid session', async () => {
  window.history.replaceState(null, '', '/?recovery=1');
  render(<AccountWorkspace />);
  expect(await screen.findByRole('heading', { name: 'Definir nova senha' })).toBeInTheDocument();
  expectNoConferenceAccess();
});

it('requests a fresh link when the recovery URL has no session without sending mail automatically', async () => {
  window.history.replaceState(null, '', '/?recovery=1');
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(<AccountWorkspace />);
  const requestLink = await screen.findByRole('button', { name: 'Solicitar novo link' });
  expectNoConferenceAccess();
  expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  fireEvent.click(requestLink);
  expect(await screen.findByRole('textbox', { name: 'E-mail' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  expectNoConferenceAccess();
  expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
});

it('subscribes before getSession and lets PASSWORD_RECOVERY override a stale null session result', async () => {
  const initial = deferred<{ data: { session: Session | null }; error: null }>();
  mocks.getSession.mockImplementationOnce(() => {
    expect(mocks.listener).toBeDefined();
    return initial.promise;
  });
  render(<AccountWorkspace />);
  await waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce());
  await emit('PASSWORD_RECOVERY', session);
  await act(async () => { initial.resolve({ data: { session: null }, error: null }); });
  expect(await screen.findByRole('heading', { name: 'Definir nova senha' })).toBeInTheDocument();
  expectNoConferenceAccess();
});

it('keeps a valid recovery event when the older getSession request later reports an error', async () => {
  const initial = deferred<{ data: { session: null }; error: { message: string } }>();
  mocks.getSession.mockReturnValueOnce(initial.promise);
  render(<AccountWorkspace />);
  await waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce());
  await emit('PASSWORD_RECOVERY', session);
  await act(async () => { initial.resolve({ data: { session: null }, error: { message: 'Synthetic stale session error' } }); });
  expect(await screen.findByRole('heading', { name: 'Definir nova senha' })).toBeInTheDocument();
  expectNoConferenceAccess();
});

it('preserves recovery and entered fields when SIGNED_IN or USER_UPDATED keeps the same account', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(<AccountWorkspace />);
  await screen.findByRole('heading', { name: 'Entrar na sua conta' });
  await emit('PASSWORD_RECOVERY', session);
  await screen.findByRole('heading', { name: 'Definir nova senha' });
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'SyntheticPassword123' } });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'SyntheticPassword123' } });
  await emit('SIGNED_IN', session);
  await emit('USER_UPDATED', session);
  expect(screen.getByRole('heading', { name: 'Definir nova senha' })).toBeInTheDocument();
  expect(screen.getByLabelText('Nova senha')).toHaveValue('SyntheticPassword123');
  expect(screen.getByLabelText('Confirmar nova senha')).toHaveValue('SyntheticPassword123');
  expectNoConferenceAccess();
});

it('invalidates recovery and clears entered passwords when SIGNED_IN changes the account', async () => {
  const anotherSession = { user: { id: 'different-user', email: 'different@example.test' } } as Session;
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(<AccountWorkspace />);
  await screen.findByRole('heading', { name: 'Entrar na sua conta' });
  await emit('PASSWORD_RECOVERY', session);
  await screen.findByRole('heading', { name: 'Definir nova senha' });
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'SyntheticPassword123' } });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'SyntheticPassword123' } });
  await emit('SIGNED_IN', anotherSession);
  expect(await screen.findByRole('button', { name: 'Solicitar novo link' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  expectNoConferenceAccess();
  expect(mocks.updateUser).not.toHaveBeenCalled();
  await emit('PASSWORD_RECOVERY', anotherSession);
  expect(await screen.findByRole('heading', { name: 'Definir nova senha' })).toBeInTheDocument();
  expect(screen.getByLabelText('Nova senha')).toHaveValue('');
  expect(screen.getByLabelText('Confirmar nova senha')).toHaveValue('');
  expectNoConferenceAccess();
});

it('treats an expired recovery callback as invalid even when an older account session exists', async () => {
  window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=Synthetic+expired+link');
  render(<AccountWorkspace />);
  expect(await screen.findByRole('button', { name: 'Solicitar novo link' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Definir nova senha' })).not.toBeInTheDocument();
  expectNoConferenceAccess();
  expect(mocks.updateUser).not.toHaveBeenCalled();
  expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
});

it('keeps an invalid recovery callback invalid after refresh with an older signed-in session', async () => {
  window.history.replaceState(null, '', '/?recovery=invalid');
  render(<AccountWorkspace />);
  expect(await screen.findByRole('heading', { name: 'Link inválido ou expirado' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Solicitar novo link' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument();
  expectNoConferenceAccess();
  expect(mocks.updateUser).not.toHaveBeenCalled();
});

it('loads saved records only after a successful password change is explicitly completed', async () => {
  window.history.replaceState(null, '', '/?recovery=1');
  render(<AccountWorkspace />);
  await screen.findByRole('heading', { name: 'Definir nova senha' });
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'SyntheticPassword123' } });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'SyntheticPassword123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
  await screen.findByRole('heading', { name: 'Senha atualizada' });
  expectNoConferenceAccess();
  expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'SyntheticPassword123' });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(await screen.findByRole('main', { name: 'Conferência carregada' })).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).has('recovery')).toBe(false);
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('still reports a genuine initial session error when no newer auth event exists', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Synthetic connection failure' } });
  render(<AccountWorkspace />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar à sua conta');
  expectNoConferenceAccess();
});

it('loads the normal saved workspace when there is no recovery event or URL marker', async () => {
  render(<AccountWorkspace />);
  expect(await screen.findByRole('main', { name: 'Conferência carregada' })).toBeInTheDocument();
  expect(mocks.from).toHaveBeenCalledExactlyOnceWith('conference_states');
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Definir nova senha' })).not.toBeInTheDocument();
});

it('loads records after a normal SIGNED_IN event without entering recovery', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(<AccountWorkspace />);
  await screen.findByRole('heading', { name: 'Entrar na sua conta' });
  expectNoConferenceAccess();
  await emit('SIGNED_IN', session);
  expect(await screen.findByRole('main', { name: 'Conferência carregada' })).toBeInTheDocument();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('unsubscribes and ignores delayed session or recovery callbacks after unmount', async () => {
  const initial = deferred<{ data: { session: Session | null }; error: null }>();
  mocks.getSession.mockReturnValue(initial.promise);
  const rendered = render(<AccountWorkspace />);
  await waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce());
  const listener = mocks.listener;
  rendered.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  await act(async () => {
    listener?.('PASSWORD_RECOVERY', session);
    initial.resolve({ data: { session }, error: null });
  });
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(window.location.search).toBe('');
});

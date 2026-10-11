import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountWorkspace } from '@/components/account-workspace';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/supabase-client', () => ({ getSupabaseClient: async () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: 'account-a', email: 'account@example.com' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }), signOut: mocks.signOut },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }), rpc: mocks.rpc,
}) }));
vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: async () => ({ configured: true }) }));
vi.mock('@/lib/divergence.functions', () => ({ analyzeDivergence: vi.fn() }));
const saved = { manifests: [{ id: 'DI00123456789', driver: 'Teste', plate: 'ABC1234', date: '2026-10-11', documents: [{ id: 'doc', ctc: '0000000001', nf: '123-1', volumes: 2, received: false }] }], activity: [], issues: [] };
beforeEach(() => { mocks.read.mockResolvedValue({ data: { revision: 7, data: saved }, error: null }); mocks.rpc.mockResolvedValue({ data: 8, error: null }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('restores saved records and only saves changes with the loaded revision', async () => {
  render(<AccountWorkspace />);
  const button = await screen.findByRole('button', { name: 'Marcar CTC 0000000001 como recebido' });
  expect(mocks.rpc).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0]?.[1].expected_revision).toBe(7);
  expect(mocks.rpc.mock.calls[0]?.[1].next_data.manifests[0].documents[0].received).toBe(true);
  await screen.findByText('Todos os dados salvos');
});
it('keeps unsaved changes visible and retries after a save failure', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { message: 'network' } }).mockResolvedValueOnce({ data: 8, error: null });
  render(<AccountWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'Marcar CTC 0000000001 como recebido' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Tentar salvar novamente' }));
  await screen.findByText('Todos os dados salvos');
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc.mock.calls[1]?.[1].expected_revision).toBe(7);
});
it('blocks a stale device from silently overwriting another revision', async () => {
  mocks.rpc.mockResolvedValue({ error: { message: 'CONFERENCE_CONFLICT' } });
  render(<AccountWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'Marcar CTC 0000000001 como recebido' }));
  expect(await screen.findByRole('button', { name: 'Recarregar dados salvos' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tentar salvar novamente' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sair da conta' })).toBeDisabled();
});
it('never replaces saved data with an empty workspace after a load error', async () => {
  mocks.read.mockResolvedValue({ data: null, error: { message: 'network' } });
  render(<AccountWorkspace />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum dado foi substituído');
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Novo pré/ })).not.toBeInTheDocument();
});

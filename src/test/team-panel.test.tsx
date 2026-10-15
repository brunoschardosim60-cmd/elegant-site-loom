import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { TeamPanel } from '@/components/team-panel';
import type { ConferenceTeam } from '@/lib/conference-team';
const team: ConferenceTeam = { teamId: '00000000-0000-4000-8000-000000000001', name: 'Equipe', owner: true, members: [{ email: 'owner@example.com', owner: true, pending: false }], revision: 1, data: { manifests: [], activity: [], issues: [] } };
afterEach(cleanup);
const auditEvent = (id: number, manifest_id = '06052233') => ({ id, actor_email: 'operator@example.invalid', occurred_at: '2026-10-15T03:00:00Z', manifest_id, action: 'ctc_received', details: { ctc: String(id).padStart(10, '0') } });
it('paginates the applied history query rather than unsent input', async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, n) => auditEvent(200 - n)), error: null }).mockResolvedValue({ data: [], error: null });
  render(<TeamPanel client={{ rpc } as unknown as SupabaseClient} team={team} open selectedPre="06052233" onOpenChange={() => {}} onRefresh={() => {}} />);
  await screen.findByRole('button', { name: 'Mais antigas' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Filtrar histórico por pré' }), { target: { value: '06052234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mais antigas' }));
  await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('get_conference_audit', { pre_id: '06052233', before_id: 101 }));
});
it('does not present the previous manifest history as results of a failed new query', async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [auditEvent(1)], error: null }).mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  render(<TeamPanel client={{ rpc } as unknown as SupabaseClient} team={team} open selectedPre="06052233" onOpenChange={() => {}} onRefresh={() => {}} />);
  await screen.findByText('06052233 · 0000000001');
  fireEvent.change(screen.getByRole('textbox', { name: 'Filtrar histórico por pré' }), { target: { value: '06052234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o histórico');
  expect(screen.queryByText('06052233 · 0000000001')).not.toBeInTheDocument();
  expect(screen.queryByText(/Nenhuma ação registrada/)).not.toBeInTheDocument();
});
it('prepares a named email invitation only on submit and tells the owner how the person joins', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: team, error: null }), refresh = vi.fn();
  render(<TeamPanel client={{ rpc } as unknown as SupabaseClient} team={team} open onOpenChange={() => {}} onRefresh={refresh} />);
  expect(rpc).not.toHaveBeenCalled(); fireEvent.change(screen.getByRole('textbox', { name: 'E-mail da pessoa' }), { target: { value: 'coworker@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Liberar acesso à equipe' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledExactlyOnceWith('invite_conference_member', { member_email: 'coworker@example.com' }));
  expect(await screen.findByRole('status')).toHaveTextContent('criar e confirmar a conta'); expect(refresh).toHaveBeenCalledOnce();
});
it('keeps audit discreet, filters by pre and shows reliable actor and NF changes on demand', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [{ id: 1, actor_email: 'coworker@example.com', occurred_at: '2026-10-13T03:00:00Z', manifest_id: 'DI00123456789', action: 'ctc_edited', details: { ctc: '0000000001', before: { nf: '123' }, after: { nf: '456' } } }], error: null });
  render(<TeamPanel client={{ rpc } as unknown as SupabaseClient} team={team} open selectedPre="DI00123456789" onOpenChange={() => {}} onRefresh={() => {}} />);
  expect(await screen.findByText(/coworker@example.com/)).toBeInTheDocument();
  expect(rpc).toHaveBeenLastCalledWith('get_conference_audit', { pre_id: 'DI00123456789', before_id: null });
  expect(screen.getByText('NF: 123 → 456')).toBeInTheDocument(); expect(screen.getByText('Ver alterações')).toBeInTheDocument();
});
it('offers invitations only to owners, without a displayed count or a fixed cap', () => {
  const rpc = vi.fn(); const first = render(<TeamPanel client={{ rpc } as unknown as SupabaseClient} team={{ ...team, owner: false }} open onOpenChange={() => {}} onRefresh={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Liberar acesso à equipe' })).not.toBeInTheDocument(); first.unmount();
  render(<TeamPanel client={{ rpc } as unknown as SupabaseClient} team={{ ...team, members: [...team.members, { email: 'two@example.com', owner: false, pending: false }, { email: 'three@example.com', owner: false, pending: true }] }} open onOpenChange={() => {}} onRefresh={() => {}} />);
  expect(screen.getByRole('button', { name: 'Liberar acesso à equipe' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Pessoas' })).toBeInTheDocument(); expect(screen.queryByText(/três pessoas|\/3/)).not.toBeInTheDocument(); expect(rpc).not.toHaveBeenCalled();
});

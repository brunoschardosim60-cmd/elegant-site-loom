import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConferenceWorkspace } from '@/components/conference-workspace';

vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: async () => ({ configured: false }) }));
const state = { manifests: [{ id: 'DI00123456789', driver: 'MOTORISTA DE TESTE', plate: 'ABC1D23', date: '2026-10-10T14:00:00Z', issueDate: '2026-10-09', documents: [{ id: 'one', ctc: '0000000001', nf: '123-1', volumes: 3, received: false }] }], activity: [], issues: [] };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('updates issue age after 24 hours without changing scans, focus or registered snapshots', () => {
  vi.setSystemTime(new Date('2026-10-10T14:00:00Z'));
  const onSnapshot = vi.fn();
  render(<ConferenceWorkspace initialState={state} onSnapshot={onSnapshot} />);
  expect(screen.getByText('Emitido há 1 dia')).toBeInTheDocument();
  const scanner = screen.getByRole('textbox', { name: 'Código do CTC' });
  fireEvent.change(scanner, { target: { value: '00000' } });
  scanner.focus();
  const snapshotCalls = onSnapshot.mock.calls.length;
  act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
  expect(screen.getByText('Emitido há 2 dias')).toBeInTheDocument();
  expect(scanner).toHaveValue('00000');
  expect(scanner).toHaveFocus();
  expect(onSnapshot).toHaveBeenCalledTimes(snapshotCalls);
  expect(state.manifests[0]!.documents[0]!.received).toBe(false);
});

it('refreshes the two-day filter after São Paulo midnight while the page remains open', () => {
  vi.setSystemTime(new Date('2026-10-11T02:59:30Z')); // 10/10 at 23:59:30 in São Paulo.
  render(<ConferenceWorkspace initialState={state} />);
  fireEvent.click(screen.getByRole('button', { name: /Pendências/ }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar pré-manifestos' }), { target: { value: 'old' } });
  expect(screen.queryByRole('table', { name: 'CTCs pendentes' })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByRole('table', { name: 'CTCs pendentes' })).toBeInTheDocument();
  expect(screen.getByText('Emitido há 2 dias')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Filtrar pré-manifestos' })).toHaveValue('old');
});

it('refreshes immediately when a suspended tab becomes visible and removes its timer/listener', () => {
  vi.setSystemTime(new Date('2026-10-10T14:00:00Z'));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const removeListener = vi.spyOn(document, 'removeEventListener');
  const view = render(<ConferenceWorkspace initialState={state} />);
  expect(screen.getByText('Emitido há 1 dia')).toBeInTheDocument();
  vi.setSystemTime(new Date('2026-10-12T14:00:00Z')); // No timer callback while suspended.
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.getByText('Emitido há 1 dia')).toBeInTheDocument();
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.getByText('Emitido há 3 dias')).toBeInTheDocument();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
});

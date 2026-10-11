import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConferenceWorkspace } from '@/components/conference-workspace';

vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: async () => ({ configured: false }) }));
afterEach(cleanup);
const initialState = { manifests: [{ id: 'DI00123456789', driver: 'MOTORISTA DE TESTE', plate: 'ABC1D23', date: '2026-10-10T14:00:00Z', issueDate: '2026-08-28', documents: [
  { id: 'one', ctc: '0000000001', nf: '123-1', volumes: 3, received: false },
  { id: 'two', ctc: '0000000002', nf: '124-1', volumes: 2, received: false },
] }], activity: [], issues: [] };

it('collapses and expands the same workspace without clearing scans, filters or creating saved changes', () => {
  const onSnapshot = vi.fn();
  render(<ConferenceWorkspace initialState={initialState} onSnapshot={onSnapshot} accountEmail="operacao@example.test" />);
  const scanner = screen.getByRole('textbox', { name: 'Código do CTC' });
  const query = screen.getByRole('textbox', { name: 'Buscar pré-manifesto' });
  const filter = screen.getByRole('combobox', { name: 'Filtrar pré-manifestos' });
  fireEvent.change(scanner, { target: { value: '00000' } });
  fireEvent.change(query, { target: { value: '123-1' } });
  fireEvent.change(filter, { target: { value: 'old' } });
  onSnapshot.mockClear();
  const workspace = scanner.closest('.workspace');
  fireEvent.click(screen.getByRole('button', { name: 'Recolher menu lateral' }));
  expect(workspace).toHaveClass('workspace-sidebar-collapsed');
  expect(screen.getByRole('button', { name: 'Expandir menu lateral' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Conferência' })).toHaveAttribute('aria-current', 'page');
  expect(scanner).toHaveValue('00000'); expect(query).toHaveValue('123-1'); expect(filter).toHaveValue('old');
  expect(screen.getByText(/Cadastros vinculados a operacao@example.test/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Expandir menu lateral' }));
  expect(workspace).not.toHaveClass('workspace-sidebar-collapsed');
  expect(screen.getByRole('button', { name: 'Recolher menu lateral' })).toHaveAttribute('aria-expanded', 'true');
  expect(scanner).toHaveValue('00000');
  expect(onSnapshot).not.toHaveBeenCalled();
});

it('keeps compact navigation labelled, shows a keyboard tooltip and preserves received documents', async () => {
  const onSnapshot = vi.fn();
  render(<ConferenceWorkspace initialState={initialState} onSnapshot={onSnapshot} />);
  fireEvent.click(screen.getByRole('button', { name: 'Recolher menu lateral' }));
  const pending = screen.getByRole('button', { name: 'Pendências' });
  fireEvent.focus(pending);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Pendências · 2');
  fireEvent.blur(pending);
  fireEvent.click(pending);
  expect(screen.getByRole('heading', { name: 'Pendências de conferência' })).toBeInTheDocument();
  expect(pending).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Marcar CTC 0000000001 como recebido' }));
  expect(onSnapshot.mock.lastCall?.[0].manifests[0].documents).toMatchObject([{ ctc: '0000000001', received: true }, { ctc: '0000000002', received: false }]);
  fireEvent.click(screen.getByRole('button', { name: 'Conferência' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expandir menu lateral' }));
  expect(screen.getByRole('button', { name: 'Desfazer CTC 0000000001' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marcar CTC 0000000002 como recebido' })).toBeInTheDocument();
  expect(initialState.manifests[0]!.documents.every(document => !document.received)).toBe(true);
});

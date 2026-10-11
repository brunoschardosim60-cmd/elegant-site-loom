import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConferenceWorkspace } from '@/components/conference-workspace';

const mocks = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock('@/lib/conference-pdf', () => ({ exportConferencePdf: mocks.pdf }));
vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: async () => ({ configured: false }) }));
const initialState = { manifests: [{ id: 'DI00123456789', driver: 'MOTORISTA DE TESTE', plate: 'ABC1D23', date: '2026-10-10', documents: [{ id: 'one', ctc: '0000000001', nf: '123-1', volumes: 3, received: false }] }], activity: [], issues: [] };
beforeEach(() => { mocks.pdf.mockReset(); mocks.pdf.mockResolvedValue(undefined); });
afterEach(cleanup);

it('removes CSV and manual divergence actions while keeping automatic operational occurrences', async () => {
  render(<ConferenceWorkspace initialState={initialState} />);
  expect(screen.queryByRole('button', { name: /CSV/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Divergência/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument();
  const scanner = screen.getByRole('textbox', { name: 'Código do CTC' });
  fireEvent.change(scanner, { target: { value: '0000009999' } });
  fireEvent.submit(scanner.closest('form')!);
  expect(await screen.findByRole('dialog')).toHaveTextContent('O CTC 0000009999 não está em nenhum pré-manifesto cadastrado.');
  fireEvent.click(screen.getByRole('button', { name: /Entendido, continuar/ }));
  fireEvent.click(screen.getByRole('button', { name: /Ocorrências/ }));
  expect(screen.getByRole('heading', { name: 'CTC sem pré-manifesto' })).toBeInTheDocument();
});

it('passes the active view, search and ordering filter to the PDF report', async () => {
  render(<ConferenceWorkspace initialState={initialState} />);
  fireEvent.click(screen.getByRole('button', { name: /Pendências/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar pré-manifesto' }), { target: { value: '123-1' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar pré-manifestos' }), { target: { value: 'old' } });
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  await waitFor(() => expect(mocks.pdf).toHaveBeenCalledExactlyOnceWith({ manifests: initialState.manifests, issues: [], view: 'missing', query: '123-1', filter: 'old' }));
  expect(await screen.findByRole('button', { name: 'PDF' })).toBeEnabled();
});

it('shows a clear error and re-enables PDF export if report generation fails', async () => {
  mocks.pdf.mockRejectedValue(new Error('synthetic PDF failure'));
  render(<ConferenceWorkspace initialState={initialState} />);
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  expect(await screen.findByText('Não foi possível gerar o PDF. Tente novamente.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpreadsheetImportDialog } from '@/components/spreadsheet-import-dialog';
import type { LuftExport } from '@/lib/luft-spreadsheet';
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/read-luft-spreadsheet', () => ({ readLuftSpreadsheet: mock.read }));
const data = (): LuftExport => ({ ignored: 3004, repeated: 0, selectedRows: 2, errors: [], drafts: [
  { id: '06052233', driver: 'ANA', plate: 'ABC1D23', issueDate: '2026-10-14', expectedRows: 1, totalVolumes: 2, rows: [{ ctc: '0000000001', nf: '123-1', volumes: '2', client: 'LAB', recipient: 'CLIENTE' }] },
  { id: '06052234', driver: 'BRUNO', plate: 'DEF2G34', issueDate: '2026-10-14', expectedRows: 1, totalVolumes: 3, rows: [{ ctc: '0000000002', nf: '456-1', volumes: '3', client: 'LAB', recipient: 'CLIENTE' }] },
] });
beforeEach(() => { mock.read.mockReset().mockResolvedValue(data()); });
afterEach(cleanup);
const upload = () => fireEvent.change(screen.getByLabelText('Enviar planilha 108'), { target: { files: [new File(['xlsx'], '108.xlsx')] } });
it('previews all eligible manifests, filters by driver and requires explicit registration', async () => {
  const save = vi.fn(() => ({ ok: true as const, manifests: [] }));
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload(); await screen.findByLabelText('Selecionar manifesto 06052233'); expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Buscar motorista, placa ou manifesto na planilha'), { target: { value: 'BRUNO' } });
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar resultados' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar 1 manifestos' }));
  expect(save).toHaveBeenCalledWith([expect.objectContaining({ id: '06052234' })]);
});
it('blocks registered CTCs and invalid source rows without mutating saved data', async () => {
  const result = data(); result.errors = ['Linha 4: confira NF e série.']; mock.read.mockResolvedValueOnce(result);
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload(); expect(await screen.findByText('Linha 4: confira NF e série.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cadastrar 2 manifestos' })).toBeDisabled(); expect(save).not.toHaveBeenCalled();
});
it('leaves existing CTC conflicts unselected and cannot silently overwrite them', async () => {
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[{ id: 'DI00123456789', driver: 'ANTIGO', plate: 'ABC1234', date: 'now', documents: [{ id: 'old', ctc: '0000000001', nf: '123-1', volumes: 2, received: true }] }]} onClose={vi.fn()} onCreate={save} />);
  upload(); const repeated = await screen.findByLabelText('Selecionar manifesto 06052233');
  expect(repeated).toBeDisabled(); expect(repeated).not.toBeChecked(); expect(screen.getByRole('button', { name: 'Cadastrar 1 manifestos' })).toBeEnabled(); expect(save).not.toHaveBeenCalled();
});
it('aborts immediately on stop and ignores a late parser result', async () => {
  let resolve!: (value: LuftExport) => void;
  mock.read.mockImplementationOnce(() => new Promise<LuftExport>(done => { resolve = done; }));
  const save = vi.fn();
  render(<SpreadsheetImportDialog manifests={[]} onClose={vi.fn()} onCreate={save} />);
  upload(); await waitFor(() => expect(mock.read).toHaveBeenCalled());
  const signal = mock.read.mock.calls[0]![1] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Parar' })); expect(signal.aborted).toBe(true);
  await act(async () => resolve(data()));
  expect(screen.queryByLabelText('Selecionar manifesto 06052233')).not.toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
});

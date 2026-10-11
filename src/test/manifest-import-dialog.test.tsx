import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManifestImportDialog } from '@/components/manifest-import-dialog';
import type { readAiPhotos } from '@/lib/photo-ai';
import type { ImportDraft } from '@/lib/manifest-import';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: vi.fn(async () => ({ configured: true })) }));
vi.mock('@/lib/photo-ai', () => ({ readAiPhotos: mocks.read }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  mocks.read.mockReset();
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = vi.fn(() => 'blob:photo'); static override revokeObjectURL = vi.fn(); });
});
const result = (id: string, ctc: string, nf: string) => ({
  pre: { id, plate: 'ABC1D23', driver: 'MOTORISTA', kind: 'pre' as const, ctcs: [ctc], documents: [{ ctc, nf, volumes: '2', client: 'LAB', recipient: 'CLIENTE' }], expectedRows: 1, totalVolumes: 2, verification: { status: 'matched' as const, checkedFields: 6, conflicts: 0 } }, text: 'Documento', milliseconds: 3200,
});

it('keeps each photo attached to its result while two reads finish out of order, and invalidates the agreement badge after editing', async () => {
  let callbacks: Parameters<typeof readAiPhotos> | undefined;
  let finish: (() => void) | undefined;
  mocks.read.mockImplementation((...args: Parameters<typeof readAiPhotos>) => { callbacks = args; return new Promise<void>(resolve => { finish = resolve; }); });
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [new File(['a'], 'primeiro.jpg', { type: 'image/jpeg' }), new File(['b'], 'segundo.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(callbacks).toBeDefined());
  await act(async () => {
    callbacks![2]?.(0, 'Lendo a primeira foto');
    callbacks![2]?.(1, 'Conferindo a segunda foto');
    callbacks![1](1, result('DI00000000002', '0000000002', '22-1'));
  });
  expect(screen.getByRole('button', { name: 'Cadastrar lote (2)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Revisar arquivo 2: DI00000000002' }));
  expect(screen.getByLabelText('NF-série')).toHaveValue('22-1');
  expect(screen.getByText('Cabeçalho e números conferidos')).toBeInTheDocument();
  expect(screen.getByText(/Confira os nomes dos clientes e destinatários/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'ABC1D24' } });
  expect(screen.queryByText('Cabeçalho e números conferidos')).not.toBeInTheDocument();
  expect(screen.getByText('Dados ajustados manualmente')).toBeInTheDocument();
  await act(async () => { callbacks![1](0, result('DI00000000001', '0000000001', '11-1')); finish!(); });
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar lote (2)' }));
  expect(create).toHaveBeenCalledWith([
    expect.objectContaining({ id: 'DI00000000001', rows: [expect.objectContaining({ ctc: '0000000001', nf: '11-1' })] }),
    expect.objectContaining({ id: 'DI00000000002', plate: 'ABC1D24', rows: [expect.objectContaining({ ctc: '0000000002', nf: '22-1' })] }),
  ]);
});

it('aborts an in-flight photo and does not refill a reopened draft with its late result', async () => {
  let callbacks: Parameters<typeof readAiPhotos> | undefined;
  let finish: (() => void) | undefined;
  mocks.read.mockImplementation((...args: Parameters<typeof readAiPhotos>) => { callbacks = args; return new Promise<void>(resolve => { finish = resolve; }); });
  function Harness() {
    const [open, setOpen] = useState(true);
    return <><button onClick={() => setOpen(true)}>Reabrir</button><ManifestImportDialog open={open} onOpenChange={setOpen} manifests={[]} onCreate={() => ({ ok: true, manifests: [] })} /></>;
  }
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [new File(['a'], 'foto.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(callbacks).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(callbacks![3]?.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }));
  await act(async () => { callbacks![1](0, result('DI00000000001', '0000000001', '11-1')); finish!(); });
  expect(screen.getByLabelText('Número do pré')).toHaveValue('');
  expect(screen.getByLabelText('NF-série')).toHaveValue('');
  expect(screen.queryByRole('img', { name: 'Documento enviado para conferência' })).not.toBeInTheDocument();
});

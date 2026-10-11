import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManifestImportDialog } from '@/components/manifest-import-dialog';
import type { readAiPhotos } from '@/lib/photo-ai';
import type { ImportDraft } from '@/lib/manifest-import';
import { LOCAL_HEADER_NOTICE, LOCAL_ROW_NOTICE } from '@/lib/local-photo';

const mocks = vi.hoisted(() => ({ read: vi.fn(), unique: vi.fn() }));
vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: vi.fn(async () => ({ configured: true })) }));
vi.mock('@/lib/photo-reader', () => ({ readPhotosWithFallback: mocks.read }));
vi.mock('@/lib/photo-files', () => ({ uniquePhotoFiles: mocks.unique }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  mocks.read.mockReset();
  mocks.unique.mockReset().mockImplementation(async (files: File[]) => ({ files, duplicates: 0 }));
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = vi.fn(() => 'blob:photo'); static override revokeObjectURL = vi.fn(); });
});
const result = (id: string, ctc: string, nf: string) => ({
  pre: { id, issueDate: '2026-08-28', plate: 'ABC1D23', driver: 'MOTORISTA', kind: 'pre' as const, readingSource: 'gemini' as const, ctcs: [ctc], documents: [{ ctc, nf, volumes: '2', client: 'LAB', recipient: 'CLIENTE' }], expectedRows: 1, totalVolumes: 2, verification: { status: 'matched' as const, checkedFields: 6, conflicts: 0 } }, text: 'Documento', milliseconds: 3200,
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
  expect(screen.getByLabelText('Data de emissão do pré')).toHaveValue('');
  expect(screen.getByLabelText('NF-série')).toHaveValue('');
  expect(screen.queryByRole('img', { name: 'Documento enviado para conferência' })).not.toBeInTheDocument();
});

it('imports the printed issue date and submits a manually corrected date without replacing it with today', async () => {
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<typeof readAiPhotos>[1]) => onResult(0, result('DI00000000001', '0000000001', '11-1')));
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  expect(screen.getByLabelText('Data de emissão do pré')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [new File(['a'], 'foto.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Cabeçalho e números conferidos');
  expect(screen.getByLabelText('Data de emissão do pré')).toHaveValue('2026-08-28');
  fireEvent.change(screen.getByLabelText('Data de emissão do pré'), { target: { value: '2026-08-27' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar pré' }));
  expect(create).toHaveBeenCalledWith([expect.objectContaining({ issueDate: '2026-08-27' })]);
});

it('consolidates the local reader notice while retaining the failure reason and specific NF warnings', async () => {
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<typeof readAiPhotos>[1]) => {
    const local = result('DI00000000001', '0000000001', '11-1');
    onResult(0, { ...local, pre: { ...local.pre, readingSource: 'local', readingFallback: true,
      verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 },
      headerReview: [LOCAL_HEADER_NOTICE, 'Gemini: O tempo de resposta foi excedido.', 'Total de volumes não confere.'],
      documents: local.pre.documents.map(row => ({ ...row, review: ['NF', LOCAL_ROW_NOTICE] })),
    } });
  });
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={() => ({ ok: true, manifests: [] })} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [new File(['a'], 'foto.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Leitura local de reserva');
  expect(screen.getByText('Gemini: O tempo de resposta foi excedido.')).toBeInTheDocument();
  expect(screen.getByText('Total de volumes não confere.')).toBeInTheDocument();
  expect(screen.getByText('Confira este CTC na foto')).toBeInTheDocument();
  expect(screen.getByText('NF')).toBeInTheDocument();
  expect(screen.queryByText(LOCAL_HEADER_NOTICE)).not.toBeInTheDocument();
  expect(screen.queryByText(LOCAL_ROW_NOTICE)).not.toBeInTheDocument();
  expect(screen.queryByText('Conferir os dados do pré')).not.toBeInTheDocument();
});

it('identifies a local fallback and never shows automatic double-read agreement for it', async () => {
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<typeof readAiPhotos>[1]) => {
    const local = result('DI00000000001', '0000000001', '11-1');
    onResult(0, { ...local, pre: { ...local.pre, readingSource: 'local', readingFallback: true, verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 }, headerReview: ['Leitura de reserva: confira todas as linhas.'] } });
  });
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={() => ({ ok: true, manifests: [] })} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [new File(['a'], 'foto.jpg', { type: 'image/jpeg' })] } });
  expect(await screen.findByText('Leitura local de reserva')).toBeInTheDocument();
  expect(screen.getByText(/Os dados foram lidos no navegador, sem conferência pela IA/)).toBeInTheDocument();
  expect(screen.queryByText('Cabeçalho e números conferidos')).not.toBeInTheDocument();
  expect(screen.queryByText('A segunda leitura não foi concluída')).not.toBeInTheDocument();
  expect(screen.getByLabelText('NF-série')).toHaveValue('11-1');
  fireEvent.change(screen.getByLabelText('Leitor de fotos'), { target: { value: 'local' } });
  expect(screen.getByText('Leitura local de reserva')).toBeInTheDocument();
});

it.each([
  ['single', 'Leitura concluída com validação local', 'verified'],
  ['unavailable', 'Leitura sem conferência independente', 'warning'],
] as const)('describes %s without claiming that two independent readings agreed', async (status, title, tone) => {
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<typeof readAiPhotos>[1]) => {
    const photo = result('DI00000000001', '0000000001', '11-1');
    onResult(0, { ...photo, pre: { ...photo.pre, verification: { status, checkedFields: 0, conflicts: 0 } } });
  });
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={() => ({ ok: true, manifests: [] })} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [new File(['a'], 'foto.jpg', { type: 'image/jpeg' })] } });
  expect((await screen.findByText(title)).closest('.import-alert')).toHaveClass(tone);
  expect(screen.queryByText('Cabeçalho e números conferidos')).not.toBeInTheDocument();
  expect(screen.queryByText(/Duas leituras concordam|A segunda leitura não foi concluída/)).not.toBeInTheDocument();
  if (status === 'single') {
    expect(screen.getByText(/A IA leu a foto uma vez/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'ABC1D24' } });
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(screen.getByText('Dados ajustados manualmente').closest('.import-alert')).toHaveClass('warning');
  } else expect(screen.getByText(/Os dados foram extraídos sem conferência independente/)).toBeInTheDocument();
});

it('ignores repeated photos before creating drafts and keeps the existing draft when every selected photo is repeated', async () => {
  const first = new File(['same photo'], 'foto.jpg', { type: 'image/jpeg' });
  const duplicate = new File(['same photo'], 'outra.jpg', { type: 'image/jpeg' });
  const pdf = new File(['pdf'], 'documento.pdf', { type: 'application/pdf' });
  mocks.unique.mockResolvedValueOnce({ files: [first], duplicates: 1 }).mockResolvedValueOnce({ files: [], duplicates: 1 });
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<typeof readAiPhotos>[1]) => onResult(0, result('DI00000000001', '0000000001', '11-1')));
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [first, duplicate, pdf] } });
  await screen.findByText('Cabeçalho e números conferidos');
  expect(screen.getByText('Alguns arquivos foram ignorados. Envie fotos em JPG, PNG ou WebP. 1 foto(s) repetida(s) ignorada(s).')).toBeInTheDocument();
  expect(mocks.read.mock.calls[0]?.[0]).toEqual([first]);
  expect(screen.queryByRole('button', { name: /Cadastrar lote/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [duplicate] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cadastrar pré' })).not.toBeDisabled());
  expect(mocks.unique.mock.calls[1]?.[1]).toEqual([first]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('NF-série')).toHaveValue('11-1');
  expect(screen.getByText('1 foto(s) repetida(s) ignorada(s).')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar pré' }));
  expect(create.mock.calls[0]?.[0]).toHaveLength(1);
});

it('cancels photo preparation on close and ignores a late duplicate check after reopening', async () => {
  let finishHash: ((result: { files: File[]; duplicates: number }) => void) | undefined;
  mocks.unique.mockImplementation(() => new Promise(resolve => { finishHash = resolve; }));
  function Harness() {
    const [open, setOpen] = useState(true);
    return <><button onClick={() => setOpen(true)}>Reabrir</button><ManifestImportDialog open={open} onOpenChange={setOpen} manifests={[]} onCreate={() => ({ ok: true, manifests: [] })} /></>;
  }
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  const file = new File(['a'], 'foto.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [file] } });
  await waitFor(() => expect(finishHash).toBeDefined());
  const signal = mocks.unique.mock.calls[0]?.[2] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }));
  await act(async () => { finishHash!({ files: [file], duplicates: 0 }); });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Número do pré')).toHaveValue('');
  expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled();
  expect(screen.queryByRole('img', { name: 'Documento enviado para conferência' })).not.toBeInTheDocument();
});

it('preserves manual changes made while photos are being checked for duplicates', async () => {
  let finishHash: ((result: { files: File[]; duplicates: number }) => void) | undefined;
  mocks.unique.mockImplementation(() => new Promise(resolve => { finishHash = resolve; }));
  mocks.read.mockImplementation(async (_files: File[], onResult: Parameters<typeof readAiPhotos>[1]) => onResult(0, result('DI00000000002', '0000000002', '22-1')));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={() => ({ ok: true, manifests: [] })} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  const file = new File(['a'], 'foto.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [file] } });
  await waitFor(() => expect(finishHash).toBeDefined());
  fireEvent.change(screen.getByLabelText('Número do pré'), { target: { value: 'DI00000000001' } });
  fireEvent.change(screen.getByLabelText('Motorista'), { target: { value: 'MOTORISTA MANUAL' } });
  await act(async () => { finishHash!({ files: [file], duplicates: 0 }); });
  await screen.findByText('Cabeçalho e números conferidos');
  fireEvent.click(screen.getByRole('button', { name: 'Revisar arquivo 1: DI00000000001' }));
  expect(screen.getByLabelText('Número do pré')).toHaveValue('DI00000000001');
  expect(screen.getByLabelText('Motorista')).toHaveValue('MOTORISTA MANUAL');
  expect(screen.getByRole('button', { name: 'Cadastrar lote (2)' })).not.toBeDisabled();
});

it.each(['local fallback', 'partial Gemini', 'error'] as const)('preserves all previous Gemini rows and manual edits when rereading returns %s', async outcome => {
  const original = result('DI00000000001', '0000000001', '11-1');
  const secondRow = { ctc: '0000000002', nf: '22-1', volumes: '3', client: 'LAB 2', recipient: 'CLIENTE 2' };
  mocks.read.mockImplementationOnce(async (_files: File[], onResult: Parameters<typeof readAiPhotos>[1]) => {
    onResult(0, { ...original, pre: { ...original.pre, ctcs: ['0000000001', '0000000002'], documents: [...original.pre.documents, secondRow], expectedRows: 2, totalVolumes: 5 } });
  });
  let retryCallbacks: Parameters<typeof readAiPhotos> | undefined;
  let finishRetry: (() => void) | undefined;
  mocks.read.mockImplementationOnce((...args: Parameters<typeof readAiPhotos>) => { retryCallbacks = args; return new Promise<void>(resolve => { finishRetry = resolve; }); });
  const create = vi.fn((_: ImportDraft[]) => ({ ok: true as const, manifests: [] }));
  render(<ManifestImportDialog open onOpenChange={vi.fn()} manifests={[]} onCreate={create} />);
  await waitFor(() => expect(screen.getByLabelText('Enviar várias fotos')).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('Enviar várias fotos'), { target: { files: [new File(['a'], 'foto.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Cabeçalho e números conferidos');
  fireEvent.change(screen.getByLabelText('NF-série'), { target: { value: '12-1' } });
  fireEvent.change(screen.getByLabelText('Cliente / laboratório'), { target: { value: 'LAB CONFERIDO' } });
  fireEvent.change(screen.getByLabelText('Motorista'), { target: { value: 'MOTORISTA CONFERIDO' } });
  fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'ABC1D24' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reler detalhes desta foto' }));
  await waitFor(() => expect(retryCallbacks).toBeDefined());
  expect(mocks.unique).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Cadastrar pré' })).toBeDisabled();
  await act(async () => {
    if (outcome === 'error') retryCallbacks![1](0, { error: 'Leitor indisponível.' });
    else {
      const partial = result('DI00000000099', '0000000099', '99-9');
      retryCallbacks![1](0, { ...partial, pre: { ...partial.pre, readingSource: outcome === 'local fallback' ? 'local' : 'gemini', readingFallback: outcome === 'local fallback', verification: { status: 'unavailable', checkedFields: 0, conflicts: 0 } } });
    }
    finishRetry!();
  });
  expect(screen.getByText('A nova tentativa não melhorou a leitura. Os dados anteriores foram preservados.')).toBeInTheDocument();
  expect(screen.getByLabelText('Número do pré')).toHaveValue('DI00000000001');
  expect(screen.getByLabelText('Placa')).toHaveValue('ABC1D24');
  expect(screen.getByLabelText('Motorista')).toHaveValue('MOTORISTA CONFERIDO');
  expect(screen.getByLabelText('NF-série')).toHaveValue('12-1');
  expect(screen.getByLabelText('Cliente / laboratório')).toHaveValue('LAB CONFERIDO');
  expect(screen.queryByText('Leitura local de reserva')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Selecionar CTC'), { target: { value: '1' } });
  expect(screen.getByLabelText('CTC')).toHaveValue('0000000002');
  expect(screen.getByLabelText('NF-série')).toHaveValue('22-1');
  expect(screen.getByLabelText('Volumes')).toHaveValue(3);
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar pré' }));
  expect(create).toHaveBeenCalledWith([expect.objectContaining({
    id: 'DI00000000001', driver: 'MOTORISTA CONFERIDO', plate: 'ABC1D24', readingSource: 'gemini', edited: true,
    rows: [expect.objectContaining({ ctc: '0000000001', nf: '12-1', client: 'LAB CONFERIDO' }), secondRow],
  })]);
});

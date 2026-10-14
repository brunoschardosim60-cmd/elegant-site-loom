import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManifestImportDialog } from '@/components/manifest-import-dialog';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: mocks.status }));
beforeEach(() => { vi.useFakeTimers(); mocks.status.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const props = { open: true, onOpenChange: vi.fn(), manifests: [], onCreate: () => ({ ok: true as const, manifests: [] }) };

it('unlocks local upload after a stalled availability check and ignores late AI availability', async () => {
  let resolve!: (value: { configured: boolean }) => void;
  mocks.status.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<ManifestImportDialog {...props} />);
  expect(screen.getByLabelText('Enviar várias fotos')).toBeDisabled();
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByLabelText('Enviar várias fotos')).toBeEnabled();
  expect(screen.getByLabelText('Leitor de fotos')).toHaveValue('local');
  expect(mocks.status.mock.calls[0]![0].signal.aborted).toBe(true);
  await act(async () => resolve({ configured: true }));
  expect(screen.getByLabelText('Leitor de fotos')).toHaveValue('local');
});

it('aborts the availability request when the import dialog is unmounted', () => {
  mocks.status.mockImplementation(() => new Promise(() => {}));
  const view = render(<ManifestImportDialog {...props} />);
  const signal = mocks.status.mock.calls[0]![0].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

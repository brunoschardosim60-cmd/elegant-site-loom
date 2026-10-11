import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DriverManifestList } from '@/components/driver-manifest-list';
import type { Manifest } from '@/lib/conference';

afterEach(cleanup);
const manifests: Manifest[] = [
  { id: 'DI000000001', driver: 'ANA SILVA', plate: 'ABC1234', date: '2026-10-10', documents: [{ id: 'one', ctc: '0000000001', nf: '101-1', volumes: 3, received: false }] },
  { id: 'DI000000002', driver: 'ana  silva', plate: 'DEF1G23', date: '2026-10-11', documents: [{ id: 'two', ctc: '0000000002', nf: '102-1', volumes: 5, received: false }, { id: 'three', ctc: '0000000003', nf: '103-1', volumes: 2, received: true }] },
  { id: 'DI000000003', driver: 'JOÃO SOUZA', plate: 'GHI5678', date: '2026-10-11', documents: [{ id: 'four', ctc: '0000000004', nf: '104-1', volumes: 9, received: false }] },
];
const props = { manifests, query: '', focusedManifest: null, age: () => 1, onToggleDocument: vi.fn() };

it('groups the same driver with pending totals and keeps one document table open', () => {
  render(<DriverManifestList {...props} />);
  const ana = screen.getByRole('region', { name: 'Pré-manifestos de ANA SILVA' });
  expect(screen.getAllByRole('region')).toHaveLength(2);
  expect(within(ana).getByText('CTCs pendentes').parentElement).toHaveTextContent('2 CTCs pendentes');
  expect(within(ana).getByText('vols. a conferir').parentElement).toHaveTextContent('8 vols. a conferir');
  expect(screen.getByRole('button', { name: 'Marcar CTC 0000000001 como recebido' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Marcar CTC 0000000002 como recebido' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir documentos do pré DI000000002' }));
  expect(screen.queryByRole('button', { name: 'Marcar CTC 0000000001 como recebido' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Marcar CTC 0000000002 como recebido' }));
  expect(props.onToggleDocument).toHaveBeenCalledWith(manifests[1], 'two', true);
  fireEvent.click(screen.getByRole('button', { name: 'Recolher documentos do pré DI000000002' }));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('opens the selected manifest on every new scan, including after collapsing it', () => {
  const view = render(<DriverManifestList {...props} />);
  view.rerender(<DriverManifestList {...props} focusedManifest={{ id: 'DI000000003' }} />);
  expect(screen.getByRole('button', { name: 'Marcar CTC 0000000004 como recebido' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Recolher documentos do pré DI000000003' }));
  view.rerender(<DriverManifestList {...props} focusedManifest={{ id: 'DI000000003' }} />);
  expect(screen.getByRole('button', { name: 'Marcar CTC 0000000004 como recebido' })).toBeInTheDocument();
});

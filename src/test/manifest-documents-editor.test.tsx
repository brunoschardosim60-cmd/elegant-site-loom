import { useState } from 'react';
import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManifestDocumentsEditor, type ManifestDraftRow } from '@/components/manifest-documents-editor';

afterEach(cleanup);
it('keeps imported rows while showing one editor, and adds and removes CTCs', () => {
  function Form() {
    const [rows, setRows] = useState<ManifestDraftRow[]>([{ ctc: '0012345678', nf: '12-1', volumes: '2' }, { ctc: '1234567890', nf: '34-1', volumes: '3' }]);
    const [index, setIndex] = useState(0);
    return <ManifestDocumentsEditor rows={rows} onChange={setRows} selectedIndex={index} onSelect={setIndex} />;
  }
  render(<Form />);
  expect(screen.getAllByLabelText('CTC')).toHaveLength(1);
  expect(screen.getByLabelText('CTC')).toHaveValue('0012345678');
  fireEvent.change(screen.getByLabelText('Selecionar CTC'), { target: { value: '1' } });
  expect(screen.getByLabelText('CTC')).toHaveValue('1234567890');
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar CTC' }));
  expect(screen.getByLabelText('CTC')).toHaveValue('');
  expect(screen.getAllByRole('option')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Remover CTC' }));
  expect(screen.getAllByRole('option')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Selecionar CTC'), { target: { value: '0' } });
  expect(screen.getByLabelText('NF-série')).toHaveValue('12-1');
});

it('places each review message inside its corresponding field and associates it with that input', () => {
  const nf = 'NF e série divergente no CTC 0012345678: 12-1 / 13-1.';
  render(<ManifestDocumentsEditor rows={[{ ctc: '0012345678', nf: '12-1', volumes: '2', client: 'LAB', recipient: 'CLIENTE', review: [nf, 'Confira volumes', 'Confira cliente/laboratório', 'Confira destinatário'] }]} onChange={vi.fn()} selectedIndex={0} onSelect={vi.fn()} />);
  for (const [field, message] of [['NF-série', nf], ['Volumes', 'Confira volumes'], ['Cliente / laboratório', 'Confira cliente/laboratório'], ['Destinatário', 'Confira destinatário']]) {
    const input = screen.getByLabelText(field!);
    expect(within(input.closest('label')!).getByText(message!)).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(`Confira na foto ${message}`);
    expect(input.closest('label')).toHaveAttribute('data-review', 'true');
  }
  expect(screen.getByLabelText('CTC')).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByText('Confira este CTC na foto')).not.toBeInTheDocument();
});

it('shows an unread CTC warning in its own field while retaining unclassified row notes below the fields', () => {
  render(<ManifestDocumentsEditor rows={[{ ctc: '', nf: '12-1', volumes: '2', review: ['CTC ilegível: informe 10 dígitos', 'Foto pouco nítida'] }]} onChange={vi.fn()} selectedIndex={0} onSelect={vi.fn()} />);
  expect(screen.getByLabelText('CTC')).toHaveAccessibleDescription('Confira na foto CTC ilegível: informe 10 dígitos');
  expect(screen.getByText('Foto pouco nítida').closest('.import-inline-review')).toBeInTheDocument();
  expect(screen.getByLabelText('NF-série')).not.toHaveAttribute('aria-describedby');
});

it('does not flag the client or CTC field just because their words occur in a recipient disagreement value', () => {
  const message = 'Destinatário divergente no CTC 0012345678: CLIENTE NF / CLIENTE NOVO.';
  render(<ManifestDocumentsEditor rows={[{ ctc: '0012345678', nf: '12-1', volumes: '2', review: [message] }]} onChange={vi.fn()} selectedIndex={0} onSelect={vi.fn()} />);
  expect(screen.getByLabelText('Destinatário')).toHaveAccessibleDescription(`Confira na foto ${message}`);
  for (const field of ['CTC', 'NF-série', 'Cliente / laboratório']) expect(screen.getByLabelText(field)).not.toHaveAttribute('aria-describedby');
});

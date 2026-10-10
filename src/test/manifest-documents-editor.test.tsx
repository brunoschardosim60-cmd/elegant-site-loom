import { useState } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
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

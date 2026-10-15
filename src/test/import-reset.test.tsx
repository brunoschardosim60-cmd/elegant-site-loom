import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConferenceWorkspace } from '@/components/conference-workspace';
vi.mock('@/lib/photo-reader.functions', () => ({ photoReaderStatus: vi.fn(async () => ({ configured: false })) }));
afterEach(cleanup);
it('discards an unsaved import when closed and opens a blank form', async () => {
  render(<ConferenceWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: /Novo pré/ }));
  const field = await screen.findByLabelText('Número do pré');
  fireEvent.change(field, { target: { value: 'DI00123456789' } });
  fireEvent.change(screen.getByLabelText('Motorista'), { target: { value: 'RASCUNHO' } });
  fireEvent.change(screen.getByLabelText('NF-série'), { target: { value: '123-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
  fireEvent.click(screen.getByRole('button', { name: /Novo pré/ }));
  expect(await screen.findByLabelText('Número do pré')).toHaveValue('');
  expect(screen.getByLabelText('Motorista')).toHaveValue('');
  expect(screen.getByLabelText('NF-série')).toHaveValue('');
});

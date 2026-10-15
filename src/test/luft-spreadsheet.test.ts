import { expect, it } from 'vitest';
import { parseLuft108, validateSpreadsheetZip, type SheetCell } from '@/lib/luft-spreadsheet';
import { applyImports } from '@/lib/manifest-import';

const headers = ['Manifesto', 'Motivo', 'Filial', 'Dataemissao', 'Placa', 'Motorista', 'CTRC', 'Remet Nome', 'Dest Nome', 'NF', 'Serie', 'Volumes'];
const row = (change: Partial<Record<typeof headers[number], SheetCell>> = {}) => {
  const data: Record<string, SheetCell> = { Manifesto: '06052233', Motivo: 'DIS', Filial: '06', Dataemissao: '14/10/2026', Placa: 'QJO7I80', Motorista: 'RAFAEL', CTRC: '0000000001', 'Remet Nome': 'LAB', 'Dest Nome': 'CLIENTE', NF: '00123', Serie: '1', Volumes: 2, ...change };
  return headers.map(header => data[header]!);
};
const parse = (...rows: SheetCell[][]) => parseLuft108([{ name: 'Relatório', rows: [headers, ...rows] }]);

it('imports only branch 06 DIS, preserves literal IDs and groups multiple NFs for one scan', () => {
  const parsed = parse(row(), row({ NF: '456', Volumes: 3 }), row({ Filial: '16' }), row({ Motivo: 'TRA' }), row({ Motivo: 'RED' }));
  expect(parsed).toMatchObject({ ignored: 3, repeated: 0, selectedRows: 2, errors: [] });
  expect(parsed.drafts[0]).toMatchObject({ id: '06052233', plate: 'QJO7I80', issueDate: '2026-10-14', expectedRows: 1, expectedNfs: 2, totalVolumes: 5 });
  const imported = applyImports([], parsed.drafts, '2026-10-14T19:00:00Z');
  expect(imported.ok).toBe(true);
  if (imported.ok) {
    expect(imported.manifests[0]!.documents).toEqual([expect.objectContaining({ ctc: '0000000001', nf: '00123-1, 456-1', volumes: 5, received: false })]);
    expect(applyImports(imported.manifests, parsed.drafts, 'later').ok).toBe(false);
  }
});
it('treats MDF-e fanout as repetition only when all operational values match', () => {
  expect(parse(row(), row())).toMatchObject({ repeated: 1, errors: [], drafts: [{ totalVolumes: 2 }] });
  expect(parse(row(), row({ Volumes: 3 })).errors[0]).toContain('dados diferentes');
});
it('rejects the same CTC across manifests rather than creating two receipt targets', () => {
  expect(parse(row(), row({ Manifesto: '06052234' })).errors[0]).toContain('aparece nos manifestos');
});
it.each([
  ['CTRC', 1], ['CTRC', '123456789'], ['CTRC', '43261052134798000672580030000344861644551460'],
  ['Manifesto', '6052233'], ['NF', null], ['Serie', ''], ['Volumes', 1.5], ['Volumes', 0],
  ['Dataemissao', '31/02/2026'], ['Placa', 'QJO7?80'], ['Motorista', ''],
] as const)('does not infer or repair an invalid %s value %s', (field, value) => {
  expect(parse(row({ [field]: value })).errors).toHaveLength(1);
});
it('supports numeric branch values without padding CTCs and accepts labelled columns in another order', () => {
  const rows = [headers, row({ Filial: 6 })].map(cells => [...cells].reverse());
  expect(parseLuft108([{ name: 'Relatório', rows }]).drafts).toHaveLength(1);
});
it('requires the complete 108 schema and does not substitute a different report', () => {
  expect(() => parseLuft108([{ name: 'Relatório', rows: [['CTC', 'NFs'], ['0000000001', '1-1']] }])).toThrow('Faltam colunas');
  expect(() => parse(row({ Motivo: 'TRA' }))).toThrow('Nenhuma linha');
});
it('refuses conflicting manifest headers or ambiguous column names', () => {
  expect(parse(row(), row({ NF: '456', Motorista: 'OUTRO' })).errors[0]).toContain('motorista, placa ou data conflitantes');
  expect(() => parseLuft108([{ name: 'Relatório', rows: [[...headers, 'NF'], [...row(), '999']] }])).toThrow('colunas obrigatórias repetidas');
});
it('checks declared ZIP expansion before reading the workbook', () => {
  expect(() => validateSpreadsheetZip(new ArrayBuffer(30))).toThrow('inválido');
  const buffer = new ArrayBuffer(68), view = new DataView(buffer);
  view.setUint32(0, 0x02014b50, true); view.setUint32(24, 49 * 1024 * 1024, true);
  view.setUint32(46, 0x06054b50, true); view.setUint16(56, 1, true); view.setUint32(58, 46, true);
  expect(() => validateSpreadsheetZip(buffer)).toThrow('48 MB');
  view.setUint32(24, 100, true); expect(() => validateSpreadsheetZip(buffer)).not.toThrow();
});

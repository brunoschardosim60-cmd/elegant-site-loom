import { expect, it } from 'vitest';
import { photoRepairPlan, applyPhotoRepair } from '@/lib/photo-repair';
import type { PhotoFields } from '@/lib/photo-fields';
import { flagPhotoNameVariants } from '@/lib/photo-name-review';
const sample = (): PhotoFields => ({ kind: 'pre', id: 'DI00601869631', plate: 'TRB7E25', driver: 'DAVID VARGAS FERNANDES', issueDate: '2026-10-13', expectedRows: 1, totalVolumes: 7, ctcs: ['5602298260'], documents: [{ ctc: '5602298260', nf: '762458-1', volumes: '1', client: 'ASTRAZENECA', recipient: 'VICTORIA' }, { ctc: '5602298260', nf: '762461-1', volumes: '6', client: 'ASTRAZENECA', recipient: 'VICTORIA', review: ['Confira volumes'] }] });
const patch = (nf = '762461-1') => ({ header: {}, rows: [{ index: 1, ctc: '5602298260', nf, volumes: '7', client: 'NOME INVENTADO', recipient: 'OUTRO' }] });
it('selects only flagged fields, treating multi-NF CTCs as legitimate rows', () => {
  expect(photoRepairPlan(sample())).toEqual({ headers: [], rows: [{ index: 1, ctc: '5602298260', nf: '762461-1', fields: ['volumes'] }] });
});
it('changes only a selected cell and keeps the adjustment visible for review', () => {
  const pre = sample(), result = applyPhotoRepair(pre, photoRepairPlan(pre)!, patch());
  expect(result.documents[1]).toMatchObject({ volumes: '7', client: 'ASTRAZENECA', recipient: 'VICTORIA' });
  expect(result.documents[0]).toEqual(pre.documents[0]); expect(pre.documents[1]!.volumes).toBe('6');
  expect(result.documents[1]!.review!.join(' ')).toContain('6 → 7');
});
it('rejects an NF shifted within the same CTC, wrong CTC, ambiguous and invalid repairs', () => {
  const pre = sample(), plan = photoRepairPlan(pre)!;
  expect(applyPhotoRepair(pre, plan, patch('762458-1')).documents).toEqual(pre.documents);
  const wrong = patch(); wrong.rows[0]!.ctc = '0000000001';
  expect(applyPhotoRepair(pre, plan, wrong).documents).toEqual(pre.documents);
  const duplicate = patch(); duplicate.rows.push({ ...duplicate.rows[0]! });
  expect(applyPhotoRepair(pre, plan, duplicate).documents).toEqual(pre.documents);
  expect(applyPhotoRepair(pre, plan, null).documents).toEqual(pre.documents);
});
it('checks all volume cells on a sum mismatch and uses full verification for missing CTCs', () => {
  const pre = sample(); pre.totalVolumes = 98;
  expect(photoRepairPlan(pre)!.rows.every(row => row.fields.includes('volumes'))).toBe(true);
  pre.documents[0]!.ctc = ''; expect(photoRepairPlan(pre)).toBeNull();
});
it('uses actual abbreviated-name variations as uncertainty without guessing a missing letter', () => {
  const rows = ['DIMED SA DISTRIBU', 'DIMED S/A - DISTRI', 'DIMED SA DISTRIB D'].map((recipient, index) => ({ ctc: `000000000${index}`, nf: '123-1', volumes: '1', recipient }));
  const flagged = flagPhotoNameVariants(rows);
  expect(flagged.map(row => row.recipient)).toEqual(rows.map(row => row.recipient));
  expect(flagged.every(row => row.review!.some(note => note.startsWith('Destinatário')))).toBe(true);
  expect(flagPhotoNameVariants([{ ...rows[0]!, recipient: 'UNIMED' }, { ...rows[1]!, recipient: 'FLEURY' }]).every(row => !row.review!.length)).toBe(true);
});
it('rejects the expanded business name observed in the live rereading test', () => {
  const pre = sample(); pre.documents[1]!.recipient = 'DIMED SA DISTRIBU'; pre.documents[1]!.review = ['Confira destinatário'];
  const plan = photoRepairPlan(pre)!; const response = patch(); response.rows[0]!.recipient = 'DIMED SA DISTRIBUIDORA DE MEDICAMENTOS';
  expect(applyPhotoRepair(pre, plan, response).documents[1]!.recipient).toBe('DIMED SA DISTRIBU');
  response.rows[0]!.recipient = 'DIMED SA DISTRIBUI';
  expect(applyPhotoRepair(pre, plan, response).documents[1]!.recipient).toBe('DIMED SA DISTRIBUI');
});

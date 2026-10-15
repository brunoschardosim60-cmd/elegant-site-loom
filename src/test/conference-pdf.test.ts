import { describe, expect, it } from 'vitest';
import { createConferencePdf, selectConferenceReport } from '../lib/conference-pdf';
import type { Manifest } from '../lib/conference';

const now = new Date('2026-10-11T14:00:00Z');
const manifests: Manifest[] = [
  { id: 'DI00000000001', driver: 'DIOGO', plate: 'ABC1D23', date: '2026-10-08T14:00:00Z', documents: [
    { id: 'a', ctc: '0000000001', nf: '101-1', volumes: 2, received: false, client: 'LABORATÓRIO A', recipient: 'CLIENTE A' },
    { id: 'b', ctc: '0000000002', nf: '102-1', volumes: 3, received: true, receivedAt: '2026-10-10T14:00:00Z' },
  ] },
  { id: 'DI00000000002', driver: 'LUCIANO', plate: 'DEF4G56', date: '2026-10-11T14:00:00Z', documents: [{ id: 'c', ctc: '0000000003', nf: '103-1', volumes: 4, received: false }] },
  { id: 'DI00000000003', driver: 'RAFAEL', plate: 'HIJ7K89', date: '2026-10-09T14:00:00Z', finishedAt: '2026-10-10T14:00:00Z', documents: [{ id: 'd', ctc: '0000000004', nf: '104-1', volumes: 5, received: true }] },
];
const base = { manifests, issues: [{ title: 'CTC desconhecido', description: 'CTC 9999999999', time: '10:15' }], generatedAt: now };

describe('PDF report scope', () => {
  it('matches pasted and unaccented searches consistently across report views', () => {
    for (const view of ['pending', 'missing', 'tracking'] as const) {
      const report = selectConferenceReport({ ...base, view, query: '  laboratorio   a  ' });
      expect(report.manifests.map(manifest => manifest.id)).toEqual(['DI00000000001']);
    }
  });
  it('includes the true activity date and identifies undated legacy occurrences', () => {
    const pdf = createConferencePdf({ ...base, view: 'issues', issues: [...base.issues, { title: 'CTC conferido', description: 'CTC 0000000001', time: '01:05', at: '2026-10-13T01:05:00Z' }] });
    const text = pdf.internal.pages.flat().join('\n');
    expect(text).toContain('12/10/2026, 22:05');
    expect(text).toContain('data');
    expect(text).toContain('registrada');
  });
  it('exports only matching tracking CTCs across open and finalized prés', () => {
    const report = selectConferenceReport({ ...base, view: 'tracking', trackingStatus: 'received' });
    expect(report.manifests.flatMap(manifest => manifest.documents.map(doc => doc.ctc))).toEqual(['0000000002', '0000000004']);
    expect(selectConferenceReport({ ...base, view: 'tracking', query: '104-1' }).manifests.flatMap(manifest => manifest.documents.map(doc => doc.ctc))).toEqual(['0000000004']);
    expect(manifests[0]!.documents).toHaveLength(2);
    const pdf = createConferencePdf({ ...base, view: 'tracking', trackingStatus: 'received' });
    expect(pdf.getNumberOfPages()).toBe(1);
    const text = pdf.internal.pages.flat().join('\n');
    expect(text).toContain('0000000002'); expect(text).toContain('0000000004');
    expect(text).not.toContain('(0000000001) Tj'); expect(text).not.toContain('(0000000003) Tj');
  });
  it('exports open prés in screen order, retaining all rows of a matching pré', () => {
    const report = selectConferenceReport({ ...base, view: 'pending', query: '101-1' });
    expect(report.manifests.map(item => item.id)).toEqual(['DI00000000001']);
    expect(report.manifests[0]!.documents.map(doc => doc.ctc)).toEqual(['0000000001', '0000000002']);
    expect(report.issues).toEqual([]);
    expect(selectConferenceReport({ ...base, view: 'pending', filter: 'new' }).manifests.map(item => item.driver)).toEqual(['LUCIANO', 'DIOGO']);
  });
  it('exports only the pending rows matching the search and age filter', () => {
    const report = selectConferenceReport({ ...base, view: 'missing', filter: 'old', query: 'LABORATÓRIO' });
    expect(report.manifests).toHaveLength(1);
    expect(report.manifests[0]!.documents.map(doc => doc.ctc)).toEqual(['0000000001']);
    expect(manifests[0]!.documents).toHaveLength(2);
    expect(selectConferenceReport({ ...base, view: 'finished' }).manifests.map(item => item.driver)).toEqual(['RAFAEL']);
  });
  it('uses original issue dates for age and ordering without inventing them on legacy records', () => {
    const withDate = [{ ...manifests[1]!, issueDate: '2026-08-27' }, manifests[0]!];
    const report = selectConferenceReport({ ...base, manifests: withDate, view: 'missing', filter: 'old' });
    expect(report.manifests.map(manifest => manifest.driver)).toEqual(['LUCIANO', 'DIOGO']);
    expect(report.manifests[0]).toMatchObject({ issueDate: '2026-08-27', date: '2026-10-11T14:00:00Z' });
    expect(report.manifests[1]).not.toHaveProperty('issueDate');
    const pdf = createConferencePdf({ ...base, manifests: withDate, view: 'missing', filter: 'old' });
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(pdf.internal.pages.flat().join('\n')).toContain('27/08/2026');
    expect(pdf.internal.pages.flat().join('\n')).toContain('11/10/2026');
    expect(pdf.internal.pages.flat().join('\n')).toContain('45 dias');
  });
  it('keeps occurrences confined to their own report, without applying a hidden search', () => {
    expect(selectConferenceReport({ ...base, view: 'issues', query: 'not found', filter: 'old' })).toEqual({ manifests: [], issues: base.issues });
  });
  it('paginates long tables without mutating the source records', () => {
    const long = { ...manifests[0]!, documents: Array.from({ length: 85 }, (_, i) => ({ ...manifests[0]!.documents[0]!, id: String(i), ctc: String(i + 1).padStart(10, '0'), client: 'LABORATÓRIO COM NOME COMPLETO PARA CONFERÊNCIA', recipient: 'DESTINATÁRIO COM NOME COMPLETO PARA CONFERÊNCIA' })) };
    const pdf = createConferencePdf({ ...base, manifests: [long], view: 'pending' });
    expect(pdf.getNumberOfPages()).toBeGreaterThan(2);
    expect(long.documents).toHaveLength(85);
    expect(long.documents[84]!.ctc).toBe('0000000085');
  });
  it('prints report branding only once and keeps every CTC on compact continuation pages', () => {
    const long = { ...manifests[0]!, documents: Array.from({ length: 85 }, (_, i) => ({ ...manifests[0]!.documents[0]!, id: String(i), ctc: String(i + 1).padStart(10, '0'), client: 'LABORATÓRIO COM NOME COMPLETO PARA CONFERÊNCIA', recipient: 'DESTINATÁRIO COM NOME COMPLETO PARA CONFERÊNCIA' })) };
    const pdf = createConferencePdf({ ...base, manifests: [long], view: 'pending' });
    const pages = (pdf.internal.pages as unknown as string[][]).slice(1).map(page => page.join('\n'));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('(confere.) Tj');
    for (const page of pages.slice(1)) {
      expect(page).not.toContain('confere.');
      expect(page).not.toContain('Emitido em');
      expect(page).not.toContain('Manifestos em aberto');
      expect(page).toContain('DIOGO');
      expect(page).toContain('DI00000000001');
      expect(page).toContain('(CTC) Tj');
    }
    const allText = pages.join('\n');
    for (const doc of long.documents) expect(allText.split(`(${doc.ctc}) Tj`)).toHaveLength(2);
  });
  it('also uses compact continuation pages for occurrences', () => {
    const issues = Array.from({ length: 80 }, (_, i) => ({ title: `Ocorrência ${i + 1}`, description: `CTC ${String(i + 1).padStart(10, '0')}`, time: '10:15', at: '2026-10-11T13:15:00Z' }));
    const pdf = createConferencePdf({ ...base, view: 'issues', issues });
    const pages = (pdf.internal.pages as unknown as string[][]).slice(1).map(page => page.join('\n'));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('(confere.) Tj');
    for (const page of pages.slice(1)) { expect(page).not.toContain('confere.'); expect(page).not.toContain('Emitido em'); }
    expect(pages.join('\n')).toContain('0000000080');
  });
  it('creates an explicit empty report instead of including data from another view', () => {
    const pdf = createConferencePdf({ ...base, view: 'pending', query: 'does not exist' });
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(selectConferenceReport({ ...base, view: 'pending', query: 'does not exist' }).manifests).toEqual([]);
  });
});

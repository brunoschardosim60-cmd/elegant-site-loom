import { describe, expect, it } from 'vitest';
import { correctLocalPhoto } from '@/lib/photo-local-correction';
import { markLocalPhoto } from '@/lib/local-photo';
import type { PhotoFields } from '@/lib/photo-fields';

const data = (): PhotoFields => ({ kind: 'pre', id: 'DI00000000001', issueDate: '2026-08-28', plate: 'ABC1D23', driver: 'MOTORISTA TESTE', expectedRows: 2, totalVolumes: 5, ctcs: ['0000000001', '0000000002'], headerReview: [], readingSource: 'gemini',
  documents: [{ ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LAB A', recipient: 'DEST A', review: [] }, { ctc: '0000000002', nf: '202-10', volumes: '3', client: 'LAB B', recipient: 'DEST B', review: [] }] });

describe('AI correction of a local OCR draft', () => {
  it('confirms independent agreement without carrying blanket local-review notices', () => {
    const local = markLocalPhoto(data()), ai = data(); const result = correctLocalPhoto(local, ai);
    expect(result.verification).toMatchObject({ status: 'matched', conflicts: 0 });
    expect(result.verification!.checkedFields).toBe(14); expect(result.headerReview).toEqual([]);
    expect(result.documents.every(row => row.review?.length === 0)).toBe(true);
    expect(local.readingSource).toBe('local'); expect(local.documents[0]!.review!.length).toBeGreaterThan(0);
  });

  it('matches reordered rows by CTC and corrects NF, volumes and literal client names', () => {
    const local = markLocalPhoto(data()), ai = data(); ai.documents.reverse();
    local.documents[0] = { ...local.documents[0]!, nf: '10-1', volumes: '8', client: 'LAB OCR' };
    const result = correctLocalPhoto(local, ai);
    expect(result.documents[0]).toMatchObject({ ctc: '0000000002', nf: '202-10', volumes: '3', client: 'LAB B' });
    expect(result.documents[1]).toMatchObject({ ctc: '0000000001', nf: '101-1', volumes: '2', client: 'LAB A' });
    expect(result.documents[1]!.review).toHaveLength(3); expect(result.verification).toMatchObject({ status: 'review', conflicts: 3 });
    expect(result.documents[0]!.review).toEqual([]);
  });

  it('retains local numbers when AI leaves them blank and never presents them as confirmed', () => {
    const local = markLocalPhoto(data()), ai = data(); ai.documents[0]!.nf = ''; ai.documents[0]!.volumes = ''; ai.documents[0]!.client = '';
    const result = correctLocalPhoto(local, ai);
    expect(result.documents[0]).toMatchObject({ nf: '101-1', volumes: '2', client: 'LAB A' });
    expect(result.documents[0]!.review!.every(note => note.includes('mantido da leitura local'))).toBe(true);
    expect(result.verification!.status).toBe('review');
  });

  it('preserves all local CTCs omitted by AI and signals the resulting header mismatch', () => {
    const local = markLocalPhoto(data()), ai = data(); ai.documents.pop();
    const result = correctLocalPhoto(local, ai);
    expect(result.documents.map(row => row.ctc)).toEqual(['0000000001', '0000000002']);
    expect(result.documents[1]!.review!.join(' ')).toContain('CTC ausente na leitura da IA');
    expect(result.verification!.status).toBe('review');
  });

  it('does not merge cell values into duplicated AI identities or infer CTC digits', () => {
    const local = markLocalPhoto(data()), ai = data(); ai.documents[0]!.ctc = '0000000002'; ai.documents[0]!.nf = '';
    const result = correctLocalPhoto(local, ai);
    expect(result.documents[0]!.nf).toBe('');
    expect(result.documents[0]!.review!.join(' ')).toContain('CTC identificado somente pela IA');
    expect(result.headerReview!.join(' ')).toContain('repetidos ou ilegíveis');
    expect(result.documents.at(-1)!.ctc).toBe('0000000001');
  });

  it('keeps the local document when AI detects a different document type or no rows', () => {
    const local = markLocalPhoto(data());
    for (const ai of [{ ...data(), kind: 'dacte' as const }, { ...data(), documents: [] }]) {
      const result = correctLocalPhoto(local, ai);
      expect(result.readingSource).toBe('local'); expect(result.readingFallback).toBe(true);
      expect(result.documents).toHaveLength(2); expect(result.verification!.status).toBe('unavailable');
    }
  });

  it('corrects header data with explicit review while preserving missing AI fields', () => {
    const local = markLocalPhoto(data()), ai = data(); local.id = 'DI00000000002'; local.plate = 'ABC1D24'; local.driver = 'MOTORISTA OCR'; local.issueDate = '2026-08-20';
    const result = correctLocalPhoto(local, ai);
    expect(result).toMatchObject({ id: 'DI00000000001', plate: 'ABC1D23', driver: 'MOTORISTA TESTE', issueDate: '2026-08-28' });
    expect(result.headerReview).toHaveLength(4); expect(result.verification!.status).toBe('review');
    const missing = data(); missing.issueDate = ''; missing.driver = '';
    expect(correctLocalPhoto(data(), missing)).toMatchObject({ issueDate: '2026-08-28', driver: 'MOTORISTA TESTE' });
  });

  it('never marks a structurally incomplete table or inconsistent totals as matched', () => {
    const local = markLocalPhoto(data()), ai = data(); ai.documents[0]!.nf = ''; local.documents[0]!.nf = ''; ai.totalVolumes = 30; ai.expectedRows = 3;
    const result = correctLocalPhoto(local, ai);
    expect(result.documents[0]!.review!.join(' ')).toContain('Confira NF');
    expect(result.headerReview!.join(' ')).toContain('Cabeçalho informa 30 volumes');
    expect(result.headerReview!.join(' ')).toContain('Cabeçalho informa 3 CTCs');
    expect(result.verification!.status).toBe('review');
  });
});

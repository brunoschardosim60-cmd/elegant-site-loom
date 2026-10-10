import { parseReading, type Manifest, type DocumentItem } from './conference';
import type { ManifestDraftRow } from '../components/manifest-documents-editor';
export type ImportDraft = { id: string; plate: string; driver: string; rows: ManifestDraftRow[]; targetId?: string };
export type ImportOutcome = { ok: true; manifests: Manifest[] } | { ok: false; error: string; index: number; row?: number | undefined };

export function applyImports(existing: Manifest[], drafts: ImportDraft[], now: string): ImportOutcome {
  let manifests = [...existing];
  for (const [index, draft] of drafts.entries()) {
    const id = (draft.targetId || draft.id).trim().toUpperCase();
    const target = draft.targetId ? manifests.find(m => m.id === id) : undefined;
    const fail = (error: string, row?: number): ImportOutcome => ({ ok: false, error, index, row });
    if (draft.targetId && !target) return fail('Selecione um pré-manifesto cadastrado.');
    if (!/^DI\d{8,12}$/.test(id)) return fail('Confira o número do pré (DI seguido de 8 a 12 dígitos).');
    if (!target && (!draft.driver.trim() || !draft.plate.trim())) return fail('Preencha motorista e placa.');
    if (!target && manifests.some(m => m.id === id)) return fail('Esse pré já está cadastrado ou repetido no lote.');
    if (!draft.rows.length) return fail('Inclua pelo menos um CTC.');
    const identifiers = new Set(target?.documents.map(d => d.ctc));
    const docs: DocumentItem[] = [];
    for (const [row, item] of draft.rows.entries()) {
      const reading = parseReading(item.ctc);
      if (reading.kind !== 'ctc') return fail('Confira o CTC de 10 dígitos.', row);
      if (!Number.isInteger(Number(item.volumes)) || Number(item.volumes) < 1) return fail('Confira a quantidade de volumes (inteiro maior que zero).', row);
      if (identifiers.has(reading.number)) return fail(`CTC ${reading.number} repetido neste pré.`, row);
      identifiers.add(reading.number);
      docs.push({ id: `${id}-${reading.number}`, ctc: reading.number, nf: item.nf.trim() || '—', client: item.client?.trim() || '', recipient: item.recipient?.trim() || '', volumes: Number(item.volumes), received: false });
    }
    if (target) manifests = manifests.map(m => m.id === id ? { ...m, documents: [...m.documents, ...docs], finishedAt: undefined } : m);
    else manifests.push({ id, driver: draft.driver.trim(), plate: draft.plate.trim().toUpperCase(), date: now, documents: docs });
  }
  return { ok: true, manifests };
}

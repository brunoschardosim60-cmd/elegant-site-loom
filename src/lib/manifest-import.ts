import { parseReading, type Manifest, type DocumentItem } from './conference';
import { normalizeIssueDate } from './manifest-date';
import type { ManifestDraftRow } from '../components/manifest-documents-editor';
export type ImportDraft = { id: string; plate: string; driver: string; issueDate?: string | undefined; sourcePhotoHash?: string | undefined; rows: ManifestDraftRow[]; targetId?: string };
export type ImportOutcome = { ok: true; manifests: Manifest[] } | { ok: false; error: string; index: number; row?: number | undefined };
export type ImportConflict = { kind: 'manifest' | 'ctc'; index: number; row?: number; message: string; manifestId?: string };

type Owner = { id: string; driver: string };
type DraftOwner = Owner & { index: number; row?: number };
const normalizedId = (id: string) => id.trim().toUpperCase();
const normalizedHash = (hash: string | undefined) => hash && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : undefined;
const ownerLabel = (owner: Owner) => `pré ${owner.id || 'sem número'} · motorista ${owner.driver.trim() || 'não informado'}`;
const addOwner = <T,>(map: Map<string, T[]>, key: string, owner: T) => { map.set(key, [...(map.get(key) ?? []), owner]); };

/** Report every affected draft/row, without rejecting duplicate legacy snapshots. */
export function findImportConflicts(existing: Manifest[], drafts: ImportDraft[]): ImportConflict[] {
  const savedIds = new Map<string, Owner[]>();
  const savedCtcs = new Map<string, Owner[]>();
  const savedHashes = new Map<string, Owner[]>();
  for (const manifest of existing) {
    const owner = { id: normalizedId(manifest.id), driver: manifest.driver };
    addOwner(savedIds, owner.id, owner);
    for (const document of manifest.documents) {
      const reading = parseReading(document.ctc);
      if (reading.kind === 'ctc') addOwner(savedCtcs, reading.number, owner);
    }
    for (const raw of manifest.sourcePhotoHashes ?? []) {
      const hash = normalizedHash(raw);
      if (hash) addOwner(savedHashes, hash, owner);
    }
  }
  const ids = new Map<string, DraftOwner[]>();
  const ctcs = new Map<string, DraftOwner[]>();
  const hashes = new Map<string, DraftOwner[]>();
  for (const [index, draft] of drafts.entries()) {
    const id = normalizedId(draft.targetId || draft.id);
    const target = draft.targetId ? existing.find(manifest => normalizedId(manifest.id) === id) ?? drafts.find(item => !item.targetId && normalizedId(item.id) === id) : undefined;
    const owner: DraftOwner = { id, driver: target?.driver ?? draft.driver, index };
    if (!draft.targetId && /^DI\d{8,12}$/.test(id)) addOwner(ids, id, owner);
    const hash = normalizedHash(draft.sourcePhotoHash);
    if (hash) addOwner(hashes, hash, owner);
    for (const [row, item] of draft.rows.entries()) {
      const reading = parseReading(item.ctc);
      if (reading.kind === 'ctc') addOwner(ctcs, reading.number, { ...owner, row });
    }
  }
  const conflicts: ImportConflict[] = [];
  const push = (kind: ImportConflict['kind'], owner: DraftOwner, reference: Owner, message: string) => {
    conflicts.push({ kind, index: owner.index, ...(owner.row !== undefined ? { row: owner.row } : {}), message, manifestId: reference.id });
  };
  for (const [id, owners] of ids) for (const owner of owners) {
    for (const reference of savedIds.get(id) ?? []) push('manifest', owner, reference, `Esse ${ownerLabel(reference)} já está cadastrado.`);
    const other = owners.find(candidate => candidate !== owner);
    if (other) push('manifest', owner, other, `Esse ${ownerLabel(other)} está repetido no lote.`);
  }
  for (const [hash, owners] of hashes) for (const owner of owners) {
    for (const reference of savedHashes.get(hash) ?? []) push('manifest', owner, reference, `Esta foto já foi cadastrada no ${ownerLabel(reference)}.`);
    const other = owners.find(candidate => candidate !== owner);
    if (other) push('manifest', owner, other, `Esta foto está repetida no lote no ${ownerLabel(other)}.`);
  }
  for (const [ctc, owners] of ctcs) for (const owner of owners) {
    // Multiple NF rows may legitimately share one CTC inside the same pre.
    // Only report repeated CTCs when they belong to different manifests/drafts.
    for (const reference of savedCtcs.get(ctc) ?? []) {
      if (normalizedId(reference.id) !== owner.id) push('ctc', owner, reference, `CTC ${ctc} já está cadastrado no ${ownerLabel(reference)}.`);
    }
    const other = owners.find(candidate => candidate.index !== owner.index);
    if (other) push('ctc', owner, other, `CTC ${ctc} repetido no ${ownerLabel(other)} do lote.`);
  }
  return [...new Map(conflicts.map(conflict => [JSON.stringify(conflict), conflict])).values()];
}

export function applyImports(existing: Manifest[], drafts: ImportDraft[], now: string): ImportOutcome {
  let manifests = [...existing];
  const indexed = drafts.map((draft, index) => ({ draft, index }));
  // A DACTE may select a new pre anywhere in the photo queue. Register new
  // pres first while retaining original error indexes and their relative order.
  const ordered = [...indexed.filter(item => !item.draft.targetId), ...indexed.filter(item => item.draft.targetId)];
  for (const { index, draft } of ordered) {
    const id = (draft.targetId || draft.id).trim().toUpperCase();
    const target = draft.targetId ? manifests.find(m => m.id === id) : undefined;
    const fail = (error: string, row?: number): ImportOutcome => ({ ok: false, error, index, row });
    if (draft.targetId && !target) return fail('Selecione um pré-manifesto cadastrado.');
    if (!/^DI\d{8,12}$/.test(id)) return fail('Confira o número do pré (DI seguido de 8 a 12 dígitos).');
    if (!target && (!draft.driver.trim() || !draft.plate.trim())) return fail('Preencha motorista e placa.');
    const sourcePhotoHash = normalizedHash(draft.sourcePhotoHash);
    if (draft.sourcePhotoHash !== undefined && !sourcePhotoHash) return fail('Confira a identificação da foto antes de cadastrar novamente.');
    const conflicts = findImportConflicts(manifests, [draft]);
    const manifestConflict = conflicts.find(conflict => conflict.kind === 'manifest');
    if (manifestConflict) return fail(manifestConflict.message);
    const issueDate = !target ? normalizeIssueDate(draft.issueDate ?? '') : undefined;
    if (!target && draft.issueDate?.trim() && !issueDate) return fail('Confira a data de emissão do pré.');
    if (!draft.rows.length) return fail('Inclua pelo menos um CTC.');
    const registeredCtcs = new Set(manifests
      .filter(manifest => normalizedId(manifest.id) !== normalizedId(id))
      .flatMap(manifest => manifest.documents.map(document => document.ctc)));
    const grouped = new Map<string, { rows: ManifestDraftRow[]; firstRow: number }>();
    for (const [row, item] of draft.rows.entries()) {
      const reading = parseReading(item.ctc);
      if (reading.kind !== 'ctc') return fail('Confira o CTC de 10 dígitos.', row);
      if (!Number.isInteger(Number(item.volumes)) || Number(item.volumes) < 1) return fail('Confira a quantidade de volumes (inteiro maior que zero).', row);
      if (registeredCtcs.has(reading.number)) return fail(conflicts.find(conflict => conflict.kind === 'ctc' && conflict.row === row)?.message ?? `CTC ${reading.number} já está cadastrado em outro pré.`, row);
      const group = grouped.get(reading.number) ?? { rows: [], firstRow: row };
      group.rows.push(item);
      grouped.set(reading.number, group);
    }
    const docs: DocumentItem[] = [...grouped.entries()].map(([ctc, group]) => {
      const unique = (field: 'nf' | 'client' | 'recipient') => [...new Set(group.rows.map(item => item[field]?.trim() ?? '').filter(Boolean))];
      return {
        id: `${id}-${ctc}`,
        ctc,
        nf: unique('nf').join(', ') || '—',
        client: unique('client').join(' / '),
        recipient: unique('recipient').join(' / '),
        volumes: group.rows.reduce((sum, item) => sum + Number(item.volumes), 0),
        received: false,
      };
    });
    if (target) manifests = manifests.map(m => m.id === id ? { ...m, documents: [...m.documents, ...docs], ...(sourcePhotoHash ? { sourcePhotoHashes: [...new Set([...(m.sourcePhotoHashes ?? []).map(hash => hash.toLowerCase()), sourcePhotoHash])] } : {}), finishedAt: undefined } : m);
    else manifests.push({ id, driver: draft.driver.trim(), plate: draft.plate.trim().toUpperCase(), date: now, ...(issueDate ? { issueDate } : {}), ...(sourcePhotoHash ? { sourcePhotoHashes: [sourcePhotoHash] } : {}), documents: docs });
  }
  return { ok: true, manifests };
}

import type { ImportDraft } from './manifest-import';
import { normalizeIssueDate } from './manifest-date';

export type SheetCell = string | number | boolean | null;
export type LuftSheet = { name: string; rows: SheetCell[][] };
export type LuftExport = { drafts: ImportDraft[]; ignored: number; repeated: number; selectedRows: number; errors: string[] };
const fields = ['Manifesto', 'Motivo', 'Filial', 'Dataemissao', 'Placa', 'Motorista', 'CTRC', 'Remet Nome', 'Dest Nome', 'NF', 'Serie', 'Volumes'] as const;
const normalized = (value: SheetCell | undefined) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const literal = (value: SheetCell | undefined) => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : '';

/** Literal cell values only. No OCR substitutions, inferred series or guessed zeros. */
export function parseLuft108(sheets: LuftSheet[]): LuftExport {
  const matching = sheets.filter(sheet => fields.every(field => sheet.rows[0]?.some(cell => normalized(cell) === normalized(field))));
  if (matching.length > 1) throw new Error('A planilha tem mais de uma aba de relatório 108. Exporte os dias juntos em uma única aba.');
  const sheet = matching[0];
  if (!sheet) throw new Error('Envie o relatório 108 — Relação de Notas por Manifesto, em XLSX. Faltam colunas obrigatórias.');
  const headers = sheet.rows[0]!;
  const indexes = Object.fromEntries(fields.map(field => [field, headers.findIndex(cell => normalized(cell) === normalized(field))])) as Record<typeof fields[number], number>;
  if (fields.some(field => headers.filter(cell => normalized(cell) === normalized(field)).length !== 1)) throw new Error('A planilha tem colunas obrigatórias repetidas. Gere novamente o relatório 108.');
  const groups = new Map<string, ImportDraft>();
  const seen = new Map<string, string>();
  const owners = new Map<string, string>();
  const errors: string[] = [];
  let ignored = 0, repeated = 0, selectedRows = 0;
  for (const [index, cells] of sheet.rows.slice(1).entries()) {
    if (cells.every(cell => cell === null || cell === '')) continue;
    const at = (field: typeof fields[number]) => cells[indexes[field]];
    const branch = normalized(at('Filial'));
    // Excel may store branch 06 as the integer 6, but CTC and manifest zeros are never guessed.
    if (!['06', '6'].includes(branch) || normalized(at('Motivo')) !== 'DIS') { ignored++; continue; }
    selectedRows++;
    const id = literal(at('Manifesto')), ctc = literal(at('CTRC'));
    const nf = literal(at('NF')), series = literal(at('Serie'));
    const plate = normalized(at('Placa')), driver = String(at('Motorista') ?? '').trim();
    const client = String(at('Remet Nome') ?? '').trim(), recipient = String(at('Dest Nome') ?? '').trim();
    const issueDate = normalizeIssueDate(literal(at('Dataemissao')));
    const rawVolumes = at('Volumes');
    const volumes = typeof rawVolumes === 'number' ? rawVolumes : typeof rawVolumes === 'string' && /^\d+$/.test(rawVolumes.trim()) ? Number(rawVolumes) : NaN;
    const bad = !/^\d{8,12}$/.test(id) ? 'número do manifesto' : !/^\d{10}$/.test(ctc) ? 'CTC de 10 dígitos' : !/^\d{1,9}$/.test(nf) || !/^\d{1,3}$/.test(series) ? 'NF e série' : !Number.isSafeInteger(volumes) || volumes < 1 || volumes > 1000000 ? 'volumes' : !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate) ? 'placa' : !driver || !client || !recipient ? 'motorista, remetente ou destinatário' : !issueDate ? 'data de emissão do manifesto' : '';
    const fail = (message: string) => { if (errors.length < 100) errors.push(`Linha ${index + 2}: ${message}.`); };
    if (bad) { fail(`confira ${bad}`); continue; }
    const identity = JSON.stringify([id, ctc, nf, series]);
    const content = JSON.stringify([plate, normalized(driver), issueDate, client, recipient, volumes]);
    if (seen.has(identity)) {
      if (seen.get(identity) === content) repeated++;
      else fail(`CTC ${ctc} / NF ${nf}-${series} repetido com dados diferentes`);
      continue;
    }
    seen.set(identity, content);
    const owner = owners.get(ctc);
    if (owner && owner !== id) { fail(`CTC ${ctc} aparece nos manifestos ${owner} e ${id}`); continue; }
    owners.set(ctc, id);
    const draft = groups.get(id) ?? { id, plate, driver, issueDate, rows: [] };
    if (draft.plate !== plate || normalized(draft.driver) !== normalized(driver) || draft.issueDate !== issueDate) { fail(`o manifesto ${id} tem motorista, placa ou data conflitantes`); continue; }
    draft.rows.push({ ctc, nf: `${nf}-${series}`, volumes: String(volumes), client, recipient });
    groups.set(id, draft);
  }
  const drafts = [...groups.values()].map(draft => ({ ...draft, expectedRows: new Set(draft.rows.map(row => row.ctc)).size, expectedNfs: draft.rows.length, totalVolumes: draft.rows.reduce((sum, row) => sum + Number(row.volumes), 0) })).sort((a, b) => (a.issueDate ?? '').localeCompare(b.issueDate ?? '') || a.id.localeCompare(b.id));
  for (const draft of drafts) if (draft.expectedRows > 300 || draft.totalVolumes > 1000000) errors.push(`Manifesto ${draft.id}: excede o limite de CTCs ou volumes por cadastro.`);
  if (!selectedRows) throw new Error('Nenhuma linha da filial 06 com motivo DIS foi encontrada. TRA e outras filiais não são importados.');
  return { drafts, ignored, repeated, selectedRows, errors };
}

export function luftManifestDays(drafts: ImportDraft[]) {
  const days = new Map<string, { date: string; manifests: number; ctcs: number; nfs: number; volumes: number }>();
  for (const draft of drafts) {
    const date = draft.issueDate ?? '';
    const day = days.get(date) ?? { date, manifests: 0, ctcs: 0, nfs: 0, volumes: 0 };
    day.manifests++; day.ctcs += draft.expectedRows ?? new Set(draft.rows.map(row => row.ctc)).size;
    day.nfs += draft.rows.length; day.volumes += draft.totalVolumes ?? draft.rows.reduce((sum, row) => sum + Number(row.volumes), 0);
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Check declared ZIP expansion before loading Excel; the worker has its own time limit. */
export function validateSpreadsheetZip(buffer: ArrayBuffer) {
  if (buffer.byteLength < 22 || buffer.byteLength > 8 * 1024 * 1024) throw new Error('Envie uma planilha XLSX de até 8 MB.');
  const view = new DataView(buffer);
  let end = -1;
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 65557); at--) if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === buffer.byteLength) { end = at; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Arquivo XLSX inválido ou dividido em várias partes.');
  const entries = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (!entries || entries > 2000 || start + size !== end) throw new Error('A estrutura da planilha excede os limites de leitura.');
  let at = start, total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50 || view.getUint16(at + 8, true) & 1) throw new Error('Arquivo XLSX inválido ou protegido por senha.');
    total += view.getUint32(at + 24, true);
    if (total > 48 * 1024 * 1024) throw new Error('A planilha descompactada excede 48 MB. Exporte um período menor.');
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (at > end) throw new Error('Arquivo XLSX inválido.');
  }
  if (at !== end) throw new Error('Arquivo XLSX inválido.');
}

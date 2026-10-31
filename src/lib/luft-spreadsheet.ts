import type { ImportDraft } from "./manifest-import";
import { normalizeIssueDate, normalizeIssueTime } from "./manifest-date";
import { isAnotherRoute } from "./conference-routes";
import { lastOccurrenceDate } from "./nf-occurrence-date";
import { spreadsheetLimits } from "./luft-spreadsheet-limits";

export type SheetCell = string | number | boolean | null;
export type LuftSheet = {
  name: string;
  rows: SheetCell[][];
  rowNumbers?: number[];
  ignored?: number;
};
export type LuftExport = {
  drafts: ImportDraft[];
  ignored: number;
  repeated: number;
  selectedRows: number;
  errors: string[];
};
const fields = [
  "Manifesto",
  "Motivo",
  "Filial",
  "Dataemissao",
  "Placa",
  "Motorista",
  "CTRC",
  "Remet Nome",
  "Dest Nome",
  "NF",
  "Serie",
  "Volumes",
] as const;
const normalized = (value: SheetCell | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
const literal = (value: SheetCell | undefined) =>
  typeof value === "string"
    ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : "";

export const isLuft108Header = (row: SheetCell[]) =>
  fields.every((field) => row.some((cell) => normalized(cell) === normalized(field)));

export const luftColumnIndex = (row: SheetCell[], name: string) =>
  row.findIndex((cell) => normalized(cell) === normalized(name));

/** Which rows of the 108 export belong to the team (team settings; default 06/DIS). */
export type LuftFilter = { branches: string[]; reasons: string[] };
export const defaultLuftFilter: LuftFilter = { branches: ["06"], reasons: ["DIS"] };
/** Branch codes compare as numbers when numeric: Excel may store 06 as 6. */
const branchKey = (value: string) => (/^\d+$/.test(value) ? String(Number(value)) : value);
export const isLuft108Demand = (
  branch: SheetCell | undefined,
  reason: SheetCell | undefined,
  filter: LuftFilter = defaultLuftFilter,
) =>
  filter.branches.some((code) => branchKey(normalized(code)) === branchKey(normalized(branch))) &&
  filter.reasons.some((code) => normalized(code) === normalized(reason));
/** "filial 06 / DIS" or "filiais 06, 12 / DIS, TRA", for messages. */
export const describeLuftFilter = (filter: LuftFilter = defaultLuftFilter) =>
  `${filter.branches.length > 1 ? "filiais" : "filial"} ${filter.branches.join(", ")} / ${filter.reasons.join(", ")}`;

/** Literal cell values only. No OCR substitutions, inferred series or guessed zeros. */
export function parseLuft108(
  sheets: LuftSheet[],
  filter: LuftFilter = defaultLuftFilter,
): LuftExport {
  const matching = sheets.filter((sheet) => isLuft108Header(sheet.rows[0] ?? []));
  if (matching.length > 1)
    throw new Error(
      "A planilha tem mais de uma aba de relatório 108. Exporte os dias juntos em uma única aba.",
    );
  const sheet = matching[0];
  if (!sheet)
    throw new Error(
      "Envie o relatório 108 — Relação de Notas por Manifesto, em XLSX. Faltam colunas obrigatórias.",
    );
  const headers = sheet.rows[0]!;
  const occurrenceCodeIndex = headers.findIndex(
    (cell) => normalized(cell) === "CODIGO ULTIMA OCORRENCIA",
  );
  const occurrenceDescriptionIndex = headers.findIndex(
    (cell) => normalized(cell) === "DESCRICAO ULTIMA OCORRENCIA",
  );
  const occurrenceHistoryIndex = headers.findIndex((cell) => normalized(cell) === "OCORRENCIAS");
  const occurrenceDateIndex = headers.findIndex(
    (cell) => normalized(cell) === "DATA ULTIMA OCORRENCIA",
  );
  if (
    [
      "CODIGO ULTIMA OCORRENCIA",
      "DESCRICAO ULTIMA OCORRENCIA",
      "OCORRENCIAS",
      "DATA ULTIMA OCORRENCIA",
    ].some((field) => headers.filter((cell) => normalized(cell) === field).length > 1)
  )
    throw new Error(
      "As colunas de última ocorrência estão repetidas. Gere novamente o relatório 108.",
    );
  const timeIndex = headers.findIndex((cell) => normalized(cell) === "HORAEMISSAO");
  const deliveryIndex = headers.findIndex((cell) => normalized(cell) === "PREV ENTREGA");
  if (
    ["HORAEMISSAO", "PREV ENTREGA"].some(
      (field) => headers.filter((cell) => normalized(cell) === field).length > 1,
    )
  )
    throw new Error(
      "As colunas de horário ou previsão de entrega estão repetidas. Gere novamente o relatório 108.",
    );
  const indexes = Object.fromEntries(
    fields.map((field) => [
      field,
      headers.findIndex((cell) => normalized(cell) === normalized(field)),
    ]),
  ) as Record<(typeof fields)[number], number>;
  if (
    fields.some(
      (field) => headers.filter((cell) => normalized(cell) === normalized(field)).length !== 1,
    )
  )
    throw new Error(
      "A planilha tem colunas obrigatórias repetidas. Gere novamente o relatório 108.",
    );
  const groups = new Map<string, ImportDraft>();
  const seen = new Map<string, string>();
  const errors: string[] = [];
  let ignored = sheet.ignored ?? 0,
    repeated = 0,
    selectedRows = 0;
  for (const [index, cells] of sheet.rows.slice(1).entries()) {
    if (cells.every((cell) => cell === null || cell === "")) continue;
    const at = (field: (typeof fields)[number]) => cells[indexes[field]];
    // Excel may store branch 06 as the integer 6, but CTC and manifest zeros are never guessed.
    if (!isLuft108Demand(at("Filial"), at("Motivo"), filter)) {
      ignored++;
      continue;
    }
    selectedRows++;
    const id = literal(at("Manifesto")),
      ctc = literal(at("CTRC"));
    const nf = literal(at("NF")),
      series = literal(at("Serie"));
    const plate = normalized(at("Placa")),
      driver = String(at("Motorista") ?? "").trim();
    const client = String(at("Remet Nome") ?? "").trim(),
      recipient = String(at("Dest Nome") ?? "").trim();
    const issueDate = normalizeIssueDate(literal(at("Dataemissao")));
    const rawTime = timeIndex >= 0 ? literal(cells[timeIndex]) : "";
    const issueTime = normalizeIssueTime(rawTime);
    const deliveryDate =
      deliveryIndex >= 0 ? normalizeIssueDate(literal(cells[deliveryIndex])) : undefined;
    const rawVolumes = at("Volumes");
    const occurrenceCode = occurrenceCodeIndex >= 0 ? literal(cells[occurrenceCodeIndex]) : "";
    const occurrenceDescription =
      occurrenceDescriptionIndex >= 0 ? String(cells[occurrenceDescriptionIndex] ?? "").trim() : "";
    const occurrenceDate =
      (occurrenceDateIndex >= 0
        ? normalizeIssueDate(literal(cells[occurrenceDateIndex]))
        : undefined) ??
      lastOccurrenceDate(
        occurrenceCode,
        occurrenceHistoryIndex >= 0 ? String(cells[occurrenceHistoryIndex] ?? "") : "",
      );
    const volumes =
      typeof rawVolumes === "number"
        ? rawVolumes
        : typeof rawVolumes === "string" && /^\d+$/.test(rawVolumes.trim())
          ? Number(rawVolumes)
          : NaN;
    const bad = !/^\d{8,12}$/.test(id)
      ? "número do manifesto"
      : !/^\d{10}$/.test(ctc)
        ? "CTC de 10 dígitos"
        : !/^\d{1,9}$/.test(nf) || !/^\d{1,3}$/.test(series)
          ? "NF e série"
          : !Number.isSafeInteger(volumes) || volumes < 1 || volumes > 1000000
            ? "volumes"
            : !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)
              ? "placa"
              : !driver || !client || !recipient
                ? "motorista, remetente ou destinatário"
                : !issueDate
                  ? "data de emissão do manifesto"
                  : rawTime && !issueTime
                    ? "horário de emissão"
                    : occurrenceCode.length > 32 || occurrenceDescription.length > 1000
                      ? "código ou descrição da ocorrência"
                      : "";
    const fail = (message: string) => {
      if (errors.length < 100)
        errors.push(`Linha ${sheet.rowNumbers?.[index + 1] ?? index + 2}: ${message}.`);
    };
    if (bad) {
      fail(`confira ${bad}`);
      continue;
    }
    const identity = JSON.stringify([id, ctc, nf, series]);
    const content = JSON.stringify([
      plate,
      normalized(driver),
      issueDate,
      client,
      recipient,
      volumes,
      issueTime,
      deliveryDate,
      occurrenceCode,
      occurrenceDescription,
      occurrenceDate,
    ]);
    if (seen.has(identity)) {
      if (seen.get(identity) === content) repeated++;
      else fail(`CTC ${ctc} / NF ${nf}-${series} repetido com dados diferentes`);
      continue;
    }
    seen.set(identity, content);
    const draft = groups.get(id) ?? {
      id,
      plate,
      driver,
      issueDate,
      ...(issueTime ? { issueTime } : {}),
      rows: [],
    };
    if (
      draft.plate !== plate ||
      normalized(draft.driver) !== normalized(driver) ||
      draft.issueDate !== issueDate ||
      draft.issueTime !== issueTime
    ) {
      fail(`o manifesto ${id} tem motorista, placa ou data conflitantes`);
      continue;
    }
    draft.rows.push({
      ctc,
      nf: `${nf}-${series}`,
      volumes: String(volumes),
      client,
      recipient,
      ...(deliveryDate ? { deliveryDate } : {}),
      ...(occurrenceCode ? { occurrenceCode } : {}),
      ...(occurrenceDescription ? { occurrenceDescription } : {}),
      ...(occurrenceDate ? { occurrenceDate } : {}),
    });
    groups.set(id, draft);
  }
  const drafts = [...groups.values()]
    .map((draft) => ({
      ...draft,
      expectedRows: new Set(draft.rows.map((row) => row.ctc)).size,
      expectedNfs: draft.rows.length,
      totalVolumes: draft.rows.reduce((sum, row) => sum + Number(row.volumes), 0),
    }))
    .sort(
      (a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? "") || a.id.localeCompare(b.id),
    );
  for (const draft of drafts)
    if (draft.expectedRows > 300 || draft.totalVolumes > 1000000)
      errors.push(`Manifesto ${draft.id}: excede o limite de CTCs ou volumes por cadastro.`);
  if (!selectedRows)
    throw new Error(
      `Nenhuma linha da ${describeLuftFilter(filter)} foi encontrada. Confira a configuração da equipe ou o período exportado.`,
    );
  return { drafts, ignored, repeated, selectedRows, errors };
}

/** Keep remanifested rows intact for an explicit selection, never two receipt targets. */
export function findLuftCtcOverlaps(drafts: ImportDraft[]) {
  const owners = new Map<string, Set<string>>();
  for (const draft of drafts)
    for (const row of draft.rows) {
      const ids = owners.get(row.ctc) ?? new Set<string>();
      ids.add(draft.id);
      owners.set(row.ctc, ids);
    }
  return [...owners]
    .filter(([, ids]) => ids.size > 1)
    .map(([ctc, ids]) => ({
      ctc,
      manifestIds: [...ids].filter((id) =>
        [...ids].some(
          (other) =>
            id !== other &&
            !isAnotherRoute(
              drafts.find((draft) => draft.id === id)!,
              drafts.find((draft) => draft.id === other)!,
            ),
        ),
      ),
    }))
    .filter((item) => item.manifestIds.length > 1);
}

export function luftManifestDays(drafts: ImportDraft[]) {
  const days = new Map<
    string,
    { date: string; manifests: number; ctcs: number; nfs: number; volumes: number }
  >();
  for (const draft of drafts) {
    const date = draft.issueDate ?? "";
    const day = days.get(date) ?? { date, manifests: 0, ctcs: 0, nfs: 0, volumes: 0 };
    day.manifests++;
    day.ctcs += draft.expectedRows ?? new Set(draft.rows.map((row) => row.ctc)).size;
    day.nfs += draft.rows.length;
    day.volumes +=
      draft.totalVolumes ?? draft.rows.reduce((sum, row) => sum + Number(row.volumes), 0);
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Check declared ZIP expansion before loading Excel; the worker has its own time limit. */
export function validateSpreadsheetZip(buffer: ArrayBuffer) {
  if (buffer.byteLength < 22 || buffer.byteLength > spreadsheetLimits.fileBytes)
    throw new Error(`Envie uma planilha XLSX de até ${spreadsheetLimits.fileMb} MB.`);
  const view = new DataView(buffer);
  let end = -1;
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 65557); at--)
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === buffer.byteLength
    ) {
      end = at;
      break;
    }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new Error("Arquivo XLSX inválido ou dividido em várias partes.");
  const entries = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (!entries || entries > 2000 || start + size !== end)
    throw new Error("A estrutura da planilha excede os limites de leitura.");
  let at = start,
    total = 0;
  for (let n = 0; n < entries; n++) {
    if (
      at + 46 > end ||
      view.getUint32(at, true) !== 0x02014b50 ||
      view.getUint16(at + 8, true) & 1
    )
      throw new Error("Arquivo XLSX inválido ou protegido por senha.");
    total += view.getUint32(at + 24, true);
    if (total > spreadsheetLimits.expandedBytes)
      throw new Error(
        `A planilha descompactada excede ${spreadsheetLimits.expandedMb} MB. Exporte um período menor.`,
      );
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
    if (at > end) throw new Error("Arquivo XLSX inválido.");
  }
  if (at !== end) throw new Error("Arquivo XLSX inválido.");
}

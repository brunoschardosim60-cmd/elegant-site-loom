import type { DocumentItem, Manifest } from "./conference";
import { conferenceTimestamp } from "./conference-display";
import { manifestAgeDays, manifestReferenceDate, formatManifestDate } from "./manifest-date";
import type { XlsxSheet } from "./xlsx-writer";

export type ExportRow = { manifest: Manifest; doc: DocumentItem };

const header = [
  "Manifesto / pré",
  "Motorista",
  "Placa",
  "Conferente",
  "Emissão",
  "Dias desde a emissão",
  "CTC",
  "NF-série",
  "Volumes",
  "Cliente / remetente",
  "Destinatário",
  "Cidade de entrega",
  "Natureza",
  "Valor da mercadoria (R$)",
  "Peso (kg)",
  "Situação",
  "Conferido em",
];

const status = (doc: DocumentItem) =>
  doc.received ? "Conferido" : doc.reroutedTo ? `Nova rota: ${doc.reroutedTo}` : "Pendente";

/** One spreadsheet row per CTC, in the order shown on screen. */
export function conferenceSheet(
  name: string,
  rows: ExportRow[],
  now: string | number | Date = Date.now(),
): XlsxSheet {
  return {
    name,
    header,
    rows: rows.map(({ manifest, doc }) => [
      manifest.id,
      manifest.driver,
      manifest.plate,
      manifest.checker,
      formatManifestDate(manifestReferenceDate(manifest)),
      doc.received ? null : manifestAgeDays(manifest, now),
      doc.ctc,
      doc.nf,
      doc.volumes,
      doc.client,
      doc.recipient,
      doc.city,
      doc.nature,
      doc.cargoValueCents === undefined ? null : doc.cargoValueCents / 100,
      doc.weightGrams === undefined ? null : doc.weightGrams / 1000,
      status(doc),
      doc.received ? conferenceTimestamp(doc.receivedAt) || null : null,
    ]),
  };
}

/** "confere-pendencias-2026-10-30.xlsx" */
export function exportFilename(kind: string, now: Date = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `confere-${kind}-${day}.xlsx`;
}

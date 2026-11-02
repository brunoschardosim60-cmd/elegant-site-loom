import type { ImportDraft } from "@/lib/manifest-import";
import type { PhotoFields } from "@/lib/photo-fields";
import { reviewManifestTotals } from "@/lib/manifest-review";
import { LOCAL_HEADER_NOTICE } from "@/lib/local-photo";

/** One entry in the photo/manual import list, from selection to registration. */
export type Draft = ImportDraft & {
  key: string;
  filename: string;
  file?: File;
  url?: string;
  text?: string;
  status: "manual" | "waiting" | "reading" | "read" | "error";
  kind?: "pre" | "dacte" | "unknown";
  message?: string;
  seconds?: number;
  headerReview?: string[] | undefined;
  imageRotation?: PhotoFields["imageRotation"];
  expectedNfs?: number | undefined;
  expectedRows?: number | undefined;
  totalVolumes?: number | undefined;
  edited?: boolean;
  progress?: string;
  readingSource?: "local" | undefined;
};
export const blank = (): Draft => ({
  key: crypto.randomUUID(),
  filename: "Cadastro manual",
  status: "manual",
  id: "",
  plate: "",
  driver: "",
  rows: [{ ctc: "", nf: "", volumes: "1" }],
});
export const documentCount = (item: Draft) =>
  new Set(item.rows.map((row) => row.ctc.trim()).filter((ctc) => /^\d{10}$/.test(ctc))).size;
export const volumeCount = (item: Draft) =>
  item.rows.reduce(
    (sum, row) =>
      sum +
      (Number.isInteger(Number(row.volumes)) && Number(row.volumes) > 0 ? Number(row.volumes) : 0),
    0,
  );
export const reviewCount = (item: Draft) => item.rows.filter((row) => row.review?.length).length;
export const needsReview = (item: Draft) =>
  reviewManifestTotals(item.rows, item).messages.length > 0 ||
  item.rows.some((row) => !row.ctc || !row.nf || !row.volumes || !row.client || !row.recipient) ||
  item.status === "error" ||
  !!item.headerReview?.some((message) => message !== LOCAL_HEADER_NOTICE) ||
  !!reviewCount(item);
export const statusText = (item: Draft) =>
  item.status === "read"
    ? item.readingSource === "local"
      ? needsReview(item)
        ? "Leitura local · campos a conferir"
        : "Leitura local"
      : item.edited
        ? "Ajustado manualmente"
        : needsReview(item)
          ? "Conferir campos"
          : "Leitura concluída"
    : item.status === "error"
      ? "Leitura interrompida"
      : item.status === "reading"
        ? "Lendo documento"
        : item.status === "waiting"
          ? "Aguardando leitura"
          : "Cadastro manual";
export const hasManualContent = (item: Draft) =>
  item.id ||
  item.issueDate ||
  item.plate ||
  item.driver ||
  item.rows.some(
    (row) =>
      row.ctc || row.nf || row.client || row.recipient || (row.volumes && row.volumes !== "1"),
  );

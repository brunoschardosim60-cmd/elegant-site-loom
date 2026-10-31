import type { LuftExport, LuftFilter } from "./luft-spreadsheet";
import { reportGeneratedAt } from "./nf-occurrence-date";
import { spreadsheetLimits } from "./luft-spreadsheet-limits";

/** No file data leaves the browser. Termination cancels parsing and late results. */
export async function readLuftSpreadsheet(
  file: File,
  signal: AbortSignal,
  filter?: LuftFilter,
): Promise<LuftExport> {
  signal.throwIfAborted();
  if (!/\.xlsx$/i.test(file.name) || file.size > spreadsheetLimits.fileBytes)
    throw new Error(`Envie o relatório 108 em XLSX, com até ${spreadsheetLimits.fileMb} MB.`);
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./luft-spreadsheet.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Importação cancelada.", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("A planilha demorou mais de 2 minutos. Exporte um período menor."));
    }, spreadsheetLimits.timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(new Error("Não foi possível ler a planilha neste navegador. Tente novamente."));
    };
    worker.onmessage = (
      event: MessageEvent<{ ok: boolean; result?: LuftExport; error?: string }>,
    ) => {
      cleanup();
      if (signal.aborted) reject(new DOMException("Importação cancelada.", "AbortError"));
      else if (event.data.ok && event.data.result) {
        const stamp = reportGeneratedAt(file.name);
        const result = event.data.result;
        resolve(
          stamp
            ? {
                ...result,
                drafts: result.drafts.map((draft) => ({
                  ...draft,
                  rows: draft.rows.map((row) =>
                    row.occurrenceCode || row.occurrenceDescription
                      ? { ...row, reportGeneratedAt: stamp }
                      : row,
                  ),
                })),
              }
            : result,
        );
      } else reject(new Error(event.data.error || "Não foi possível ler a planilha."));
    };
    if (signal.aborted) abort();
    else worker.postMessage({ bytes, filter }, [bytes]);
  });
}

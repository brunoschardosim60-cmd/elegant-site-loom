import { decodeLuftXlsx } from "./decode-luft-xlsx";

import type { LuftFilter } from "./luft-spreadsheet";

self.onmessage = (event: MessageEvent<{ bytes: ArrayBuffer; filter?: LuftFilter }>) => {
  try {
    self.postMessage({ ok: true, result: decodeLuftXlsx(event.data.bytes, event.data.filter) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error:
        error instanceof Error &&
        /^(Envie|Nenhuma|A planilha|Arquivo XLSX|A estrutura|A planilha tem)/.test(error.message)
          ? error.message
          : "Não foi possível abrir esta planilha. Gere novamente o relatório 108 em XLSX.",
    });
  }
};

import { decodeLuftXlsx } from "./decode-luft-xlsx";

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ ok: true, result: decodeLuftXlsx(event.data) });
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

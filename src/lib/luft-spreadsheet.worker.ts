import ExcelJS from 'exceljs';
import { parseLuft108, validateSpreadsheetZip, type LuftSheet, type SheetCell } from './luft-spreadsheet';

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    validateSpreadsheetZip(event.data);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(event.data, { ignoreNodes: ['drawing', 'picture', 'dataValidations', 'conditionalFormatting', 'sheetProtection', 'pageMargins', 'pageSetup', 'headerFooter'] });
    const sheets: LuftSheet[] = [];
    let cells = 0;
    for (const sheet of workbook.worksheets) {
      if (sheet.rowCount > 20000 || sheet.columnCount > 100 || (cells += sheet.rowCount * sheet.columnCount) > 2000000) throw new Error('A planilha excede 20 mil linhas ou 100 colunas. Exporte um período menor.');
      const rows: SheetCell[][] = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const values: SheetCell[] = [];
        for (let col = 1; col <= sheet.columnCount; col++) {
          const value = row.getCell(col).value;
          // Formulas are never evaluated or accepted as operational identifiers.
          values.push(value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value as SheetCell : value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'object' && 'richText' in value ? value.richText.map(part => part.text).join('') : null);
        }
        rows.push(values);
      });
      sheets.push({ name: sheet.name, rows });
    }
    self.postMessage({ ok: true, result: parseLuft108(sheets) });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error && /^(Envie|Nenhuma|A planilha|Arquivo XLSX|A estrutura|A planilha tem)/.test(error.message) ? error.message : 'Não foi possível abrir esta planilha. Gere novamente o relatório 108 em XLSX.' }); }
};

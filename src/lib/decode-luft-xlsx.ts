import { unzipSync, strFromU8 } from 'fflate';
import { SaxesParser } from 'saxes';
import { parseLuft108, validateSpreadsheetZip, type LuftExport, type LuftSheet, type SheetCell } from './luft-spreadsheet';

const invalid = () => new Error('Arquivo XLSX inválido. Gere novamente o relatório 108.');
const local = (name: string) => name.split(':').at(-1)!;
function xmlParser() {
  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', () => { throw invalid(); });
  parser.on('doctype', () => { throw invalid(); });
  return parser;
}
function sharedStrings(xml: string) {
  const result: string[] = [];
  if (!xml) return result;
  const parser = xmlParser();
  let inside = false, inText = false, phonetic = false, value = '';
  parser.on('opentag', node => {
    const name = local(node.name);
    if (name === 'si') { inside = true; value = ''; }
    if (name === 'rPh') phonetic = true;
    if (name === 't' && inside && !phonetic) inText = true;
  });
  parser.on('text', text => { if (inText) { value += text; if (value.length > 32767) throw invalid(); } });
  parser.on('closetag', node => {
    const name = local(node.name);
    if (name === 't') inText = false;
    if (name === 'rPh') phonetic = false;
    if (name === 'si') { result.push(value); inside = false; if (result.length > 200000) throw invalid(); }
  });
  parser.write(xml).close();
  return result;
}
function dateFormats(xml: string) {
  const parser = xmlParser(), formats = new Set<number>(), styles = new Set<number>();
  if (!xml) return styles;
  let inCellFormats = false, index = 0;
  parser.on('opentag', node => {
    const name = local(node.name), attr = node.attributes;
    if (name === 'numFmt' && /[yd]/i.test((attr['formatCode'] ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''))) formats.add(Number(attr['numFmtId']));
    if (name === 'cellXfs') inCellFormats = true;
    else if (name === 'xf' && inCellFormats) {
      const id = Number(attr['numFmtId']);
      if (id >= 14 && id <= 22 || id >= 45 && id <= 47 || formats.has(id)) styles.add(index);
      index++;
    }
  });
  parser.on('closetag', node => { if (local(node.name) === 'cellXfs') inCellFormats = false; });
  parser.write(xml).close();
  return styles;
}
function workbookUses1904(xml: string) {
  const parser = xmlParser(); let value = false;
  if (!xml) return value;
  parser.on('opentag', node => { if (local(node.name) === 'workbookPr') value = ['1', 'true'].includes(node.attributes['date1904'] ?? ''); });
  parser.write(xml).close(); return value;
}
function excelDate(value: number, epoch1904: boolean): string | null {
  const days = Math.floor(value);
  if (!Number.isFinite(value) || days < (epoch1904 ? 0 : 1) || days > 2958465 || !epoch1904 && days === 60) return null;
  const epoch = epoch1904 ? Date.UTC(1904, 0, 1) : days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + days * 86400000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function readSheet(xml: string, strings: string[], dates: Set<number>, epoch1904: boolean): SheetCell[][] {
  const rows: SheetCell[][] = [], parser = xmlParser();
  let row: SheetCell[] | null = null, rowNumber = 0, maxColumn = 0, column = 0, type = '', style = 0, value = '', inline = '', inValue = false, inText = false, inCell = false, phonetic = false;
  let used = new Set<number>();
  parser.on('opentag', node => {
    const name = local(node.name), attr = node.attributes;
    if (name === 'row') {
      if (row) throw invalid();
      rowNumber = attr['r'] ? Number(attr['r']) : rows.length + 1;
      if (!Number.isInteger(rowNumber) || rowNumber <= rows.length || rowNumber > 20000) throw new Error('A planilha excede 20 mil linhas ou contém linhas repetidas.');
      row = []; used = new Set();
    } else if (name === 'c' && row) {
      const match = /^([A-Z]{1,3})(\d+)$/.exec(attr['r'] ?? '');
      if (!match || Number(match[2]) !== rowNumber || inCell) throw invalid();
      column = [...match[1]!].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      maxColumn = Math.max(maxColumn, column + 1);
      if (column >= 100 || used.has(column) || rowNumber * maxColumn > 2000000) throw new Error('A planilha excede 100 colunas ou dois milhões de células, ou repete uma célula.');
      used.add(column); type = attr['t'] ?? 'n'; style = Number(attr['s'] ?? 0); value = ''; inline = ''; inCell = true;
    } else if (name === 'f' && inCell) throw new Error('A planilha tem fórmulas. Exporte o relatório 108 com valores, sem fórmulas.');
    else if (name === 'v' && inCell) inValue = true;
    else if (name === 'rPh') phonetic = true;
    else if (name === 't' && inCell && !phonetic) inText = true;
  });
  parser.on('text', text => {
    if (inValue) value += text;
    if (inText) inline += text;
    if (value.length > 32767 || inline.length > 32767) throw invalid();
  });
  parser.on('closetag', node => {
    const name = local(node.name);
    if (name === 'v') inValue = false;
    if (name === 't') inText = false;
    if (name === 'rPh') phonetic = false;
    if (name === 'c' && inCell && row) {
      let cell: SheetCell = null;
      if (type === 's') {
        if (!/^\d+$/.test(value) || Number(value) >= strings.length) throw invalid();
        cell = strings[Number(value)]!;
      } else if (type === 'inlineStr') cell = inline;
      else if (type === 'str') cell = value;
      else if (type === 'b') cell = value === '1';
      else if (type === 'd') cell = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ? value.slice(0, 10) : null;
      else if (type === 'n' && value.trim()) {
        const number = Number(value);
        if (Number.isFinite(number)) cell = dates.has(style) ? excelDate(number, epoch1904) : number;
      }
      row[column] = cell; inCell = false;
    } else if (name === 'row' && row) {
      while (rows.length < rowNumber - 1) rows.push([]);
      rows.push(Array.from({ length: row.length }, (_, index) => row![index] ?? null)); row = null;
    }
  });
  parser.write(xml).close();
  return rows;
}

/** Reads only OpenXML values. No Excel calculation engine, network or timer-based ZIP tasks. */
export function decodeLuftXlsx(buffer: ArrayBuffer): LuftExport {
  validateSpreadsheetZip(buffer);
  const names = new Set<string>();
  const files = unzipSync(new Uint8Array(buffer), { filter: file => {
    const keep = /^xl\/(sharedStrings|styles|workbook)\.xml$/.test(file.name) || /^xl\/worksheets\/[^/]+\.xml$/.test(file.name);
    if (keep && names.has(file.name)) throw invalid();
    if (keep) names.add(file.name);
    return keep;
  } });
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.byteLength, 0) > 48 * 1024 * 1024) throw invalid();
  const xml = (name: string) => files[name] ? strFromU8(files[name]!) : '';
  const strings = sharedStrings(xml('xl/sharedStrings.xml')), dates = dateFormats(xml('xl/styles.xml')), epoch1904 = workbookUses1904(xml('xl/workbook.xml'));
  const sheets: LuftSheet[] = []; let cells = 0;
  for (const name of Object.keys(files).filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name))) {
    const rows = readSheet(xml(name), strings, dates, epoch1904);
    cells += rows.reduce((sum, row) => sum + row.length, 0);
    if (cells > 2000000) throw new Error('A planilha excede dois milhões de células. Exporte um período menor.');
    sheets.push({ name, rows });
  }
  return parseLuft108(sheets);
}

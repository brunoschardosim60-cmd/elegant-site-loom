import { Unzip, UnzipInflate } from "fflate";
import { spreadsheetLimits } from "./luft-spreadsheet-limits";
import { SaxesParser } from "saxes";
import {
  parseLuft108,
  isLuft108Header,
  isLuft108Demand,
  defaultLuftFilter,
  describeLuftFilter,
  type LuftFilter,
  luftColumnIndex,
  validateSpreadsheetZip,
  type LuftExport,
  type LuftSheet,
  type SheetCell,
} from "./luft-spreadsheet";

const invalid = () => new Error("Arquivo XLSX inválido. Gere novamente o relatório 108.");
const local = (name: string) => name.split(":").at(-1)!;
function xmlParser() {
  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", () => {
    throw invalid();
  });
  parser.on("doctype", () => {
    throw invalid();
  });
  return parser;
}
function sharedStrings() {
  const result: string[] = [];
  const parser = xmlParser();
  let inside = false,
    inText = false,
    phonetic = false,
    value = "",
    characters = 0;
  parser.on("opentag", (node) => {
    const name = local(node.name);
    if (name === "si") {
      inside = true;
      value = "";
    }
    if (name === "rPh") phonetic = true;
    if (name === "t" && inside && !phonetic) inText = true;
  });
  parser.on("text", (text) => {
    if (inText) {
      value += text;
      if (value.length > 32767) throw invalid();
    }
  });
  parser.on("closetag", (node) => {
    const name = local(node.name);
    if (name === "t") inText = false;
    if (name === "rPh") phonetic = false;
    if (name === "si") {
      characters += value.length;
      if (characters > spreadsheetLimits.sharedCharacters)
        throw new Error(
          "A planilha tem textos demais para este navegador. Exporte um período menor.",
        );
      result.push(value);
      inside = false;
      if (result.length > spreadsheetLimits.sharedStrings) throw invalid();
    }
  });
  return { parser, result };
}
function dateFormats(xml: string) {
  const parser = xmlParser(),
    formats = new Set<number>(),
    styles = new Set<number>();
  if (!xml) return styles;
  let inCellFormats = false,
    index = 0;
  parser.on("opentag", (node) => {
    const name = local(node.name),
      attr = node.attributes;
    if (
      name === "numFmt" &&
      /[yd]/i.test((attr["formatCode"] ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""))
    )
      formats.add(Number(attr["numFmtId"]));
    if (name === "cellXfs") inCellFormats = true;
    else if (name === "xf" && inCellFormats) {
      const id = Number(attr["numFmtId"]);
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || formats.has(id)) styles.add(index);
      index++;
    }
  });
  parser.on("closetag", (node) => {
    if (local(node.name) === "cellXfs") inCellFormats = false;
  });
  parser.write(xml).close();
  return styles;
}
function workbookUses1904(xml: string) {
  const parser = xmlParser();
  let value = false;
  if (!xml) return value;
  parser.on("opentag", (node) => {
    if (local(node.name) === "workbookPr")
      value = ["1", "true"].includes(node.attributes["date1904"] ?? "");
  });
  parser.write(xml).close();
  return value;
}
function excelDate(value: number, epoch1904: boolean): string | null {
  const days = Math.floor(value);
  if (
    !Number.isFinite(value) ||
    days < (epoch1904 ? 0 : 1) ||
    days > 2958465 ||
    (!epoch1904 && days === 60)
  )
    return null;
  const epoch = epoch1904
    ? Date.UTC(1904, 0, 1)
    : days < 60
      ? Date.UTC(1899, 11, 31)
      : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + days * 86400000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function readSheet(
  strings: string[],
  dates: Set<number>,
  epoch1904: boolean,
  budget: { cells: number; selected: number },
  filter: LuftFilter,
) {
  const rows: SheetCell[][] = [],
    parser = xmlParser();
  let row: SheetCell[] | null = null,
    rowNumber = 0,
    column = 0,
    type = "",
    style = 0,
    value = "",
    inline = "",
    inValue = false,
    inText = false,
    inCell = false,
    phonetic = false;
  let used = new Set<number>();
  const rowNumbers: number[] = [];
  let lastRow = 0,
    ignored = 0,
    matching = false,
    branchColumn = -1,
    reasonColumn = -1;
  parser.on("opentag", (node) => {
    const name = local(node.name),
      attr = node.attributes;
    if (name === "row") {
      if (row) throw invalid();
      rowNumber = attr["r"] ? Number(attr["r"]) : lastRow + 1;
      if (
        !Number.isInteger(rowNumber) ||
        rowNumber <= lastRow ||
        rowNumber > spreadsheetLimits.rows
      )
        throw new Error(
          "A planilha excede o limite de linhas do Excel ou contém linhas repetidas.",
        );
      lastRow = rowNumber;
      row = [];
      used = new Set();
    } else if (name === "c" && row) {
      const match = /^([A-Z]{1,3})(\d+)$/.exec(attr["r"] ?? "");
      if (!match || Number(match[2]) !== rowNumber || inCell) throw invalid();
      column = [...match[1]!].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      budget.cells++;
      if (column >= 100 || used.has(column) || budget.cells > spreadsheetLimits.cells)
        throw new Error(
          "A planilha excede 100 colunas ou 20 milhões de células, ou repete uma célula.",
        );
      used.add(column);
      type = attr["t"] ?? "n";
      style = Number(attr["s"] ?? 0);
      value = "";
      inline = "";
      inCell = true;
    } else if (name === "f" && inCell)
      throw new Error(
        "A planilha tem fórmulas. Exporte o relatório 108 com valores, sem fórmulas.",
      );
    else if (name === "v" && inCell) inValue = true;
    else if (name === "rPh") phonetic = true;
    else if (name === "t" && inCell && !phonetic) inText = true;
  });
  parser.on("text", (text) => {
    if (inValue) value += text;
    if (inText) inline += text;
    if (value.length > 32767 || inline.length > 32767) throw invalid();
  });
  parser.on("closetag", (node) => {
    const name = local(node.name);
    if (name === "v") inValue = false;
    if (name === "t") inText = false;
    if (name === "rPh") phonetic = false;
    if (name === "c" && inCell && row) {
      let cell: SheetCell = null;
      if (type === "s") {
        if (!/^\d+$/.test(value) || Number(value) >= strings.length) throw invalid();
        cell = strings[Number(value)]!;
      } else if (type === "inlineStr") cell = inline;
      else if (type === "str") cell = value;
      else if (type === "b") cell = value === "1";
      else if (type === "d")
        cell = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ? value.slice(0, 10) : null;
      else if (type === "n" && value.trim()) {
        const number = Number(value);
        if (Number.isFinite(number))
          cell = dates.has(style) ? excelDate(number, epoch1904) : number;
      }
      row[column] = cell;
      inCell = false;
    } else if (name === "row" && row) {
      const cells = Array.from({ length: row.length }, (_, index) => row![index] ?? null);
      if (rowNumber === 1) {
        rows.push(cells);
        rowNumbers.push(rowNumber);
        matching = isLuft108Header(cells);
        branchColumn = luftColumnIndex(cells, "Filial");
        reasonColumn = luftColumnIndex(cells, "Motivo");
      } else if (matching && cells.some((cell) => cell !== null && cell !== "")) {
        if (!isLuft108Demand(cells[branchColumn], cells[reasonColumn], filter)) ignored++;
        else {
          if (++budget.selected > spreadsheetLimits.selectedRows)
            throw new Error(
              `A planilha tem mais de 50 mil linhas da ${describeLuftFilter(filter)}. Exporte um período menor.`,
            );
          rows.push(cells);
          rowNumbers.push(rowNumber);
        }
      }
      row = null;
    }
  });
  return { parser, result: () => ({ rows, rowNumbers, ignored }) };
}

/** Feed UTF-8 XML in bounded chunks; never materialize the expanded workbook. */
function readZipXml(
  buffer: ArrayBuffer,
  budget: { expanded: number },
  open: (name: string) => ((text: string, final: boolean) => void) | undefined,
) {
  const names = new Set<string>();
  const unzip = new Unzip((file) => {
    const relevant =
      /^xl\/(sharedStrings|styles|workbook)\.xml$/.test(file.name) ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(file.name);
    if (relevant && names.has(file.name)) throw invalid();
    if (relevant) names.add(file.name);
    const write = open(file.name);
    if (!write) return;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    file.ondata = (error, bytes, final) => {
      if (error) throw error;
      budget.expanded += bytes.length;
      if (budget.expanded > spreadsheetLimits.expandedBytes) throw invalid();
      write(decoder.decode(bytes, { stream: !final }), final);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const bytes = new Uint8Array(buffer),
    size = 16384;
  for (let offset = 0; offset < bytes.length; offset += size)
    unzip.push(bytes.subarray(offset, offset + size), offset + size >= bytes.length);
}

/** Metadata first, then streamed sheets; only the team's branch/reason rows stay in memory. */
export function decodeLuftXlsx(
  buffer: ArrayBuffer,
  filter: LuftFilter = defaultLuftFilter,
): LuftExport {
  validateSpreadsheetZip(buffer);
  const strings = sharedStrings();
  const expansion = { expanded: 0 };
  let stylesXml = "",
    workbookXml = "";
  readZipXml(buffer, expansion, (name) => {
    if (name === "xl/sharedStrings.xml")
      return (text, final) => {
        strings.parser.write(text);
        if (final) strings.parser.close();
      };
    if (name !== "xl/styles.xml" && name !== "xl/workbook.xml") return;
    let length = 0;
    return (text) => {
      length += text.length;
      if (length > 4 * 1024 * 1024) throw invalid();
      if (name === "xl/styles.xml") stylesXml += text;
      else workbookXml += text;
    };
  });
  const dates = dateFormats(stylesXml),
    epoch1904 = workbookUses1904(workbookXml);
  const sheets: LuftSheet[] = [];
  const budget = { cells: 0, selected: 0 };
  readZipXml(buffer, expansion, (name) => {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) return;
    const sheet = readSheet(strings.result, dates, epoch1904, budget, filter);
    return (text, final) => {
      sheet.parser.write(text);
      if (final) {
        sheet.parser.close();
        sheets.push({ name, ...sheet.result() });
      }
    };
  });
  return parseLuft108(sheets, filter);
}

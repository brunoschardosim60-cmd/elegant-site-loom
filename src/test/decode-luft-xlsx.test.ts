import { expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { decodeLuftXlsx } from "@/lib/decode-luft-xlsx";
import { luftManifestDays } from "@/lib/luft-spreadsheet";
import { applyImports } from "@/lib/manifest-import";
const headers = [
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
];
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const col = (n: number) => String.fromCharCode(65 + n);
const line = (values: (string | number)[], r: number) =>
  `<row r="${r}">${values.map((v, c) => (typeof v === "number" ? `<c r="${col(c)}${r}"><v>${v}</v></c>` : `<c r="${col(c)}${r}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`)).join("")}</row>`;
const base = [
  "06052233",
  "DIS",
  "06",
  "14/10/2026",
  "ABC1D23",
  "ANA",
  "0000000001",
  "LAB & CIA",
  "CLIENTE",
  "00123",
  "1",
  2,
];
const sheet = (rows: (string | number)[][]) =>
  `<worksheet><sheetData>${[headers, ...rows].map((v, i) => line(v, i + 1)).join("")}</sheetData></worksheet>`;
const packed = (xml: string, extra: Record<string, string> = {}) =>
  zipSync(
    Object.fromEntries(
      Object.entries({ "xl/worksheets/sheet1.xml": xml, ...extra }).map(([k, v]) => [
        k,
        strToU8(v),
      ]),
    ),
  ).buffer as ArrayBuffer;
it("decodes literal inline values, entities and leading zeros without an Excel engine", () => {
  expect(decodeLuftXlsx(packed(sheet([base])))).toMatchObject({
    errors: [],
    drafts: [
      {
        id: "06052233",
        issueDate: "2026-10-14",
        rows: [{ ctc: "0000000001", nf: "00123-1", client: "LAB & CIA", volumes: "2" }],
      },
    ],
  });
});
it("supports rich shared strings and real Excel date values", () => {
  const xml = sheet([base])
    .replace(
      '<c r="D2" t="inlineStr"><is><t>14/10/2026</t></is></c>',
      '<c r="D2" s="1"><v>46309.5</v></c>',
    )
    .replace('<c r="F2" t="inlineStr"><is><t>ANA</t></is></c>', '<c r="F2" t="s"><v>0</v></c>');
  const parsed = decodeLuftXlsx(
    packed(xml, {
      "xl/styles.xml":
        '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      "xl/sharedStrings.xml":
        "<sst><si><r><t>AN</t></r><rPh><t>IGNORAR</t></rPh><r><t>A</t></r></si></sst>",
    }),
  );
  expect(parsed.drafts[0]).toMatchObject({ driver: "ANA", issueDate: "2026-10-14" });
});
it("handles the Excel 1904 date epoch", () => {
  const xml = sheet([base]).replace(
    '<c r="D2" t="inlineStr"><is><t>14/10/2026</t></is></c>',
    '<c r="D2" s="1"><v>44847</v></c>',
  );
  expect(
    decodeLuftXlsx(
      packed(xml, {
        "xl/workbook.xml": '<workbook><workbookPr date1904="1"/></workbook>',
        "xl/styles.xml":
          '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      }),
    ).drafts[0]?.issueDate,
  ).toBe("2026-10-14");
});
it.each([
  ["formula", sheet([base]).replace("<v>2</v>", "<f>1+1</f><v>2</v>")],
  ["doctype", '<!DOCTYPE worksheet [<!ENTITY a "BAD">]>' + sheet([base])],
  ["duplicate cell", sheet([base]).replace("</row>", '<c r="A1"><v>1</v></c></row>')],
  [
    "invalid shared string",
    sheet([base]).replace(
      '<c r="F2" t="inlineStr"><is><t>ANA</t></is></c>',
      '<c r="F2" t="s"><v>999</v></c>',
    ),
  ],
])("rejects unsafe or ambiguous %s without partial import", (_, xml) =>
  expect(() => decodeLuftXlsx(packed(xml))).toThrow(),
);
it("rejects two matching report sheets instead of silently dropping a day", () =>
  expect(() =>
    decodeLuftXlsx(packed(sheet([base]), { "xl/worksheets/sheet2.xml": sheet([base]) })),
  ).toThrow("mais de uma aba"));
it("keeps fifty manifests across five dates for the same driver without dropping or duplicating NFs", () => {
  const rows = Array.from({ length: 50 }, (_, i) => [
    String(60000000 + i),
    "DIS",
    "06",
    `${10 + Math.floor(i / 10)}/10/2026`,
    "ABC1D23",
    "ANA",
    String(1000000000 + i),
    "LAB",
    "CLIENTE",
    String(100 + i),
    "1",
    2,
  ]);
  const parsed = decodeLuftXlsx(packed(sheet(rows.reverse())));
  expect(parsed.errors).toEqual([]);
  expect(parsed.drafts).toHaveLength(50);
  expect(luftManifestDays(parsed.drafts)).toEqual(
    Array.from({ length: 5 }, (_, d) => ({
      date: `2026-10-${10 + d}`,
      manifests: 10,
      ctcs: 10,
      nfs: 10,
      volumes: 20,
    })),
  );
  const saved = applyImports([], parsed.drafts, "2026-10-15T00:00:00Z");
  expect(saved.ok).toBe(true);
  if (saved.ok) {
    expect(saved.manifests).toHaveLength(50);
    expect(applyImports(saved.manifests, parsed.drafts, "later").ok).toBe(false);
  }
});

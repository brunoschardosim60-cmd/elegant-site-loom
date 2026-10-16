import { describe, expect, it } from "vitest";
import {
  compareOccurrence,
  lastOccurrenceDate,
  mergeOccurrenceReference,
  reportGeneratedAt,
} from "@/lib/nf-occurrence-date";
import { parseLuft108 } from "@/lib/luft-spreadsheet";
import { applyImports } from "@/lib/manifest-import";
import { planOccurrenceUpdates } from "@/lib/nf-occurrences";
import { conferenceStateSchema } from "@/lib/conference-state";

const value = {
  nf: "123-1",
  code: "91",
  description: "PROGRAMADA",
  occurredOn: "2026-10-15",
  reportGeneratedAt: "2026-10-15T09:00:00",
};
describe("source occurrence chronology", () => {
  it("matches the declared code, independent of history order, and ignores invalid dates", () => {
    expect(
      lastOccurrenceDate(
        "LE",
        "16/10/2026 - B1 - OUTRA; 13/10/2026 - LE - RETENCAO; 09/10/2026 - LE - RETENCAO; 31/02/2026 - LE - INVALIDA",
      ),
    ).toBe("2026-10-13");
    expect(lastOccurrenceDate("01", "16/10/2026 - B1 - OUTRA")).toBeUndefined();
    expect(lastOccurrenceDate("", "16/10/2026 - 01 - ENTREGUE")).toBeUndefined();
  });
  it("uses the export filename clock, including copied files, without guessing an import date", () => {
    expect(reportGeneratedAt("108_Relação_20261015090923 (1).xlsx")).toBe("2026-10-15T09:09:23");
    for (const name of [
      "108.xlsx",
      "108_20260230090923.xlsx",
      "108_20261015240923.xlsx",
      "108_20261015096023.xlsx",
    ])
      expect(reportGeneratedAt(name)).toBeUndefined();
  });
  it("prioritizes the event date over even a later report generation", () => {
    expect(
      compareOccurrence(value, {
        ...value,
        occurredOn: "2026-10-14",
        reportGeneratedAt: "2026-10-16T09:00:00",
      }),
    ).toBe("older");
    expect(
      compareOccurrence(value, {
        ...value,
        occurredOn: "2026-10-16",
        reportGeneratedAt: "2026-10-14T09:00:00",
      }),
    ).toBe("newer");
  });
  it("resolves the same event day using the report clock, protecting against reverse import order", () => {
    expect(
      compareOccurrence(value, { ...value, code: "01", reportGeneratedAt: "2026-10-15T10:00:00" }),
    ).toBe("newer");
    expect(
      compareOccurrence(value, { ...value, code: "01", reportGeneratedAt: "2026-10-15T08:00:00" }),
    ).toBe("older");
    expect(compareOccurrence(value, { ...value, code: "01" })).toBe("uncertain");
    expect(compareOccurrence(value, { nf: "123-1", code: "01", description: "ENTREGUE" })).toBe(
      "uncertain",
    );
  });
  it("establishes legacy chronology once and enriches identical values without losing references", () => {
    const legacy = { nf: "123-1", code: "LE", description: "RETIDA" };
    expect(compareOccurrence(legacy, value)).toBe("newer");
    expect(compareOccurrence(value, value)).toBe("equal");
    const prior = { ...legacy, occurredOn: "2026-10-15" };
    const incoming = { ...legacy, reportGeneratedAt: "2026-10-15T10:00:00" };
    expect(compareOccurrence(prior, incoming)).toBe("newer");
    expect(mergeOccurrenceReference(prior, incoming)).toMatchObject({
      occurredOn: "2026-10-15",
      reportGeneratedAt: "2026-10-15T10:00:00",
    });
  });
});

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
  "Codigo Ultima Ocorrencia",
  "Descricao Ultima Ocorrencia",
  "Ocorrencias",
];
function drafts(day: string, code = "91", stamp = "2026-10-15T09:00:00") {
  const result = parseLuft108([
    {
      name: "108",
      rows: [
        headers,
        [
          "06050001",
          "DIS",
          "06",
          "01/10/2026",
          "ABC1D23",
          "TESTE",
          "0000000001",
          "LAB",
          "CLIENTE",
          "123",
          "1",
          2,
          code,
          "DESCRICAO",
          `${day} - ${code} - DESCRICAO; 16/10/2026 - B1 - OUTRA`,
        ],
      ],
    },
  ]);
  expect(result.errors).toEqual([]);
  result.drafts[0]!.rows[0]!.reportGeneratedAt = stamp;
  return result.drafts;
}
it("keeps chronological metadata through 108 parsing, registration and persistence; refresh changes only newer NF occurrences", () => {
  const initial = applyImports([], drafts("15/10/2026"), "2026-10-16T12:00:00Z");
  if (!initial.ok) throw new Error(initial.error);
  const manifests = conferenceStateSchema.parse({
    manifests: initial.manifests,
    activity: [],
    issues: [],
  }).manifests;
  const original = structuredClone(manifests);
  expect(manifests[0]!.documents[0]!.nfOccurrences![0]).toMatchObject({
    occurredOn: "2026-10-15",
    reportGeneratedAt: "2026-10-15T09:00:00",
  });
  expect(
    planOccurrenceUpdates(manifests, drafts("14/10/2026", "LE", "2026-10-16T09:00:00")),
  ).toMatchObject({ count: 0, skippedOlder: 1, manifests: original });
  const newer = planOccurrenceUpdates(manifests, drafts("16/10/2026", "01", "2026-10-16T09:00:00"));
  expect(newer).toMatchObject({ count: 1, skippedOlder: 0 });
  expect(newer.manifests[0]).toEqual({
    ...original[0],
    documents: [
      {
        ...original[0]!.documents[0],
        nfOccurrences: [
          {
            nf: "123-1",
            code: "01",
            description: "DESCRICAO",
            occurredOn: "2026-10-16",
            reportGeneratedAt: "2026-10-16T09:00:00",
          },
        ],
      },
    ],
  });
  expect(manifests).toEqual(original);
  const unknown = drafts("", "LE");
  delete unknown[0]!.rows[0]!.reportGeneratedAt;
  expect(planOccurrenceUpdates(manifests, unknown)).toMatchObject({
    count: 0,
    skippedUncertain: 1,
  });
});

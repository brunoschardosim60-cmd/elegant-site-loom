import { describe, expect, it } from "vitest";
import {
  compareManifestDates,
  formatManifestDate,
  manifestAgeDays,
  manifestAgeLabel,
  manifestReferenceDate,
  normalizeIssueDate,
  parsePreIssueDate,
} from "@/lib/manifest-date";
import { conferenceStateSchema } from "@/lib/conference-state";

const now = "2026-10-11T14:00:00Z";
const registration = { date: now };
describe("printed pré issue dates", () => {
  it.each([
    ["28/08/2026", "2026-08-28"],
    ["2026-08-28", "2026-08-28"],
    [" 29 . 02 . 2024 ", "2024-02-29"],
    ["31-12-2026", "2026-12-31"],
  ])("normalizes a valid calendar date %s", (input, expected) =>
    expect(normalizeIssueDate(input)).toBe(expected),
  );
  it.each([
    "29/02/2026",
    "31/04/2026",
    "00/01/2026",
    "01/13/2026",
    "28/08/26",
    "2026-08-28T00:00:00Z",
    "",
    "28/8/2026",
  ])("rejects invalid or ambiguous date %s", (value) =>
    expect(normalizeIssueDate(value)).toBeUndefined(),
  );
  it("reads only the labelled original date and ignores the delivery table", () => {
    expect(
      parsePreIssueDate(
        "PRÉ-MANIFESTO\nUSUÁRIO BRUNO.SEV DATA 28/08/2026 16:48:54 CONFERENTE\nCTCs 11\nPrev. Entrega\n31/08/2026",
      ),
    ).toBe("2026-08-28");
    expect(parsePreIssueDate("DATA DE EMISSÃO\n28 / 08 / 2026\nRESTRIÇÃO CARRO\n31/08/2026")).toBe(
      "2026-08-28",
    );
  });
  it.each([
    "PRÉ-MANIFESTO Prev. Entrega 31/08/2026",
    "DATA DE ENTREGA: 31/08/2026",
    "DATA PREVISTA: 31/08/2026",
    "DATA 28/08/2026 29/08/2026",
  ])("does not invent an issue date from delivery or conflicting dates", (text) =>
    expect(parsePreIssueDate(text)).toBeUndefined(),
  );
  it("measures age from the printed calendar date even if registered today", () => {
    const manifest = { ...registration, issueDate: "2026-08-27" };
    expect(manifestAgeDays(manifest, now)).toBe(45);
    expect(manifestAgeLabel(manifest, now)).toBe("Emitido há 45 dias");
    expect(formatManifestDate(manifestReferenceDate(manifest))).toBe("27/08/2026");
  });
  it("uses registration truthfully for legacy records and keeps calendar dates from shifting", () => {
    const manifest = { date: "2026-10-10" };
    expect(manifestReferenceDate(manifest)).toBe("2026-10-10");
    expect(manifestAgeLabel(manifest, now)).toBe("Cadastrado há 1 dia");
    expect(manifestAgeLabel(registration, now)).toBe("Cadastrado hoje");
    expect(manifestAgeLabel({ date: "invalid" }, now)).toBe("Data não informada");
  });
  it("counts São Paulo calendar days rather than elapsed 24-hour periods or UTC days", () => {
    expect(manifestAgeDays({ date: "2026-10-11T02:59:00Z" }, "2026-10-12T01:59:00Z")).toBe(1);
    expect(manifestAgeDays({ date: now, issueDate: "2026-10-11" }, "2026-10-12T01:59:00Z")).toBe(0);
  });
  it("signals a future issue date and sorts by original date instead of new registration", () => {
    const old = { ...registration, issueDate: "2026-08-27" };
    const recent = { date: "2026-10-10T14:00:00Z" };
    expect(compareManifestDates(old, recent)).toBeLessThan(0);
    expect(manifestAgeLabel({ ...registration, issueDate: "2026-10-12" }, now)).toBe(
      "Emissão futura · conferir",
    );
    expect(manifestAgeDays({ ...registration, issueDate: "2026-10-12" }, now)).toBe(0);
  });
  it("round-trips the optional date in registered JSON without changing old records", () => {
    const legacy = {
      id: "DI00123456789",
      plate: "ABC1D23",
      driver: "ANA",
      date: now,
      documents: [],
    };
    const state = {
      manifests: [legacy, { ...legacy, id: "DI00123456790", issueDate: "2026-08-27" }],
      activity: [],
      issues: [],
    };
    const loaded = conferenceStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(loaded.manifests[0]).not.toHaveProperty("issueDate");
    expect(loaded.manifests[1]?.issueDate).toBe("2026-08-27");
    expect(
      conferenceStateSchema.safeParse({
        ...state,
        manifests: [{ ...legacy, issueDate: "31/02/2026" }],
      }).success,
    ).toBe(false);
  });
});

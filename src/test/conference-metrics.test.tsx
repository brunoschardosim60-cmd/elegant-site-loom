import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Manifest } from "@/lib/conference";
import { conferenceMetrics, formatMoney } from "@/lib/conference-metrics";
import { ConferenceMetricsView } from "@/components/conference-metrics";
import { applyImports } from "@/lib/manifest-import";

afterEach(cleanup);
const now = "2026-10-30T15:00:00.000Z";
const doc = (
  ctc: string,
  extra: Partial<Manifest["documents"][number]> = {},
): Manifest["documents"][number] => ({
  id: `d-${ctc}`,
  ctc,
  nf: "1-1",
  volumes: 1,
  received: false,
  ...extra,
});
const manifests: Manifest[] = [
  {
    id: "26180001",
    driver: "ANA",
    plate: "ABC1D23",
    date: "2026-10-25T12:00:00.000Z",
    issueDate: "2026-10-25",
    documents: [
      doc("0000000001", {
        cargoValueCents: 1_000_000,
        nature: "PERECIVEL-CONVENCIONAL",
        city: "GRAVATAI",
      }),
      doc("0000000002", { received: true, receivedAt: "2026-10-27T10:00:00.000Z" }),
    ],
  },
  {
    id: "26180002",
    driver: "BETO",
    plate: "ABC1D24",
    date: "2026-10-30T12:00:00.000Z",
    issueDate: "2026-10-30",
    documents: [
      doc("0000000003", { cargoValueCents: 250_000, city: "GRAVATAI" }),
      doc("0000000004", { received: true, receivedAt: "2026-10-30T13:00:00.000Z" }),
      doc("0000000005", { reroutedTo: "26180003" }),
    ],
  },
];

it("computes return rate, late and perishable CTCs, pending value and median return days", () => {
  const m = conferenceMetrics(manifests, now);
  expect(m.ctcs).toBe(4);
  expect(m.received).toBe(2);
  expect(m.returnRate).toBe(0.5);
  expect(m.pending).toBe(2);
  expect(m.late).toBe(1);
  expect(m.perishablePending).toBe(1);
  expect(m.pendingValueCents).toBe(1_250_000);
  expect(m.medianReturnDays).toBe(1);
  expect(m.drivers.map((d) => [d.driver, d.late, d.oldestDays])).toEqual([
    ["ANA", 1, 5],
    ["BETO", 0, 0],
  ]);
  // Late now: only ANA's CTC still pending after 5 days. History apart: one of
  // the two conferred CTCs came back 2 days after the manifest date.
  expect(m.lateRate).toBe(0.25);
  expect(m.returnedLate).toBe(1);
  expect(m.timedReturns).toBe(2);
  expect(m.returnedLateRate).toBe(0.5);
  expect(m.cities).toEqual([
    {
      city: "GRAVATAI",
      ctcs: 2,
      received: 0,
      pending: 2,
      late: 1,
      returnedLate: 0,
      timedReturns: 0,
      untimedReturns: 0,
      pendingValueCents: 1_250_000,
      medianReturnDays: undefined,
      topClients: [],
      topDrivers: ["ANA", "BETO"],
    },
  ]);
  expect(formatMoney(1_250_000).replace(/\s/g, " ")).toBe("R$ 12.500");
});

it("renders the indicator tiles and the per-driver table", () => {
  render(<ConferenceMetricsView manifests={manifests} now={now} />);
  expect(screen.getByText(/25% dos CTCs · pendentes há 2\+ dias/)).toBeInTheDocument();
  expect(screen.getByText("50%")).toBeInTheDocument();
  expect(screen.getByText(/1 de 2 conferidos/)).toBeInTheDocument();
  const table = screen.getByRole("region", { name: "Por motorista" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByText("ANA")).toBeInTheDocument();
});

it("shows an empty state without CTCs", () => {
  render(<ConferenceMetricsView manifests={[]} now={now} />);
  expect(screen.getByText("Sem dados neste período")).toBeInTheDocument();
});

it("sums cargo value and weight over a CTC's NFs and keeps the manifest checker", () => {
  const out = applyImports(
    [],
    [
      {
        id: "26180009",
        plate: "ABC1D23",
        driver: "ANA",
        issueDate: "2026-10-28",
        checker: "SADI",
        rows: [
          {
            ctc: "0000000009",
            nf: "1-1",
            volumes: "2",
            client: "LAB",
            recipient: "HOSP",
            cargoValueCents: 1000,
            weightGrams: 500,
            nature: "MAT.LAB",
            city: "CANOAS",
          },
          {
            ctc: "0000000009",
            nf: "2-1",
            volumes: "1",
            client: "LAB",
            recipient: "HOSP",
            cargoValueCents: 250,
            weightGrams: 100,
            nature: "MAT.LAB",
            city: "CANOAS",
          },
        ],
      },
    ],
    now,
  );
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.manifests[0]!.checker).toBe("SADI");
  expect(out.manifests[0]!.documents[0]).toMatchObject({
    cargoValueCents: 1250,
    weightGrams: 600,
    nature: "MAT.LAB",
    city: "CANOAS",
    volumes: 3,
  });
});

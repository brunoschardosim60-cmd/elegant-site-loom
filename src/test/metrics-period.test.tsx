import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Manifest } from "@/lib/conference";
import { ConferenceMetricsView } from "@/components/conference-metrics";
import { inRange, metricsPeriod } from "@/lib/metrics-period";
import { createMetricsPdf } from "@/lib/metrics-pdf";
import { conferenceMetrics } from "@/lib/conference-metrics";
import shapes from "@/lib/maps/rs-municipios.json";
import type { CityShapes } from "@/lib/city-map";

const mocks = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock("@/lib/metrics-pdf", async (original) => ({
  ...(await original<typeof import("@/lib/metrics-pdf")>()),
  exportMetricsPdf: mocks.pdf,
}));
afterEach(cleanup);

// 15:00 UTC = 12:00 in Brasília.
const now = "2026-11-05T15:00:00.000Z";

it("builds periods by manifest date in Brasília with an equivalent period before", () => {
  expect(metricsPeriod("7d", now)).toMatchObject({
    range: { from: "2026-10-30", to: "2026-11-05" },
    previous: { from: "2026-10-23", to: "2026-10-29" },
  });
  expect(metricsPeriod("30d", now).previous).toEqual({ from: "2026-09-07", to: "2026-10-06" });
  expect(metricsPeriod("month", now)).toMatchObject({
    range: { from: "2026-11-01", to: "2026-11-05" },
    previous: { from: "2026-10-01", to: "2026-10-05" },
  });
  expect(metricsPeriod("last-month", now)).toMatchObject({
    range: { from: "2026-10-01", to: "2026-10-31" },
    previous: { from: "2026-09-01", to: "2026-09-30" },
  });
  // 31 March: the same days of February stop at its last day.
  expect(metricsPeriod("month", "2027-03-31T15:00:00Z").previous).toEqual({
    from: "2027-02-01",
    to: "2027-02-28",
  });
  // Late evening in Brasília is still the same day.
  expect(metricsPeriod("7d", "2026-11-06T02:00:00Z").range?.to).toBe("2026-11-05");
  expect(metricsPeriod("all", now)).toMatchObject({ range: undefined, previous: undefined });
});

const doc = (ctc: string, extra: Partial<Manifest["documents"][number]> = {}) => ({
  id: `d-${ctc}`,
  ctc,
  nf: "1-1",
  volumes: 1,
  received: true,
  client: "DIMED",
  city: "PORTO ALEGRE",
  ...extra,
});
/** A finished manifest whose CTCs came back `days` after issue. */
const finished = (id: string, issueDate: string, days: number, count: number): Manifest => ({
  id,
  driver: "ANA",
  plate: "ABC1D23",
  date: `${issueDate}T12:00:00.000Z`,
  issueDate,
  documents: Array.from({ length: count }, (_, i) =>
    doc(`${id.slice(-4)}${String(i).padStart(6, "0")}`, {
      receivedAt: new Date(Date.parse(`${issueDate}T15:00:00Z`) + days * 86400000).toISOString(),
    }),
  ),
});

it("filters by period, adds archived manifests and compares with the period before", async () => {
  const live = [finished("DI0000000001", "2026-11-02", 0, 6)];
  // The previous 7 days are only in the archive: all six came back after 3 days.
  const archived = [finished("DI0000000002", "2026-10-25", 3, 6)];
  const loadArchived = vi.fn().mockResolvedValue(archived);
  render(<ConferenceMetricsView manifests={live} now={now} loadArchived={loadArchived} />);
  expect(loadArchived).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Período dos indicadores" }), {
    target: { value: "7d" },
  });
  await waitFor(() =>
    expect(loadArchived).toHaveBeenCalledExactlyOnceWith({ from: "2026-10-23", to: "2026-11-05" }),
  );
  expect(await screen.findByText(/▼ 100 p\.p\. vs\. período anterior/)).toBeInTheDocument();
  expect(screen.getByText(/comparado com 23\/10 a 29\/10\/2026/)).toBeInTheDocument();
  const clients = screen.getByRole("region", { name: "Por cliente (remetente)" });
  expect(within(clients).getByText("DIMED")).toBeInTheDocument();
});

it("says when the database cannot list archived manifests yet", async () => {
  render(
    <ConferenceMetricsView
      manifests={[finished("DI0000000001", "2026-11-02", 0, 6)]}
      now={now}
      loadArchived={vi.fn().mockResolvedValue(null)}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Período dos indicadores" }), {
    target: { value: "30d" },
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "falta aplicar a atualização do banco",
  );
});

it("lists ten rows and expands to all", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    finished(`DI00000001${String(i).padStart(2, "0")}`, "2026-11-02", 0, 1),
  ).map((manifest, i) => ({
    ...manifest,
    documents: manifest.documents.map((d) => ({ ...d, client: `CLIENTE ${i + 1}` })),
  }));
  render(<ConferenceMetricsView manifests={many} now={now} />);
  const clients = screen.getByRole("region", { name: "Por cliente (remetente)" });
  expect(within(clients).getAllByRole("row")).toHaveLength(11);
  fireEvent.click(within(clients).getByRole("button", { name: "Mostrar todos (12)" }));
  expect(within(clients).getAllByRole("row")).toHaveLength(13);
});

it("exports the management report for the period shown", async () => {
  render(
    <ConferenceMetricsView manifests={[finished("DI0000000001", "2026-11-02", 0, 6)]} now={now} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "PDF gerencial" }));
  await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
  expect(mocks.pdf.mock.calls[0]![0]).toMatchObject({
    period: { kind: "all" },
    metrics: { ctcs: 6, late: 0 },
  });
});

it("draws a management PDF with the map and tables", () => {
  const manifests = [
    finished("DI0000000001", "2026-10-20", 3, 8),
    finished("DI0000000002", "2026-10-21", 0, 8),
  ];
  manifests[1]!.documents = manifests[1]!.documents.map((d) => ({ ...d, city: "CAXIAS DO SUL" }));
  const period = metricsPeriod("last-month", now);
  const pdf = createMetricsPdf({
    metrics: conferenceMetrics(inRange(manifests, period.range), now),
    period,
    shapes: shapes as CityShapes,
    generatedAt: new Date(now),
  });
  expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(10_000);
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import type { Manifest } from "@/lib/conference";
import { conferenceMetrics } from "@/lib/conference-metrics";
import type { ConferenceState } from "@/lib/conference-state";

afterEach(cleanup);

const now = "2026-11-06T15:00:00.000Z";
const doc = (ctc: string, extra: Partial<Manifest["documents"][number]> = {}) => ({
  id: `d-${ctc}`,
  ctc,
  nf: "1-1",
  volumes: 1,
  received: false,
  ...extra,
});
/** Issued on `issueDate`, registered in the system at `registered`. */
const manifest = (
  id: string,
  issueDate: string,
  registered: string,
  docs: Manifest["documents"],
): Manifest => ({
  id,
  driver: "ANA",
  plate: "ABC1D23",
  date: `${registered}T12:00:00.000Z`,
  issueDate,
  documents: docs,
});

it("leaves out of the return times the pres registered after the deadline", () => {
  const m = conferenceMetrics(
    [
      // Registered the same day: receipt times are return times.
      manifest("26180001", "2026-10-20", "2026-10-20", [
        doc("0000000001", { received: true, receivedAt: "2026-10-21T12:00:00Z" }),
      ]),
      // Registered 15 days late and conferred then: not a real return time.
      manifest("26180002", "2026-10-01", "2026-10-16", [
        doc("0000000002", { received: true, receivedAt: "2026-10-16T13:00:00Z" }),
        doc("0000000003", { received: true, receivedAt: "2026-10-16T13:00:00Z" }),
      ]),
    ],
    now,
  );
  expect(m.timedReturns).toBe(1);
  expect(m.untimedReturns).toBe(2);
  expect(m.returnedLate).toBe(0);
  expect(m.medianReturnDays).toBe(1);
});

it("uses the team's deadline for late CTCs", () => {
  const manifests = [manifest("26180003", "2026-11-03", "2026-11-03", [doc("0000000004")])];
  expect(conferenceMetrics(manifests, now).late).toBe(1);
  expect(conferenceMetrics(manifests, now, 5).late).toBe(0);
});

const state: ConferenceState = {
  manifests: [
    manifest("26180010", "2026-11-01", "2026-11-01", [
      doc("0000000010", { city: "CANOAS", client: "LAB A" }),
      doc("0000000011", { city: "CANOAS", client: "LAB B", nature: "PERECIVEL-CONVENCIONAL 48" }),
    ]),
    manifest("26180011", "2026-11-06", "2026-11-06", [doc("0000000012", { city: "CANOAS" })]),
  ],
  activity: [],
  issues: [],
};

it("opens the late CTCs, perishable first, from the indicator", async () => {
  render(<ConferenceWorkspace initialState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Indicadores" }));
  fireEvent.click(await screen.findByRole("button", { name: /CTCs atrasados agora/ }));
  expect(screen.getByRole("button", { name: "Pendências" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByLabelText("Filtrar pré-manifestos")).toHaveValue("urgent");
  const rows = within(screen.getByRole("table", { name: "CTCs pendentes" })).getAllByRole("row");
  // Only the two late CTCs, the perishable one first; today's CTC is not late.
  expect(rows).toHaveLength(3);
  expect(rows[1]).toHaveTextContent("0000000011");
  expect(rows[2]).toHaveTextContent("0000000010");
});

it("applies a longer team deadline to filters and badges", () => {
  render(<ConferenceWorkspace initialState={state} lateDays={10} />);
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  expect(screen.getByRole("option", { name: "Há 10 dias ou mais" })).toBeInTheDocument();
});

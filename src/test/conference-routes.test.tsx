import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Manifest } from "@/lib/conference";
import { findCurrentMatches, isAnotherRoute, presentRoutes } from "@/lib/conference-routes";
import { selectTrackingRows } from "@/lib/ctc-tracking";
import { selectConferenceReport } from "@/lib/conference-pdf";
import { conferenceStateSchema } from "@/lib/conference-state";
import { ConferenceWorkspace } from "@/components/conference-workspace";

vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
afterEach(cleanup);
const routes = (): Manifest[] =>
  [13, 15].map((day, index) => ({
    id: `0605222${index}`,
    driver: index ? "NOVO MOTORISTA" : "ANTIGO MOTORISTA",
    plate: index ? "XYZ1A23" : "ABC1D23",
    date: `2026-10-${day}`,
    issueDate: `2026-10-${day}`,
    documents: [
      { id: `route-${index}`, ctc: "0000000001", nf: "123-1", volumes: 8, received: false },
    ],
  }));
it("keeps the previous attempt unchanged and resolves only the most recent route, regardless of driver", () => {
  const original = routes();
  expect(isAnotherRoute(original[0]!, original[1]!)).toBe(true);
  expect(findCurrentMatches(original, "0000000001")).toEqual([
    { manifest: original[1], doc: original[1]!.documents[0] },
  ]);
  const shown = presentRoutes(original);
  expect(shown[0]).toMatchObject({
    routeResolved: true,
    documents: [{ received: false, reroutedTo: "06052221" }],
  });
  expect(shown[1]).toMatchObject({ routeResolved: false, documents: [{ received: false }] });
  expect(original[0]!.documents[0]).not.toHaveProperty("reroutedTo");
  expect(
    conferenceStateSchema.parse({ manifests: shown, activity: [], issues: [] }).manifests[0],
  ).not.toHaveProperty("routeResolved");
});
it("does not resolve ambiguous same-day, undated or invalid duplicates by guessing", () => {
  for (const change of [{ issueDate: "2026-10-13" }, { issueDate: undefined }, { id: "INVALID" }]) {
    const items = routes();
    items[1] = { ...items[1]!, ...change };
    expect(findCurrentMatches(items, "0000000001")).toHaveLength(2);
  }
});
it("filters historical attempts out of pending lists and PDFs while preserving them in tracking", () => {
  const items = routes();
  expect(selectTrackingRows(items, { status: "pending" }).map((row) => row.manifest.id)).toEqual([
    "06052221",
  ]);
  expect(selectTrackingRows(items, { status: "rerouted" }).map((row) => row.manifest.id)).toEqual([
    "06052220",
  ]);
  expect(selectTrackingRows(items)).toHaveLength(2);
  expect(
    selectConferenceReport({ manifests: items, issues: [], view: "missing" }).manifests.map(
      (m) => m.id,
    ),
  ).toEqual(["06052221"]);
  expect(
    selectConferenceReport({ manifests: items, issues: [], view: "finished" }).manifests[0]!
      .documents[0],
  ).toMatchObject({ received: false, reroutedTo: "06052221" });
});
it("scans only the latest attempt and never marks the previous route received", async () => {
  const snapshot = vi.fn();
  render(
    <ConferenceWorkspace
      initialState={{ manifests: routes(), activity: [], issues: [] }}
      onSnapshot={snapshot}
    />,
  );
  fireEvent.change(screen.getByLabelText("Código do CTC"), { target: { value: "0000000001" } });
  fireEvent.click(screen.getByRole("button", { name: "Conferir" }));
  const state = snapshot.mock.calls.at(-1)![0];
  expect(state.manifests[0].documents[0].received).toBe(false);
  expect(state.manifests[1].documents[0].received).toBe(true);
  expect(state.manifests[1].documents[0].receivedAt).toBeTruthy();
  expect(screen.queryByText(/vínculo ambíguo/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Rastreamento/ }));
  expect(await screen.findByText("Remanifestado")).toBeInTheDocument();
});

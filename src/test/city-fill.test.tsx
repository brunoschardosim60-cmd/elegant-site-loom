import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManifestDocumentsEditor } from "@/components/manifest-documents-editor";
import { ConferenceWorkspace } from "@/components/conference-workspace";
import type { Manifest } from "@/lib/conference";
import type { ConferenceState } from "@/lib/conference-state";
import { fillCities, knownCities, withKnownCities } from "@/lib/city-fill";

afterEach(cleanup);

const doc = (ctc: string, extra: Partial<Manifest["documents"][number]> = {}) => ({
  id: `d-${ctc}`,
  ctc,
  nf: "1-1",
  volumes: 1,
  received: false,
  ...extra,
});
const manifest = (id: string, docs: Manifest["documents"]): Manifest => ({
  id,
  driver: "ANA",
  plate: "ABC1D23",
  date: "2026-10-20T12:00:00.000Z",
  issueDate: "2026-10-20",
  documents: docs,
});

it("learns each recipient's usual city and fills only CTCs without one", () => {
  const known = knownCities([
    manifest("26180001", [
      doc("0000000001", { recipient: "Hospital São Lucas", city: "PORTO ALEGRE" }),
      doc("0000000002", { recipient: "HOSPITAL SAO LUCAS ", city: "PORTO ALEGRE" }),
      doc("0000000003", { recipient: "hospital são lucas", city: "CANOAS" }),
      doc("0000000004", { recipient: "FARMACIA X" }),
    ]),
  ]);
  expect(known.get("HOSPITAL SAO LUCAS")).toBe("PORTO ALEGRE");
  expect(known.has("FARMACIA X")).toBe(false);
  const [filled] = fillCities(
    [
      {
        id: "26180002",
        plate: "ABC1D23",
        driver: "ANA",
        rows: [
          { ctc: "0000000005", nf: "1-1", volumes: "1", recipient: "Hospital Sao Lucas" },
          {
            ctc: "0000000006",
            nf: "1-1",
            volumes: "1",
            recipient: "Hospital Sao Lucas",
            city: "GRAVATAI",
          },
          { ctc: "0000000007", nf: "1-1", volumes: "1", recipient: "Outro" },
        ],
      },
    ],
    [
      manifest("26180001", [
        doc("0000000001", { recipient: "HOSPITAL SAO LUCAS", city: "PORTO ALEGRE" }),
      ]),
    ],
  );
  expect(filled!.rows.map((row) => row.city)).toEqual(["PORTO ALEGRE", "GRAVATAI", undefined]);
});

const state: ConferenceState = {
  manifests: [
    manifest("26180001", [
      doc("0000000001", { city: "CANOAS", recipient: "CLINICA A" }),
      doc("0000000002", { city: "CANOAS", recipient: "CLINICA A" }),
    ]),
  ],
  activity: [],
  issues: [],
};

it("updates the map as soon as a CTC is scanned, here or on another device", async () => {
  const { rerender } = render(<ConferenceWorkspace initialState={state} externalState={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Indicadores" }));
  expect(
    await screen.findByRole("button", { name: /^Canoas: 2 CTCs · 2 pendentes/ }),
  ).toBeInTheDocument();
  // Scanned here.
  const scanner = screen.getByRole("textbox", { name: "Código do CTC" });
  fireEvent.change(scanner, { target: { value: "0000000001" } });
  fireEvent.submit(scanner.closest("form")!);
  expect(
    await screen.findByRole("button", { name: /^Canoas: 2 CTCs · 1 pendente/ }),
  ).toBeInTheDocument();
  // Received on another device (team sync).
  const synced: ConferenceState = {
    ...state,
    manifests: state.manifests.map((m) => ({
      ...m,
      documents: m.documents.map((d) => ({
        ...d,
        received: true,
        receivedAt: new Date().toISOString(),
      })),
    })),
  };
  rerender(<ConferenceWorkspace initialState={state} externalState={synced} />);
  expect(
    await screen.findByRole("button", { name: /^Canoas: 2 CTCs · 0 pendentes/ }),
  ).toBeInTheDocument();
});

it("asks for the delivery city when typing a CTC, hinting the recipient's known city", () => {
  const change = vi.fn();
  render(
    <ManifestDocumentsEditor
      rows={[{ ctc: "0000000009", nf: "1-1", volumes: "1", recipient: "CLINICA A" }]}
      onChange={change}
      selectedIndex={0}
      onSelect={vi.fn()}
      cityFor={(recipient) => (recipient === "CLINICA A" ? "CANOAS" : undefined)}
    />,
  );
  const city = screen.getByRole("combobox", { name: "Cidade de entrega" });
  expect(city).toHaveAttribute("placeholder", "CANOAS");
  fireEvent.change(city, { target: { value: "gravataí" } });
  expect(change).toHaveBeenCalledWith([expect.objectContaining({ city: "GRAVATAÍ" })]);
});

it("shows older CTCs without a city on the map through their recipient, without saving", () => {
  const older = manifest("26180009", [doc("0000000009", { recipient: "clinica a" })]);
  const shown = withKnownCities([...state.manifests, older]);
  expect(shown[1]!.documents[0]!.city).toBe("CANOAS");
  expect(older.documents[0]!.city).toBeUndefined();
});

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseLuft108 } from "@/lib/luft-spreadsheet";
import { applyImports } from "@/lib/manifest-import";
import { planOccurrenceUpdates } from "@/lib/nf-occurrences";
import { conferenceStateSchema } from "@/lib/conference-state";
import { applyManifestEdit } from "@/lib/manifest-edit";
import { ConferenceWorkspace } from "@/components/conference-workspace";
vi.mock("@/lib/photo-reader.functions", () => ({
  photoReaderStatus: async () => ({ configured: false }),
}));
afterEach(cleanup);

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
];
const row = (nf = "00123", code = "01", description = "ENTREGA REALIZADA NORMALMENTE") => [
  "06050001",
  "DIS",
  "06",
  "16/10/2026",
  "ABC1D23",
  "MOTORISTA",
  "0000000001",
  "LAB",
  "CLIENTE",
  nf,
  "1",
  2,
  code,
  description,
];
const parsed = () =>
  parseLuft108([
    { name: "Relatório", rows: [headers, row(), row("456", "C3", "CLIENTE RETEVE CTC/NF")] },
  ]);
function imported() {
  const result = applyImports([], parsed().drafts, "2026-10-16T13:00:00Z");
  if (!result.ok) throw new Error(result.error);
  return result.manifests;
}
it("keeps code 01 and each NF-series occurrence through grouping and saved-state decoding without receiving it", () => {
  const manifests = imported();
  const state = conferenceStateSchema.parse({ manifests, activity: [], issues: [] });
  expect(state.manifests[0]?.documents).toHaveLength(1);
  expect(state.manifests[0]?.documents[0]).toMatchObject({
    received: false,
    volumes: 4,
    nf: "00123-1, 456-1",
    nfOccurrences: [
      { nf: "00123-1", code: "01", description: "ENTREGA REALIZADA NORMALMENTE" },
      { nf: "456-1", code: "C3", description: "CLIENTE RETEVE CTC/NF" },
    ],
  });
});
it("keeps reports without optional occurrence columns compatible and leaves empty occurrences absent", () => {
  const plain = parseLuft108([
    { name: "Relatório", rows: [headers.slice(0, 12), row().slice(0, 12)] },
  ]);
  expect(plain.errors).toEqual([]);
  expect(plain.drafts[0]?.rows[0]).not.toHaveProperty("occurrenceCode");
  const blank = parseLuft108([{ name: "Relatório", rows: [headers, row("00123", "", "")] }]);
  const result = applyImports([], blank.drafts, "now");
  expect(result.ok).toBe(true);
  expect(result.ok && result.manifests[0]?.documents[0]).not.toHaveProperty("nfOccurrences");
});
it("rejects ambiguous duplicate NF occurrences and duplicate optional headers instead of choosing one", () => {
  const result = parseLuft108([
    { name: "Relatório", rows: [headers, row(), row("00123", "91", "ENTREGA PROGRAMADA")] },
  ]);
  expect(result.errors[0]).toContain("dados diferentes");
  expect(() =>
    parseLuft108([{ name: "Relatório", rows: [[...headers, "Codigo Ultima Ocorrencia"], row()] }]),
  ).toThrow("ocorrência estão repetidas");
});
it("updates only exact manifest + CTC + NF-series matches and preserves receipt, owner, volumes and IDs", () => {
  const manifests = imported();
  const original = manifests[0]!;
  original.createdByEmail = "bruno@example.test";
  original.documents[0]!.received = true;
  original.documents[0]!.receivedAt = "2026-10-16T13:30:00Z";
  original.documents[0]!.receivedByEmail = "gisele@example.test";
  original.documents[0]!.nfOccurrences = undefined;
  const before = structuredClone(manifests);
  const result = planOccurrenceUpdates(manifests, parsed().drafts);
  expect(result.count).toBe(2);
  expect(result.manifests[0]).toEqual({
    ...original,
    documents: [
      { ...original.documents[0], nfOccurrences: imported()[0]!.documents[0]!.nfOccurrences },
    ],
  });
  expect(manifests).toEqual(before);
  expect(planOccurrenceUpdates(result.manifests, parsed().drafts).count).toBe(0);
  result.manifests[0]!.documents[0]!.nfOccurrences =
    result.manifests[0]!.documents[0]!.nfOccurrences!.map((item) => ({
      description: item.description,
      code: item.code,
      nf: item.nf,
    }));
  expect(planOccurrenceUpdates(result.manifests, parsed().drafts).count).toBe(0);
  const wrongRoute = parsed().drafts.map((d) => ({ ...d, id: "06050002" }));
  expect(planOccurrenceUpdates(manifests, wrongRoute).count).toBe(0);
  const wrongSeries = parsed().drafts.map((d) => ({
    ...d,
    rows: d.rows.map((r) => ({ ...r, nf: r.nf.replace(/-1$/, "-2") })),
  }));
  expect(planOccurrenceUpdates(manifests, wrongSeries).count).toBe(0);
  const wrongCtc = parsed().drafts.map((d) => ({
    ...d,
    rows: d.rows.map((r) => ({ ...r, ctc: "0000000002" })),
  }));
  expect(planOccurrenceUpdates(manifests, wrongCtc).count).toBe(0);
});
it("does not erase existing occurrences for blanks, and rejects conflicting refresh rows", () => {
  const manifests = imported();
  const blank = parsed().drafts.map((d) => ({
    ...d,
    rows: d.rows.map((r) => ({
      ...r,
      occurrenceCode: undefined,
      occurrenceDescription: undefined,
    })),
  }));
  expect(planOccurrenceUpdates(manifests, blank).manifests).toEqual(manifests);
  const draft = parsed().drafts[0]!;
  expect(() =>
    planOccurrenceUpdates(manifests, [
      { ...draft, rows: [draft.rows[0]!, { ...draft.rows[0]!, occurrenceCode: "91" }] },
    ]),
  ).toThrow("conflitantes");
});
it("preserves occurrences on an ordinary edit, removing only the NF association that changed", () => {
  const manifests = imported(),
    base = manifests[0]!;
  const draft = {
    id: base.id,
    driver: base.driver,
    plate: base.plate,
    issueDate: base.issueDate,
    rows: [{ ctc: base.documents[0]!.ctc, nf: base.documents[0]!.nf, volumes: "4" }],
  };
  const kept = applyManifestEdit(manifests, base, draft);
  expect(kept.ok && kept.manifests[0]?.documents[0]?.nfOccurrences).toEqual(
    base.documents[0]!.nfOccurrences,
  );
  const changed = applyManifestEdit(manifests, base, {
    ...draft,
    rows: [{ ...draft.rows[0]!, nf: "456-1" }],
  });
  expect(changed.ok && changed.manifests[0]?.documents[0]?.nfOccurrences).toEqual([
    base.documents[0]!.nfOccurrences![1],
  ]);
});
it("shows distinct NF occurrences in the manifest, pending list and tracking without conflating delivery with receipt", () => {
  render(
    <ConferenceWorkspace initialState={{ manifests: imported(), activity: [], issues: [] }} />,
  );
  expect(screen.getByText(/ENTREGA REALIZADA NORMALMENTE/)).toBeInTheDocument();
  expect(screen.getByText(/CLIENTE RETEVE CTC\/NF/)).toBeInTheDocument();
  expect(screen.getByText("Pendente", { exact: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pendências" }));
  expect(screen.getByText(/ENTREGA REALIZADA NORMALMENTE/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Rastreamento" }));
  expect(screen.getByText(/CLIENTE RETEVE CTC\/NF/)).toBeInTheDocument();
  expect(screen.getByText("Aguardando conferência")).toBeInTheDocument();
});

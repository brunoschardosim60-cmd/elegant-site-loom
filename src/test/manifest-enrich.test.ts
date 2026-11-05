import { expect, it } from "vitest";
import type { Manifest } from "@/lib/conference";
import { planDetailUpdates } from "@/lib/manifest-enrich";
import type { ImportDraft } from "@/lib/manifest-import";

const saved: Manifest = {
  id: "06052233",
  driver: "ANA",
  plate: "ABC1D23",
  date: "2026-10-14T12:00:00.000Z",
  issueDate: "2026-10-14",
  previousIds: ["06052200"],
  documents: [
    {
      id: "a",
      ctc: "0000000001",
      nf: "1-1, 2-1",
      volumes: 3,
      received: true,
      receivedAt: "2026-10-15T10:00:00.000Z",
      client: "LAB",
      recipient: "HOSPITAL",
    },
    { id: "b", ctc: "0000000002", nf: "3-1", volumes: 1, received: false, city: "DIGITADA" },
  ],
};
const draft = (id: string): ImportDraft => ({
  id,
  driver: "ANA",
  plate: "ABC1D23",
  issueDate: "2026-10-14",
  checker: "SADI",
  rows: [
    {
      ctc: "0000000001",
      nf: "1-1",
      volumes: "2",
      client: "LAB",
      recipient: "HOSPITAL",
      city: "CANOAS",
      nature: "PERECIVEL-CONVENCIONAL 48",
      cargoValueCents: 1000,
      weightGrams: 500,
    },
    {
      ctc: "0000000001",
      nf: "2-1",
      volumes: "1",
      client: "LAB",
      recipient: "HOSPITAL",
      city: "CANOAS",
      nature: "PERECIVEL-CONVENCIONAL 48",
      cargoValueCents: 250,
      weightGrams: 100,
    },
    { ctc: "0000000002", nf: "3-1", volumes: "1", city: "GRAVATAI", recipient: "CLINICA" },
  ],
});

it("fills only empty 108 details of registered CTCs and keeps every conference", () => {
  const out = planDetailUpdates([saved], [draft("06052233")]);
  expect(out.count).toBe(2);
  expect(out.manifestIds).toEqual(["06052233"]);
  const [manifest] = out.manifests;
  expect(manifest!.checker).toBe("SADI");
  expect(manifest!.documents[0]).toMatchObject({
    id: "a",
    received: true,
    receivedAt: "2026-10-15T10:00:00.000Z",
    city: "CANOAS",
    nature: "PERECIVEL-CONVENCIONAL 48",
    cargoValueCents: 1250,
    weightGrams: 600,
    volumes: 3,
  });
  // A city already typed is kept; only the missing recipient comes in.
  expect(manifest!.documents[1]).toMatchObject({ city: "DIGITADA", recipient: "CLINICA" });
  // Running it again changes nothing.
  expect(planDetailUpdates(out.manifests, [draft("06052233")]).count).toBe(0);
});

it("matches a renumbered pre by its earlier number and ignores unknown ones", () => {
  expect(planDetailUpdates([saved], [draft("06052200")]).count).toBe(2);
  const none = planDetailUpdates([saved], [draft("06059999")]);
  expect(none.count).toBe(0);
  expect(none.manifests[0]).toBe(saved);
});

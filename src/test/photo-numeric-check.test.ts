import { describe, expect, it } from "vitest";
import { checkPhotoNumbers } from "@/lib/photo-numeric-check";
import type { PhotoFields } from "@/lib/photo-fields";
import type { NumericPhotoRead } from "@/lib/photo-numeric-reader";

const photo = (): PhotoFields => ({
  kind: "pre",
  id: "DI00012345678",
  driver: "ANA SILVA",
  plate: "ABC1D23",
  ctcs: ["0000000001", "0000000002"],
  expectedRows: 2,
  totalVolumes: 15,
  documents: [
    {
      ctc: "0000000001",
      nf: "12345-1",
      volumes: "6",
      client: "LABORATORIO A",
      recipient: "DISTRIBUIDORA A",
    },
    {
      ctc: "0000000002",
      nf: "23456-1",
      volumes: "9",
      client: "LABORATORIO B",
      recipient: "DISTRIBUIDORA B",
    },
  ],
});
const local = (pre = photo()): NumericPhotoRead => ({
  pre,
  confirmed: pre.documents.map((row) => ({ ctc: row.ctc, nf: row.nf, volumes: row.volumes })),
  milliseconds: 3000,
});

describe("Independent local numeric check", () => {
  it("corrects swapped volumes despite a matching total, using CTC identity rather than order", () => {
    const ai = photo();
    ai.documents[0]!.volumes = "9";
    ai.documents[1]!.volumes = "6";
    const read = photo();
    read.documents.reverse();
    const result = checkPhotoNumbers(ai, local(read));
    expect(result.documents.map((row) => row.volumes)).toEqual(["6", "9"]);
    expect(
      result.documents.every((row) =>
        row.review?.some((note) => note.includes("duas leituras locais")),
      ),
    ).toBe(true);
    expect(result.verification?.status).toBe("review");
    expect(ai.documents[0]!.volumes).toBe("9");
  });
  it("corrects a wrong valid CTC only through a unique NF/volume anchor and two local readings", () => {
    const ai = photo();
    ai.documents[0]!.ctc = "0000000099";
    const result = checkPhotoNumbers(ai, local());
    expect(result.documents[0]!.ctc).toBe("0000000001");
    expect(result.ctcs).toEqual(["0000000001", "0000000002"]);
    expect(result.documents[0]!.review?.join(" ")).toContain("CTC corrigido");
  });
  it("flags one local reading without replacing a plausible AI value", () => {
    const ai = photo();
    ai.documents[0]!.nf = "1235-1";
    const read = local();
    read.confirmed[0] = {};
    const result = checkPhotoNumbers(ai, read);
    expect(result.documents[0]!.nf).toBe("1235-1");
    expect(result.documents[0]!.review?.join(" ")).toContain("NF-série diferente");
  });
  it("flags a different NF even when the local reader could not see its hyphen", () => {
    const ai = photo(),
      read = local();
    read.pre.documents[0]!.nf = "123651";
    read.confirmed[0] = {};
    const result = checkPhotoNumbers(ai, read);
    expect(result.documents[0]!.nf).toBe("12345-1");
    expect(result.documents[0]!.review?.join(" ")).toContain("dígitos diferentes");
  });
  it("keeps NFs of a repeated CTC separate even when the OCR orders them differently", () => {
    const ai = photo();
    ai.documents[1]!.ctc = ai.documents[0]!.ctc;
    ai.expectedRows = 1;
    ai.ctcs = [ai.documents[0]!.ctc];
    const source = structuredClone(ai);
    source.documents.reverse();
    expect(
      checkPhotoNumbers(ai, local(source)).documents.map((row) => [row.nf, row.volumes]),
    ).toEqual([
      ["12345-1", "6"],
      ["23456-1", "9"],
    ]);
  });
  it("does not match ambiguous NF/volume anchors or append extra OCR rows", () => {
    const ai = photo();
    ai.documents[0]!.ctc = "0000000099";
    ai.documents[1]!.nf = ai.documents[0]!.nf;
    ai.documents[1]!.volumes = ai.documents[0]!.volumes;
    const source = local();
    source.pre.documents.push({ ...source.pre.documents[0]! });
    source.confirmed.push({ ctc: "0000000001" });
    const result = checkPhotoNumbers(ai, source);
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]!.ctc).toBe("0000000099");
    expect(result.headerReview?.join(" ")).toContain("não confirmou todas as linhas");
  });
  it("never invents missing local cells, headers or names and ignores another document type", () => {
    const read = local();
    read.pre.documents[0]!.nf = "";
    read.confirmed[0] = {};
    const ai = photo();
    ai.documents[0]!.recipient = "DISTRIBUIDORAAB";
    const result = checkPhotoNumbers(ai, read);
    expect(result.documents[0]!.nf).toBe("12345-1");
    expect(result.documents[0]!.recipient).toBe("DISTRIBUIDORAAB");
    expect(result.documents[0]!.review?.join(" ")).toContain("Destinatário diferente");
    expect(result.id).toBe(ai.id);
    expect(checkPhotoNumbers(ai, { ...read, pre: { ...read.pre, kind: "dacte" } })).toMatchObject({
      documents: ai.documents,
      verification: { status: "unavailable" },
    });
  });
  it("uses a decoded pré barcode for its ID only, with an explicit review notice", () => {
    const read = local();
    read.barcodeId = "DI00012345679";
    const result = checkPhotoNumbers(photo(), read);
    expect(result.id).toBe(read.barcodeId);
    expect(result.documents.map((row) => row.ctc)).toEqual(photo().documents.map((row) => row.ctc));
    expect(result.headerReview?.join(" ")).toContain("código de barras");
  });
});

import { expect, it } from "vitest";
import { conferenceStateSchema } from "@/lib/conference-state";

const manifest = {
  id: "DI00123456789",
  driver: "Ana Silva",
  plate: "ABC1D23",
  date: "2026-10-11",
  documents: [{ id: "document", ctc: "0012345678", nf: "123-1", volumes: 1, received: false }],
};
const state = (manifests: unknown[]) => ({ manifests, activity: [], issues: [] });

it("keeps legacy states compatible, including duplicate CTCs already saved in different pres", () => {
  const parsed = conferenceStateSchema.parse(
    state([manifest, { ...manifest, id: "DI00123456790", finishedAt: "done" }]),
  );
  expect(parsed.manifests).toHaveLength(2);
  expect(parsed.manifests[0]).not.toHaveProperty("sourcePhotoHashes");
  expect(parsed.manifests[0]!.documents[0]!.ctc).toBe("0012345678");
});

it("roundtrips registered photo hashes without storing a source file or import draft", () => {
  const sourcePhotoHashes = ["a".repeat(64), "B".repeat(64)];
  const parsed = conferenceStateSchema.parse(
    state([
      { ...manifest, sourcePhotoHashes, photo: "discard this image", draft: { unfinished: true } },
    ]),
  );
  expect(parsed.manifests[0]!.sourcePhotoHashes).toEqual(sourcePhotoHashes);
  expect(parsed.manifests[0]).not.toHaveProperty("photo");
  expect(parsed.manifests[0]).not.toHaveProperty("draft");
  expect(conferenceStateSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
});

it.each([["a".repeat(63)], ["g".repeat(64)], ["a".repeat(64), ""], "a".repeat(64)])(
  "rejects malformed registered photo hash metadata",
  (sourcePhotoHashes) => {
    expect(
      conferenceStateSchema.safeParse(state([{ ...manifest, sourcePhotoHashes }])).success,
    ).toBe(false);
  },
);

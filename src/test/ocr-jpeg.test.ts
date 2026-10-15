// @vitest-environment node
import { describe, expect, it } from "vitest";
import { jpegWithoutExif } from "@/lib/ocr-jpeg";

describe("OCR JPEG coordinates", () => {
  it("removes EXIF while preserving compressed image bytes and unrelated metadata exactly", async () => {
    const head = [255, 216, 255, 224, 0, 4, 12, 13];
    const exif = [255, 225, 0, 10, 69, 120, 105, 102, 0, 0, 6, 0];
    const xmp = [255, 225, 0, 4, 20, 21];
    const image = [255, 218, 0, 2, 33, 44, 55, 255, 217];
    const source = new File([new Uint8Array([...head, ...exif, ...xmp, ...image])], "photo.jpg", {
      type: "image/jpeg",
    });
    const result = await jpegWithoutExif(source);
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([...head, ...xmp, ...image]);
    expect(result.type).toBe("image/jpeg");
  });
  it("keeps malformed JPEGs and other image formats unchanged", async () => {
    for (const [type, bytes] of [
      ["image/png", [1, 2, 3]],
      ["image/jpeg", [255, 216, 255, 225, 255, 255]],
    ] as const) {
      const file = new File([new Uint8Array(bytes)], "photo", { type });
      expect(await jpegWithoutExif(file)).toBe(file);
    }
  });
});

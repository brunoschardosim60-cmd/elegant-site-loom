import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "tesseract.js";

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(),
  setParameters: vi.fn(),
}));
vi.mock("tesseract.js", () => ({ PSM: { SPARSE_TEXT: "11" }, createWorker: vi.fn() }));
vi.mock("@/lib/image-prep", () => ({
  prepareForOcr: vi.fn(async (file: File) => new Blob([file])),
}));
import { createWorker } from "tesseract.js";
import { ocrWorkerOptions } from "@/lib/ocr-worker-options";
import { prepareForOcr } from "@/lib/image-prep";
import { detectPhotoOrientations, hasUprightPhotoHeading } from "@/lib/photo-orientation";

const worker = mocks as unknown as Worker;
const file = (name: string) => new File(["image"], name);
const read = (text: string) => ({ data: { text } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(createWorker).mockResolvedValue(worker);
  vi.mocked(prepareForOcr).mockImplementation(async (file) => new Blob([file]));
  mocks.recognize.mockReset().mockResolvedValue(read("unreadable"));
  mocks.setParameters.mockResolvedValue(undefined);
  mocks.terminate.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Local thumbnail orientation", () => {
  it("shares one worker, keeps indices and stops at the first readable heading per photo", async () => {
    const files = [file("sideways.jpg"), file("upright.jpg")],
      progress = vi.fn();
    mocks.recognize
      .mockResolvedValueOnce(read("unreadable"))
      .mockResolvedValueOnce(read("PRÉ-MANIFESTO"))
      .mockResolvedValueOnce(read("DACTE"));
    expect(await detectPhotoOrientations(files, progress)).toEqual([270, 0]);
    expect(createWorker).toHaveBeenCalledExactlyOnceWith("por", 1, ocrWorkerOptions);
    expect(vi.mocked(prepareForOcr).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [files[0], 0, 1400],
      [files[0], 270, 1400],
      [files[1], 0, 1400],
    ]);
    expect(mocks.setParameters).toHaveBeenCalledExactlyOnceWith({
      tessedit_pageseg_mode: "11",
      tessedit_char_whitelist: "",
    });
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(progress.mock.calls.map((call) => call[0])).toEqual([0, 1]);
  });

  it("tries only four thumbnails and preserves zero when no heading is readable", async () => {
    const files = [file("unknown.jpg")];
    expect(await detectPhotoOrientations(files)).toEqual([0]);
    expect(vi.mocked(prepareForOcr).mock.calls.map((call) => call[1])).toEqual([0, 270, 90, 180]);
    expect(mocks.recognize).toHaveBeenCalledTimes(4);
  });

  it("continues with other angles after an individual decode failure", async () => {
    vi.mocked(prepareForOcr).mockRejectedValueOnce(new Error("decode"));
    mocks.recognize.mockResolvedValue(read("DI00601860020"));
    expect(await detectPhotoOrientations([file("photo.jpg")])).toEqual([270]);
    expect(mocks.recognize).toHaveBeenCalledOnce();
  });
  it("never processes a full original when thumbnail preparation falls back", async () => {
    vi.mocked(prepareForOcr).mockImplementation(async (file) => file);
    expect(await detectPhotoOrientations([file("photo.jpg")])).toEqual([0]);
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it("does no work for an empty or already canceled batch", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await detectPhotoOrientations([])).toEqual([]);
    expect(await detectPhotoOrientations([file("photo.jpg")], undefined, abort.signal)).toEqual([
      0,
    ]);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("cancels a pending language download immediately and terminates its late worker", async () => {
    let finish!: (worker: Worker) => void;
    vi.mocked(createWorker).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const abort = new AbortController(),
      progress = vi.fn();
    const result = detectPhotoOrientations([file("photo.jpg")], progress, abort.signal);
    abort.abort();
    expect(await result).toEqual([0]);
    finish(worker);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledOnce();
  });

  it("includes initialization in the six-second global budget", async () => {
    let finish!: (worker: Worker) => void;
    vi.mocked(createWorker).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = detectPhotoOrientations([file("photo.jpg")]);
    await vi.advanceTimersByTimeAsync(5999);
    expect(mocks.recognize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual([0]);
    finish(worker);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });

  it("also bounds a stalled thumbnail preparation and discards its late result", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(prepareForOcr).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = detectPhotoOrientations([file("photo.jpg")]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await result).toEqual([0]);
    expect(vi.mocked(prepareForOcr).mock.calls[0]?.[3]?.aborted).toBe(true);
    expect(mocks.terminate).toHaveBeenCalledOnce();
    finish(new Blob(["thumbnail"]));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it("propagates an external cancellation into pending thumbnail preparation", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(prepareForOcr).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const abort = new AbortController();
    const result = detectPhotoOrientations([file("photo.jpg")], undefined, abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    const preparationSignal = vi.mocked(prepareForOcr).mock.calls[0]?.[3];
    expect(preparationSignal?.aborted).toBe(false);
    abort.abort();
    expect(await result).toEqual([0]);
    expect(preparationSignal?.aborted).toBe(true);
    finish(new Blob(["late thumbnail"]));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });

  it("preserves completed orientations when the batch deadline interrupts recognition", async () => {
    let finish!: (reading: ReturnType<typeof read>) => void;
    mocks.recognize
      .mockResolvedValueOnce(read("unreadable"))
      .mockResolvedValueOnce(read("PRÉ-MANIFESTO"))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    const progress = vi.fn(),
      result = detectPhotoOrientations([file("a.jpg"), file("b.jpg"), file("c.jpg")], progress);
    await vi.advanceTimersByTimeAsync(6000);
    const angles = await result;
    expect(angles).toEqual([270, 0, 0]);
    expect(mocks.terminate).toHaveBeenCalledOnce();
    finish(read("DACTE"));
    await vi.advanceTimersByTimeAsync(0);
    expect(angles).toEqual([270, 0, 0]);
    expect(progress.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    expect(mocks.recognize).toHaveBeenCalledTimes(3);
  });

  it("cancels active recognition without late orientation or progress changes", async () => {
    let finish!: (reading: ReturnType<typeof read>) => void;
    mocks.recognize.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const abort = new AbortController(),
      progress = vi.fn();
    const result = detectPhotoOrientations([file("a.jpg"), file("b.jpg")], progress, abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    const angles = await result;
    expect(angles).toEqual([0, 0]);
    finish(read("DACTE"));
    await vi.advanceTimersByTimeAsync(0);
    expect(angles).toEqual([0, 0]);
    expect(progress).toHaveBeenCalledOnce();
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
});

it.each(["PRÉ-MANIFESTO", "PRE MANIFESTO", "DACTE", "DI00601860020"])(
  "confirms a readable document marker: %s",
  (text) => {
    expect(hasUprightPhotoHeading(text)).toBe(true);
  },
);
it.each(["1234567890", "NF 123456-1", "random heading", "DI1234"])(
  "does not orient from unrelated numbers: %s",
  (text) => {
    expect(hasUprightPhotoHeading(text)).toBe(false);
  },
);

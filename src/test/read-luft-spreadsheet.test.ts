import { afterEach, expect, it, vi } from "vitest";
import { readLuftSpreadsheet } from "@/lib/read-luft-spreadsheet";
import { spreadsheetLimits } from "@/lib/luft-spreadsheet-limits";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("accepts a 50 MB file and immediately terminates its worker on cancellation", async () => {
  const terminate = vi.fn(),
    post = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      terminate = terminate;
      postMessage = post;
    },
  );
  const file = {
    name: "108.xlsx",
    size: 50 * 1024 * 1024,
    arrayBuffer: async () => new ArrayBuffer(22),
  } as File;
  const abort = new AbortController();
  const pending = readLuftSpreadsheet(file, abort.signal);
  const result = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  expect(post).toHaveBeenCalledOnce();
  abort.abort();
  await result;
  expect(terminate).toHaveBeenCalledOnce();
});

it("rejects oversized files before allocating their bytes", async () => {
  const arrayBuffer = vi.fn();
  await expect(
    readLuftSpreadsheet(
      { name: "108.xlsx", size: spreadsheetLimits.fileBytes + 1, arrayBuffer } as unknown as File,
      new AbortController().signal,
    ),
  ).rejects.toThrow("200 MB");
  expect(arrayBuffer).not.toHaveBeenCalled();
});

it("allows a larger file more than 20 seconds and stops a stalled read at two minutes", async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      terminate = terminate;
      postMessage = vi.fn();
    },
  );
  const pending = readLuftSpreadsheet(
    {
      name: "108.xlsx",
      size: 50 * 1024 * 1024,
      arrayBuffer: async () => new ArrayBuffer(22),
    } as File,
    new AbortController().signal,
  );
  const result = expect(pending).rejects.toThrow("2 minutos");
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(20000);
  expect(terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100000);
  await result;
  expect(terminate).toHaveBeenCalledOnce();
});

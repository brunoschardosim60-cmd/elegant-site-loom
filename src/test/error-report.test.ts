import { afterEach, expect, it, vi } from "vitest";
import { reportError, resetErrorReports } from "@/lib/error-report";

afterEach(() => resetErrorReports());

it("sends a redacted, de-duplicated report and never one for network failures", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const failure = new Error(
    "Cannot read properties of undefined (token sb_secret_abcdefghijklmnopqrstu)",
  );
  reportError(rpc, failure, "window");
  reportError(rpc, failure, "window");
  reportError(rpc, new TypeError("Failed to fetch"), "promise");
  expect(rpc).toHaveBeenCalledOnce();
  const args = rpc.mock.calls[0]![1] as { message: string };
  expect(args.message).toMatch(/^\[window\] Error: Cannot read properties/);
  expect(args.message).not.toContain("sb_secret_abcdefghijklmnopqrstu");
});

it("caps reports per page and survives a failing RPC", () => {
  const rpc = vi.fn().mockRejectedValue(new Error("offline"));
  for (let n = 0; n < 25; n++) reportError(rpc, new Error(`falha ${n}`), "window");
  expect(rpc).toHaveBeenCalledTimes(10);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A dynamic path keeps this build-only JavaScript helper outside application TS.
const script = "../../scripts/check-gemini-backup.mjs";
const { checkGeminiBackup } = await import(/* @vite-ignore */ script);
const credential = "synthetic-backup-key-must-not-appear-in-logs";
const validMetadata = {
  name: "models/gemini-3.8-flash",
  supportedGenerationMethods: ["generateContent"],
};
const fixture = (fetch = vi.fn()) => ({
  env: { GEMINI_API_KEY_FALLBACK: credential },
  fetch,
  log: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("skips an absent or blank reserve without making a request", async () => {
  for (const env of [{}, { GEMINI_API_KEY_FALLBACK: "   " }]) {
    const input = { ...fixture(), env };
    expect(await checkGeminiBackup(input)).toBe("SKIP");
    expect(input.fetch).not.toHaveBeenCalled();
    expect(input.log).toHaveBeenCalledExactlyOnceWith("[gemini_backup_check] SKIP");
  }
});

it("uses exactly one header-authenticated GET and validates generation-capable model metadata", async () => {
  const input = fixture(vi.fn().mockResolvedValue(new Response(JSON.stringify(validMetadata))));
  expect(await checkGeminiBackup(input)).toBe("OK HTTP_200");
  expect(input.fetch).toHaveBeenCalledExactlyOnceWith(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash",
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: { "x-goog-api-key": credential },
      signal: expect.anything(),
    }),
  );
  const request = input.fetch.mock.calls[0]!;
  expect(request[0]).not.toContain(credential);
  expect(request[1]).not.toHaveProperty("body");
  expect(input.log).toHaveBeenCalledExactlyOnceWith("[gemini_backup_check] OK HTTP_200");
  expect(JSON.stringify(input.log.mock.calls)).not.toContain(credential);
});

it("checks the configured model rather than accepting metadata for a different model", async () => {
  const input = {
    ...fixture(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            name: "models/configured-model",
            supportedGenerationMethods: ["generateContent"],
          }),
        ),
      ),
    ),
    env: { GEMINI_API_KEY_FALLBACK: credential, GEMINI_OCR_MODEL: "configured-model" },
  };
  expect(await checkGeminiBackup(input)).toBe("OK HTTP_200");
  expect(input.fetch.mock.calls[0]![0]).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/configured-model",
  );
});

it.each([
  { name: "models/different", supportedGenerationMethods: ["generateContent"] },
  { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["embedContent"] },
  { name: "models/gemini-3.8-flash" },
  null,
])(
  "fails a 200 response whose metadata does not confirm the requested generation model",
  async (metadata) => {
    const input = fixture(vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata))));
    expect(await checkGeminiBackup(input)).toBe("CHECK_FAILED HTTP_200");
    expect(input.fetch).toHaveBeenCalledOnce();
    expect(input.log).toHaveBeenCalledExactlyOnceWith(
      "[gemini_backup_check] CHECK_FAILED HTTP_200",
    );
  },
);

it.each([400, 401, 403, 429, 500])(
  "logs only fixed HTTP %s status without reading a potentially sensitive provider error body",
  async (status) => {
    const json = vi.fn().mockRejectedValue(new Error(credential));
    const input = fixture(vi.fn().mockResolvedValue({ status, json }));
    expect(await checkGeminiBackup(input)).toBe(`CHECK_FAILED HTTP_${status}`);
    expect(json).not.toHaveBeenCalled();
    expect(input.fetch).toHaveBeenCalledOnce();
    expect(input.log).toHaveBeenCalledExactlyOnceWith(
      `[gemini_backup_check] CHECK_FAILED HTTP_${status}`,
    );
    expect(JSON.stringify(input.log.mock.calls)).not.toContain(credential);
  },
);

it("does not expose a network exception or reject the build check", async () => {
  const input = fixture(vi.fn().mockRejectedValue(new Error(`api_key=${credential}`)));
  expect(await checkGeminiBackup(input)).toBe("CHECK_FAILED HTTP_UNKNOWN");
  expect(input.log).toHaveBeenCalledExactlyOnceWith(
    "[gemini_backup_check] CHECK_FAILED HTTP_UNKNOWN",
  );
});

it("does not expose an invalid JSON body or reject the build check", async () => {
  const input = fixture(vi.fn().mockResolvedValue(new Response(`api_key=${credential}`)));
  expect(await checkGeminiBackup(input)).toBe("CHECK_FAILED HTTP_200");
  expect(input.log).toHaveBeenCalledExactlyOnceWith("[gemini_backup_check] CHECK_FAILED HTTP_200");
});

it.each(["fetch", "body"] as const)(
  "bounds a stalled %s at five seconds even when it ignores cancellation",
  async (stage) => {
    const input = fixture(
      stage === "fetch"
        ? vi.fn(() => new Promise(() => {}))
        : vi.fn().mockResolvedValue({ status: 200, json: () => new Promise(() => {}) }),
    );
    let finished = false;
    const run = checkGeminiBackup(input).then((result: string) => {
      finished = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await run).toBe("CHECK_FAILED TIMEOUT");
    expect(input.fetch).toHaveBeenCalledOnce();
    expect(input.fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(input.log).toHaveBeenCalledExactlyOnceWith("[gemini_backup_check] CHECK_FAILED TIMEOUT");
  },
);

it("prefers the additional reserve for the safe build probe without logging it", async () => {
  const input = {
    ...fixture(vi.fn().mockResolvedValue(new Response(JSON.stringify(validMetadata)))),
    env: {
      GEMINI_API_KEY_FALLBACK: credential,
      GEMINI_API_KEY_FALLBACK_2: "synthetic-additional-key",
    },
  };
  expect(await checkGeminiBackup(input)).toBe("OK HTTP_200");
  expect(input.fetch.mock.calls[0]![1].headers["x-goog-api-key"]).toBe("synthetic-additional-key");
  expect(JSON.stringify(input.log.mock.calls)).not.toContain("synthetic");
});

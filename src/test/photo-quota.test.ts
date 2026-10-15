import { expect, it } from "vitest";
import { photoQuotaFailure } from "@/lib/photo-quota";

it("recognizes the daily quota even when the provider also suggests a short retry", () => {
  const result = photoQuotaFailure({
    error: {
      message: "Try again in 30s",
      details: [
        {
          violations: [
            {
              quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
              quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            },
          ],
        },
        { retryDelay: "30s" },
      ],
    },
  });
  expect(result.quota).toBe("daily");
  expect(result.retryable).toBe(false);
  expect(result.error).toContain("diária");
});

it("distinguishes a minute quota and keeps raw provider details private", () => {
  const result = photoQuotaFailure({
    error: {
      message: "private-project-name",
      details: [
        { violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
      ],
    },
  });
  expect(result.quota).toBe("minute");
  expect(JSON.stringify(result)).not.toContain("private-project-name");
});

it("does not infer a quota period from an unrecognized or invalid response", () => {
  for (const value of [
    null,
    "invalid json",
    { error: { message: "Resource exhausted" } },
    { error: { details: [null, { violations: [null, "invalid"] }] } },
  ]) {
    expect(photoQuotaFailure(value).quota).toBe("unknown");
  }
});

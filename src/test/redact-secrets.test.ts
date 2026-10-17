import { expect, it } from "vitest";
import { redactSecrets } from "@/lib/redact-secrets";
it("hides credentials in errors, URLs, headers and serialized context without destroying useful diagnostics", () => {
  const inputs = [
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature",
    '{"password":"synthetic password with spaces","refresh_token":"synthetic-refresh"}',
    "https://synthetic.invalid/?access_token=synthetic-access&other=kept",
    "x-goog-api-key=synthetic-provider",
    JSON.stringify({ password: '"synthetic password with spaces' }),
    "sb_secret_synthetic_credential_value",
  ];
  for (const value of inputs) {
    const result = redactSecrets(value);
    expect(result).toContain("REDACTED");
    expect(result).not.toMatch(
      /synthetic-(?:refresh|access|provider)|synthetic password|synthetic_credential/,
    );
  }
  expect(redactSecrets("CONFERENCE_CONFLICT at conference.ts:42")).toBe(
    "CONFERENCE_CONFLICT at conference.ts:42",
  );
});

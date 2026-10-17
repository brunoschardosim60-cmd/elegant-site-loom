// @vitest-environment node
import { expect, it } from "vitest";
import {
  CSP_NONCE_HEADER,
  MAX_REQUEST_BYTES,
  secureRequest,
  securityHeaders,
} from "@/lib/http-security";
import { publicSupabaseConfig, supabaseConfig } from "@/lib/supabase-config";

it("replaces visitor-supplied nonces and preserves legitimate RPC bytes", async () => {
  const original = new Request("https://confere.example/_serverFn/test", {
    method: "POST",
    headers: { [CSP_NONCE_HEADER]: "forged" },
    body: '{"value":"normal"}',
  });
  const request = await secureRequest(original, "random-server-nonce");
  expect(request).toBeInstanceOf(Request);
  expect((request as Request).headers.get(CSP_NONCE_HEADER)).toBe("random-server-nonce");
  expect(await (request as Request).text()).toBe('{"value":"normal"}');
});
it("rejects an oversized announced body before reading it", async () => {
  const result = await secureRequest(
    new Request("https://confere.example/", {
      method: "POST",
      headers: { "content-length": String(MAX_REQUEST_BYTES + 1) },
      body: "x",
    }),
    "nonce",
  );
  expect((result as Response).status).toBe(413);
});
it("rejects oversized chunked uploads even with no Content-Length, and cancels the producer", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://confere.example/", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  expect(((await secureRequest(request, "nonce")) as Response).status).toBe(413);
  expect(cancelled).toBe(true);
});
it("protects HTML and error responses without caching account data or allowing arbitrary scripts or frames", () => {
  const result = securityHeaders(
    new Response("safe", {
      status: 500,
      headers: { "set-cookie": "session=synthetic; Secure; HttpOnly", "content-type": "text/html" },
    }),
    "random",
    true,
  );
  expect(result.headers.get("content-security-policy")).toContain("'nonce-random'");
  expect(result.headers.get("content-security-policy")).not.toMatch(
    /script-src[^;]*'unsafe-(?:inline|eval)'/,
  );
  expect(result.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(result.headers.get("x-frame-options")).toBe("DENY");
  expect(result.headers.get("x-content-type-options")).toBe("nosniff");
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("set-cookie")).toContain("synthetic");
  expect(result.headers.get("permissions-policy")).toContain("camera=(self)");
  expect(result.status).toBe(500);
});
it("does not enforce production CSP on Vite development", () => {
  expect(
    securityHeaders(new Response("dev"), "random", false).headers.has("content-security-policy"),
  ).toBe(false);
});
it("never exports secret or service-role keys, including legacy privileged JWTs", () => {
  const legacy = (role: string) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  expect(publicSupabaseConfig({})).toEqual(supabaseConfig);
  for (const key of [
    "sb_secret_synthetic",
    legacy("service_role"),
    legacy("authenticated"),
    "not-a-key",
  ])
    expect(() => publicSupabaseConfig({ SUPABASE_PUBLISHABLE_KEY: key })).toThrow("inválida");
  expect(publicSupabaseConfig({ SUPABASE_PUBLISHABLE_KEY: legacy("anon") })).toMatchObject({
    key: legacy("anon"),
  });
  expect(() =>
    publicSupabaseConfig({ SUPABASE_URL: "https://name:password@synthetic.invalid" }),
  ).toThrow("inválida");
});

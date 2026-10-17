import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Bounded, unauthenticated probes only. No passwords, account creation or load test.
const origin = process.argv[2] || "https://elegant-site-loom.vercel.app";
assert(["https://elegant-site-loom.vercel.app", "http://127.0.0.1:8083"].includes(origin));
const results = [];
async function probe(name, url, options, check) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const body = await response.text();
  check(response, body);
  results.push({ test: name, status: response.status, passed: true });
}
await probe("HTTP protections and nonced SSR", origin + "/", {}, (response, html) => {
  assert.equal(response.status, 200);
  const csp = response.headers.get("content-security-policy");
  const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
  assert(nonce);
  assert(csp.includes("frame-ancestors 'none'"));
  assert(!csp.match(/script-src ([^;]+)/)?.[1].includes("https:"));
  assert(csp.includes("worker-src 'self'"));
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control"), /no-store/);
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)];
  assert(scripts.length > 0);
  assert(scripts.every(([tag]) => tag.includes(`nonce="${nonce}"`)));
  assert(!/(?:sb_secret_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})/.test(html));
});
await probe(
  "Lockfile-pinned local OCR worker",
  origin + "/ocr-assets/worker.min.js",
  {},
  (response, body) => {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
    assert(body.length > 10000);
  },
);
for (const path of ["/.env", "/.git/config", "/layout-preview"])
  await probe("Private/development path " + path, origin + path, {}, (response) =>
    assert.equal(response.status, 404),
  );
const config = await readFile(new URL("../src/lib/supabase-config.ts", import.meta.url), "utf8");
const database = config.match(/url: "([^"]+)"/)[1],
  key = config.match(/key: "([^"]+)"/)[1];
for (const table of [
  "conference_states",
  "conference_members",
  "conference_audit",
  "conference_reader_limits",
])
  await probe(
    "Anonymous table " + table,
    `${database}/rest/v1/${table}?select=*&limit=0`,
    { headers: { apikey: key } },
    (response) => assert([401, 403].includes(response.status)),
  );
for (const [rpc, args] of [
  ["get_conference_revision", {}],
  ["get_conference_audit", {}],
  ["save_team_conference", { base_data: {}, next_data: {} }],
  ["consume_conference_reader_quota", {}],
  ["conference_merge", { b: {}, l: {}, r: {} }],
])
  await probe(
    "Anonymous RPC " + rpc,
    `${database}/rest/v1/rpc/${rpc}`,
    {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify(args),
    },
    (response) => assert([401, 403, 404].includes(response.status)),
  );
const forged =
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url") +
  "." +
  Buffer.from(
    JSON.stringify({
      role: "service_role",
      sub: "10000000-0000-4000-8000-000000000099",
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString("base64url") +
  ".invalid-signature";
await probe(
  "Forged privileged JWT",
  `${database}/rest/v1/conference_states?select=*&limit=0`,
  { headers: { apikey: key, authorization: `Bearer ${forged}` } },
  (response) => assert.equal(response.status, 401),
);
const files = await readdir(new URL("../.output/server/", import.meta.url));
const manifest = await readFile(
  new URL(
    "../.output/server/" + files.find((name) => name.includes("server-fn-resolver")),
    import.meta.url,
  ),
  "utf8",
);
const id = manifest.match(/"([a-f0-9]{64})":\s*\{\s*functionName: "getSupabaseConfig/)[1];
await probe(
  "Cross-origin server function",
  `${origin}/_serverFn/${id}`,
  { headers: { Origin: "https://untrusted.example.invalid", "Sec-Fetch-Site": "cross-site" } },
  (response) => assert.equal(response.status, 403),
);
console.log(
  JSON.stringify(
    { origin, checkedAt: new Date().toISOString(), checks: results.length, results },
    null,
    2,
  ),
);

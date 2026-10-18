import { supabaseConfig } from "./supabase-config";

export const CSP_NONCE_HEADER = "x-confere-csp-nonce";
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** Enforce the real stream size as well as Content-Length before RPC decoding. */
export async function secureRequest(request: Request, nonce: string): Promise<Request | Response> {
  const headers = new Headers(request.headers);
  // Never trust a nonce supplied by the visitor.
  headers.set(CSP_NONCE_HEADER, nonce);
  const length = headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES))
    return new Response("Arquivo ou solicitação muito grande.", { status: 413 });
  // Rebuild from the URL: cloning a foreign Request implementation breaks in dev SSR.
  const rebuild = (body?: ArrayBuffer) =>
    new Request(request.url, {
      method: request.method,
      headers,
      redirect: "manual",
      ...(body ? { body, duplex: "half" as const } : {}),
    });
  if (!request.body) return rebuild();
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return new Response("Arquivo ou solicitação muito grande.", { status: 413 });
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rebuild(body.buffer);
}

export function securityHeaders(
  response: Response,
  nonce: string,
  production: boolean,
  databaseUrl = supabaseConfig.url,
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  );
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Cache-Control", "private, no-store");
  if (production) {
    const supabase = new URL(databaseUrl);
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      `connect-src 'self' ${supabase.origin} wss://${supabase.host} https://cdn.jsdelivr.net https://tessdata.projectnaptha.com`,
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ];
    headers.set("Content-Security-Policy", csp.join("; "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

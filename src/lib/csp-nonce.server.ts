import { getRequestHeader } from "@tanstack/react-start/server";
import { CSP_NONCE_HEADER } from "./http-security";

/** Server-only: read the per-response CSP nonce threaded by src/server.ts. */
export function readCspNonce(): string | undefined {
  return getRequestHeader(CSP_NONCE_HEADER);
}

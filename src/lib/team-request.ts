import type { SupabaseClient } from "@supabase/supabase-js";
/** Bound uploads and responses; retries remain explicit to preserve user edits. */
export function teamRequest(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const request = client.rpc(name, args);
  return typeof request.abortSignal === "function"
    ? request.abortSignal(AbortSignal.timeout(15000))
    : request;
}

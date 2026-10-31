import { isTransientFailure } from "./conference-team";
import { redactSecrets } from "./redact-secrets";

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

/** At most this many reports per page load; the database also limits 30 per hour. */
const MAX_REPORTS = 10;
const sent = new Set<string>();

/**
 * Sends a browser error to the database log (report_client_error), so failures
 * are seen without anyone reporting them. Never throws, never retries, skips
 * repeats and network failures (those are already retried and shown to users).
 */
export function reportError(rpc: Rpc, error: unknown, origin: string) {
  try {
    const message = redactSecrets(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    ).slice(0, 1000);
    if (!message || isTransientFailure(message) || sent.size >= MAX_REPORTS) return;
    const key = `${origin}|${message}`;
    if (sent.has(key)) return;
    sent.add(key);
    const stack = error instanceof Error && error.stack ? redactSecrets(error.stack) : null;
    void Promise.resolve(
      rpc("report_client_error", {
        message: `[${origin}] ${message}`,
        stack: stack?.slice(0, 4000) ?? null,
        page: typeof location === "undefined" ? null : location.pathname,
        agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 300),
      }),
    ).catch(() => {});
  } catch {
    /* Reporting must never break the page. */
  }
}

/** Reports uncaught errors and rejected promises while the workspace is open. */
export function watchErrors(rpc: Rpc) {
  const onError = (event: ErrorEvent) => reportError(rpc, event.error ?? event.message, "window");
  const onRejection = (event: PromiseRejectionEvent) => reportError(rpc, event.reason, "promise");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Test hook: forget what was already sent. */
export function resetErrorReports() {
  sent.clear();
}

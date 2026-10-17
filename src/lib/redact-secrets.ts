/** Redact credential-shaped strings before sending diagnostics to any logger. */
export function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]")
    .replace(
      /\b(?:AIza[A-Za-z0-9_-]{25,}|sb_secret_[A-Za-z0-9_-]+|AQ\.[A-Za-z0-9_-]{30,})\b/g,
      "[REDACTED KEY]",
    )
    .replace(
      /((?:password|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|x-goog-api-key|client_secret)["']?\s*[:=]\s*)(["'])((?:\\.|(?!\2)[^\\])*)\2/gi,
      "$1$2[REDACTED]$2",
    )
    .replace(
      /((?:password|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|x-goog-api-key|client_secret)\s*[:=]\s*)([^\s,;&"'}]+)/gi,
      "$1[REDACTED]",
    );
}

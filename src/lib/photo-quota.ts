/** Classify provider quota metadata without returning its raw response to the browser. */
export function photoQuotaFailure(value: unknown) {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const error =
    body["error"] && typeof body["error"] === "object"
      ? (body["error"] as Record<string, unknown>)
      : {};
  const details = Array.isArray(error["details"]) ? error["details"] : [];
  const metrics = details.flatMap((detail) => {
    if (!detail || typeof detail !== "object") return [];
    const violations = (detail as Record<string, unknown>)["violations"];
    return Array.isArray(violations)
      ? violations.flatMap((violation) => {
          if (!violation || typeof violation !== "object") return [];
          const item = violation as Record<string, unknown>;
          return [item["quotaMetric"], item["quotaId"]].filter(
            (field): field is string => typeof field === "string",
          );
        })
      : [];
  });
  // Explicit violation IDs take precedence over general documentation in the message.
  const evidence = metrics.length
    ? metrics.join(" ")
    : typeof error["message"] === "string"
      ? error["message"]
      : "";
  const quota = /per.?day|daily/i.test(evidence)
    ? ("daily" as const)
    : /per.?minute/i.test(evidence)
      ? ("minute" as const)
      : ("unknown" as const);
  const message =
    quota === "daily"
      ? "Cota diária do Gemini esgotada. Aguarde a renovação da cota ou ative o faturamento no Google AI Studio."
      : quota === "minute"
        ? "Limite de leituras por minuto do Gemini atingido. Aguarde um minuto e releia esta foto."
        : "Limite do Gemini atingido. Confira a cota no Google AI Studio antes de tentar novamente.";
  return { ok: false as const, retryable: false as const, quota, error: message };
}

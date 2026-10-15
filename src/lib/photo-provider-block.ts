export type PhotoProviderBlock = {
  ok: false;
  retryable: false;
  quota: "daily";
  error: string;
};

type BlockMetadata = { userId: string; expiresAt: number };

const storagePrefix = "confere.photo-provider-block.v1:";
const memory = new Map<string, BlockMetadata>();
const maxQuotaDay = 26 * 60 * 60 * 1000;
const providerDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dailyMessage =
  "Cota diária do Gemini esgotada. O leitor gratuito no navegador será usado até a renovação da cota.";

function validTime(now: number) {
  return Number.isFinite(now) && Math.abs(now) < 8.64e15 - maxQuotaDay;
}

/** Find the next provider midnight without assuming a 24-hour day or a fixed UTC offset. */
function nextQuotaReset(now: number) {
  const currentDate = providerDate.format(now);
  let before = Math.floor(now);
  let after = before + maxQuotaDay;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (providerDate.format(middle) === currentDate) before = middle;
    else after = middle;
  }
  return after;
}

function storage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function storageKey(userId: string) {
  return `${storagePrefix}${encodeURIComponent(userId)}`;
}

function activeMetadata(value: unknown, userId: string, now: number): value is BlockMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["userId"] === userId &&
    typeof record["expiresAt"] === "number" &&
    Number.isSafeInteger(record["expiresAt"]) &&
    record["expiresAt"] > now &&
    record["expiresAt"] === nextQuotaReset(now)
  );
}

function block(): PhotoProviderBlock {
  return { ok: false, retryable: false, quota: "daily", error: dailyMessage };
}

/** Only daily-quota metadata is retained; no photos, drafts, credentials or provider response text. */
export function getPhotoProviderBlock(
  userId: string,
  now = Date.now(),
): PhotoProviderBlock | undefined {
  if (!userId.trim() || !validTime(now)) return undefined;
  const cached = memory.get(userId);
  if (activeMetadata(cached, userId, now)) return block();
  memory.delete(userId);

  const session = storage();
  if (!session) return undefined;
  const key = storageKey(userId);
  try {
    const raw = session.getItem(key);
    if (raw === null) return undefined;
    const metadata: unknown = JSON.parse(raw);
    if (activeMetadata(metadata, userId, now)) {
      memory.set(userId, metadata);
      return block();
    }
  } catch {
    /* A blocked or corrupt browser store must not prevent local reading. */
  }
  try {
    session.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
  return undefined;
}

export function rememberPhotoProviderBlock(
  userId: string,
  result: { ok: false; quota?: string; error: string },
  now = Date.now(),
): void {
  if (result.quota !== "daily" || !userId.trim() || !validTime(now)) return;
  const metadata: BlockMetadata = { userId, expiresAt: nextQuotaReset(now) };
  memory.set(userId, metadata);
  try {
    storage()?.setItem(storageKey(userId), JSON.stringify(metadata));
  } catch {
    /* Keep the in-memory block when browser storage is unavailable. */
  }
}

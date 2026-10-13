// Only hashes are memoized, with weak keys. Photos and import results are never
// saved to browser storage or retained after the form releases the File objects.
const hashes = new WeakMap<File, Promise<string | undefined>>();

function bytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function photoFingerprint(file: File): Promise<string | undefined> {
  let hash = hashes.get(file);
  if (!hash) {
    hash = (async () => {
      if (!globalThis.crypto?.subtle) return undefined;
      const digest = await crypto.subtle.digest('SHA-256', await bytes(file));
      return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    })().catch(() => undefined);
    hashes.set(file, hash);
  }
  return hash;
}

function untilCancelled(hash: Promise<string | undefined>, signal?: AbortSignal): Promise<string | undefined> {
  if (!signal) return hash;
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const finish = (value?: string) => {
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const cancel = () => finish();
    signal.addEventListener('abort', cancel, { once: true });
    void hash.then(finish);
  });
}

/** Hash a few photos in parallel without allocating one full ArrayBuffer per
 * selected file at once. Mobile devices stay at two concurrent file reads.
 */
async function fingerprintFiles(files: File[], signal?: AbortSignal): Promise<(string | undefined)[]> {
  const result: (string | undefined)[] = Array(files.length).fill(undefined);
  if (!files.length || signal?.aborted) return result;
  const mobile = typeof navigator !== 'undefined' && (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
  const memory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
    ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
    : undefined;
  const lowMemory = memory !== undefined && Number.isFinite(memory) && memory <= 4;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const parallelism = Math.min(files.length, mobile || lowMemory ? 2 : cores >= 8 ? 4 : 2);
  let next = 0;
  await Promise.all(Array.from({ length: parallelism }, async () => {
    while (!signal?.aborted) {
      const index = next++;
      if (index >= files.length) return;
      result[index] = await untilCancelled(photoFingerprint(files[index]!), signal);
    }
  }));
  return result;
}

export type RegisteredPhoto = { hash: string; manifestId: string };
export type PhotoSelection = { files: File[]; duplicates: number; registeredDuplicates?: { filename: string; manifestId: string }[] };

/** Ignore byte-identical photos within this import and registered photos,
 * regardless of their names. Registered hashes come from this account's saved
 * manifests; no photo contents or unsaved reading results are retained.
 * If hashing is unavailable, retain the file rather than risk dropping a page.
 */
export async function uniquePhotoFiles(selected: File[], existing: File[] = [], signal?: AbortSignal, registered: RegisteredPhoto[] = []): Promise<PhotoSelection> {
  const files: File[] = [];
  const seen = new Set(existing);
  const fingerprints = new Set<string>();
  const saved = new Map(registered.filter(item => /^[a-f0-9]{64}$/i.test(item.hash)).map(item => [item.hash.toLowerCase(), item.manifestId]));
  const registeredDuplicates: NonNullable<PhotoSelection['registeredDuplicates']> = [];
  let duplicates = 0;
  const existingHashes = await fingerprintFiles(existing, signal);
  if (signal?.aborted) return { files: [], duplicates: 0 };
  for (const hash of existingHashes) if (hash) fingerprints.add(hash);

  // Preserve original order for duplicate resolution, but hash photos in a
  // small parallel pool so large batches can start OCR sooner.
  const selectedHashes = await fingerprintFiles(selected, signal);
  if (signal?.aborted) return { files: [], duplicates: 0 };
  for (const [index, file] of selected.entries()) {
    const hash = selectedHashes[index];
    const manifestId = hash ? saved.get(hash) : undefined;
    if (manifestId) {
      duplicates++;
      registeredDuplicates.push({ filename: file.name, manifestId });
    } else if (seen.has(file) || (hash && fingerprints.has(hash))) duplicates++;
    else {
      files.push(file);
      seen.add(file);
      if (hash) fingerprints.add(hash);
    }
  }
  return { files, duplicates, ...(registeredDuplicates.length ? { registeredDuplicates } : {}) };
}

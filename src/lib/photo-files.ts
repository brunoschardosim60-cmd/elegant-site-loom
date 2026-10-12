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
  for (const file of existing) {
    if (signal?.aborted) return { files: [], duplicates: 0 };
    const hash = await untilCancelled(photoFingerprint(file), signal);
    if (hash) fingerprints.add(hash);
  }
  for (const file of selected) {
    if (signal?.aborted) return { files: [], duplicates: 0 };
    const hash = await untilCancelled(photoFingerprint(file), signal);
    if (signal?.aborted) return { files: [], duplicates: 0 };
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

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

function fingerprint(file: File): Promise<string | undefined> {
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

/** Ignore byte-identical photos within this import, regardless of their names.
 * If hashing is unavailable, retain the file rather than risk dropping a page.
 */
export async function uniquePhotoFiles(selected: File[], existing: File[] = [], signal?: AbortSignal): Promise<{ files: File[]; duplicates: number }> {
  const files: File[] = [];
  const seen = new Set(existing);
  const fingerprints = new Set<string>();
  let duplicates = 0;
  for (const file of existing) {
    if (signal?.aborted) return { files: [], duplicates: 0 };
    const hash = await untilCancelled(fingerprint(file), signal);
    if (hash) fingerprints.add(hash);
  }
  for (const file of selected) {
    if (signal?.aborted) return { files: [], duplicates: 0 };
    const hash = await untilCancelled(fingerprint(file), signal);
    if (signal?.aborted) return { files: [], duplicates: 0 };
    if (seen.has(file) || (hash && fingerprints.has(hash))) duplicates++;
    else {
      files.push(file);
      seen.add(file);
      if (hash) fingerprints.add(hash);
    }
  }
  return { files, duplicates };
}

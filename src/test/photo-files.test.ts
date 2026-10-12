import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { photoFingerprint, uniquePhotoFiles } from '@/lib/photo-files';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const photo = (content: string, name = 'photo.jpg') => new File([content], name, { type: 'image/jpeg', lastModified: 10 });

describe('duplicate import photos', () => {
  it('ignores the same bytes with different filenames and keeps distinct pages in order', async () => {
    const first = photo('page one'); const second = photo('page two');
    expect(await uniquePhotoFiles([first, photo('page one', 'copy.jpg'), second])).toEqual({ files: [first, second], duplicates: 1 });
  });

  it('compares against the open form without hiding different bytes under the same filename', async () => {
    const existing = photo('already read'); const another = photo('different page');
    expect(await uniquePhotoFiles([photo('already read', 'renamed.jpg'), another], [existing])).toEqual({ files: [another], duplicates: 1 });
  });

  it('does not reuse import results after the form has released its photos', async () => {
    const file = photo('same page');
    expect((await uniquePhotoFiles([file])).files).toEqual([file]);
    expect((await uniquePhotoFiles([file])).files).toEqual([file]);
  });

  it('skips registered photos across imports before OCR, including renamed copies', async () => {
    const original = photo('registered page');
    const hash = (await photoFingerprint(original))!;
    const next = photo('new page');
    expect(await uniquePhotoFiles([photo('registered page', 'copy.jpg'), next], [], undefined, [{ hash: hash.toUpperCase(), manifestId: 'DI00601860020' }])).toEqual({
      files: [next], duplicates: 1, registeredDuplicates: [{ filename: 'copy.jpg', manifestId: 'DI00601860020' }],
    });
  });

  it('does not confuse different image contents with the same name or retain another account records', async () => {
    const hash = (await photoFingerprint(photo('first')))!;
    const changed = photo('second');
    expect(await uniquePhotoFiles([changed], [], undefined, [{ hash, manifestId: 'DI00601860020' }])).toEqual({ files: [changed], duplicates: 0 });
    const original = photo('first');
    expect(await uniquePhotoFiles([original])).toEqual({ files: [original], duplicates: 0 });
  });

  it('uses the actual bytes for a stable SHA-256 fingerprint without retaining a read result', async () => {
    expect(await photoFingerprint(photo('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await photoFingerprint(photo('abc', 'renamed.jpg'))).toBe(await photoFingerprint(photo('abc')));
  });

  it('keeps distinct files if content hashing is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const a = photo('page'); const b = photo('page');
    expect(await uniquePhotoFiles([a, a, b])).toEqual({ files: [a, b], duplicates: 1 });
  });

  it('returns no additions after cancellation', async () => {
    const abort = new AbortController(); abort.abort();
    expect(await uniquePhotoFiles([photo('page')], [], abort.signal)).toEqual({ files: [], duplicates: 0 });
  });

  it('stops waiting immediately when cancelled during a slow file read', async () => {
    const abort = new AbortController(); const file = photo('slow file');
    Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(() => {}) });
    const pending = uniquePhotoFiles([file], [], abort.signal);
    abort.abort();
    expect(await pending).toEqual({ files: [], duplicates: 0 });
  });
});

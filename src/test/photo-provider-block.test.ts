import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderBlockModule = typeof import('@/lib/photo-provider-block');
let provider: ProviderBlockModule;
const user = 'user-one';
const otherUser = 'user-two';
const key = (userId: string) => `confere.photo-provider-block.v1:${encodeURIComponent(userId)}`;
const at = (value: string) => Date.parse(value);
const daily = { ok: false as const, quota: 'daily', error: 'Provider details that must not be stored: secret-example-token' };

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  provider = await import('@/lib/photo-provider-block');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('daily photo-provider quota memory', () => {
  it('retains only user and reset metadata, isolates users and survives module reloads', async () => {
    const now = at('2026-10-11T12:00:00Z');
    provider.rememberPhotoProviderBlock(user, daily, now);
    const saved = sessionStorage.getItem(key(user));
    expect(JSON.parse(saved!)).toEqual({ userId: user, expiresAt: at('2026-10-12T07:00:00Z') });
    expect(saved).not.toContain(daily.error);
    expect(provider.getPhotoProviderBlock(otherUser, now)).toBeUndefined();
    expect(provider.getPhotoProviderBlock(user, now)).toEqual({
      ok: false, retryable: false, quota: 'daily',
      error: 'Cota diária do Gemini esgotada. O leitor gratuito no navegador será usado até a renovação da cota.',
    });
    vi.resetModules();
    const reloaded = await import('@/lib/photo-provider-block');
    expect(reloaded.getPhotoProviderBlock(user, now + 60_000)?.quota).toBe('daily');
    expect(reloaded.getPhotoProviderBlock(otherUser, now + 60_000)).toBeUndefined();
  });

  it.each([
    ['before the March transition', '2026-03-07T12:00:00Z', '2026-03-08T08:00:00Z'],
    ['the 23-hour March day', '2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z'],
    ['after the March transition', '2026-03-09T12:00:00Z', '2026-03-10T07:00:00Z'],
    ['before the November transition', '2026-10-31T12:00:00Z', '2026-11-01T07:00:00Z'],
    ['the 25-hour November day', '2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'],
    ['after the November transition', '2026-11-02T12:00:00Z', '2026-11-03T08:00:00Z'],
    ['one millisecond before Pacific midnight', '2026-11-02T07:59:59.999Z', '2026-11-02T08:00:00Z'],
  ])('expires at Pacific midnight %s', (_label, timestamp, resetTimestamp) => {
    const now = at(timestamp); const reset = at(resetTimestamp);
    provider.rememberPhotoProviderBlock(user, daily, now);
    expect(JSON.parse(sessionStorage.getItem(key(user))!).expiresAt).toBe(reset);
    expect(provider.getPhotoProviderBlock(user, reset - 1)?.quota).toBe('daily');
    expect(provider.getPhotoProviderBlock(user, reset)).toBeUndefined();
    expect(sessionStorage.getItem(key(user))).toBeNull();
  });

  it('uses the supplied time rather than the computer timezone and defaults to Date.now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T18:00:00Z'));
    provider.rememberPhotoProviderBlock(user, daily);
    expect(JSON.parse(sessionStorage.getItem(key(user))!).expiresAt).toBe(at('2026-03-09T07:00:00Z'));
    expect(provider.getPhotoProviderBlock(user)?.quota).toBe('daily');
    vi.setSystemTime(new Date('2026-03-09T07:00:00Z'));
    expect(provider.getPhotoProviderBlock(user)).toBeUndefined();
  });

  it.each(['minute', 'unknown', undefined, 'transient'])('does not remember a %s response, even when its text mentions daily quotas', quota => {
    const now = at('2026-10-11T12:00:00Z');
    provider.rememberPhotoProviderBlock(user, { ok: false, ...(quota === undefined ? {} : { quota }), error: 'See daily quota documentation; 429 retry later.' }, now);
    expect(provider.getPhotoProviderBlock(user, now)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps a confirmed daily block when a later minute response arrives', () => {
    const now = at('2026-10-11T12:00:00Z');
    provider.rememberPhotoProviderBlock(user, daily, now);
    provider.rememberPhotoProviderBlock(user, { ok: false, quota: 'minute', error: 'Wait one minute.' }, now + 1);
    expect(provider.getPhotoProviderBlock(user, now + 1)?.quota).toBe('daily');
  });

  it('falls back to memory when access to sessionStorage is denied', () => {
    vi.stubGlobal('sessionStorage', undefined);
    const now = at('2026-10-11T12:00:00Z');
    provider.rememberPhotoProviderBlock(user, daily, now);
    expect(provider.getPhotoProviderBlock(user, now)?.quota).toBe('daily');
    expect(provider.getPhotoProviderBlock(otherUser, now)).toBeUndefined();
    expect(provider.getPhotoProviderBlock(user, at('2026-10-12T07:00:00Z'))).toBeUndefined();
  });

  it('keeps an in-memory block when storage reads, writes and cleanup throw', () => {
    const denied = () => { throw new DOMException('Access denied', 'SecurityError'); };
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied });
    const now = at('2026-10-11T12:00:00Z');
    expect(() => provider.rememberPhotoProviderBlock(user, daily, now)).not.toThrow();
    expect(provider.getPhotoProviderBlock(user, now)?.quota).toBe('daily');
    expect(() => provider.getPhotoProviderBlock(otherUser, now)).not.toThrow();
    expect(provider.getPhotoProviderBlock(user, at('2026-10-12T07:00:00Z'))).toBeUndefined();
  });

  it.each([
    'invalid JSON',
    'null',
    JSON.stringify({ userId: otherUser, expiresAt: at('2026-10-12T07:00:00Z') }),
    JSON.stringify({ userId: user, expiresAt: '2026-10-12T07:00:00Z' }),
    JSON.stringify({ userId: user, expiresAt: at('2026-10-13T07:00:00Z') }),
    JSON.stringify({ userId: user, expiresAt: at('2026-10-12T06:00:00Z') }),
  ])('discards corrupt, mismatched or overlong stored blocks: %s', raw => {
    sessionStorage.setItem(key(user), raw);
    expect(provider.getPhotoProviderBlock(user, at('2026-10-11T12:00:00Z'))).toBeUndefined();
    expect(sessionStorage.getItem(key(user))).toBeNull();
  });

  it('ignores unauthenticated users and invalid timestamps', () => {
    const now = at('2026-10-11T12:00:00Z');
    for (const userId of ['', '  ']) {
      provider.rememberPhotoProviderBlock(userId, daily, now);
      expect(provider.getPhotoProviderBlock(userId, now)).toBeUndefined();
    }
    for (const invalidTime of [NaN, Infinity, -Infinity]) {
      provider.rememberPhotoProviderBlock(user, daily, invalidTime);
      expect(provider.getPhotoProviderBlock(user, invalidTime)).toBeUndefined();
    }
    expect(sessionStorage.length).toBe(0);
  });
});

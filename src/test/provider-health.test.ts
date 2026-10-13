import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), user: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => { const builder = { inputValidator: () => builder, handler: (fn: unknown) => fn }; return builder; } }));
vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => ({ signal: new AbortController().signal }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.user } }) }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch); vi.stubEnv('GEMINI_API_KEY', 'synthetic-primary'); vi.stubEnv('GEMINI_API_KEY_FALLBACK_2', undefined); vi.stubEnv('GEMINI_SERVICE_OWNER_EMAIL', undefined); vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve'); mocks.user.mockResolvedValue({ data: { user: { email: 'brunoschardosim60@gmail.com' } }, error: null }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const input = { data: { accessToken: 'synthetic-access-token' } };
it('authenticates the service owner before using provider credentials', async () => {
  mocks.user.mockResolvedValue({ data: { user: { email: 'outsider@example.com' } }, error: null });
  const { checkPhotoProviders } = await import('@/lib/provider-health.functions');
  expect((await checkPhotoProviders(input)).error).toContain('responsável'); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('tests normal and Lite independently for both credentials without leaking provider responses', async () => {
  mocks.fetch.mockImplementation(async (_url, request) => request.headers['x-goog-api-key'] === 'synthetic-primary' ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })) : new Response(JSON.stringify({ error: { message: 'requires billing account synthetic-reserve synthetic-access-token' } }), { status: 403 }));
  const { checkPhotoProviders } = await import('@/lib/provider-health.functions'); const result = await checkPhotoProviders(input);
  expect(result.checks.map(r => r.status)).toEqual(['Disponível', 'Disponível', 'Faturamento exigido pelo Google', 'Faturamento exigido pelo Google']);
  expect(mocks.fetch).toHaveBeenCalledTimes(4); expect(JSON.stringify(result)).not.toContain('synthetic');
  expect((await checkPhotoProviders(input)).error).toContain('cinco minutos'); expect(mocks.fetch).toHaveBeenCalledTimes(4);
});
it('reports missing and duplicate credentials without sending duplicate requests', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-primary'); mocks.fetch.mockResolvedValue(new Response('{}', { status: 429 }));
  const { checkPhotoProviders } = await import('@/lib/provider-health.functions'); const result = await checkPhotoProviders(input);
  expect(result.checks.map(r => r.status)).toEqual(['Cota ou limite atingido', 'Cota ou limite atingido', 'Mesma chave da principal', 'Mesma chave da principal']);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it('checks the additional reserve and deduplicates it against either existing credential', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK_2', 'synthetic-additional'); mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })));
  let mod = await import('@/lib/provider-health.functions'); let result = await mod.checkPhotoProviders(input);
  expect(result.checks.filter(r => r.key === 'Reserva adicional').map(r => r.status)).toEqual(['Disponível', 'Disponível']); expect(mocks.fetch).toHaveBeenCalledTimes(6);
  vi.resetModules(); mocks.fetch.mockClear(); vi.stubEnv('GEMINI_API_KEY_FALLBACK_2', 'synthetic-reserve');
  mod = await import('@/lib/provider-health.functions'); result = await mod.checkPhotoProviders(input);
  expect(result.checks.filter(r => r.key === 'Reserva adicional').map(r => r.status)).toEqual(['Mesma chave de outra reserva', 'Mesma chave de outra reserva']); expect(mocks.fetch).toHaveBeenCalledTimes(4); expect(JSON.stringify(result)).not.toContain('synthetic');
});

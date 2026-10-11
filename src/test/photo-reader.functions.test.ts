import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPhotoWithGemini } from '@/lib/photo-reader.functions';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), user: vi.fn(), request: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => {
  const builder = { inputValidator: () => builder, handler: (handle: (context: { data: unknown }) => unknown) => handle };
  return builder;
} }));
vi.mock('@tanstack/react-start/server', () => ({ getRequest: mocks.request }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.user } }) }));

const input = { data: { accessToken: 'synthetic-session-token', data: 'a'.repeat(120), mimeType: 'image/jpeg' as const, mode: 'full' as const } };
const parsedPhoto = { kind: 'pre', id: 'DI000000001', plate: 'ABC1D23', driver: 'MOTORISTA', issueDate: '2026-08-28', expectedRows: 1, totalVolumes: 2, clockwiseRotation: 0,
  documents: [{ ctc: '0000000001', nf: '100-1', volumes: '2', client: 'LAB', recipient: 'CLIENTE', review: [] }],
};
let user = 0;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-provider-key'); vi.stubEnv('GEMINI_OCR_MODEL', undefined); vi.stubEnv('GEMINI_OCR_VERIFY_MODEL', undefined);
  mocks.user.mockResolvedValue({ data: { user: { id: `server-test-${++user}` } }, error: null });
  mocks.request.mockReturnValue({ signal: new AbortController().signal });
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('AbortSignal', {
    timeout: (ms: number) => { const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), ms); return controller.signal; },
    any: (signals: AbortSignal[]) => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    },
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('uses Flash for the full literal transcription, retaining image detail, all fields and the pre issue date', async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(parsedPhoto) }] } }] })));
  const result = await readPhotoWithGemini(input);
  expect(result).toMatchObject({ ok: true, rotation: 0, pre: { issueDate: '2026-08-28', documents: [{ ctc: '0000000001', nf: '100-1', volumes: '2' }] } });
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0]![0]).toContain('/gemini-3.8-flash:generateContent');
  const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
  expect(body.generationConfig).toMatchObject({ temperature: 0, mediaResolution: 'MEDIA_RESOLUTION_HIGH', thinkingConfig: { thinkingLevel: 'LOW' } });
  expect(body.generationConfig.responseJsonSchema.required).toContain('issueDate');
  expect(body.contents[0].parts[1].inlineData).toEqual({ data: input.data.data, mimeType: 'image/jpeg' });
  expect(body.contents[0].parts[0].text).toContain('issueDate sempre vazio');
});

it.each([
  ['verify', undefined, 'gemini-3.5-flash-lite', 'MINIMAL'],
  ['full', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'MINIMAL'],
  ['verify', 'gemini-3.8-flash', 'gemini-3.8-flash', 'LOW'],
] as const)('selects the independent %s model with an optional server override %s', async (mode, override, model, level) => {
  if (override) vi.stubEnv(mode === 'verify' ? 'GEMINI_OCR_VERIFY_MODEL' : 'GEMINI_OCR_MODEL', override);
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(parsedPhoto) }] } }] })));
  expect(await readPhotoWithGemini({ data: { ...input.data, mode } })).toMatchObject({ ok: true });
  expect(mocks.fetch.mock.calls[0]![0]).toContain(`/${model}:generateContent`);
  expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).generationConfig.thinkingConfig.thinkingLevel).toBe(level);
});

it.each([['full', 20000], ['verify', 10000]] as const)('aborts a stalled provider %s request at %sms and emits a safe fallback cause', async (mode, budget) => {
  mocks.fetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })));
  let finished = false;
  const run = readPhotoWithGemini({ data: { ...input.data, mode } }).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(budget - 100);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(await run).toMatchObject({ ok: false, unavailable: true, retryable: false, error: `O Gemini excedeu o limite de ${budget / 1000} s; a leitura local pode ser usada.` });
  expect(mocks.fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  const log = JSON.stringify(vi.mocked(console.warn).mock.calls);
  expect(log).toContain('elapsedMs');
  expect(log).not.toContain('synthetic-provider-key');
  expect(log).not.toContain(input.data.accessToken);
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it.each([429, 400])('classifies an aborted HTTP %s response body as a timeout rather than a quota or schema failure', async status => {
  const bodyRead = vi.fn();
  mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
    status, ok: false,
    json: () => {
      bodyRead();
      return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
    },
  }));
  let finished = false;
  const run = readPhotoWithGemini(input).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(bodyRead).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(19900);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  const result = await run;
  expect(result).toMatchObject({ ok: false, unavailable: true, retryable: false, error: 'O Gemini excedeu o limite de 20 s; a leitura local pode ser usada.' });
  expect(result).not.toHaveProperty('quota');
  expect(mocks.fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it('returns provider unavailability without an automatic second attempt or exposing provider internals', async () => {
  mocks.fetch.mockResolvedValue(new Response('internal api_key=do-not-show', { status: 503 }));
  const result = await readPhotoWithGemini(input);
  expect(result).toMatchObject({ ok: false, unavailable: true, retryable: false, error: 'Gemini indisponível (503). Tente novamente.' });
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('do-not-show');
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('do-not-show');
});

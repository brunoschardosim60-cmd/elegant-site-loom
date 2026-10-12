import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { photoReaderStatus, readPhotoWithGemini } from '@/lib/photo-reader.functions';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), user: vi.fn(), request: vi.fn(), client: vi.fn() }));
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => {
  const builder = { inputValidator: () => builder, handler: (handle: (context: { data: unknown }) => unknown) => handle };
  return builder;
} }));
vi.mock('@tanstack/react-start/server', () => ({ getRequest: mocks.request }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }));

const input = { data: { accessToken: 'synthetic-session-token', data: 'a'.repeat(120), mimeType: 'image/jpeg' as const, mode: 'full' as const } };
const parsedPhoto = { kind: 'pre', id: 'DI000000001', plate: 'ABC1D23', driver: 'MOTORISTA', issueDate: '2026-08-28', expectedRows: 1, totalVolumes: 2, clockwiseRotation: 0,
  documents: [{ ctc: '0000000001', nf: '100-1', volumes: '2', client: 'LAB', recipient: 'CLIENTE', review: [] }],
};
const successResponse = () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(parsedPhoto) }] } }] }));
let user = 0;
const advanceUntil = (startedAt: number, elapsed: number) => vi.advanceTimersByTimeAsync(Math.max(0, startedAt + elapsed - Date.now()));
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-provider-key'); vi.stubEnv('GEMINI_API_KEY_FALLBACK', undefined); vi.stubEnv('GEMINI_OCR_MODEL', undefined); vi.stubEnv('GEMINI_OCR_VERIFY_MODEL', undefined);
  mocks.user.mockResolvedValue({ data: { user: { id: `server-test-${++user}` } }, error: null });
  mocks.client.mockImplementation(() => ({ auth: { getUser: mocks.user } }));
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

it('does not authenticate or call Gemini when the browser request is already cancelled', async () => {
  const controller = new AbortController(); controller.abort();
  mocks.request.mockReturnValue({ signal: controller.signal });
  expect(await readPhotoWithGemini(input)).toEqual({ ok: false, retryable: false, fallback: false, error: 'Leitura cancelada.' });
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
});

it('aborts authentication HTTP work immediately on close and never starts Gemini after its late result', async () => {
  const controller = new AbortController();
  mocks.request.mockReturnValue({ signal: controller.signal });
  let completeAuth!: (value: { data: { user: { id: string } }; error: null }) => void;
  mocks.fetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  }));
  mocks.user.mockImplementation(() => {
    const options = mocks.client.mock.calls[0]![2];
    // Supabase's own fetch shares the request signal even if its high-level
    // getUser call takes longer to settle after network cancellation.
    void options.global.fetch('https://synthetic.supabase.test/auth/v1/user', {}).catch(() => {});
    return new Promise(resolve => { completeAuth = resolve; });
  });
  const run = readPhotoWithGemini(input);
  await vi.waitFor(() => expect(mocks.user).toHaveBeenCalledOnce());
  const authSignal: AbortSignal = mocks.fetch.mock.calls[0]![1].signal;
  expect(authSignal.aborted).toBe(false);
  controller.abort();
  expect(await run).toEqual({ ok: false, retryable: false, fallback: false, error: 'Leitura cancelada.' });
  expect(authSignal.aborted).toBe(true);
  completeAuth({ data: { user: { id: `cancelled-auth-${user}` } }, error: null });
  await Promise.resolve(); await Promise.resolve();
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0]![0]).toContain('/auth/v1/user');
  expect(console.warn).not.toHaveBeenCalled();
});

it.each([['full', 20000], ['verify', 10000]] as const)('includes stalled authentication in the same %s %sms deadline', async (mode, budget) => {
  mocks.user.mockReturnValue(new Promise(() => {}));
  let finished = false;
  const startedAt = Date.now();
  const run = readPhotoWithGemini({ data: { ...input.data, mode } }).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(mocks.user).toHaveBeenCalledOnce());
  await advanceUntil(startedAt, budget - 100);
  expect(finished).toBe(false);
  await advanceUntil(startedAt, budget);
  expect(await run).toMatchObject({ ok: false, unavailable: true, retryable: false, error: `O Gemini excedeu o limite de ${budget / 1000} s; a leitura local pode ser usada.` });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain('authentication');
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(input.data.accessToken);
});

it('uses the remaining deadline for Gemini after authentication rather than resetting the clock', async () => {
  mocks.user.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { user: { id: `slow-auth-${user}` } }, error: null }), 5000)));
  mocks.fetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })));
  let finished = false;
  const startedAt = Date.now();
  const run = readPhotoWithGemini(input).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(mocks.user).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  await advanceUntil(startedAt, 19900);
  expect(finished).toBe(false);
  await advanceUntil(startedAt, 20000);
  expect(await run).toMatchObject({ ok: false, unavailable: true, error: 'O Gemini excedeu o limite de 20 s; a leitura local pode ser usada.' });
  expect(mocks.fetch.mock.calls[0]![1].signal.aborted).toBe(true);
});

it('preserves explicit authentication denial without a provider call or local retry permission', async () => {
  mocks.user.mockResolvedValue({ data: { user: null }, error: new Error('synthetic auth internals') });
  expect(await readPhotoWithGemini(input)).toEqual({ ok: false, fallback: false, error: 'Entre novamente na sua conta para ler fotos.' });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
});

it('does not consume the per-user photo bucket when closing during authentication', async () => {
  const userId = `cancelled-bucket-${user}`;
  for (let index = 0; index < 80; index++) {
    const controller = new AbortController();
    mocks.request.mockReturnValue({ signal: controller.signal });
    mocks.user.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ data: { user: { id: userId } }, error: null });
    });
    expect(await readPhotoWithGemini(input)).toMatchObject({ ok: false, fallback: false, error: 'Leitura cancelada.' });
  }
  mocks.request.mockReturnValue({ signal: new AbortController().signal });
  mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(parsedPhoto) }] } }] })));
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: true });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it.each([200, 429])('stops an HTTP %s body that ignores its signal immediately on close without returning quota metadata', async status => {
  const controller = new AbortController();
  mocks.request.mockReturnValue({ signal: controller.signal });
  const bodyRead = vi.fn(() => new Promise(() => {}));
  mocks.fetch.mockResolvedValue({ status, ok: status === 200, json: bodyRead });
  const run = readPhotoWithGemini(input);
  await vi.waitFor(() => expect(bodyRead).toHaveBeenCalledOnce());
  controller.abort();
  const result = await run;
  expect(result).toEqual({ ok: false, retryable: false, fallback: false, error: 'Leitura cancelada.' });
  expect(result).not.toHaveProperty('quota');
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  expect(console.warn).not.toHaveBeenCalled();
});

it('uses Flash for the full literal transcription, retaining image detail, all fields and the pre issue date', async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(parsedPhoto) }] } }] })));
  const result = await readPhotoWithGemini(input);
  expect(result).toMatchObject({ ok: true, rotation: 0, pre: { issueDate: '2026-08-28', documents: [{ ctc: '0000000001', nf: '100-1', volumes: '2' }] } });
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0]![0]).toContain('/gemini-3.8-flash:generateContent');
  const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
  expect(body.generationConfig).toMatchObject({ temperature: 1, mediaResolution: 'MEDIA_RESOLUTION_HIGH', thinkingConfig: { thinkingLevel: 'LOW' } });
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
  const startedAt = Date.now();
  const run = readPhotoWithGemini({ data: { ...input.data, mode } }).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  await advanceUntil(startedAt, budget - 100);
  expect(finished).toBe(false);
  await advanceUntil(startedAt, budget);
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
  const startedAt = Date.now();
  const run = readPhotoWithGemini(input).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(bodyRead).toHaveBeenCalledOnce());
  await advanceUntil(startedAt, 19900);
  expect(finished).toBe(false);
  await advanceUntil(startedAt, 20000);
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

it('keeps a successful primary reading at one provider call even with a reserve configured', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockResolvedValue(successResponse());
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: true });
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0]![1].headers['x-goog-api-key']).toBe('synthetic-provider-key');
});

it.each([401, 403, 500, 503, 599, 400])('tries one distinct reserve after an eligible HTTP %s access or technical failure', async status => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'API key invalid synthetic-provider-key' } }), { status })).mockResolvedValueOnce(successResponse());
  const result = await readPhotoWithGemini(input);
  expect(result).toMatchObject({ ok: true, pre: { documents: [{ ctc: '0000000001', nf: '100-1', volumes: '2' }] } });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.fetch.mock.calls.map(([, init]) => init.headers['x-goog-api-key'])).toEqual(['synthetic-provider-key', 'synthetic-reserve-key']);
  expect(mocks.fetch.mock.calls[1]![1].signal).toBe(mocks.fetch.mock.calls[0]![1].signal);
  const output = JSON.stringify([result, vi.mocked(console.warn).mock.calls]);
  expect(output).not.toContain('synthetic-provider-key');
  expect(output).not.toContain('synthetic-reserve-key');
});

it('uses a reserve once for a connection error but returns a safe error after both fail', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockRejectedValueOnce(new Error('network api_key=synthetic-provider-key')).mockRejectedValueOnce(new Error('network api_key=synthetic-reserve-key'));
  const result = await readPhotoWithGemini(input);
  expect(result).toMatchObject({ ok: false, unavailable: true, retryable: false });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  const output = JSON.stringify([result, vi.mocked(console.warn).mock.calls]);
  expect(output).not.toContain('synthetic-provider-key');
  expect(output).not.toContain('synthetic-reserve-key');
});

it('recovers a primary connection error with one successful reserve attempt', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockRejectedValueOnce(new TypeError('Fetch failed')).mockResolvedValueOnce(successResponse());
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: true });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it.each([429, 402])('does not use a reserve to bypass HTTP %s quota or billing limits', async status => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Quota per day exhausted' } }), { status }));
  const result = await readPhotoWithGemini(input);
  expect(result).toMatchObject({ ok: false, retryable: false });
  if (status === 429) expect(result).toHaveProperty('quota', 'daily');
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it.each(['connection', '503'] as const)('does not block the primary until midnight when a %s failure is followed by daily quota on the reserve', async failure => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  if (failure === 'connection') mocks.fetch.mockRejectedValueOnce(new TypeError('Fetch failed'));
  else mocks.fetch.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Quota per day exhausted' } }), { status: 429 }));
  const result = await readPhotoWithGemini(input);
  expect(result).toEqual({ ok: false, unavailable: true, retryable: false, error: 'Cota diária do Gemini esgotada. Aguarde a renovação da cota ou ative o faturamento no Google AI Studio.' });
  expect(result).not.toHaveProperty('quota');
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.fetch.mock.calls.map(([, init]) => init.headers['x-goog-api-key'])).toEqual(['synthetic-provider-key', 'synthetic-reserve-key']);
});

it('keeps the daily block when the reserve is the only configured credential', async () => {
  vi.stubEnv('GEMINI_API_KEY', ''); vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Quota per day exhausted' } }), { status: 429 }));
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: false, quota: 'daily', retryable: false });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it.each(['JSON schema constraint unsupported', 'Image inlineData base64 invalid', 'Thinking resolution unsupported', 'Invalid request'])('does not retry shared HTTP 400 payload or model errors with another credential: %s', async message => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message } }), { status: 400 }));
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: false, retryable: false });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it('does not repeat an HTTP 200 response whose transcription is invalid', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'invalid transcription json' }] } }] })));
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: false });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it.each(['synthetic-provider-key', ' synthetic-provider-key ', '', '   '])('ignores a duplicate or empty reserve credential', async reserve => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', reserve);
  mocks.fetch.mockResolvedValue(new Response('unavailable', { status: 503 }));
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: false, unavailable: true });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it('accepts a reserve as the only configured credential without exposing it or its count in status', async () => {
  vi.stubEnv('GEMINI_API_KEY', '  '); vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  expect(await photoReaderStatus()).toEqual({ configured: true });
  mocks.fetch.mockResolvedValue(successResponse());
  const result = await readPhotoWithGemini(input);
  expect(result).toMatchObject({ ok: true });
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0]![1].headers['x-goog-api-key']).toBe('synthetic-reserve-key');
  expect(JSON.stringify(result)).not.toContain('synthetic-reserve-key');
});

it('reports only unconfigured status when neither credential is provided', async () => {
  vi.stubEnv('GEMINI_API_KEY', ''); vi.stubEnv('GEMINI_API_KEY_FALLBACK', '  ');
  expect(await photoReaderStatus()).toEqual({ configured: false });
  expect(await readPhotoWithGemini(input)).toMatchObject({ ok: false, unavailable: true });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('does not start a reserve if closing races with the primary access failure', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  const controller = new AbortController();
  mocks.request.mockReturnValue({ signal: controller.signal });
  mocks.fetch.mockImplementationOnce(async () => { controller.abort(); return new Response('access denied', { status: 403 }); });
  expect(await readPhotoWithGemini(input)).toEqual({ ok: false, retryable: false, fallback: false, error: 'Leitura cancelada.' });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it('keeps the reserve inside the original deadline, including time spent waiting for a primary failure', async () => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(new Response('unavailable', { status: 503 })), 5000)))
    .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })));
  const startedAt = Date.now(); let finished = false;
  const run = readPhotoWithGemini(input).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  await advanceUntil(startedAt, 19900); expect(finished).toBe(false);
  await advanceUntil(startedAt, 20000);
  expect(await run).toMatchObject({ ok: false, unavailable: true, error: 'O Gemini excedeu o limite de 20 s; a leitura local pode ser usada.' });
  expect(mocks.fetch.mock.calls[1]![1].signal).toBe(mocks.fetch.mock.calls[0]![1].signal);
  expect(mocks.fetch.mock.calls[1]![1].signal.aborted).toBe(true);
});

it.each([['full', 20000], ['verify', 10000], ['survey', 8000]] as const)('does not start a reserve after the initial %s request consumes its entire deadline', async (mode, budget) => {
  vi.stubEnv('GEMINI_API_KEY_FALLBACK', 'synthetic-reserve-key');
  mocks.fetch.mockImplementation(() => new Promise(() => {}));
  const startedAt = Date.now();
  const run = readPhotoWithGemini({ data: { ...input.data, mode } });
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  await advanceUntil(startedAt, budget);
  expect(await run).toMatchObject({ ok: false, unavailable: true, error: `O Gemini excedeu o limite de ${budget / 1000} s; a leitura local pode ser usada.` });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

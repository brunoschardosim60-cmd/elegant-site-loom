import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { normalizeGeminiPhoto, photoJsonSchema, photoPrompt } from './gemini-photo';
const requests = new Map<string, { count: number; until: number }>();

export const photoReaderStatus = createServerFn({ method: 'GET' }).handler(async () => ({ configured: Boolean(process.env['GEMINI_API_KEY']) }));

export const readPhotoWithGemini = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ data: z.string().min(100).max(2800000).regex(/^[A-Za-z0-9+/=]+$/), detail: z.string().max(1000000).regex(/^[A-Za-z0-9+/=]+$/).optional(), mimeType: z.literal('image/jpeg') }))
  .handler(async ({ data }) => {
    const key = process.env['GEMINI_API_KEY'];
    if (!key) return { ok: false as const, error: 'Configure GEMINI_API_KEY na Vercel para ativar a leitura por IA.' };
    const { getRequestIP } = await import('@tanstack/react-start/server');
    const now = Date.now();
    for (const [ip, value] of requests) if (value.until < now) requests.delete(ip);
    const ip = getRequestIP({ xForwardedFor: true }) || 'unknown';
    const bucket = requests.get(ip) || { count: 0, until: now + 600000 };
    if (bucket.count >= 30) return { ok: false as const, error: 'Muitas fotos seguidas. Aguarde alguns minutos.' };
    bucket.count++; requests.set(ip, bucket);
    try {
      const request = (model: string) => fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', signal: AbortSignal.timeout(55000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ model, store: false,
          system_instruction: 'Faça TRANSCRIÇÃO LITERAL. Não use conhecimento externo para expandir razões sociais. Copie exatamente as abreviações visíveis: por exemplo LABORATORIOS BAGO continua LABORATORIOS BAGO, sem país ou sufixo inventado. NF-Série é a coluna imediatamente ANTES de Nº Pedido; nunca use o pedido como NF. Se houver segunda imagem, ela é uma ampliação da MESMA página, não outro documento. Use a ampliação para ler os números pequenos.',
          input: [{ type: 'text', text: photoPrompt }, { type: 'image', data: data.data, mime_type: data.mimeType }, ...(data.detail ? [{ type: 'image', data: data.detail, mime_type: data.mimeType }] : [])],
          response_format: { type: 'text', mime_type: 'application/json', schema: photoJsonSchema },
          generation_config: { max_output_tokens: 12000, thinking_level: 'low' },
        }),
      });
      let response = await request(process.env['GEMINI_OCR_MODEL'] || 'gemini-3.7-flash');
      if ([404, 503].includes(response.status)) response = await request('gemini-3.8-flash');
      if (!response.ok) return { ok: false as const, error: response.status === 429 ? 'Limite do Gemini atingido. Aguarde e tente novamente.' : response.status === 403 || response.status === 401 ? 'Chave do Gemini sem acesso. Confira a configuração na Vercel.' : `Gemini indisponível (${response.status}). Tente novamente.` };
      const result = await response.json() as { status?: string; steps?: { type: string; content?: { type: string; text?: string }[] }[] };
      if (result.status !== 'completed') return { ok: false as const, error: 'A leitura ficou incompleta. Tente novamente com uma foto por vez.' };
      const output = result.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).filter(c => c.type === 'text').map(c => c.text || '').join('') || '';
      const parsed = JSON.parse(output);
      const pre = normalizeGeminiPhoto(parsed);
      const rotation = [90, 180, 270].includes(parsed.clockwiseRotation) ? parsed.clockwiseRotation as number : 0;
      return { ok: true as const, pre, rotation, text: JSON.stringify(pre, null, 2) };
    } catch { return { ok: false as const, error: 'Não foi possível concluir a leitura por IA. Tente novamente; nenhum cadastro foi feito.' }; }
  });

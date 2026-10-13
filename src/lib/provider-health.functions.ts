import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { supabaseConfig } from './supabase-config';
let nextCheck = 0;
// Diagnostics never return keys, provider response bodies, or account tokens.
export const checkPhotoProviders = createServerFn({ method: 'POST' }).inputValidator(z.object({ accessToken: z.string().min(20).max(10000) })).handler(async ({ data }) => {
  const timeout = AbortSignal.timeout(12000);
  const { getRequest } = await import('@tanstack/react-start/server');
  const signal = AbortSignal.any([timeout, getRequest().signal]);
  const { createClient } = await import('@supabase/supabase-js');
  const auth = createClient(process.env['SUPABASE_URL'] || supabaseConfig.url, process.env['SUPABASE_PUBLISHABLE_KEY'] || supabaseConfig.key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal }) } });
  const user = await auth.auth.getUser(data.accessToken);
  signal.throwIfAborted();
  if (user.error || user.data.user?.email?.toLowerCase() !== (process.env['GEMINI_SERVICE_OWNER_EMAIL'] || 'brunoschardosim60@gmail.com').toLowerCase()) return { error: 'Diagnóstico disponível apenas para o responsável pelo serviço.', checks: [] };
  if (Date.now() < nextCheck) return { error: 'Aguarde cinco minutos antes de repetir o diagnóstico.', checks: [] };
  nextCheck = Date.now() + 300000;
  const keys = [{ label: 'Principal', key: process.env['GEMINI_API_KEY']?.trim() }, { label: 'Reserva', key: process.env['GEMINI_API_KEY_FALLBACK']?.trim() }, ...(process.env['GEMINI_API_KEY_FALLBACK_2']?.trim() ? [{ label: 'Reserva adicional', key: process.env['GEMINI_API_KEY_FALLBACK_2'].trim() }] : [])];
  const models = [{ label: 'Gemini normal', id: process.env['GEMINI_OCR_MODEL'] || 'gemini-3.8-flash' }, { label: 'Flash Lite', id: 'gemini-3.5-flash-lite' }];
  const checks = await Promise.all(keys.flatMap(({ label, key }, index) => models.map(async model => {
    const result = { key: label, model: model.label, status: 'Não configurada' };
    if (!key) return result;
    if (keys.slice(0, index).some(previous => previous.key === key)) return { ...result, status: key === keys[0]!.key ? 'Mesma chave da principal' : 'Mesma chave de outra reserva' };
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Responda apenas OK.' }] }], generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: 'LOW' } } }) });
      if (response.ok) {
        const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return { ...result, status: body.candidates?.some(c => c.content?.parts?.some(p => p.text?.trim())) ? 'Disponível' : 'Sem resposta de texto' };
      }
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      const message = body.error?.message ?? '';
      const status = /billing|payment|paid tier|prepay|spend limit/i.test(message) ? 'Faturamento exigido pelo Google' : response.status === 429 ? 'Cota ou limite atingido' : response.status === 401 || response.status === 403 ? 'Acesso negado pelo Google' : response.status === 400 ? 'Credencial ou configuração recusada' : response.status === 404 ? 'Modelo indisponível nesta conta' : 'Serviço temporariamente indisponível';
      return { ...result, status };
    } catch { return { ...result, status: 'Sem resposta dentro do prazo' }; }
  })));
  return { error: '', checks };
});

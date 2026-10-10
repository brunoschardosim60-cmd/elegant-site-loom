import { createServerFn } from '@tanstack/react-start';

type Input = { cte: string; nf: string; volumesExpected: string; volumesReceived: string; manifest: string; description: string };

export const analyzeDivergence = createServerFn({ method: 'POST' })
  .inputValidator((data: Input) => {
    const clean = (v: unknown) => String(v ?? '').slice(0, 2000);
    if (!clean(data.description).trim()) throw new Error('Descreva a divergência.');
    return { cte: clean(data.cte), nf: clean(data.nf), volumesExpected: clean(data.volumesExpected), volumesReceived: clean(data.volumesReceived), manifest: clean(data.manifest), description: clean(data.description) };
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false as const, error: 'Análise indisponível: chave não configurada.' };
    const prompt = `Dados informados pelo conferente:\nCT-e: ${data.cte || '—'}\nNF: ${data.nf || '—'}\nPré-manifesto: ${data.manifest || '—'}\nVolumes esperados: ${data.volumesExpected || '—'}\nVolumes recebidos: ${data.volumesReceived || '—'}\nDivergência: ${data.description}`;
    const res = await fetch('https://ai.gateway.lovable.dev/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': key, Authorization: `Bearer ${key}`, 'X-Lovable-AIG-SDK': 'fetch' },
      body: JSON.stringify({
        model: 'openai/gpt-6-astra', stream: true, store: false, reasoning: { effort: 'low' },
        instructions: 'Você auxilia conferentes de uma transportadora a conferir o retorno de CT-es. Responda em português, curto e direto, em até 3 seções com títulos: "Possíveis inconsistências" (lista), "Ação sugerida" (passo a passo curto) e "Prioridade" (Baixa, Média ou Alta). Não invente dados que não foram informados.',
        input: prompt,
      }),
    });
    if (!res.ok || !res.body) {
      const msg = res.status === 429 ? 'Muitas análises seguidas. Aguarde um instante.' : res.status === 402 ? 'Créditos de IA esgotados no workspace.' : `Falha na análise (${res.status}).`;
      return { ok: false as const, error: msg };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try { const ev = JSON.parse(payload); if (ev.type === 'response.output_text.delta') text += ev.delta; if (ev.type === 'error' || ev.type === 'response.failed') return { ok: false as const, error: 'A análise falhou.' }; } catch { /* ignore */ }
      }
    }
    return text.trim() ? { ok: true as const, text: text.trim() } : { ok: false as const, error: 'O modelo não retornou resposta.' };
  });

# confere.

Conferência de CTCs e pré-manifestos para operações de transporte. A equipe cadastra os pré-manifestos (pela planilha 108 ou por foto), bipa os CTCs que retornam, acompanha as pendências por motorista e gera relatórios em PDF. Cada ação fica registrada com autor e horário.

## O que o sistema faz

- **Importação da planilha 108:** lê o XLSX no navegador e cadastra os manifestos do período escolhido.
- **Leitura de fotos:** o OCR roda no próprio aparelho. As fotos não são enviadas nem guardadas, e os campos incertos ficam sinalizados para revisão.
- **Conferência por bipe:** com leitor de código de barras ou digitando o CTC. Um CTC repetido não conta duas vezes.
- **Equipe:** os integrantes entram por convite e trabalham na mesma base ao mesmo tempo. Conflitos de edição nunca sobrescrevem o trabalho de outra pessoa.
- **Rastreamento e PDF:** busca CTCs, inclusive nos prés arquivados, e exporta a seleção.
- **Histórico:** auditoria imutável de cadastros, conferências, alterações e exclusões.
- **Arquivo automático:** prés finalizados há mais de 30 dias saem da lista de trabalho e continuam consultáveis.

## Tecnologia

React 19 e TanStack Start (SSR), Supabase (PostgreSQL, autenticação e regras de acesso por linha), Tesseract.js para o OCR local e Vercel para hospedagem. Nenhum serviço de IA ou CDN externa é usado em tempo de execução.

## Rodar localmente

Requer [Bun](https://bun.sh) 1.2+ e Node.js 22+.

```sh
bun install
bun run dev        # servidor de desenvolvimento
bun run test       # todos os testes, incluindo banco em PostgreSQL embutido
bun run build      # build de produção
```

## Publicar

1. **Banco:** aplique no Supabase, em ordem de nome, os arquivos de `supabase/migrations/` que ainda não estiverem lá. Para descobrir quais faltam, rode `supabase/checks/migration-status.sql` no editor SQL. O script só lê, não altera nada.
2. **Variáveis na Vercel:**
   - `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` são opcionais e substituem os valores de `src/lib/supabase-config.ts`. Use somente a chave *publishable*, nunca a *service role*.
   - `VITE_SITE_URL` é o endereço público (ex.: `https://confere.empresa.com.br`). Serve para a imagem de pré-visualização aparecer no WhatsApp.
3. **Supabase → Authentication → URL Configuration:** autorize o endereço do site, para o link de "Esqueci minha senha" funcionar.
4. **LGPD:** preencha `src/lib/legal-config.ts` (empresa, CNPJ, encarregado, região do banco, prazo de guarda) e peça ao jurídico da empresa para revisar `/privacidade` e `/termos`. Enquanto não forem preenchidos, os campos aparecem destacados nas páginas.

## Documentação

- [Documentação técnica](docs/tecnico.md): regras de dados, sincronização, leitura de fotos e da planilha, testes de concorrência.
- [Revisão de segurança](docs/security-review-2026-10-17.md)
- [Regras para quem edita o código](AGENTS.md)

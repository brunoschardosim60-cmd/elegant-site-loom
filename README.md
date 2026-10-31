# confere.

Conferência de CTCs e pré-manifestos para operações de transporte. A equipe cadastra os pré-manifestos (pela planilha 108 ou por foto), bipa os CTCs que retornam, acompanha as pendências por motorista e gera relatórios em PDF. Cada ação fica registrada com autor e horário.

## O que o sistema faz

- **Importação da planilha 108:** lê o XLSX no navegador e cadastra os manifestos do período escolhido.
- **Leitura de fotos:** o OCR roda no próprio aparelho. As fotos não são enviadas nem guardadas, e os campos incertos ficam sinalizados para revisão.
- **Conferência por bipe:** com leitor de código de barras ou digitando o CTC. Um CTC repetido não conta duas vezes.
- **Equipe e papéis:** os integrantes entram só por convite e trabalham na mesma base ao mesmo tempo. Papéis: responsável, administrador, conferente e só leitura. Conflitos de edição nunca sobrescrevem o trabalho de outra pessoa.
- **Filial configurável:** cada equipe escolhe quais filiais e motivos da planilha 108 importa (padrão: 06 / DIS).
- **Indicadores:** taxa de devolução, valor de mercadoria com CTC pendente, atrasados, perecíveis e tempo até a devolução, por motorista e por cidade.
- **Rastreamento, PDF e Excel:** busca CTCs, inclusive nos prés arquivados, e exporta a seleção.
- **Bipe sonoro:** sons diferentes para conferido, pré finalizado, aviso e erro.
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

1. **Banco:** rode `supabase/checks/migration-status.sql` no editor SQL do Supabase (só lê, não altera nada) e aplique, em ordem de nome, as migrações marcadas como FALTANDO. Ordem com o deploy:
   - até `20261030020000_conference_archive.sql`: aplique antes ou depois do deploy, tanto faz;
   - publique o app;
   - depois aplique `20261030030000_roles_settings_monitoring.sql` e `20261030040000_cargo_details.sql`. A primeira fecha as funções antigas de salvamento, que versões anteriores do app ainda usam.
2. **Quem pode criar uma equipe nova:** o cadastro agora é só por convite. Quem já tem equipe continua entrando normalmente. Para liberar um novo responsável de equipe, rode no editor SQL:
   ```sql
   insert into public.conference_owner_allowlist(email, note) values ('pessoa@empresa.com.br', 'Filial 06');
   ```
3. **Variáveis na Vercel:**
   - `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` são opcionais e substituem os valores de `src/lib/supabase-config.ts`. Use somente a chave _publishable_, nunca a _service role_.
   - `VITE_SITE_URL` é o endereço público (ex.: `https://confere.empresa.com.br`). Serve para a imagem de pré-visualização aparecer no WhatsApp.
4. **Supabase → Authentication → URL Configuration:** autorize o endereço do site, para o link de "Esqueci minha senha" funcionar.
5. **LGPD:** preencha `src/lib/legal-config.ts` (empresa, CNPJ, encarregado, região do banco, prazo de guarda) e peça ao jurídico da empresa para revisar `/privacidade` e `/termos`. Enquanto não forem preenchidos, os campos aparecem destacados nas páginas.
6. **Monitoramento:**
   - Cadastre `https://<seu-site>/healthz` num monitor de disponibilidade (UptimeRobot, Better Stack ou similar), com aviso por e-mail. Ele responde `{"ok":true}` sem tocar no banco.
   - Erros que aparecem na tela dos usuários ficam em `conference_client_errors` (90 dias). Para ver os recentes:
     ```sql
     select occurred_at, message, page from public.conference_client_errors order by occurred_at desc limit 50;
     ```

As funções do servidor rodam em São Paulo (`gru1`), configurado em `vite.config.ts`.

## Documentação

- [Documentação técnica](docs/tecnico.md): regras de dados, sincronização, leitura de fotos e da planilha, testes de concorrência.
- [Revisão de segurança](docs/security-review-2026-10-17.md)
- [Regras para quem edita o código](AGENTS.md)

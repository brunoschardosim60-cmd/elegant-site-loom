# Auditoria do confere. — 15/10/2026

**Atualização posterior:** a dívida de lint registrada nesta auditoria foi resolvida. Veja a seção 8 para o resultado mais recente.

Base examinada: `f5409b6`, branch `codex/ocr-image-reading`. O Git estava limpo no início. Na conclusão inicial, as correções ficaram **locais, sem commit, push, deploy ou migração remota**. A publicação foi autorizada posteriormente pelo usuário, incluindo os ajustes complementares abaixo. Nenhum cadastro real foi criado, editado ou excluído.

## 1. Arquitetura e funcionamento

- React 19, TypeScript, TanStack Start/Router, Vite 8 e Tailwind 4; componentes Radix para diálogos e controles. A página `/` monta `AccountWorkspace` e, após autenticação e carga, `ConferenceWorkspace`.
- Conferência, Pendências, Finalizados, Rastreamento e Ocorrências são vistas do mesmo componente operacional. Isso preserva o campo de leitura e o estado da sessão ao trocar de vista. Rastreamento inclui pendentes e conferidos, com paginação de 50 CTCs; Pendências mostra apenas os documentos ainda não conferidos.
- Supabase Auth controla entrada, confirmação de conta e recuperação de senha. A associação a uma equipe exige convite explícito. O cliente obtém apenas configuração pública; chaves de IA ficam no servidor.
- `TeamSync` consulta a revisão a cada dois segundos quando a página está visível, salva por RPC e trata conflitos. As migrações SQL implementam associação à equipe, RLS, merge transacional, validação de duplicatas, horários definidos pelo servidor e auditoria autenticada.
- O relatório 108 é decodificado em Web Worker usando fflate/saxes. Seleciona **Filial 06 + DIS**, exclui TRA e outras filiais, preserva os CTCs literais e agrupa NFs do mesmo CTC. Datas vêm do relatório. A prévia exige cadastro explícito; erros de origem bloqueiam o lote.
- Fotos permanecem como fluxo alternativo, com OCR local e funções de servidor para Gemini. DeepSeek permanece removido. O PDF usa jsPDF/AutoTable e respeita o escopo da vista e os filtros.
- `/layout-preview` é restrita ao modo de desenvolvimento. A revisão desta rodada usou também um pacote local separado com os componentes reais, dados fictícios e adaptadores simulados claramente identificados. Isso valida apresentação e interação, **não comprova o funcionamento de um serviço externo**.

## 2. Problemas encontrados e correções

| Prioridade    | Problema e impacto                                                                                                                           | Correção / evidência                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2            | “Mais antigas” usava o texto ainda não enviado no filtro de histórico, podendo misturar eventos de dois manifestos.                          | Consulta aplicada separada do texto digitado; paginação usa a consulta e o cursor correspondentes. Teste falhou antes e passou após a correção.                                                                                            |
| P2            | Uma consulta de histórico com falha mantinha eventos da consulta anterior; a lista podia sugerir resultados de outro manifesto.              | Limpeza ao iniciar nova consulta, identificação do filtro aplicado e erro anunciado como alerta. Não mostra “nenhuma ação” quando houve falha. Teste de regressão e inspeção visual.                                                       |
| P2            | Falha no logout era ignorada e a pessoa não sabia se havia saído.                                                                            | Estado “Saindo…”, bloqueio de cliques repetidos e de interação durante a saída, mensagem de falha e nova tentativa. Preservado o bloqueio de saída com alterações não salvas. Testados erro retornado, rejeição e requisição em andamento. |
| P2            | Um manifesto cadastrado pela equipe durante a prévia ficava selecionado e bloqueado, impedindo o lote; a seleção precisava ser reconstruída. | Ação explícita “Remover repetidos da seleção”, mantendo os demais selecionados. Nenhuma remoção silenciosa de seleção ou alteração da regra de duplicatas. Teste com atualização dos registros enquanto o diálogo está aberto.             |
| P2            | Em 768×1024, o campo de CTC ficava espremido ao lado do título.                                                                              | Campo ocupa uma linha inteira entre 761 e 1000 px; totais em duas colunas. Inspeção antes/depois: campo final com 473 px de largura e cerca de 328 px úteis para texto.                                                                    |
| P2            | Na vista Pendências, o campo Status mostrava somente a idade do manifesto.                                                                   | Agora exibe “Pendente”, relógio e cor, mantendo a idade em uma linha separada. Conferido continua com texto, ícone e cor nas outras vistas.                                                                                                |
| P3            | Mensagens vazias genéricas e páginas de erro em inglês.                                                                                      | Orientação para importar a primeira planilha, explicação de quando um manifesto aparece em Finalizados, mensagens 404/erro em português.                                                                                                   |
| P3            | Campos de importação com foco pouco visível e tabelas roláveis sem foco próprio.                                                             | Foco visível no envio/busca; regiões de tabela e NFs identificadas e acessíveis por teclado. Rolagem horizontal das NFs verificada no celular.                                                                                             |
| P3            | Cálculo de conflitos e resumo por dia repetido a cada digitação na busca.                                                                    | Memoização desses cálculos, atualizada quando registros ou planilha mudam. Sem alteração do parser.                                                                                                                                        |
| P2 preventivo | O `.gitignore` compartilhado não protegia arquivos `.env` e metadados Vercel.                                                                | Inclusão de `.env`, `.env.*` e `.vercel/`, preservando `.env.example`. Não foi encontrado segredo privado pelos padrões pesquisados nos arquivos versionados.                                                                              |

Não foi identificada falha P0 nesta rodada. Isso se limita ao código, testes e fluxos observados; não equivale a uma certificação de segurança ou auditoria completa da infraestrutura de produção.

## 3. Arquivos relevantes

- `src/components/team-panel.tsx`: isolamento entre consultas de histórico, paginação e erros.
- `src/components/account-workspace.tsx` e `account-status.tsx`: tratamento de logout, estado transitório e diferenciação entre repetir salvamento e sincronização.
- `src/components/spreadsheet-import-dialog.tsx`: conflitos que chegam durante a prévia, foco/rolagem e memoização.
- `src/components/conference-workspace.tsx`: status explícito de pendência e orientação de listas vazias.
- `src/styles.css`: tablet e dimensionamento do conteúdo da conta.
- `src/routes/__root.tsx` e `src/lib/error-page.ts`: mensagens em português; ajuste de box-sizing na página de erro isolada.
- `src/test/team-panel.test.tsx`, `account-workspace.test.tsx`, `spreadsheet-import-dialog.test.tsx`: cinco novos testes de regressão.
- `.gitignore`: prevenção de inclusão de credenciais locais.

Não foram alterados contratos de API, schema do banco, regras de negócio ou dependências.

## 4. Testes e evidências

| Verificação                                           | Resultado                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base anterior: `npm test`                             | 736 testes / 55 arquivos passaram.                                                                                                                                                                                                                                                                                                                                                                            |
| Reproduções de histórico/logout e seleção concorrente | Falhas registradas antes das respectivas correções.                                                                                                                                                                                                                                                                                                                                                           |
| Regressão final: `npm test`                           | **741 testes / 55 arquivos passaram**, 17,34 s na última execução completa.                                                                                                                                                                                                                                                                                                                                   |
| `npx tsc --noEmit`                                    | Passou, sem erros.                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run build`                                       | Passou. O diagnóstico externo opcional de chaves no postbuild retornou **SKIP**, não comprova disponibilidade do Gemini.                                                                                                                                                                                                                                                                                      |
| `bun audit --json` via Bun temporário                 | Resultado `{}`, código de saída zero; nenhuma vulnerabilidade conhecida reportada para o lockfile consultado. `npm audit` não se aplica diretamente porque o projeto usa `bun.lock`, sem package-lock.                                                                                                                                                                                                        |
| `git diff --check`                                    | Passou; apenas avisos do Git sobre conversão LF/CRLF.                                                                                                                                                                                                                                                                                                                                                         |
| Lint                                                  | **Não passou**. A base já tinha 13.282 erros e 11 avisos no `npm run lint`, incluindo prévias locais. Uma verificação restrita a src/scripts/configs encontrou cerca de 13 mil problemas de formatação, 17 outros erros e 8 avisos. Há dívida de estilo, tipos `any` em testes, regex e avisos de hooks/fast refresh. Não foi aplicada reformatação massiva nem desativadas regras para mascarar o resultado. |

A suíte executa as migrações reais em PostgreSQL local via PGlite. Ela cobre RLS/permissões, contas não confirmadas, isolamento entre equipes, auditoria, duplicatas, correção de identidade, edições/exclusões concorrentes e perda de resposta depois do commit. Testes de três clientes HTTP simultâneos verificam convergência, conferência única, conflitos e importação de 50 manifestos. **São três clientes de teste, não três aparelhos físicos de produção.**

### Navegador

- Área útil confirmada em **1366×768**, **390×844** e **768×1024**. Capturas foram abertas e inspecionadas; a avaliação não se baseou apenas no CSS.
- Conferência, agrupamento por motorista, finalizados, pendências e rastreamento revisados. Na prévia local, um CTC fictício finalizou o manifesto; uma nova leitura do mesmo código manteve a contagem e mostrou “já bipado”.
- Diálogo de histórico: consulta, erro, fechamento e identificação do filtro. Formulário de recuperação: layout local, sem envio de e-mail real.
- Planilha de **50 manifestos / 5 dias / 185 CTCs / 220 NFs / 13.175 volumes**: leitura observada de **0,5 s**. É uma massa sintética derivada do relatório de um dia, não uma amostra real de cinco dias. O tempo depende da máquina e do arquivo; não é uma garantia de produção.
- No celular: diálogo com 372 px úteis e sem transbordamento interno; botões Cancelar/Cadastrar terminavam em aproximadamente y=806, dentro dos 844 px. Lista chegou ao último manifesto; região de NFs com 620 px de conteúdo em 307 px de área rolável, rolagem por teclado confirmada.
- No site publicado, a sessão já autenticada carregou novamente os registros após recarregar: 23 CTCs, 9 pendentes, 14 conferidos, 1 manifesto aberto e 2 finalizados. Nenhuma escrita operacional foi feita. Não apareceram erros nos logs de console disponíveis dessa página durante a consulta.
- Algumas capturas falharam por timeout do navegador. As inspeções bem-sucedidas e as evidências salvas estão listadas abaixo; falha de captura não foi tratada como sucesso do produto.

Evidências locais: `C:/Users/Bruno/Documents/Playground/audit-20261015/`.

- `desktop-conferencia.png`, `desktop-historico-erro.png`
- `tablet-finalizado.png` (antes do ajuste de largura), `tablet-corrigido.png`
- `celular-planilha.png`, `celular-rolagem-nfs.png`
- `celular-pendencias.png`, `celular-rastreamento.png`
- `celular-recuperacao.png`, `celular-falha-saida.png`
- `celular-lista-vazia.png`, `celular-erro-carregamento.png`
- `tests-final.log`, `types-final.log`, `build-final.log`, `lint-final.json`

## 5. Limitações e pendências

1. A publicação dependia de autorização expressa, concedida posteriormente pelo usuário. A implantação deve ser verificada após o envio; nenhuma migração remota faz parte deste pacote.
2. Lint continua reprovado por dívida preexistente. Corrigir isso requer uma rodada separada de padronização para evitar misturar milhares de alterações cosméticas com correções funcionais.
3. Cadastro de conta, entrega de e-mail de confirmação/recuperação e troca real de senha não foram executados contra o serviço. Seus componentes e casos de erro foram cobertos por testes; a sessão existente foi consultada no site publicado.
4. Não foram enviadas fotos ao Gemini nesta rodada, nem verificados faturamento/cotas/validade de cada chave. O principal fluxo de planilha não usa IA. O diagnóstico opcional do build foi pulado.
5. Permissões e concorrência foram testadas com as migrações locais; não foi feita nova inspeção administrativa das políticas/configurações efetivamente aplicadas no Supabase remoto. O teste com três aparelhos físicos continua pendente.
6. O desempenho de 50 manifestos foi medido numa massa sintética. Uma exportação real de vários dias continua sendo uma validação adicional útil.
7. Dados antigos originados de OCR não foram corrigidos automaticamente nem recadastrados. A auditoria do software não certifica a transcrição de documentos já salvos.

## 6. Próximas melhorias

| Prioridade | Trabalho                                                                                                       | Benefício                                                             | Esforço estimado                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| P2         | Validar exportação real de cinco dias e uso simultâneo por integrantes autorizados, em ambiente de homologação | Verificar diferenças reais de origem e latência entre dispositivos    | Meio a um dia, após disponibilidade dos dados/contas   |
| P2         | Procedimento de backup e exercício de restauração em ambiente isolado                                          | Comprovar recuperação operacional, além da persistência normal        | Um dia, depende de acesso administrativo               |
| P3         | Padronizar formatação e resolver os erros/avisos de lint sem alterar regras de negócio                         | Tornar a verificação de qualidade utilizável em CI                    | Um a dois dias                                         |
| P3         | Automatizar capturas de regressão nos três tamanhos com fixtures locais dos componentes reais                  | Detectar regressões como o campo estreito do tablet antes de publicar | Um dia                                                 |
| P3         | Medir volume histórico real antes de alterar armazenamento/paginação                                           | Planejar escala sem antecipar migração ampla do banco                 | Meio dia de medição; implementação conforme resultados |

As estimativas são indicativas e não incluem espera por acesso externo. Não foi iniciada nenhuma dessas alterações remotas ou migrações futuras.

## 7. Ajustes complementares autorizados para publicação

- Arrastar e soltar uma planilha XLSX na área de importação, com destaque visual, limite de um arquivo e proteção contra novos envios durante a leitura; seleção por clique preservada.
- Rodapé de edição fixo com Cancelar/Salvar acessíveis, apenas os campos com rolagem; fontes e espaçamentos revisados, NFs longas com quebra de linha.
- Foco do scanner com `preventScroll`, preservando a posição ao excluir/cancelar, fechar importação manual ou planilha, salvar/cancelar edição e fechar aviso de CTC. Dois testes de exclusão e cinco de outros diálogos cobrem o retorno de foco.
- Reproduzido no navegador: exclusão movia a página de y=2000 para y=482. Após a correção, ficou em y=1811, com ajuste natural pelo conteúdo removido; cancelamento preservou exatamente a posição. No computador, o painel manteve scrollTop=837. Salvar edição na prévia manteve a página em y=1890 e o scanner fora da área visível.
- Validação final do pacote: **751 testes em 55 arquivos aprovados**, tipos sem erros, build de produção aprovado e `git diff --check` sem erros. A dívida de lint registrada acima permanece.
- A publicação foi autorizada explicitamente pelo usuário; o resultado da implantação e a conferência do site publicado são informados na conversa. Nenhum registro de teste será cadastrado em produção.

## 8. Encerramento da dívida de lint

- `npm run lint` aprovado com **zero erros e zero avisos**. O comando agora usa `--max-warnings 0`, preservando as regras existentes e exigindo que os avisos também sejam corrigidos.
- Formatação padronizada e quebras de linha LF protegidas por `.gitattributes` e Prettier. Arquivos gerados e prévias locais não versionadas ficam fora da verificação da aplicação.
- Helpers de estilos e contextos separados dos componentes React. Os módulos públicos continuam nos mesmos caminhos, reexportando os componentes, hooks, tipos e variantes para preservar os imports existentes.
- Removidos `any` dos testes afetados com tipos de RPC e eventos de auditoria. Regex simplificadas; limpeza dos caracteres de controle do PDF mantém o comportamento anterior.
- Avisos de hooks resolvidos sem desativar regras. O pré inicialmente informado seleciona o novo rascunho pelo índice correto e preserva os anteriores; um novo teste cobre esse fluxo.
- Regressão: **754 testes em 56 arquivos aprovados**, TypeScript sem erros, build de produção aprovado e `git diff --check` sem erros. Novos testes cobrem também os contextos públicos de formulário e menu após a separação dos módulos.
- As limitações externas da auditoria (e-mails reais, IA, aparelhos físicos e exportação real de vários dias) continuam separadas desta limpeza técnica.

## 9. Exportação real de vários dias e remanifestação

- Reproduzido o bloqueio de uma exportação real com 32 manifestos de distribuição da filial 06, em quatro datas. Um CTC constava em duas tentativas de rota; o usuário confirmou que o retorno e a remanifestação, inclusive com troca de motorista, fazem parte da operação.
- O leitor mantém todas as 155 linhas de NFs e os 3.675 volumes por rota. Comparação independente com openpyxl confirmou CTC, NF, série, volumes, remetente e destinatário sem omissões. Leitura no Chrome: 2,3 segundos neste computador.
- Tentativas em dias diferentes são preservadas. A lista de pendências e a bipagem usam a tentativa mais recente cadastrada. Rastreamento, cartões e PDF mostram a anterior como remanifestada, sem inventar uma conferência ou apagar horários reais. Estados derivados não são persistidos.
- Repetições no mesmo dia, sem data original, de IDs de manifesto ou de NF dentro do mesmo CTC continuam protegidas. Conflitos de seleção são apresentados antes do cadastro; linhas inválidas continuam bloqueando o lote.
- Migração `20261015090000_remanifested_routes.sql`: valida a unicidade por tentativa datada e rejeita uma conferência obsoleta após o cadastro de rota mais recente por outro integrante. Mantém bloqueio transacional, membros, autenticação, RLS e auditoria. Não altera registros existentes.
- Testes de regressão incluem mudança de motorista, histórico sem falsa conferência, PDF/pendências, scanner da rota atual, reaplicação da migração, bloqueio no mesmo dia e três sessões HTTP concorrentes. A sessão local com a planilha real conferiu somente a rota mais recente do CTC remanifestado. Nenhum registro de teste foi cadastrado em produção.
- Validação final: **764 testes em 57 arquivos aprovados**, lint sem erros nem avisos, TypeScript e build de produção aprovados. Banco remoto atualizado e verificado sem cadastrar ou alterar registros operacionais.

## 10. PDF compacto, horários e previsão de entrega

- O relatório completo da exportação real passou de 16 para 13 páginas, preservando as 155 NFs e os 134 registros de CTC por rota. Cabeçalho completo somente na primeira página; continuação compacta com motorista, manifesto e colunas. Remanifestação identifica a nova rota e sua data, mantendo horários de conferências reais.
- O resumo distingue 133 CTCs únicos, 134 tentativas de rota e uma remanifestação. Pendências contam somente a rota atual: 133 CTCs e 3.667 volumes neste arquivo. O scanner simulado conferiu somente a tentativa mais recente.
- Comparação independente com openpyxl e pdfplumber confirmou todos os 134 registros do PDF contra a planilha: manifesto, CTC, NFs, volumes, horário de emissão e datas previstas. As 13 páginas renderizadas foram revisadas visualmente, sem conteúdo fora dos limites.
- Horário de emissão e previsão de entrega são metadados opcionais obtidos da planilha. Emissão à tarde e entrega prevista no dia seguinte permanecem informações distintas; nenhum corte automático às 16:30, horário de agendamento ou atraso é inferido. Horário exibido nos cartões e rastreamento; previsão no rastreamento, detalhes da importação e PDF.
- A migração `20261015110000_manifest_schedule_metadata.sql` valida esses campos opcionais no RPC compartilhado, sem atualizar registros existentes nem alterar autenticação, membros, RLS ou regra de remanifestação. Aplicada e confirmada no banco remoto. Cadastros antigos sem esses campos permanecem sem informações presumidas.
- Validação final: **767 testes em 57 arquivos aprovados**, lint sem erros nem avisos, TypeScript e build de produção aprovados. Teste da planilha realizado em memória, sem cadastrar registros de teste em produção. Valores de mercadoria continuam fora do produto, conforme solicitado.

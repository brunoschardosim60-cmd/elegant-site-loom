# Revisão da interface — 16/10/2026

> **Documento histórico.** Descreve o sistema na data do título; partes podem ter mudado desde então. Veja o [README](../README.md) para o estado atual.

## Ajustes

- Pendências renderiza até 50 CTCs por página. A busca, os totais, o PDF e as operações continuam usando todos os registros; não há truncamento no cadastro.
- Rastreamento e Pendências compartilham a apresentação da paginação. Navegação explícita leva ao início dos novos resultados. Conferências e sincronização não acionam esse movimento.
- Busca ganhou um botão de limpeza, foco visível e retorno ao campo sem deslocar a tela. Limpar filtros restaura busca, idade e status.
- Importação 108 ganhou Limpar filtros, preservando a seleção atual.
- Uma conta sem manifestos próprios não apresenta os manifestos de colegas como se fossem seus finalizados. A equipe vazia não recebe instruções de importação na visão somente consulta.
- Rastreamento identifica corretamente consulta pessoal ou da equipe. A lista da equipe orienta a consultar, em vez de conferir.

## Validação

- 781 testes passaram em 59 arquivos. Lint sem erros ou avisos; TypeScript e compilação de produção aprovados.
- Revisão visual local com componentes reais em 1366×768 e 390×844: pesquisa, paginação, rolagem, importação, cancelamento e botões do rodapé.
- Relatório real `108_Relação de Notas por Manifesto_20261015090923.xlsx`: 32 manifestos, 4 dias, 134 entradas de CTC (133 únicos), 155 NFs e 3675 volumes das tentativas. Leitura observada de 2,6 s no navegador; não é garantia de tempo para outros arquivos ou dispositivos.
- O CTC em nova tentativa foi identificado sem impedir a importação. Filtrar por SANDRO e 15/10 mostrou 1 dos 32 manifestos; limpar filtros voltou aos 32 sem perder seleção.
- Nenhum registro real foi cadastrado, excluído ou alterado. A prévia usa contas simuladas. A produção carregou a tela de login, portanto a revisão visual autenticada foi feita localmente.

## Preservado

Filial 06 + DIS, exclusão de TRA, CTC literal com zeros à esquerda, remanifestação, autoria, histórico, PDF, autenticação, equipes, permissões e sincronização transacional.

# Ocorrências por NF na planilha 108

O importador lê as colunas opcionais `Codigo Ultima Ocorrencia` e `Descricao Ultima Ocorrencia`. O código é preservado como texto, incluindo zeros à esquerda. Cada NF-série mantém sua ocorrência, mesmo quando várias notas são agrupadas no mesmo CTC para uma única conferência.

Os dados aparecem junto da NF em Conferência, Pendências, Rastreamento e na prévia das notas durante a importação. A ocorrência descreve a situação informada no arquivo da Luft; não confirma recebimento do documento e não muda os totais ou a conferência. O PDF atual mantém seu formato.

Para registros novos, as ocorrências acompanham o cadastro normal. Para os existentes, reimporte a 108 e use **Atualizar ocorrências das NFs cadastradas**. O botão informa quantas NFs e manifestos correspondem a valores novos ou diferentes. Ele usa o arquivo inteiro, independentemente dos filtros de seleção de novos cadastros, e deixa a importação aberta para continuar o trabalho.

A atualização exige correspondência exata de manifesto, CTC e NF-série. Não cria registros, não muda números de notas, volumes, responsáveis, datas, conferências ou autores de recebimento. Valores ausentes não apagam informações já salvas. Repetições conflitantes da mesma NF no arquivo impedem a importação. A mudança passa pelo salvamento autenticado e pelo histórico existentes.

Arquivos antigos sem as duas colunas continuam compatíveis. Cadastros sem ocorrência continuam válidos. Edições manuais preservam as associações das NFs que continuam no mesmo CTC e removem apenas as associações de notas que foram corrigidas ou removidas.

O armazenamento JSON e o RPC transacional existentes preservam os novos campos. Não é necessária migração do banco, mudança de autenticação ou de permissões.

## Validação

- 790 testes aprovados, incluindo preservação por NF-série, edição manual, atualização explícita sem novos cadastros e merge transacional de uma conferência concorrente.
- Relatório real 108 de 15/10/2026: 32 manifestos, 155 NFs, sendo 141 com última ocorrência informada. Leitura observada na prévia: 2,9 s.
- Na interface local, reimportar uma NF sem ocorrência mostrou exatamente uma atualização, com cadastro duplicado bloqueado. Após atualizar, o CTC continuou pendente e os volumes foram preservados.
- CTC com três NFs manteve três associações de código e descrição. Revisão visual em 1366×768 e 390×844, sem extrapolar a largura do celular.
- Prévia isolada, sem gravações em produção; nenhuma conta, permissão ou registro real foi alterado nos testes.

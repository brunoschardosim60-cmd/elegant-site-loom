# Elegant Site Loom

Controle de retorno de CTCs e pré-manifestos, com leitura de fotos pelo Gemini e cadastros vinculados à conta no Supabase.

## Dados e acesso

- Login por e-mail e senha, com confirmação de e-mail pelo Supabase.
- Cadastros, conferências, atividades e ocorrências ficam em `conference_states`, isolados por usuário com RLS.
- A mesma conta pode carregar os cadastros em outros dispositivos. Alterações concorrentes são rejeitadas por revisão; a interface pede gerar um PDF para guardar uma cópia das alterações locais antes de recarregar em caso de conflito.
- O status no topo confirma quando o banco terminou de salvar. Falhas mantêm os dados na tela e oferecem nova tentativa.
- Fotos e rascunhos de importação não são armazenados no banco; fechar o formulário os descarta.
- A emissão do pré é guardada em `issueDate` (`YYYY-MM-DD`), separada da data de cadastro. Cartões, pendências, ordenação e PDF usam a emissão quando disponível; registros antigos continuam identificados pela data de cadastro. A idade considera dias do calendário de Brasília. A data pode ser corrigida na importação e nos prés cadastrados.
- A configuração publicável do projeto está em `src/lib/supabase-config.ts`. `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` podem substituí-la no servidor. Nunca use uma chave secret/service-role nessa configuração.
- `GEMINI_API_KEY` permanece exclusivamente no servidor da Vercel. Uma chave reserva opcional pode ser configurada como `GEMINI_API_KEY_FALLBACK`, também somente no servidor, seguida de novo deploy. Nenhuma chave deve ter prefixo `VITE_` ou aparecer no navegador. A leitura por IA exige sessão Supabase válida.
- O `postbuild` verifica a reserva com um único GET dos metadados do modelo, sem fotos nem geração; valida nome e suporte a `generateContent`, limita a 5 segundos e registra apenas `gemini_backup_check` com `OK`, `SKIP` ou `CHECK_FAILED` e HTTP/timeout. Falhas não impedem o build.
- Migração: `supabase/migrations/20261011040000_conference.sql`. Testes transacionais de permissões: `supabase/tests/conference-security.sql` (fixtures desfeitas com rollback).

## Leitura e revisão

- O PDF usa A4 na horizontal, agrupa os prés por motorista e mostra placa, CTC, NF, volumes, cliente/laboratório, destinatário e situação. Respeita a tela, a busca e o filtro selecionados; tabelas longas repetem os cabeçalhos, com numeração de páginas e horário de Brasília. A exportação CSV e a análise manual de divergências por IA foram removidas.
- O menu lateral pode ser recolhido no desktop, mantendo ícones, contagens e dicas acessíveis. A navegação e o leitor permanecem montados, sem perder o que foi digitado. No celular, permanece a navegação horizontal.

- O modo automático é **Leitura local + IA**: um worker Tesseract lê cada foto e preenche um rascunho provisório. Uma transcrição independente do Gemini confere a mesma foto. A IA recebe somente a imagem, sem o texto local, para evitar induzir a repetição de erros.
- A conferência de uma foto começa assim que seu OCR local termina, enquanto o navegador lê a foto seguinte. Há no máximo duas conferências por IA simultâneas. A orientação identificada pelo OCR é reaproveitada; não há outro worker de orientação nessa etapa. Fotos que falham no OCR ainda podem ser recuperadas pela IA.
- Se o leitor local ficar 20 segundos sem concluir uma foto, ele é interrompido e a IA pode recuperar os arquivos restantes. Progresso e resultados locais tardios são ignorados, sem bloquear o botão Parar.
- Quando a chamada inicial funciona, cada foto usa uma única chamada completa ao Gemini nesse fluxo. Não há segunda ou terceira chamada automática por inconsistência: local e IA são as duas leituras independentes. A função de IA ainda aceita a verificação adicional para compatibilidade com outros consumidores.
- A correção compara as linhas pelo CTC literal de 10 dígitos, preservando zeros. NF, volumes e nomes legíveis da IA corrigem o rascunho local; diferenças ficam sinalizadas no próprio campo. Nunca se associam dados por índice da linha nem se derivam CTCs de chaves fiscais. Campos locais que a IA deixou vazios e CTCs locais ausentes na IA são mantidos com aviso. Contagem e soma são conferidas novamente após a correção.
- Durante a conferência, os campos provisórios ficam visíveis e bloqueados. O botão **Parar** invalida imediatamente a execução, aborta requisições e libera a interface, sem aguardar uma promessa travada. Dados locais já extraídos e resultados concluídos permanecem disponíveis; fotos sem resultado saem da fila. Respostas e progresso tardios não alteram o formulário nem uma nova leitura. Fechar descarta todos os rascunhos e fotos.
- Avisos de NF, volumes, CTC, laboratório e destinatário aparecem junto à respectiva caixa, com indicação visual e descrição acessível. Não há um bloco genérico acima de cada CTC. O aviso geral da leitura local explica quando a IA não conseguiu conferir a foto.
- Fotos idênticas no lote ou já presentes no formulário são ignoradas usando SHA-256 em memória. Uma releitura explícita continua disponível. Não há persistência de fotos, texto ou rascunhos.
- A leitura completa usa `gemini-3.8-flash`, raciocínio `LOW`, imagem `HIGH`, temperatura padrão `1` e saída JSON estruturada. `GEMINI_OCR_MODEL` substitui o modelo no servidor. O modo adicional legado usa `GEMINI_OCR_VERIFY_MODEL` ou `gemini-3.5-flash-lite` com `MINIMAL`; outros modelos usam `LOW`.
- O limite total no servidor é 20 segundos para a leitura completa e 10 para conferência adicional, incluindo autenticação e resposta. O cliente limita envio e resposta a 22/12 segundos. O cancelamento cobre autenticação Supabase, envio ao Gemini e leitura da resposta. Se houver uma chave reserva distinta, o servidor pode tentar essa chave uma única vez após erro de conexão, HTTP 401/403, HTTP 400 de credencial ou HTTP 5xx. As duas tentativas compartilham o mesmo limite total e cancelamento; não há tentativa reserva após timeout, erro da imagem/formato, HTTP 429/cota ou HTTP 402/faturamento. Chaves repetidas ou vazias são ignoradas, e os bloqueios de cota existentes são preservados.
- Quando a IA falha, os dados locais já obtidos permanecem: não se executa OCR outra vez. Cota diária conhecida impede chamadas novas até a renovação; indisponibilidade transitória ativa pausa de dois minutos. O navegador guarda somente usuário/expiração da cota em `sessionStorage`, separado por modelo/etapa. Nenhuma foto, credencial ou rascunho é guardado ali.
- O OCR local faz recortes agrupados de CTCs, NFs e totais, além de conferir volumes. A associação usa posições de linha para que uma célula ausente não desloque as seguintes. Pode haver erros mesmo com formatos e totais corretos; mudanças e campos não confirmados continuam para revisão. Não há cadastro automático nem promessa de exatidão de 100%.
Referências oficiais verificadas em 11/10/2026: [modelos e disponibilidade](https://ai.google.dev/gemini-api/docs/deprecations), [Flash com suporte a imagens e saídas estruturadas](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [níveis de raciocínio](https://ai.google.dev/gemini-api/docs/thinking), [camadas gratuitas e preços](https://ai.google.dev/gemini-api/docs/pricing), [entrada de imagens](https://ai.google.dev/gemini-api/docs/image-understanding) e [saídas estruturadas](https://ai.google.dev/gemini-api/docs/structured-output). A camada gratuita tem cotas específicas de cada projeto; ela não assegura disponibilidade nem precisão.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0c2d18b1-bafd-47c8-aa61-ab10fdedeb3f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

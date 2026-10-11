# Elegant Site Loom

Controle de retorno de CTCs e pré-manifestos, com leitura de fotos pelo Gemini e cadastros vinculados à conta no Supabase.

## Dados e acesso

- Login por e-mail e senha, com confirmação de e-mail pelo Supabase.
- Cadastros, conferências, atividades e ocorrências ficam em `conference_states`, isolados por usuário com RLS.
- A mesma conta pode carregar os cadastros em outros dispositivos. Alterações concorrentes são rejeitadas por revisão; a interface pede gerar um PDF para guardar uma cópia das alterações locais antes de recarregar em caso de conflito.
- O status no topo confirma quando o banco terminou de salvar. Falhas mantêm os dados na tela e oferecem nova tentativa.
- Fotos e rascunhos de importação não são armazenados no banco; fechar o formulário os descarta.
- A configuração publicável do projeto está em `src/lib/supabase-config.ts`. `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` podem substituí-la no servidor. Nunca use uma chave secret/service-role nessa configuração.
- `GEMINI_API_KEY` permanece exclusivamente no servidor da Vercel. A leitura por IA exige sessão Supabase válida.
- Migração: `supabase/migrations/20261011040000_conference.sql`. Testes transacionais de permissões: `supabase/tests/conference-security.sql` (fixtures desfeitas com rollback).

## Leitura e revisão

- O PDF usa A4 na horizontal, agrupa os prés por motorista e mostra placa, CTC, NF, volumes, cliente/laboratório, destinatário e situação. Respeita a tela, a busca e o filtro selecionados; tabelas longas repetem os cabeçalhos, com numeração de páginas e horário de Brasília. A exportação CSV e a análise manual de divergências por IA foram removidas.

- Lotes processam até duas fotos ao mesmo tempo, preservando a posição de cada arquivo. Uma única decodificação gera as imagens de leitura e a ampliação.
- O modo econômico faz uma leitura completa e valida localmente formatos, campos obrigatórios, CTCs únicos, contagem de linhas e soma dos volumes. Dados consistentes recebem status `single`, sem afirmar concordância entre duas leituras. Campos ausentes, avisos, placa ambígua ou totais incompatíveis acionam uma segunda leitura independente na imagem orientada e ampliada, incluindo laboratório e destinatário. Não há terceira leitura automática.
- Valores divergentes permanecem sinalizados para revisão, preservando o literal da primeira leitura. Campos ausentes podem ser recuperados da segunda leitura pelo CTC e recebem aviso. Concordância ou validação de formato não representa garantia de exatidão.
- Fotos com conteúdo idêntico no lote ou já presentes no formulário são ignoradas antes da leitura, mesmo com nomes diferentes. A comparação usa SHA-256 em memória, sem guardar fotos nem resultados; uma releitura solicitada explicitamente continua disponível. Fechar libera as fotos e descarta os rascunhos.
- Limites: 45 segundos para a leitura completa, 25 por conferência compacta e 75 por foto. Uma falha HTTP transitória recebe uma nova tentativa; timeout não reinicia outra espera longa. Se apenas a conferência falhar, os dados já lidos continuam disponíveis com aviso.
- Fechar ou parar cancela as requisições e impede resultados tardios de preencher outro formulário. O servidor combina o cancelamento com seu timeout e limita requisições por usuário autenticado.
- Cotas do Google são distintas dos limites do aplicativo. O servidor diferencia bloqueios por minuto e por dia usando os metadados do Gemini. Ao esgotar a cota diária, o lote mantém resultados concluídos e encaminha as fotos restantes ao leitor gratuito. O navegador lembra somente usuário/expiração em `sessionStorage`, para novos lotes irem direto à reserva até a meia-noite de Los Angeles; fotos e rascunhos nunca são persistidos. Limites por minuto ou indisponibilidade transitória não bloqueiam o dia inteiro. Uma foto consistente consome uma chamada, e uma foto sinalizada até duas leituras, além da repetição única permitida para falhas HTTP transitórias. Confira a cota efetiva no Google AI Studio.
- Quando uma foto não obtém nenhum resultado válido do Gemini, o modo automático usa o leitor gratuito no navegador (Tesseract). Apenas essas fotos são relidas, em uma fila local que preserva os índices e usa um worker para o lote. Falhas de autenticação continuam pedindo novo login. Dados Gemini já obtidos são preservados se somente a conferência adicional falhar.
- A reserva local não envia a foto a outra API nem tem cobrança por leitura. Ela exige baixar o leitor e o idioma no primeiro uso e pode ser mais lenta e menos precisa. Todo resultado local fica identificado e todos os CTCs recebem aviso de revisão; não há promessa de leitura completa nem cadastro automático.
- Uma indisponibilidade confirmada do provedor encaminha as fotos ainda na fila à reserva local sem repetir a mesma espera em cada uma. Leituras já em andamento podem terminar. O tempo exibido da reserva inclui a tentativa por IA e a fila local. Ao reler detalhes, uma falha ou reserva local não substitui uma leitura Gemini anterior válida nem suas correções manuais.

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

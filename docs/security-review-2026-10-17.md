# Revisão de segurança — confere.

Escopo: código e dependências, autenticação, funções públicas, isolamento de equipes, auditoria, importação e políticas HTTP. Testes de escrita adversarial executados exclusivamente em PostgreSQL/PGlite isolado, com identidades fictícias. Produção recebeu apenas migração de estrutura/funções e verificações anônimas de baixo volume; nenhum cadastro operacional ou senha foi alterado.

## Corrigido

- **Convite cancelado durante aceitação:** a aceitação usava uma consulta anterior à espera pelo bloqueio da equipe. Uma reprodução controlada confirmou que o código anterior ainda admitia o usuário nesse intervalo. Agora verifica novamente o convite depois de adquirir o mesmo bloqueio usado pelo cancelamento. A reprodução idêntica é recusada.
- **Validação anterior à mesclagem:** entradas grandes, campos inesperados e estruturas aninhadas em campos escalares são recusadas antes da mesclagem recursiva. Escritas pessoais antigas também passam pela validação. Rejeições preservam dados e auditoria.
- **Proteções HTTP:** CSP com nonce aleatório por resposta, propagado aos scripts SSR; nonce enviado pelo visitante é substituído. Scripts inline arbitrários, objetos e enquadramento por outros sites são bloqueados. Respostas dinâmicas usam `private, no-store`, `nosniff` e política sem envio de Referer. Câmera continua permitida apenas à própria origem.
- **Uploads:** limite de 4 MiB verifica Content-Length e os bytes reais de envios em partes antes da desserialização das funções. O limite existente dos arquivos XLSX locais permanece inalterado.
- **Configuração pública:** rejeita chaves secretas/service-role e URLs de autenticação com credenciais. Somente chave publicável ou anon legada é aceita.
- **Confirmação da conta:** diagnóstico/leitura por IA e consultas administrativas do banco exigem e-mail atualmente confirmado.
- **Limite de IA persistente:** até 80 solicitações por conta em dez minutos, com contador atômico privado no banco. Reiniciar ou escalar a Vercel não reinicia esse limite. Erro na autorização/cota impede chamar o provedor.
- **Regressão contínua:** CI inclui auditoria de dependências com limiar high; testes exercitam os controles e a reprodução da falha.

## Verificações

- Acesso anônimo às tabelas de estado, membros, auditoria e contador: recusado.
- Funções de dados e auxiliares privadas: sem autorização anônima.
- JWT forjado com papel privilegiado: recusado.
- Chamada de função do site a partir de origem externa: HTTP 403.
- `.env`, `.git/config` e prévia de desenvolvimento: HTTP 404.
- Isolamento entre equipes, autoria e auditoria: cenários de PostgreSQL isolado recusam acesso indevido e falsificação.
- HTML malicioso em ocorrência: renderizado como texto, sem criar script, imagem ou iframe.
- Metacaracteres SQL em nomes: tratados como dados, sem executar comandos.
- Importador OpenXML mantém rejeição de DOCTYPE e fórmulas, limites de expansão ZIP e execução cancelável no navegador.
- Auditoria Bun do lockfile combinado com as alterações da Lovable: nenhum advisory retornado na execução.
- Tela de login compilada e navegação de recuperação funcionaram com CSP ativa, sem avisos de CSP no navegador.

O script `node scripts/security-smoke.mjs` repete as verificações externas sem senha, criação de contas ou leitura de registros. A variante `http://127.0.0.1:8083` testa o servidor local e os mesmos endpoints públicos do Supabase. Não executa ataques de carga, força bruta ou escrita autenticada na produção.

## Limites

Esta é uma revisão técnica com testes controlados, não uma certificação de inviolabilidade nem um pentest independente. A base de advisories não cobre vulnerabilidades desconhecidas. O limite da IA é por conta, não um teto global de gasto do provedor. A política permite os recursos confiáveis necessários ao OCR local e estilos inline da interface; não usa isolamento COEP que possa quebrar esses recursos.

A visão pessoal filtra os registros apresentados; a equipe explicitamente convidada continua sendo a fronteira de acesso compartilhado prevista no produto. Não foi transformada em um novo sistema de permissões por registro. Senhas, MFA, regras externas de faturamento e recuperação de desastre não foram alterados nesta entrega.

## Referências técnicas

- [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: segurança de funções](https://supabase.com/docs/guides/database/functions)
- [TanStack: proteção de server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [Bun: auditoria de dependências](https://bun.com/docs/install/audit)

## Segunda revisão — validação estrita e OCR próprio

Em uma reprodução isolada com conta confirmada e autorizada, o banco aceitava campos como `driver: 42` e `volumes: 1e100`. O navegador rejeitava depois esse estado inteiro. A migração `20261017020000_security_scalar_types.sql` recusa tipos incorretos, números fora do intervalo seguro, datas inválidas e metadados de NF incompatíveis com o esquema. Rejeições não modificam registros. A reprodução falhou antes da correção e passou depois; as três suítes de banco passaram com a migração reaplicada para verificar idempotência.

**Aplicação remota pendente:** essa segunda migração foi validada somente no PostgreSQL isolado. O controle do Chrome/Supabase deixou de responder antes da aplicação. Publicar o código pelo Git não executa automaticamente as migrações neste projeto. A primeira migração de segurança permanece aplicada.

O código executável do OCR (worker e variantes WebAssembly LSTM) agora é preparado a partir das dependências instaladas e fixadas no lockfile, servido pelo próprio site. A CSP do documento deixa de permitir scripts do CDN e workers blob. Os arquivos de treinamento de idioma continuam como dados externos; nenhuma foto é enviada pelo teste local. Uma leitura real da referência de 15 linhas concluiu em 11,3 segundos sob a CSP restrita, com pré DI00601869631, placa TRB7E25, motorista DAVID VARGAS FERNANDES e total de 98 volumes. Os avisos de revisão permanecem; esse teste verifica funcionamento e não certifica exatidão de todos os campos.

Credenciais com formatos reconhecidos e campos de senha/token são ocultados nos diagnósticos de erro do servidor, inclusive valores JSON com aspas escapadas. Essa filtragem não equivale a classificar automaticamente toda informação privada possível.

Validação: 815 testes passaram, compilação de produção concluída, TypeScript e lint sem erros após os ajustes. As 16 verificações externas limitadas passaram contra a compilação local. Não foram feitos ataques destrutivos, carga ou escrita autenticada nos registros reais.

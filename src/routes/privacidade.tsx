import { createFileRoute } from "@tanstack/react-router";
import { Fact, LegalPage } from "@/components/legal-page";
import { legalConfig as c } from "@/lib/legal-config";

export const Route = createFileRoute("/privacidade")({
  head: () => ({ meta: [{ title: "Política de privacidade — confere." }] }),
  component: PrivacyPolicy,
});

function PrivacyPolicy() {
  return (
    <LegalPage title="Política de privacidade">
      <p>
        Esta política explica quais dados pessoais o sistema confere. trata, para quê, por quanto
        tempo e como você pode exercer seus direitos, conforme a Lei Geral de Proteção de Dados (Lei
        nº 13.709/2018, LGPD).
      </p>

      <h2>1. Quem é responsável</h2>
      <p>
        A controladora dos dados é <Fact value={c.controller} />, CNPJ{" "}
        <Fact value={c.controllerCnpj} />, que decide como o sistema é usado na sua operação. O
        sistema é desenvolvido e mantido por <Fact value={c.operator} />, que atua como operador e
        trata os dados somente conforme as instruções da controladora.
      </p>
      <p>
        Canal do encarregado de dados: <Fact value={c.privacyContact} />.
      </p>

      <h2>2. Quais dados são tratados</h2>
      <ul>
        <li>
          <strong>Conta de acesso:</strong> e-mail e senha. A senha é guardada pelo serviço de
          autenticação apenas em forma cifrada (hash); ninguém da operação consegue lê-la.
        </li>
        <li>
          <strong>Dados operacionais dos documentos de transporte:</strong> número do pré-manifesto
          ou manifesto, nome do motorista e do conferente, placa do veículo, datas de emissão e
          previsão de entrega, números de CTC e de nota fiscal, volumes, valor e peso da mercadoria,
          natureza da carga, cidade de entrega, nomes do remetente (cliente/laboratório) e do
          destinatário, e ocorrências de entrega importadas da planilha.
        </li>
        <li>
          <strong>Registro de ações (auditoria):</strong> e-mail e identificador de quem cadastrou,
          conferiu, alterou ou excluiu cada registro, com data e hora. Esse registro não pode ser
          alterado pelos usuários.
        </li>
        <li>
          <strong>Fotos de documentos:</strong> são lidas no próprio navegador do aparelho e{" "}
          <strong>não são enviadas nem armazenadas</strong>. Ao cadastrar, guarda-se somente uma
          impressão digital do arquivo (código SHA-256), usada para avisar quando a mesma foto é
          enviada de novo. A partir dela não é possível reconstruir a imagem.
        </li>
        <li>
          <strong>Planilhas importadas:</strong> são lidas no navegador. O arquivo não é guardado;
          ficam salvos apenas os dados de cada pré que você cadastrar.
        </li>
        <li>
          <strong>Dados técnicos de acesso:</strong> os provedores de hospedagem e de autenticação
          podem registrar dados como endereço IP, data e hora de acesso, para segurança e
          cumprimento de obrigações legais.
        </li>
        <li>
          <strong>Registro de falhas:</strong> quando ocorre um erro inesperado na tela, o sistema
          guarda a mensagem técnica, a página, o navegador usado e o identificador da conta, para
          corrigir o problema. Senhas e chaves são removidas da mensagem, e o registro é apagado
          após 90 dias.
        </li>
      </ul>

      <h2>3. Para que os dados são usados</h2>
      <p>
        Exclusivamente para controlar o retorno de documentos de transporte: cadastrar
        pré-manifestos, conferir CTCs, acompanhar pendências por motorista, rastrear documentos,
        gerar relatórios em PDF e manter o histórico de quem fez cada ação. Os dados não são usados
        para publicidade, não são vendidos e não são enviados a serviços de inteligência artificial.
      </p>
      <p>
        O papel de cada pessoa na equipe (responsável, administrador, conferente ou só leitura)
        define o que ela pode consultar e alterar.
      </p>
      <p>
        As bases legais são a execução do contrato com a controladora e o legítimo interesse na
        organização e na segurança da operação (LGPD, art. 7º, incisos V e IX), além do cumprimento
        de obrigações legais quando aplicável.
      </p>

      <h2>4. Com quem os dados são compartilhados</h2>
      <p>Os dados ficam em serviços contratados para operar o sistema:</p>
      <ul>
        <li>
          <strong>Supabase:</strong> banco de dados e autenticação. Região do banco:{" "}
          <Fact value={c.databaseRegion} />.
        </li>
        <li>
          <strong>Vercel:</strong> hospedagem do site.
        </li>
      </ul>
      <p>
        Esses provedores podem processar dados fora do Brasil, com as salvaguardas previstas na
        LGPD. Fora isso, os dados só são compartilhados por determinação legal ou judicial.
      </p>

      <h2>5. Por quanto tempo</h2>
      <p>
        Os pré-manifestos ficam na lista de trabalho enquanto estão em andamento. Os finalizados há
        mais de 30 dias são movidos para um arquivo, que continua consultável no Rastreamento. O
        prazo de guarda dos registros é: <Fact value={c.retention} />. Depois disso, eles são
        excluídos ou anonimizados, salvo obrigação legal de guarda.
      </p>

      <h2>6. Armazenamento no seu aparelho</h2>
      <p>
        O sistema não usa cookies de publicidade nem ferramentas de análise de navegação. O
        navegador guarda localmente a sua sessão de acesso, para você não precisar entrar a cada
        página, e o modelo de leitura de fotos, para não baixá-lo de novo. Sair da conta encerra a
        sessão; limpar os dados do site no navegador remove os dois.
      </p>

      <h2>7. Segurança</h2>
      <p>
        A comunicação é cifrada (HTTPS). Cada equipe só acessa os próprios registros, por regras
        aplicadas no próprio banco de dados. As senhas não ficam legíveis, as ações ficam
        registradas na auditoria e o site usa cabeçalhos de segurança contra ataques comuns em
        navegadores.
      </p>

      <h2>8. Seus direitos</h2>
      <p>
        Você pode pedir confirmação de que seus dados são tratados, acesso, correção, anonimização,
        bloqueio ou eliminação de dados desnecessários, informação sobre compartilhamento e revisão
        de decisões, entre os demais direitos do art. 18 da LGPD. Faça o pedido pelo canal do
        encarregado: <Fact value={c.privacyContact} />. Você também pode reclamar à Autoridade
        Nacional de Proteção de Dados (ANPD).
      </p>

      <h2>9. Alterações</h2>
      <p>
        Esta política pode ser atualizada quando o sistema mudar. A data no topo indica a versão em
        vigor.
      </p>
    </LegalPage>
  );
}

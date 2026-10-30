import { createFileRoute } from "@tanstack/react-router";
import { Fact, LegalPage } from "@/components/legal-page";
import { legalConfig as c } from "@/lib/legal-config";

export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos de uso — confere." }] }),
  component: TermsOfUse,
});

function TermsOfUse() {
  return (
    <LegalPage title="Termos de uso">
      <p>
        Estes termos valem para quem usa o sistema confere. na operação de{" "}
        <Fact value={c.controller} />. Ao criar uma conta ou entrar no sistema, você concorda com
        eles e com a <a href="/privacidade">Política de privacidade</a>.
      </p>

      <h2>1. Para que serve</h2>
      <p>
        O confere. registra pré-manifestos e conhecimentos de transporte (CTCs), confere o retorno
        dos documentos, acompanha pendências e gera relatórios. É uma ferramenta interna de
        trabalho, para uso exclusivo nas atividades da empresa.
      </p>

      <h2>2. Sua conta</h2>
      <ul>
        <li>A conta é pessoal e intransferível. Não compartilhe sua senha.</li>
        <li>
          Use um e-mail que você controla: ele identifica, no histórico, as ações que você fizer.
        </li>
        <li>
          Avise o responsável pela equipe se suspeitar de acesso indevido à sua conta, e troque a
          senha pela opção &quot;Esqueci minha senha&quot;.
        </li>
        <li>Quem administra a equipe decide quem participa dela e pode retirar o acesso.</li>
      </ul>

      <h2>3. Conferência dos dados</h2>
      <p>
        A leitura de fotos e de planilhas é automática e <strong>pode conter erros</strong>, mesmo
        quando os totais conferem. Antes de cadastrar, revise número do pré, CTC, nota fiscal,
        volumes e nomes, principalmente os campos sinalizados. Você é responsável pelos dados que
        cadastrar e pelas conferências que registrar.
      </p>

      <h2>4. Uso permitido</h2>
      <p>Não é permitido:</p>
      <ul>
        <li>cadastrar dados falsos ou de documentos que não pertençam à operação;</li>
        <li>tentar acessar dados de outras equipes ou burlar as regras de acesso;</li>
        <li>usar o sistema para fins diferentes da conferência de documentos da empresa;</li>
        <li>copiar os dados em massa para fora da empresa sem autorização.</li>
      </ul>

      <h2>5. Disponibilidade</h2>
      <p>
        O sistema depende de internet e de serviços de terceiros (hospedagem e banco de dados) e
        pode ficar indisponível por manutenção ou falhas. Alterações não salvas ficam na tela, com
        aviso; gere o PDF quando precisar guardar uma cópia. Não se garante funcionamento sem
        interrupções.
      </p>

      <h2>6. Registro das ações</h2>
      <p>
        Cadastros, conferências, alterações e exclusões ficam registrados com o e-mail de quem fez e
        o horário, e esse histórico não pode ser alterado pelos usuários. Ele serve para rastrear a
        operação e esclarecer divergências.
      </p>

      <h2>7. Alterações nestes termos</h2>
      <p>
        Estes termos podem mudar quando o sistema mudar. A data no topo indica a versão em vigor.
        Dúvidas: <Fact value={c.privacyContact} />.
      </p>
    </LegalPage>
  );
}

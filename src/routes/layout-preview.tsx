import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AccountFeedback, AccountStatusBar } from "@/components/account-status";
import { AccountPanel } from "@/components/account-auth";
import { ConferenceWorkspace } from "@/components/conference-workspace";

// Local-only visual preview with fictitious data; never available in production builds.
// Midday UTC keeps the rendered date identical on the server (UTC) and in the
// browser (America/Sao_Paulo), avoiding a hydration mismatch in this preview.
const now = Date.now();
const day = (n: number) => {
  const date = new Date(now - n * 86400000);
  date.setUTCHours(15, 0, 0, 0);
  return date.toISOString();
};
const doc = (id: string, ctc: string, nf: string, volumes: number, received: boolean) => ({
  id,
  ctc,
  nf,
  volumes,
  received,
  client: "REMETENTE EXEMPLO",
  recipient: "DESTINO EXEMPLO",
});
const state = {
  activity: [],
  issues: [],
  manifests: [
    {
      id: "DI0000000001",
      driver: "MOTORISTA EXEMPLO A",
      plate: "AAA1A11",
      date: day(3),
      issueDate: day(3).slice(0, 10),
      documents: [
        doc("a1", "0000000101", "1001-1", 3, true),
        doc("a2", "0000000102", "1002-1", 5, false),
        doc("a3", "0000000103", "1003-1", 2, false),
      ],
    },
    {
      id: "DI0000000002",
      driver: "MOTORISTA EXEMPLO A",
      plate: "AAA1A11",
      date: day(1),
      issueDate: day(1).slice(0, 10),
      documents: [doc("b1", "0000000201", "2001-1", 1, false)],
    },
    {
      id: "DI0000000003",
      driver: "MOTORISTA EXEMPLO B",
      plate: "BBB2B22",
      date: day(0),
      issueDate: day(0).slice(0, 10),
      documents: [
        doc("c1", "0000000301", "3001-1", 4, true),
        doc("c2", "0000000302", "3002-1", 6, false),
      ],
    },
  ],
};

export const Route = createFileRoute("/layout-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Prévia de layout · confere." },
      {
        name: "description",
        content: "Prévia local das telas de conferência do confere. com dados fictícios.",
      },
      { property: "og:title", content: "Prévia de layout · confere." },
      {
        property: "og:description",
        content: "Revisão local das telas de conferência e importação Luft.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LayoutPreview,
});

function LayoutPreview() {
  const [scenario, setScenario] = useState("normal");
  const pending = scenario === "saving" || scenario === "save-error";
  const error =
    scenario === "save-error"
      ? "Sem conexão. Suas alterações ainda não foram salvas. Tente salvar novamente."
      : "";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted px-3 py-2 text-xs">
        <strong>Prévia local · dados fictícios</strong>
        <label>
          Cenário{" "}
          <select
            aria-label="Cenário da prévia"
            className="rounded border bg-background px-2 py-1"
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          >
            {[
              ["normal", "Dados salvos"],
              ["saving", "Salvando"],
              ["save-error", "Erro ao salvar"],
              ["loading", "Carregando cadastros"],
              ["load-error", "Erro ao carregar"],
              ["empty", "Lista vazia"],
            ].map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {scenario === "loading" || scenario === "load-error" ? (
        <AccountPanel>
          <AccountFeedback
            message={
              scenario === "loading"
                ? "Carregando seus cadastros…"
                : "Não foi possível carregar seus cadastros. Nenhum dado foi substituído."
            }
            error={scenario === "load-error"}
            onRetry={scenario === "load-error" ? () => setScenario("normal") : undefined}
          />
        </AccountPanel>
      ) : (
        <div className="account-shell" style={{ height: "calc(100dvh - 45px)" }}>
          <AccountStatusBar
            email="equipe@exemplo.invalid"
            status={
              error
                ? "Alterações ainda não salvas"
                : pending
                  ? "Salvando…"
                  : "Todos os dados salvos"
            }
            pending={pending}
            error={error}
            conflict={false}
            onTeam={() => {}}
            onSignOut={() => {}}
            onRetry={() => setScenario("normal")}
            onReload={() => setScenario("normal")}
          />
          <ConferenceWorkspace
            key={scenario === "empty" ? "empty" : "records"}
            initialState={
              scenario === "empty" ? { manifests: [], activity: [], issues: [] } : state
            }
          />
        </div>
      )}
    </>
  );
}

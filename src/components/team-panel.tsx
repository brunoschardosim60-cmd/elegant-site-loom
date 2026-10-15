import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import type { ConferenceTeam } from "@/lib/conference-team";
import { teamRequest } from "@/lib/team-request";

const auditSchema = z.array(
  z.object({
    id: z.number(),
    actor_email: z.string(),
    occurred_at: z.string(),
    manifest_id: z.string(),
    action: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
);
type Audit = z.infer<typeof auditSchema>;
const actions: Record<string, string> = {
  pre_added: "Pré cadastrado",
  pre_edited: "Pré alterado",
  pre_removed: "Pré excluído",
  pre_finished: "Pré finalizado",
  pre_reopened: "Pré reaberto",
  ctc_added: "CTC / NF adicionado",
  ctc_edited: "CTC / NF alterado",
  ctc_removed: "CTC removido",
  ctc_received: "CTC conferido",
  ctc_reopened: "Conferência desfeita",
};
const labels: Record<string, string> = {
  nf: "NF",
  volumes: "Volumes",
  client: "Laboratório",
  recipient: "Destinatário",
  plate: "Placa",
  driver: "Motorista",
  issueDate: "Emissão",
};
function changes(details: Record<string, unknown>) {
  const before = details["before"] as Record<string, unknown> | undefined;
  const after = details["after"] as Record<string, unknown> | undefined;
  return Object.entries(labels).flatMap(([key, label]) =>
    before?.[key] !== after?.[key]
      ? [`${label}: ${String(before?.[key] ?? "—")} → ${String(after?.[key] ?? "—")}`]
      : [],
  );
}
export function TeamPanel({
  client,
  team,
  open,
  onOpenChange,
  onRefresh,
  selectedPre = "",
  canJoin = true,
}: {
  client: SupabaseClient;
  team: ConferenceTeam;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  selectedPre?: string;
  canJoin?: boolean;
}) {
  const [tab, setTab] = useState<"members" | "history">("members");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [events, setEvents] = useState<Audit>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [appliedFilter, setAppliedFilter] = useState("");
  const [historyError, setHistoryError] = useState("");
  const version = useRef(0);
  async function join() {
    if (busy || !canJoin) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await teamRequest(client, "get_conference_team", { accept_invitation: true });
      if (result.error) throw result.error;
      window.location.reload();
    } catch {
      setMessage("Não foi possível entrar na equipe. Confira o convite e tente novamente.");
      setBusy(false);
    }
  }
  const [providerChecks, setProviderChecks] = useState<
    { key: string; model: string; status: string }[]
  >([]);
  async function testProviders() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) throw new Error("session");
      const { checkPhotoProviders } = await import("@/lib/provider-health.functions");
      const result = await checkPhotoProviders({ data: { accessToken: session.access_token } });
      setProviderChecks(result.checks);
      setMessage(result.error || "Teste concluído. A cota pode mudar durante o dia.");
    } catch {
      setMessage("Não foi possível concluir o diagnóstico. Tente novamente mais tarde.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (open) {
      setMessage("");
      setFilter(selectedPre);
      if (selectedPre) setTab("history");
    } else {
      version.current++;
      setEmail("");
    }
  }, [open, selectedPre]);
  const history = useCallback(
    async (append = false, query = "", beforeId: number | null = null) => {
      const normalizedQuery = query.trim().toUpperCase();
      const run = ++version.current;
      setLoading(true);
      setHistoryError("");
      // Results and pagination always belong to the submitted query, never to
      // text the user is still editing. Clear previous results on a new search.
      if (!append) {
        setEvents([]);
        setMore(false);
        setAppliedFilter(normalizedQuery);
      }
      try {
        const result = await teamRequest(client, "get_conference_audit", {
          pre_id: normalizedQuery || null,
          before_id: append ? beforeId : null,
        });
        if (result.error) throw result.error;
        const rows = auditSchema.parse(result.data);
        if (run !== version.current) return;
        setEvents((current) => (append ? [...current, ...rows] : rows));
        setMore(rows.length === 100);
      } catch {
        if (run === version.current)
          setHistoryError("Não foi possível carregar o histórico. Tente novamente.");
      } finally {
        if (run === version.current) setLoading(false);
      }
    },
    [client],
  );
  const invalidateHistory = useCallback(() => {
    version.current++;
  }, []);
  useEffect(() => {
    if (open && tab === "history") {
      setFilter(selectedPre);
      void history(false, selectedPre);
    }
    return invalidateHistory;
  }, [open, tab, selectedPre, history, invalidateHistory]);
  async function invite(cancel?: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await teamRequest(
        client,
        cancel ? "cancel_conference_invite" : "invite_conference_member",
        { member_email: cancel ?? email },
      );
      if (result.error) throw result.error;
      setEmail("");
      setMessage(
        cancel
          ? "Convite cancelado."
          : "Acesso preparado. Essa pessoa deve criar e confirmar a conta com esse e-mail e entrar no site.",
      );
      onRefresh();
    } catch (error) {
      const reason = String((error as { message?: string }).message);
      setMessage(
        /Equipe completa/.test(reason)
          ? "A configuração de acesso da equipe precisa ser atualizada no servidor."
          : /Email já incluído|Confira o email|Somente o responsável|outra equipe/.test(reason)
            ? reason
            : "Não foi possível atualizar a equipe. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Equipe e histórico</DialogTitle>
          <DialogDescription>
            Compartilhe os cadastros com sua equipe. Cada pessoa entra com sua própria conta.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={tab === "members" ? "default" : "outline"}
            onClick={() => {
              setTab("members");
              setMessage("");
            }}
          >
            Pessoas
          </Button>
          <Button
            size="sm"
            variant={tab === "history" ? "default" : "outline"}
            onClick={() => setTab("history")}
          >
            Histórico de ações
          </Button>
        </div>
        {tab === "members" ? (
          <div className="grid gap-4">
            {team.invitation && (
              <div className="rounded-lg border bg-accent p-3 text-xs grid gap-2">
                <strong>Convite de {team.invitation.ownerEmail}</strong>
                <p>
                  Ao aceitar, você passará a consultar e alterar os cadastros dessa equipe. Seus
                  cadastros pessoais anteriores ficam preservados e não são transferidos.
                </p>
                <Button size="sm" disabled={busy || !canJoin} onClick={() => void join()}>
                  Aceitar convite e entrar na equipe
                </Button>
                {!canJoin && <span>Conclua o salvamento antes de trocar de equipe.</span>}
              </div>
            )}
            <ul className="grid gap-2 text-xs">
              {team.members.map((m) => (
                <li
                  key={m.email}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                >
                  <span className="break-all mr-auto">{m.email}</span>
                  <span className="text-muted-foreground">
                    {m.owner ? "Responsável" : m.pending ? "Aguardando entrada" : "Integrante"}
                  </span>
                  {team.owner && m.pending && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void invite(m.email)}
                    >
                      Cancelar convite
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {team.owner && (
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void invite();
                }}
              >
                <label className="form-field">
                  E-mail da pessoa
                  <input
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <Button disabled={busy || !email.trim()} type="submit">
                  {busy ? "Preparando…" : "Liberar acesso à equipe"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Ao incluir o e-mail, você permite que essa conta consulte e altere os dados da
                  equipe. Não é enviado e-mail automático; compartilhe o endereço do site com a
                  pessoa.
                </p>
              </form>
            )}
            <p className="text-xs text-muted-foreground">
              Os registros anteriores do responsável continuam nesta equipe. Dados pessoais de outra
              conta não são importados automaticamente. O histórico começa nas alterações feitas a
              partir desta versão.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void history(false, filter);
              }}
            >
              <label className="form-field flex-1">
                Pré (opcional)
                <input
                  aria-label="Filtrar histórico por pré"
                  value={filter}
                  placeholder="Todos os prés, incluindo excluídos"
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <Button className="self-end" variant="outline" disabled={loading}>
                Consultar
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Consulta: {appliedFilter || "Todos os manifestos"}
            </p>
            {historyError && (
              <p role="alert" className="text-sm text-destructive">
                {historyError}
              </p>
            )}
            {loading && (
              <p role="status" className="text-xs">
                Carregando histórico…
              </p>
            )}
            {!loading && !historyError && !events.length && (
              <p className="text-xs text-muted-foreground">
                Nenhuma ação registrada neste filtro. Cadastros anteriores à ativação não têm
                autoria retroativa.
              </p>
            )}
            <ul className="grid gap-2">
              {events.map((event) => (
                <li key={event.id} className="rounded-lg border p-3 text-xs">
                  <div className="flex flex-wrap gap-2">
                    <strong>{actions[event.action] ?? "Registro alterado"}</strong>
                    <span className="font-mono">
                      {event.manifest_id}
                      {typeof event.details["ctc"] === "string" ? ` · ${event.details["ctc"]}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground break-all">
                    {event.actor_email} ·{" "}
                    {new Date(event.occurred_at).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}
                  </p>
                  {changes(event.details).length > 0 && (
                    <details className="mt-2 text-muted-foreground">
                      <summary className="cursor-pointer">Ver alterações</summary>
                      {changes(event.details).map((line, index) => (
                        <p className="mt-1 break-words" key={index}>
                          {line}
                        </p>
                      ))}
                    </details>
                  )}
                </li>
              ))}
            </ul>
            {more && (
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void history(true, appliedFilter, events.at(-1)?.id ?? null)}
              >
                Mais antigas
              </Button>
            )}
          </div>
        )}
        {team.owner && tab === "members" && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Diagnóstico do leitor</summary>
            <p className="my-2">
              Testa as chaves configuradas no servidor, sem enviar fotos ou cadastrar dados. Consome
              uma solicitação pequena por modelo e chave.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void testProviders()}
            >
              {busy ? "Testando…" : "Testar disponibilidade da IA"}
            </Button>
            {providerChecks.length > 0 && (
              <ul className="mt-2 grid gap-1">
                {providerChecks.map((check) => (
                  <li key={`${check.key}-${check.model}`}>
                    {check.key} · {check.model}: <strong>{check.status}</strong>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
        {message && (
          <p role="status" className="text-xs">
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

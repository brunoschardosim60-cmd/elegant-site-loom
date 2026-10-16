import { UserRound, Users, Settings2, Clock3 } from "lucide-react";
import { Button } from "./ui/button";
import type { Manifest } from "@/lib/conference";
import type { ConferenceTeam } from "@/lib/conference-team";
import { demandTotals, selectOwnedRoutes, type WorkspaceScope } from "@/lib/conference-ownership";
const quantity = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

export function DemandScope({
  scope,
  onScopeChange,
  manifests,
  members = [],
  onManageTeam,
}: {
  scope: WorkspaceScope;
  onScopeChange: (scope: WorkspaceScope) => void;
  manifests: Manifest[];
  members?: ConferenceTeam["members"] | undefined;
  onManageTeam?: (() => void) | undefined;
}) {
  const owners = members
    .filter((member) => !member.pending)
    .map(({ email, userId }) => ({ email, userId }));
  for (const manifest of manifests)
    if (
      manifest.createdByEmail &&
      !owners.some(
        (owner) =>
          (manifest.createdBy && owner.userId === manifest.createdBy) ||
          owner.email.toLowerCase() === manifest.createdByEmail?.toLowerCase(),
      )
    )
      owners.push({ email: manifest.createdByEmail, userId: manifest.createdBy });
  const total = demandTotals(selectOwnedRoutes(manifests));
  return (
    <section className="demand-scope" aria-label="Visão das demandas">
      <div className="demand-scope-tools">
        <div className="demand-scope-buttons" role="group" aria-label="Selecionar visão">
          <Button
            variant={scope === "mine" ? "default" : "outline"}
            aria-pressed={scope === "mine"}
            onClick={() => onScopeChange("mine")}
          >
            <UserRound size={16} />
            Minhas demandas
          </Button>
          <Button
            variant={scope === "team" ? "default" : "outline"}
            aria-pressed={scope === "team"}
            onClick={() => onScopeChange("team")}
          >
            <Users size={16} />
            Equipe
          </Button>
        </div>
        {onManageTeam && (
          <Button variant="ghost" size="sm" onClick={onManageTeam}>
            <Settings2 size={14} />
            Membros e histórico
          </Button>
        )}
      </div>
      <p className="demand-scope-description">
        {scope === "mine"
          ? "Manifestos que você cadastrou. As conferências feitas pela equipe atualizam suas demandas."
          : "Todos os cadastros da equipe. Os totais por pessoa correspondem aos manifestos que ela cadastrou; quem executou cada ação aparece no histórico."}
      </p>
      {scope === "team" && (
        <>
          <p className="demand-team-total" role="status">
            {quantity(total.manifests, "manifesto", "manifestos")} ·{" "}
            {quantity(total.nfs, "NF", "NFs")} ·{" "}
            {quantity(total.pendingNfs, "NF pendente", "NFs pendentes")} ·{" "}
            {quantity(total.pending, "CTC pendente", "CTCs pendentes")} ·{" "}
            {quantity(total.finished, "manifesto finalizado", "manifestos finalizados")}
          </p>
          <section className="demand-members" aria-label="Resumo por integrante">
            {owners.map((owner) => {
              const totals = demandTotals(selectOwnedRoutes(manifests, owner));
              return (
                <article className="demand-member" key={owner.userId ?? owner.email}>
                  <h2 title={owner.email}>{owner.email.split("@")[0]}</h2>
                  <p>
                    {quantity(totals.manifests, "manifesto", "manifestos")} ·{" "}
                    {quantity(totals.nfs, "NF", "NFs")}
                  </p>
                  <div>
                    <span>
                      <Clock3 size={12} />{" "}
                      {quantity(totals.pendingNfs, "NF pendente", "NFs pendentes")}
                    </span>
                    <span>
                      {quantity(totals.finished, "manifesto finalizado", "manifestos finalizados")}
                    </span>
                  </div>
                  <small>
                    {quantity(totals.pending, "CTC pendente", "CTCs pendentes")} ·{" "}
                    {quantity(totals.volumes, "volume pendente", "volumes pendentes")}
                    <br />
                    {quantity(
                      totals.received,
                      "CTC conferido na rota atual",
                      "CTCs conferidos na rota atual",
                    )}
                  </small>
                </article>
              );
            })}
          </section>
        </>
      )}
    </section>
  );
}

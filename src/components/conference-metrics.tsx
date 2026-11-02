import type { Manifest } from "@/lib/conference";
import {
  conferenceMetrics,
  formatDays,
  formatMoney,
  LATE_AFTER_DAYS,
} from "@/lib/conference-metrics";

/** Indicators a manager reads at a glance: return rate, delays and value still pending. */
export function ConferenceMetricsView({ manifests, now }: { manifests: Manifest[]; now: string }) {
  const m = conferenceMetrics(manifests, now);
  if (!m.ctcs)
    return (
      <div className="empty-state">
        <h3>Sem dados para indicadores</h3>
        <p className="text-xs mt-2">Importe uma planilha 108 para ver os indicadores da equipe.</p>
      </div>
    );
  const tiles = [
    {
      label: "Taxa de devolução",
      value: m.returnRate === undefined ? "—" : `${Math.round(m.returnRate * 100)}%`,
      caption: `${m.received} de ${m.ctcs} CTCs devolvidos`,
    },
    {
      label: "Mercadoria com CTC pendente",
      value: formatMoney(m.pendingValueCents),
      caption: m.pendingWithoutValue
        ? `${m.pending} CTCs pendentes · ${m.pendingWithoutValue} sem valor informado`
        : `${m.pending} CTCs pendentes · ${(m.pendingWeightGrams / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} t`,
    },
    {
      label: `Atrasados (${LATE_AFTER_DAYS}+ dias)`,
      value: String(m.late),
      caption: m.perishablePending
        ? `${m.perishablePending} perecível(is) pendente(s)`
        : "Nenhum perecível pendente",
    },
    {
      label: "Tempo até a devolução",
      value: formatDays(m.medianReturnDays),
      caption: "Mediana, da emissão do manifesto até a conferência",
    },
  ];
  return (
    <section className="metrics-view" aria-label="Indicadores">
      <div className="metric-grid metrics-tiles">
        {tiles.map((tile) => (
          <div className="metric" key={tile.label}>
            <div className="metric-label">{tile.label}</div>
            <div className="metric-value">{tile.value}</div>
            <div className="metric-caption">{tile.caption}</div>
          </div>
        ))}
      </div>
      <div
        className="manifest-card metrics-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Indicadores por motorista"
      >
        <table className="document-table metrics-table">
          <caption>Por motorista</caption>
          <thead>
            <tr>
              <th>Motorista</th>
              <th>Pendentes</th>
              <th>Atrasados</th>
              <th>Valor pendente</th>
              <th>Mais antigo</th>
              <th>Devolução (mediana)</th>
            </tr>
          </thead>
          <tbody>
            {m.drivers.map((driver) => (
              <tr key={driver.driver} data-late={driver.late > 0}>
                <td data-label="Motorista">{driver.driver}</td>
                <td data-label="Pendentes">{driver.pending}</td>
                <td data-label="Atrasados">{driver.late}</td>
                <td data-label="Valor pendente">
                  {driver.pendingValueCents ? formatMoney(driver.pendingValueCents) : "—"}
                </td>
                <td data-label="Mais antigo">
                  {driver.pending ? formatDays(driver.oldestDays) : "—"}
                </td>
                <td data-label="Devolução (mediana)">{formatDays(driver.medianReturnDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!m.cities.length && (
        <div
          className="manifest-card metrics-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Pendências por cidade"
        >
          <table className="document-table metrics-table">
            <caption>Pendências por cidade de entrega</caption>
            <thead>
              <tr>
                <th>Cidade</th>
                <th>CTCs pendentes</th>
                <th>Valor pendente</th>
              </tr>
            </thead>
            <tbody>
              {m.cities.map((city) => (
                <tr key={city.city}>
                  <td data-label="Cidade">{city.city}</td>
                  <td data-label="CTCs pendentes">{city.pending}</td>
                  <td data-label="Valor pendente">
                    {city.pendingValueCents ? formatMoney(city.pendingValueCents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Valores, peso, natureza e cidade vêm da planilha 108; cadastros por foto ou manuais não têm
        esses dados. Tempo até a devolução conta dias de calendário em Brasília.
      </p>
    </section>
  );
}

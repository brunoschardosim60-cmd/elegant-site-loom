import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { Manifest } from "@/lib/conference";
import { CityMap } from "./city-map";
import { withKnownCities } from "@/lib/city-fill";
import { Button } from "./ui/button";
import {
  conferenceMetrics,
  formatDays,
  formatMoney,
  formatShare,
  LATE_AFTER_DAYS,
  MIN_CTCS,
  outOfTimeShare,
  type ConferenceMetrics,
  type GroupMetrics,
} from "@/lib/conference-metrics";
import {
  formatRange,
  inRange,
  metricsPeriod,
  periodLabels,
  type DateRange,
  type PeriodKind,
} from "@/lib/metrics-period";

/** Archived (finished, out of the live list) manifests by date; null when the database cannot list them. */
export type LoadArchivedByDate = (range: DateRange) => Promise<Manifest[] | null>;

const ROWS = 10;

/** Live manifests plus archived ones, without duplicates (the live copy wins). */
function merge(live: Manifest[], archived: Manifest[]) {
  const ids = new Set(live.map((manifest) => manifest.id));
  return [...live, ...archived.filter((manifest) => !ids.has(manifest.id))];
}

/** "▲ 3 p.p." in red when worse, "▼ 3 p.p." in green when better. */
function Change({
  current,
  previous,
  format,
  lowerIsBetter = true,
}: {
  current: number | undefined;
  previous: number | undefined;
  format: (difference: number) => string;
  lowerIsBetter?: boolean;
}) {
  if (current === undefined || previous === undefined) return null;
  const difference = current - previous;
  if (Math.abs(difference) < 1e-9)
    return <span className="metric-change">igual ao período anterior</span>;
  const better = lowerIsBetter ? difference < 0 : difference > 0;
  return (
    <span className="metric-change" data-better={better}>
      {difference > 0 ? "▲" : "▼"} {format(Math.abs(difference))} vs. período anterior
    </span>
  );
}

function GroupTable<T extends GroupMetrics>({
  title,
  label,
  rows,
  name,
  extra,
}: {
  title: string;
  label: string;
  rows: T[];
  name: (row: T) => string;
  extra?: { header: string; cell: (row: T) => ReactNode }[];
}) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, ROWS);
  return (
    <div className="manifest-card metrics-table-wrap" tabIndex={0} role="region" aria-label={title}>
      <table className="document-table metrics-table">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>{label}</th>
            <th>CTCs</th>
            <th>Pendentes</th>
            <th>Fora do prazo</th>
            <th>Valor pendente</th>
            {extra?.map((column) => (
              <th key={column.header}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const enough = row.evaluated >= MIN_CTCS;
            return (
              <tr key={name(row)} data-late={enough && row.outOfTime > 0} data-few={!enough}>
                <td data-label={label}>{name(row)}</td>
                <td data-label="CTCs">{row.ctcs}</td>
                <td data-label="Pendentes">{row.pending}</td>
                <td data-label="Fora do prazo">
                  {row.outOfTime}
                  {enough ? ` · ${formatShare(outOfTimeShare(row))}` : ""}
                </td>
                <td data-label="Valor pendente">
                  {row.pendingValueCents ? formatMoney(row.pendingValueCents) : "—"}
                </td>
                {extra?.map((column) => (
                  <td key={column.header} data-label={column.header}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > ROWS && (
        <button type="button" className="metrics-more" onClick={() => setAll(!all)}>
          {all ? "Mostrar só os 10 primeiros" : `Mostrar todos (${rows.length})`}
        </button>
      )}
    </div>
  );
}

/** Indicators a manager reads at a glance: what comes back late, where, with whom and for which client. */
export function ConferenceMetricsView({
  manifests,
  now,
  onOpenCity,
  loadArchived,
}: {
  manifests: Manifest[];
  now: string;
  onOpenCity?: ((city: string) => void) | undefined;
  loadArchived?: LoadArchivedByDate | undefined;
}) {
  const [kind, setKind] = useState<PeriodKind>("all");
  const period = useMemo(() => metricsPeriod(kind, now || Date.now()), [kind, now]);
  // Archived manifests for both the period and the one it is compared with.
  const span = period.range && {
    from: period.previous?.from ?? period.range.from,
    to: period.range.to,
  };
  const spanKey = span ? `${span.from}|${span.to}` : "";
  const [archive, setArchive] = useState<{
    key: string;
    manifests: Manifest[];
    status: "ok" | "unavailable" | "error";
  }>({ key: "", manifests: [], status: "ok" });
  useEffect(() => {
    if (!loadArchived || !spanKey) return;
    let active = true;
    const [from, to] = spanKey.split("|") as [string, string];
    loadArchived({ from, to })
      .then((found) => {
        if (active)
          setArchive({
            key: spanKey,
            manifests: found ?? [],
            status: found ? "ok" : "unavailable",
          });
      })
      .catch(() => {
        if (active) setArchive({ key: spanKey, manifests: [], status: "error" });
      });
    return () => {
      active = false;
    };
  }, [loadArchived, spanKey]);
  const archived = archive.key === spanKey ? archive.manifests : [];
  const loading = !!loadArchived && !!spanKey && archive.key !== spanKey;
  const all = withKnownCities(merge(manifests, archived));
  const m = conferenceMetrics(inRange(all, period.range), now);
  const before: ConferenceMetrics | undefined = period.previous
    ? conferenceMetrics(inRange(all, period.previous), now)
    : undefined;
  const comparable = !!before && before.evaluated >= MIN_CTCS;
  const [pdfBusy, setPdfBusy] = useState(false);
  async function exportPdf() {
    setPdfBusy(true);
    try {
      const { exportMetricsPdf } = await import("@/lib/metrics-pdf");
      await exportMetricsPdf({ metrics: m, previous: comparable ? before : undefined, period });
    } finally {
      setPdfBusy(false);
    }
  }
  const tiles = [
    {
      label: "Fora do prazo",
      value: formatShare(m.outOfTimeRate),
      caption: (
        <>
          {m.outOfTime} de {m.evaluated} CTCs com {LATE_AFTER_DAYS}+ dias
          {comparable && (
            <Change
              current={m.outOfTimeRate}
              previous={before.outOfTimeRate}
              format={(d) => `${Math.round(d * 100)} p.p.`}
            />
          )}
        </>
      ),
    },
    {
      label: "Tempo até a devolução",
      value: formatDays(m.medianReturnDays),
      caption: (
        <>
          Mediana, da emissão até a conferência
          {comparable && (
            <Change
              current={m.medianReturnDays}
              previous={before.medianReturnDays}
              format={(d) => formatDays(d)}
            />
          )}
        </>
      ),
    },
    {
      label: "Mercadoria com CTC pendente",
      value: formatMoney(m.pendingValueCents),
      caption: m.pendingWithoutValue
        ? `${m.pending} CTCs pendentes · ${m.pendingWithoutValue} sem valor informado`
        : `${m.pending} CTCs pendentes · ${(m.pendingWeightGrams / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} t`,
    },
    {
      label: `Pendentes há ${LATE_AFTER_DAYS}+ dias`,
      value: String(m.late),
      caption: m.perishablePending
        ? `${m.perishablePending} perecível(is) pendente(s) · devolvidos: ${formatShare(m.returnRate)}`
        : `Nenhum perecível pendente · devolvidos: ${formatShare(m.returnRate)}`,
    },
  ];
  return (
    <section className="metrics-view" aria-label="Indicadores">
      <div className="metrics-toolbar">
        <label>
          Período
          <select
            className="filter-select"
            aria-label="Período dos indicadores"
            value={kind}
            onChange={(event) => setKind(event.target.value as PeriodKind)}
          >
            {(Object.keys(periodLabels) as PeriodKind[]).map((option) => (
              <option key={option} value={option}>
                {periodLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <span className="metrics-period">
          {period.range
            ? `Prés emitidos de ${formatRange(period.range)}`
            : "Prés na lista de trabalho"}
          {comparable && period.previous ? ` · comparado com ${formatRange(period.previous)}` : ""}
          {loading && " · carregando arquivo…"}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="text-[11px] ml-auto"
          onClick={() => void exportPdf()}
          disabled={pdfBusy || !m.ctcs}
        >
          {pdfBusy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          {pdfBusy ? "Gerando PDF…" : "PDF gerencial"}
        </Button>
      </div>
      {archive.key === spanKey && archive.status !== "ok" && (
        <p className="metrics-note" role="status">
          {archive.status === "unavailable"
            ? "Os prés arquivados (finalizados há mais de 30 dias) ainda não entram nesta conta: falta aplicar a atualização do banco."
            : "Não foi possível consultar os prés arquivados agora; os números mostram só a lista de trabalho."}
        </p>
      )}
      {!m.ctcs ? (
        <div className="empty-state">
          <h3>Sem dados neste período</h3>
          <p className="text-xs mt-2">
            {manifests.length
              ? "Escolha outro período ou importe a planilha 108 dos dias que faltam."
              : "Importe uma planilha 108 para ver os indicadores da equipe."}
          </p>
        </div>
      ) : (
        <>
          <div className="metric-grid metrics-tiles">
            {tiles.map((tile) => (
              <div className="metric" key={tile.label}>
                <div className="metric-label">{tile.label}</div>
                <div className="metric-value">{tile.value}</div>
                <div className="metric-caption">{tile.caption}</div>
              </div>
            ))}
          </div>
          {!!m.cities.length && <CityMap cities={m.cities} onOpenCity={onOpenCity} />}
          <GroupTable
            title="Por cidade de entrega"
            label="Cidade"
            rows={m.cities}
            name={(row) => row.city}
          />
          <GroupTable
            title="Por cliente (remetente)"
            label="Cliente"
            rows={m.clients}
            name={(row) => row.client}
          />
          <GroupTable
            title="Por motorista"
            label="Motorista"
            rows={m.drivers}
            name={(row) => row.driver}
            extra={[
              {
                header: "Mais antigo",
                cell: (row) => (row.pending ? formatDays(row.oldestDays) : "—"),
              },
              { header: "Devolução (mediana)", cell: (row) => formatDays(row.medianReturnDays) },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Fora do prazo: devolvido ou ainda pendente {LATE_AFTER_DAYS} dias ou mais após a emissão
            do pré. A porcentagem só aparece com {MIN_CTCS} CTCs ou mais.
          </p>
        </>
      )}
    </section>
  );
}

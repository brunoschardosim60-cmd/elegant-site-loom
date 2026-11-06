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
  lateShare,
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
            <th>Atrasados</th>
            <th>Devolução (mediana)</th>
            <th>Valor pendente</th>
            {extra?.map((column) => (
              <th key={column.header}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const enough = row.ctcs >= MIN_CTCS;
            return (
              <tr key={name(row)} data-late={row.late > 0} data-few={!enough}>
                <td data-label={label}>{name(row)}</td>
                <td data-label="CTCs">{row.ctcs}</td>
                <td data-label="Pendentes">{row.pending}</td>
                <td data-label="Atrasados">
                  {row.late}
                  {enough && row.late ? ` · ${formatShare(lateShare(row))}` : ""}
                </td>
                <td data-label="Devolução (mediana)">{formatDays(row.medianReturnDays)}</td>
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
  onOpenLate,
  loadArchived,
  lateDays = LATE_AFTER_DAYS,
}: {
  manifests: Manifest[];
  now: string;
  onOpenCity?: ((city: string) => void) | undefined;
  loadArchived?: LoadArchivedByDate | undefined;
  /** Opens the late pending CTCs, perishable first. */
  onOpenLate?: (() => void) | undefined;
  /** Team deadline in days. */
  lateDays?: number | undefined;
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
  const m = conferenceMetrics(inRange(all, period.range), now, lateDays);
  const before: ConferenceMetrics | undefined = period.previous
    ? conferenceMetrics(inRange(all, period.previous), now, lateDays)
    : undefined;
  const comparable = !!before && before.timedReturns >= MIN_CTCS;
  const [pdfBusy, setPdfBusy] = useState(false);
  async function exportPdf() {
    setPdfBusy(true);
    try {
      const { exportMetricsPdf } = await import("@/lib/metrics-pdf");
      await exportMetricsPdf({
        metrics: m,
        previous: comparable ? before : undefined,
        period,
        lateDays,
      });
    } finally {
      setPdfBusy(false);
    }
  }
  const tiles = [
    {
      label: "CTCs atrasados agora",
      value: String(m.late),
      caption: `${m.late ? `${formatShare(m.lateRate)} dos CTCs · ` : ""}pendentes há ${lateDays}+ dias${
        m.perishablePending ? ` · ${m.perishablePending} perecível(is) pendente(s)` : ""
      }`,
    },
    {
      label: "Mercadoria com CTC pendente",
      // Without any value from the 108, "R$ 0" would read as nothing pending.
      value:
        m.pending && m.pendingWithoutValue === m.pending ? "—" : formatMoney(m.pendingValueCents),
      caption: m.pendingWithoutValue
        ? `${m.pending} CTCs pendentes · ${m.pendingWithoutValue} sem valor informado`
        : `${m.pending} CTCs pendentes`,
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
      label: `Conferidos com ${lateDays}+ dias`,
      value: formatShare(m.returnedLateRate),
      caption: (
        <>
          {m.returnedLate} de {m.timedReturns} conferidos
          {!!m.untimedReturns && (
            <span className="metric-change">
              {m.untimedReturns} sem horário confiável (pré cadastrado com atraso)
            </span>
          )}
          {comparable && (
            <Change
              current={m.returnedLateRate}
              previous={before.returnedLateRate}
              format={(d) => `${Math.round(d * 100)} p.p.`}
            />
          )}
        </>
      ),
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
            {tiles.map((tile, index) => {
              const body = (
                <>
                  <div className="metric-label">{tile.label}</div>
                  <div className="metric-value">{tile.value}</div>
                  <div className="metric-caption">{tile.caption}</div>
                </>
              );
              // The late tile leads to the CTCs behind the number.
              return index === 0 && onOpenLate && m.late ? (
                <button
                  type="button"
                  className="metric metric-link"
                  key={tile.label}
                  onClick={onOpenLate}
                  title="Ver os atrasados, perecíveis primeiro"
                >
                  {body}
                </button>
              ) : (
                <div className="metric" key={tile.label}>
                  {body}
                </div>
              );
            })}
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
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Atrasado: CTC pendente {lateDays} {lateDays === 1 ? "dia" : "dias"} ou mais após a
            emissão do pré; sai da conta assim que é conferido. Devolução: dias entre a emissão e a
            conferência, sem contar prés cadastrados depois do prazo. A porcentagem só aparece com{" "}
            {MIN_CTCS} CTCs ou mais.
          </p>
        </>
      )}
    </section>
  );
}

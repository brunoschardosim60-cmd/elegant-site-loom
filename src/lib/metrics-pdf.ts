import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { cityLevel, placeCities, type CityLevel, type CityShapes } from "./city-map";
import {
  formatDays,
  formatMoney,
  formatShare,
  LATE_AFTER_DAYS,
  MIN_CTCS,
  lateShare,
  type ConferenceMetrics,
  type GroupMetrics,
} from "./conference-metrics";
import { formatRange, type Period } from "./metrics-period";

export type MetricsPdfInput = {
  metrics: ConferenceMetrics;
  /** The period before, when it has enough data to compare. */
  previous?: ConferenceMetrics | undefined;
  period: Period;
  shapes: CityShapes;
  generatedAt?: Date;
};

type Rgb = [number, number, number];
const ink: Rgb = [16, 33, 62];
const blue: Rgb = [1, 69, 167];
const muted: Rgb = [94, 106, 123];
const line: Rgb = [219, 226, 235];
const levelColors: Record<CityLevel | "none", Rgb> = {
  ok: [22, 128, 60],
  attention: [232, 164, 0],
  critical: [200, 30, 30],
  few: [159, 176, 196],
  none: [221, 228, 236],
};
const levelNames: Record<CityLevel, string> = {
  ok: "Nada atrasado",
  attention: "Menos de 20% atrasados",
  critical: "20% ou mais atrasados",
  few: `Poucos dados (menos de ${MIN_CTCS} CTCs)`,
};
const ROWS = 15;

const stamp = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
/** jsPDF's standard fonts have no "—" or "·" in every viewer; keep to plain Latin-1. */
const plain = (value: string) => value.replace(/—/g, "-").replace(/\u202f/g, " ");

/** Change against the previous period, in words that print in any font. */
function change(
  current: number | undefined,
  previous: number | undefined,
  format: (d: number) => string,
) {
  if (current === undefined || previous === undefined) return "";
  const difference = current - previous;
  if (Math.abs(difference) < 1e-9) return "igual ao período anterior";
  return `${difference > 0 ? "subiu" : "caiu"} ${format(Math.abs(difference))} vs. período anterior`;
}

/** Draws the state's municipalities, coloured by level, inside the given box (mm). */
function drawMap(
  pdf: jsPDF,
  shapes: CityShapes,
  levels: Map<string, CityLevel>,
  x: number,
  y: number,
  width: number,
) {
  const scale = width / shapes.width;
  pdf.setDrawColor(255, 255, 255);
  pdf.setLineWidth(0.08);
  // Uncoloured municipalities first, so coloured borders stay on top.
  const ordered = [...shapes.cities].sort(
    (a, b) => Number(levels.has(a.id)) - Number(levels.has(b.id)),
  );
  for (const shape of ordered) {
    const level = levels.get(shape.id);
    pdf.setFillColor(...levelColors[level ?? "none"]);
    for (const ring of shape.d.split("M").filter(Boolean)) {
      const numbers =
        ring
          .replace(/Z/g, "")
          .match(/-?[\d.]+/g)
          ?.map(Number) ?? [];
      if (numbers.length < 6) continue;
      const ops: { op: string; c: number[] }[] = [];
      for (let i = 0; i < numbers.length; i += 2)
        ops.push({
          op: i ? "l" : "m",
          c: [x + numbers[i]! * scale, y + numbers[i + 1]! * scale],
        });
      ops.push({ op: "h", c: [] });
      pdf.path(ops).fillStroke();
    }
  }
}

/** One A4 report: headline indicators, the map and the worst cities, clients and drivers. */
export function createMetricsPdf(input: MetricsPdfInput) {
  const { metrics: m, previous, period } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  pdf.setProperties({
    title: "confere. - Relatório gerencial",
    subject: "Indicadores de devolução de CTCs",
    author: "confere.",
    creator: "confere.",
  });
  const width = pdf.internal.pageSize.getWidth();
  const margin = 12;
  const available = width - margin * 2;
  const text = (
    value: string,
    x: number,
    y: number,
    size = 9,
    bold = false,
    color: Rgb = ink,
    align: "left" | "right" = "left",
  ) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    pdf.text(plain(value), x, y, { align });
  };

  text("confere.", margin, 15, 18, true, blue);
  text("Relatório gerencial", margin + 34, 15, 12, true);
  text(`Emitido em ${stamp(generatedAt)} · Brasília`, width - margin, 15, 8, false, muted, "right");
  pdf.setFillColor(...blue);
  pdf.rect(margin, 19, available, 0.5, "F");
  text(
    period.range
      ? `${period.label}: prés emitidos de ${formatRange(period.range)}${previous && period.previous ? ` · comparado com ${formatRange(period.previous)}` : ""}`
      : `${period.label}: prés em aberto e finalizados nos últimos 30 dias`,
    margin,
    26,
    9,
    false,
    muted,
  );

  const tiles: [string, string, string][] = [
    [
      "CTCS ATRASADOS AGORA",
      String(m.late),
      `${m.late ? `${formatShare(m.lateRate)} dos CTCs, ` : ""}pendentes há ${LATE_AFTER_DAYS}+ dias`,
    ],
    [
      "MERCADORIA COM CTC PENDENTE",
      formatMoney(m.pendingValueCents),
      `${m.pending} CTCs pendentes`,
    ],
    [
      "TEMPO ATÉ A DEVOLUÇÃO",
      formatDays(m.medianReturnDays),
      `Mediana. ${change(m.medianReturnDays, previous?.medianReturnDays, formatDays)}`,
    ],
    [
      `CONFERIDOS COM ${LATE_AFTER_DAYS}+ DIAS`,
      formatShare(m.returnedLateRate),
      `${m.returnedLate} de ${m.timedReturns}. ${change(m.returnedLateRate, previous?.returnedLateRate, (d) => `${Math.round(d * 100)} p.p.`)}`,
    ],
  ];
  const tileWidth = (available - 3 * 4) / 4;
  tiles.forEach(([label, value, caption], index) => {
    const x = margin + index * (tileWidth + 4);
    pdf.setDrawColor(...line);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(x, 31, tileWidth, 27, 1.5, 1.5, "S");
    text(label, x + 3, 37, 6.5, true, muted);
    text(value, x + 3, 46, 15, true);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(...muted);
    pdf.text(pdf.splitTextToSize(plain(caption.trim()), tileWidth - 6) as string[], x + 3, 51);
  });

  // Map on the left, legend and worst cities on the right.
  const top = 66;
  text("Cidades de entrega no Rio Grande do Sul", margin, top, 10, true);
  const { placed, unplaced } = placeCities(input.shapes, m.cities);
  const levels = new Map([...placed].map(([id, city]) => [id, cityLevel(city)]));
  const mapWidth = 108;
  drawMap(pdf, input.shapes, levels, margin, top + 4, mapWidth);
  const side = margin + mapWidth + 6;
  let cursor = top + 8;
  const counts = { ok: 0, attention: 0, critical: 0, few: 0 } as Record<CityLevel, number>;
  for (const level of levels.values()) counts[level]++;
  for (const level of Object.keys(levelNames) as CityLevel[]) {
    pdf.setFillColor(...levelColors[level]);
    pdf.rect(side, cursor - 2.6, 3, 3, "F");
    text(`${levelNames[level]}: ${counts[level]}`, side + 5, cursor, 8);
    cursor += 5.5;
  }
  cursor += 3;
  text("Mais atrasadas", side, cursor, 9, true);
  cursor += 5;
  const worst = m.cities.filter((city) => city.ctcs >= MIN_CTCS && city.late).slice(0, 8);
  if (!worst.length) text("Nenhuma cidade com CTCs atrasados.", side, cursor, 8, false, muted);
  for (const city of worst) {
    text(city.city, side, cursor, 8);
    text(
      `${formatShare(lateShare(city))} · ${city.late}/${city.ctcs}`,
      width - margin,
      cursor,
      8,
      true,
      ink,
      "right",
    );
    cursor += 5;
  }
  if (unplaced.length) {
    cursor += 2;
    pdf.setFontSize(7);
    pdf.setTextColor(...muted);
    pdf.text(
      pdf.splitTextToSize(
        plain(`Fora do RS: ${unplaced.map((city) => city.city).join(", ")}`),
        width - margin - side,
      ) as string[],
      side,
      cursor,
    );
  }
  const mapHeight = (input.shapes.height / input.shapes.width) * mapWidth;

  const table = <T extends GroupMetrics>(
    title: string,
    label: string,
    rows: T[],
    name: (row: T) => string,
    startY: number,
  ) => {
    if (!rows.length) return startY;
    // Keep a title with at least a few rows of its table.
    if (startY > pdf.internal.pageSize.getHeight() - 45) {
      pdf.addPage();
      startY = 18;
    }
    text(
      `${title}${rows.length > ROWS ? ` (${ROWS} de ${rows.length})` : ""}`,
      margin,
      startY,
      10,
      true,
    );
    autoTable(pdf, {
      startY: startY + 2,
      margin: { left: margin, right: margin, top: 14, bottom: 14 },
      head: [[label, "CTCs", "Pendentes", "Atrasados", "%", "Devolução", "Valor pendente"]],
      body: rows
        .slice(0, ROWS)
        .map((row) => [
          plain(name(row)),
          String(row.ctcs),
          String(row.pending),
          String(row.late),
          row.ctcs < MIN_CTCS ? "poucos dados" : row.late ? formatShare(lateShare(row)) : "-",
          plain(formatDays(row.medianReturnDays)),
          row.pendingValueCents ? formatMoney(row.pendingValueCents) : "-",
        ]),
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 1.8,
        textColor: ink,
        lineColor: line,
        lineWidth: 0.1,
      },
      headStyles: { fillColor: blue, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 248, 250] },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
      rowPageBreak: "avoid",
    });
    return (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  };
  let y = Math.max(top + 4 + mapHeight, cursor) + 8;
  y = table("Por cidade de entrega", "Cidade", m.cities, (row) => row.city, y);
  y = table("Por cliente (remetente)", "Cliente", m.clients, (row) => row.client, y);
  y = table("Por motorista", "Motorista", m.drivers, (row) => row.driver, y);

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    const height = pdf.internal.pageSize.getHeight();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(...muted);
    pdf.text(
      pdf.splitTextToSize(
        plain(
          `Atrasado: CTC pendente ${LATE_AFTER_DAYS} dias ou mais após a emissão do pré. Devolução: dias entre a emissão e a conferência (mediana). Porcentagens só com ${MIN_CTCS} ou mais CTCs. Dados da planilha 108.`,
        ),
        available - 20,
      ) as string[],
      margin,
      height - 9,
    );
    pdf.text(`${page}/${pages}`, width - margin, height - 9, { align: "right" });
  }
  return pdf;
}

/** Builds and downloads the report; the map outlines load only now. */
export async function exportMetricsPdf(input: Omit<MetricsPdfInput, "shapes">) {
  const { default: shapes } = await import("./maps/rs-municipios.json");
  const generatedAt = input.generatedAt ?? new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(generatedAt);
  createMetricsPdf({ ...input, shapes: shapes as CityShapes, generatedAt }).save(
    `confere-relatorio-gerencial-${day}.pdf`,
  );
}

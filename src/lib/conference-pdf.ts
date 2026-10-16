import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { activityTimestamp, matchesConferenceSearch } from "./conference-display";
import type { Manifest } from "./conference";
import { isPendingDocument, presentRoutes } from "./conference-routes";
import {
  compareManifestDates,
  formatManifestDate,
  manifestAgeDays,
  manifestAgeLabel,
  normalizeIssueDate,
  normalizeIssueTime,
} from "./manifest-date";
import { selectTrackingRows, type TrackingStatus } from "./ctc-tracking";
import { belongsTo, type DemandOwner } from "./conference-ownership";

type ReportIssue = { title: string; description: string; time: string; at?: string | undefined };
type ReportView = "pending" | "missing" | "finished" | "issues" | "tracking";
export type ConferencePdfInput = {
  manifests: Manifest[];
  issues: ReportIssue[];
  view: ReportView;
  query?: string;
  filter?: string;
  trackingStatus?: TrackingStatus;
  generatedAt?: Date;
  owner?: DemandOwner | undefined;
};
const labels: Record<ReportView, string> = {
  pending: "Manifestos em aberto",
  missing: "CTCs pendentes",
  finished: "Manifestos finalizados",
  issues: "Ocorrências da conferência",
  tracking: "Rastreamento de CTCs",
};
const ink: [number, number, number] = [23, 43, 64];
const blue: [number, number, number] = [0, 73, 124];
const muted: [number, number, number] = [92, 107, 120];
const line: [number, number, number] = [217, 226, 232];
const clean = (value: string | undefined) =>
  (value ?? "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim();
const field = (value: string | undefined) => clean(value) || "-";
const date = (value: string | Date | undefined, withTime = false) => {
  if (!withTime && typeof value === "string" && normalizeIssueDate(value))
    return formatManifestDate(value);
  const parsed = value instanceof Date ? value : new Date(value ?? "");
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(parsed);
};

/** Export the same scope as the active view, including its search and age filter. */
export function selectConferenceReport(input: ConferencePdfInput) {
  const query = input.query ?? "";
  const now = (input.generatedAt ?? new Date()).getTime();
  if (input.view === "tracking") {
    const groups = new Map<string, Manifest>();
    for (const { manifest, doc } of selectTrackingRows(input.manifests, {
      query: input.query ?? "",
      filter: input.filter ?? "all",
      status: input.trackingStatus ?? "all",
      now,
    })) {
      if (input.owner && !belongsTo(manifest, input.owner)) continue;
      const group = groups.get(manifest.id) ?? { ...manifest, documents: [] };
      group.documents.push(doc);
      groups.set(manifest.id, group);
    }
    return { manifests: [...groups.values()], issues: [] };
  }
  const manifests =
    input.view === "issues"
      ? []
      : presentRoutes(input.manifests)
          .filter((manifest) => !input.owner || belongsTo(manifest, input.owner))
          .filter((manifest) =>
            input.view === "finished"
              ? Boolean(manifest.finishedAt || manifest.routeResolved)
              : !manifest.finishedAt && !manifest.routeResolved,
          )
          .filter((manifest) => input.filter !== "old" || manifestAgeDays(manifest, now) >= 2)
          .flatMap((manifest) => {
            if (input.view === "missing") {
              const documents = manifest.documents.filter(
                (doc) => isPendingDocument(doc) && matchesConferenceSearch(manifest, query, doc),
              );
              return documents.length ? [{ ...manifest, documents }] : [];
            }
            return matchesConferenceSearch(manifest, query) ? [manifest] : [];
          })
          .sort((a, b) =>
            input.filter === "new" ? compareManifestDates(b, a) : compareManifestDates(a, b),
          );
  return { manifests, issues: input.view === "issues" ? input.issues : [] };
}

/** Vector PDF: readable when printed, with repeated table headers on long prés. */
export function createConferencePdf(input: ConferencePdfInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const selected = selectConferenceReport({ ...input, generatedAt });
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  pdf.setProperties({
    title: `confere. - ${labels[input.view]}`,
    subject: "Conferência de CTCs e pré-manifestos",
    author: "confere.",
    creator: "confere.",
  });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const available = width - margin * 2;
  const continuationTop = 10;
  let cursor = 27;
  const text = (value: string, x: number, y: number, size = 9, bold = false, color = ink) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    pdf.text(clean(value), x, y);
  };
  // Report branding and generation metadata belong only on the first page.
  // Continuations reserve space only for the current driver/manifest and columns.
  const drawFirstHeader = () => {
    text("confere.", margin, 13, 15, true, blue);
    text(labels[input.view], margin + 30, 13, 11, true);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...muted);
    pdf.text(`Emitido em ${date(generatedAt, true)} · Brasília`, width - margin, 13, {
      align: "right",
    });
    pdf.setFillColor(...blue);
    pdf.rect(margin, 20, available, 0.5, "F");
  };
  const newPage = () => {
    pdf.addPage();
    cursor = continuationTop;
  };
  const reserve = (space: number) => {
    if (cursor + space > height - 14) newPage();
  };
  drawFirstHeader();
  const documents = selected.manifests.flatMap((manifest) => manifest.documents);
  const metrics =
    input.view === "issues"
      ? [["OCORRÊNCIAS", String(selected.issues.length)]]
      : [
          ["MANIFESTOS", String(selected.manifests.length)],
          ["CTCs ÚNICOS", String(new Set(documents.map((doc) => doc.ctc)).size)],
          ["PENDENTES", String(documents.filter(isPendingDocument).length)],
          [
            "CONFERIDOS ATUAIS",
            String(documents.filter((doc) => doc.received && !doc.reroutedTo).length),
          ],
          ["REMANIFESTADOS", String(documents.filter((doc) => doc.reroutedTo).length)],
          [
            "VOLS. PENDENTES",
            String(documents.filter(isPendingDocument).reduce((sum, doc) => sum + doc.volumes, 0)),
          ],
        ];
  const cardWidth = (available - 4 * (metrics.length - 1)) / metrics.length;
  metrics.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + 4);
    pdf.setFillColor(242, 246, 249);
    pdf.roundedRect(x, cursor - 2, cardWidth, 12, 1.5, 1.5, "F");
    text(label!, x + 3, cursor + 2, 6.8, true, muted);
    text(value!, x + 3, cursor + 8, 11.5, true, blue);
  });
  cursor += 14;
  if (input.view !== "issues") {
    const nfs = documents.reduce(
      (sum, doc) => sum + doc.nf.split(/[,;]/).filter((nf) => /^\d/.test(nf.trim())).length,
      0,
    );
    text(
      `${documents.length} registros de rota · ${nfs} NFs por rota. Remanifestados mantêm o histórico e não somam pendências.`,
      margin,
      cursor,
      7.5,
      false,
      muted,
    );
    cursor += 5;
    text(
      "Emissão não define a agenda: a previsão de entrega vem da planilha. Tempo desde emissão não significa atraso.",
      margin,
      cursor,
      7.5,
      false,
      muted,
    );
    cursor += 6;
  }
  const filters = [
    input.owner ? `Cadastros de: ${clean(input.owner.email)}` : "",
    input.view !== "issues" && clean(input.query) ? `Busca: ${clean(input.query)}` : "",
    input.view !== "issues" && input.filter === "old"
      ? "Há 2 dias ou mais pela emissão; sem emissão, pelo cadastro"
      : "",
    input.view === "tracking" && input.trackingStatus && input.trackingStatus !== "all"
      ? `Status: ${input.trackingStatus === "received" ? "Conferidos" : input.trackingStatus === "rerouted" ? "Remanifestados" : "Pendentes"}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
  if (filters) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const lines = pdf.splitTextToSize(filters, available);
    text(lines.join("\n"), margin, cursor, 8, false, muted);
    cursor += lines.length * 4 + 5;
  }

  if (input.view === "issues") {
    if (selected.issues.length) {
      autoTable(pdf, {
        startY: cursor,
        margin: { left: margin, right: margin, top: continuationTop, bottom: 14 },
        head: [["Data / hora", "Ocorrência", "Detalhe"]],
        body: selected.issues.map((issue) => [
          field(activityTimestamp(issue)),
          field(issue.title),
          field(issue.description),
        ]),
        styles: {
          font: "helvetica",
          fontSize: 9,
          cellPadding: 3,
          textColor: ink,
          overflow: "linebreak",
          lineColor: line,
          lineWidth: 0.1,
        },
        headStyles: { fillColor: blue, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 248, 250] },
        columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 65 } },
        rowPageBreak: "avoid",
      });
    } else text("Nenhuma ocorrência registrada.", margin, cursor + 8, 11, false, muted);
  } else if (!selected.manifests.length) {
    text("Nenhum manifesto encontrado nesta seleção.", margin, cursor + 8, 11, false, muted);
  } else {
    const groups = new Map<string, Manifest[]>();
    for (const manifest of selected.manifests) {
      const key =
        clean(manifest.driver).replace(/\s+/g, " ").toLocaleUpperCase("pt-BR") ||
        "MOTORISTA NÃO INFORMADO";
      groups.set(key, [...(groups.get(key) ?? []), manifest]);
    }
    for (const [driver, manifests] of groups) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      const driverLines = pdf.splitTextToSize(driver, available) as string[];
      const driverHeight = driverLines.length * 4.5 + 2;
      const drawDriver = () => {
        text(driverLines.join("\n"), margin, cursor, 10, true, blue);
        cursor += driverHeight;
      };
      reserve(driverHeight + 36);
      drawDriver();
      for (const manifest of manifests) {
        const issueDate = normalizeIssueDate(manifest.issueDate ?? "");
        const issueTime = normalizeIssueTime(manifest.issueTime ?? "");
        const timing = [
          `Placa ${field(manifest.plate)}`,
          issueDate
            ? `Emissão ${formatManifestDate(issueDate)}${issueTime ? ` às ${issueTime}` : ""}`
            : `Cadastro ${date(manifest.date)}`,
          !manifest.finishedAt && !manifest.routeResolved
            ? manifestAgeLabel(manifest, generatedAt)
            : "",
        ]
          .filter(Boolean)
          .join(" | ");
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        const timingLines = pdf.splitTextToSize(timing, available * 0.64) as string[];
        const headerHeight = 8 + timingLines.length * 3.3;
        const pending = manifest.documents.filter(isPendingDocument).length;
        const remanifested = manifest.documents.filter((doc) => doc.reroutedTo).length;
        const header = (continuation = false) => {
          pdf.setFillColor(233, 240, 245);
          pdf.roundedRect(margin, cursor - 1, available, headerHeight, 1.5, 1.5, "F");
          text(
            `${field(manifest.id)}${continuation ? " (continuação)" : ""}`,
            margin + 2,
            cursor + 3,
            9,
            true,
          );
          text(timingLines.join("\n"), margin + 2, cursor + 7.5, 7.5, false, muted);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8);
          pdf.setTextColor(...blue);
          pdf.text(
            `${manifest.documents.length} CTCs | ${manifest.documents.reduce((sum, doc) => sum + doc.volumes, 0)} vol. | ${pending} pend.${remanifested ? ` | ${remanifested} remanif.` : ""}`,
            width - margin - 2,
            cursor + 3,
            { align: "right" },
          );
          if (manifest.finishedAt) {
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8);
            pdf.setTextColor(...muted);
            pdf.text(
              `Finalizado em ${date(manifest.finishedAt, true)}`,
              width - margin - 3,
              cursor + 7.5,
              { align: "right" },
            );
          }
        };
        if (cursor + headerHeight + 17 > height - 14) {
          newPage();
          drawDriver();
        }
        header();
        cursor += headerHeight + 2;
        const tableStartPage = pdf.getCurrentPageInfo().pageNumber;
        const hasDelivery = manifest.documents.some((doc) => doc.deliveryDates?.length);
        const statusIndex = hasDelivery ? 6 : 5;
        autoTable(pdf, {
          startY: cursor,
          margin: {
            left: margin,
            right: margin,
            top: continuationTop + driverHeight + headerHeight + 2,
            bottom: 14,
          },
          head: [
            [
              "CTC",
              "NF / série",
              "Vols.",
              "Cliente / laboratório",
              "Destinatário",
              ...(hasDelivery ? ["Prev. entrega"] : []),
              "Situação",
            ],
          ],
          body: manifest.documents.map((doc) => [
            field(doc.ctc),
            field(doc.nf),
            String(doc.volumes),
            field(doc.client),
            field(doc.recipient),
            ...(hasDelivery
              ? [doc.deliveryDates?.map((day) => formatManifestDate(day)).join("\n") || "-"]
              : []),
            (() => {
              const status = doc.received
                ? `Conferido${doc.receivedAt ? `\n${date(doc.receivedAt, true)}` : ""}`
                : doc.reroutedTo
                  ? "Remanifestado"
                  : "Pendente";
              if (!doc.reroutedTo) return status;
              const target = input.manifests.find((item) => item.id === doc.reroutedTo);
              return `${status}\nNova rota ${doc.reroutedTo}${target?.issueDate ? ` · ${formatManifestDate(target.issueDate)}` : ""}${target && target.driver.trim().toUpperCase() !== manifest.driver.trim().toUpperCase() ? `\nMotorista: ${target.driver}` : ""}`;
            })(),
          ]),
          styles: {
            font: "helvetica",
            fontSize: 8.5,
            cellPadding: 1.5,
            textColor: ink,
            valign: "middle",
            overflow: "linebreak",
            lineColor: line,
            lineWidth: 0.1,
          },
          headStyles: {
            fillColor: blue,
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 8,
          },
          alternateRowStyles: { fillColor: [245, 248, 250] },
          columnStyles: {
            0: { cellWidth: 26, fontStyle: "bold" },
            1: { cellWidth: 26 },
            2: { cellWidth: 12, halign: "center" },
            3: { cellWidth: 61 },
            4: { cellWidth: available - 166 - (hasDelivery ? 24 : 0) },
            ...(hasDelivery ? { 5: { cellWidth: 24 } } : {}),
            [statusIndex]: { cellWidth: 41 },
          },
          rowPageBreak: "avoid",
          showHead: "everyPage",
          willDrawPage: () => {
            if (pdf.getCurrentPageInfo().pageNumber > tableStartPage) {
              cursor = continuationTop;
              drawDriver();
              header(true);
            }
          },
          didParseCell: (data) => {
            if (data.section === "body" && manifest.documents[data.row.index]?.reroutedTo)
              data.cell.styles.fillColor = [235, 243, 250];
            if (data.section === "body" && data.column.index === statusIndex)
              data.cell.styles.textColor = manifest.documents[data.row.index]?.received
                ? [22, 105, 77]
                : manifest.documents[data.row.index]?.reroutedTo
                  ? blue
                  : [146, 91, 17];
          },
        });
        cursor = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
      }
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setDrawColor(...line);
    pdf.line(margin, height - 10, width - margin, height - 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...muted);
    pdf.text(`${page} / ${pages}`, width - margin, height - 6, { align: "right" });
  }
  return pdf;
}

export async function exportConferencePdf(input: ConferencePdfInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const filename = `confere-${input.view === "pending" ? "abertos" : input.view === "missing" ? "pendencias" : input.view === "finished" ? "finalizados" : input.view === "tracking" ? "rastreamento" : "ocorrencias"}-${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(generatedAt)}.pdf`;
  createConferencePdf({ ...input, generatedAt }).save(filename);
}

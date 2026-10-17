import type { NfOccurrence } from "@/lib/conference";

export function NfOccurrences({
  nf,
  values,
  prefix = false,
}: {
  nf: string;
  values?: NfOccurrence[] | undefined;
  prefix?: boolean;
}) {
  const invoices = [
    ...new Set(
      nf
        .split(/[,;]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const occurrences = new Map(
    values
      ?.filter((value) => value.code.trim() || value.description.trim())
      .map((value) => [value.nf, value]),
  );
  const hasOccurrences = invoices.some((invoice) => occurrences.has(invoice));
  if (!invoices.length)
    return (
      <>
        {prefix && "NF "}
        {nf || "não informada"}
      </>
    );
  return (
    <div className="nf-occurrences">
      <ul>
        {invoices.map((invoice) => {
          const item = occurrences.get(invoice);
          return (
            <li key={invoice}>
              <span className="nf-occurrence-invoice">
                {(prefix || hasOccurrences) && "NF "}
                {invoice}
              </span>
              {item ? (
                <>
                  {" · "}
                  {item.code && <strong>{item.code}</strong>}
                  {item.code && item.description && " — "}
                  {item.description || "Descrição não informada"}
                </>
              ) : (
                <>
                  {" "}
                  <span className="nf-occurrence-empty">Sem ocorrência</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

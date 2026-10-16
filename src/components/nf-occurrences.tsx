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
  const occurrences = new Map(values?.map((value) => [value.nf, value]));
  if (!invoices.some((invoice) => occurrences.has(invoice)))
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
              <span className="nf-occurrence-invoice">NF {invoice}</span>
              {item && (
                <>
                  {" · "}
                  {item.code && <strong>{item.code}</strong>}
                  {item.code && item.description && " — "}
                  {item.description || "Descrição não informada"}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

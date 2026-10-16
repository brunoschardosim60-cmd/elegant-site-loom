import type { NfOccurrence } from "@/lib/conference";

export function NfOccurrences({ values }: { values?: NfOccurrence[] | undefined }) {
  if (!values?.length) return null;
  return (
    <div className="nf-occurrences">
      <span className="nf-occurrences-label">Última ocorrência · Luft</span>
      <ul>
        {values.map((item) => (
          <li key={item.nf}>
            <span className="nf-occurrence-invoice">NF {item.nf}</span>
            {" · "}
            {item.code && <strong>{item.code}</strong>}
            {item.code && item.description && " — "}
            {item.description || "Descrição não informada"}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { Snowflake } from "lucide-react";
import type { DocumentItem } from "@/lib/conference";
import { isPerishable } from "@/lib/conference-metrics";

/** Marks a perishable CTC wherever it is listed, so it is returned first. */
export function CargoTags({ doc }: { doc: Pick<DocumentItem, "nature" | "city"> }) {
  if (!isPerishable(doc)) return null;
  return (
    <span className="cargo-tag cargo-tag-perishable" title={doc.nature}>
      <Snowflake aria-hidden="true" size={10} />
      Perecível
    </span>
  );
}

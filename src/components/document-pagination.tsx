import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import type { RefObject } from "react";

export const documentPageSize = 50;

export function DocumentPagination({
  total,
  page,
  onPageChange,
  label,
  targetRef,
}: {
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  label: string;
  targetRef?: RefObject<HTMLDivElement | null>;
}) {
  if (total <= documentPageSize) return null;
  const pages = Math.ceil(total / documentPageSize);
  function navigate(next: number) {
    onPageChange(next);
    // An explicit page change returns to the new rows, not the top of the site.
    // Receipts and background synchronization never trigger this navigation.
    if (targetRef)
      requestAnimationFrame(() => {
        targetRef.current?.focus({ preventScroll: true });
        targetRef.current?.scrollIntoView?.({ block: "start" });
      });
  }
  return (
    <nav className="tracking-pagination" aria-label={label}>
      <span role="status" aria-live="polite">
        {page * documentPageSize + 1}–{Math.min((page + 1) * documentPageSize, total)} de {total}{" "}
        CTCs
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page === 0}
        onClick={() => navigate(page - 1)}
      >
        <ChevronLeft size={14} /> Anterior
      </Button>
      <span>
        Página {page + 1} de {pages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page + 1 >= pages}
        onClick={() => navigate(page + 1)}
      >
        Próxima <ChevronRight size={14} />
      </Button>
    </nav>
  );
}

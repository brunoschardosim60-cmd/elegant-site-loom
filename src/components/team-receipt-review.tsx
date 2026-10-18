import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { conferenceTimestamp } from "@/lib/conference-display";
import type { TeamReceiptCandidate } from "@/lib/team-receipt-review";

export function TeamReceiptReview({
  available,
  review,
  updated = false,
  onOpen,
  onClose,
  onAccept,
}: {
  available: TeamReceiptCandidate[];
  review: TeamReceiptCandidate[] | null;
  updated?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAccept: () => void;
}) {
  const groups = new Map<string, TeamReceiptCandidate[]>();
  for (const item of review ?? []) {
    const group = groups.get(item.manifestId) ?? [];
    group.push(item);
    groups.set(item.manifestId, group);
  }
  return (
    <>
      {!!available.length && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 max-w-full text-xs text-muted-foreground hover:text-primary"
          onClick={onOpen}
        >
          Conferências da equipe ({available.length})
        </Button>
      )}
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-4 overflow-hidden rounded-lg p-5 sm:p-6 data-[state=closed]:hidden">
          <DialogHeader className="shrink-0 text-left">
            <DialogTitle>Conferências disponíveis da equipe</DialogTitle>
            <DialogDescription>
              A equipe já conferiu {review?.length ?? 0} {review?.length === 1 ? "CTC" : "CTCs"} de{" "}
              {groups.size} {groups.size === 1 ? "manifesto seu" : "manifestos seus"}. Você pode
              aceitar estas conferências ou continuar manualmente. Esta lista inclui todos os dias,
              sem aplicar os filtros da tela.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            {updated && (
              <p
                role="alert"
                className="mb-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
              >
                As conferências mudaram. Nenhum CTC foi alterado. Confira a lista atualizada antes
                de aceitar.
              </p>
            )}
            {!review?.length && (
              <p className="text-sm text-muted-foreground">
                Não há mais conferências disponíveis. Nenhum CTC foi alterado.
              </p>
            )}
            <div className="space-y-3">
              {[...groups].map(([id, items]) => {
                const sources = [
                  ...new Set(items.map((item) => item.source.email || "Integrante da equipe")),
                ];
                return (
                  <details key={id} className="rounded-md border p-3" open={groups.size === 1}>
                    <summary className="cursor-pointer text-sm leading-relaxed break-words">
                      <strong>Manifesto {id}</strong> · {items[0]?.driver}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {items.length} {items.length === 1 ? "CTC" : "CTCs"} · Conferido por{" "}
                        {sources.join(", ")}
                      </span>
                    </summary>
                    <ul className="mt-3 space-y-3 border-t pt-3">
                      {items.map((item) => (
                        <li key={item.documentId} className="text-sm break-words">
                          <span className="font-mono font-medium">CTC {item.ctc}</span>
                          <span className="block text-xs text-muted-foreground">
                            NF {item.nf} · {item.volumes}{" "}
                            {item.volumes === 1 ? "volume" : "volumes"}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {item.source.email || "Integrante da equipe"} ·{" "}
                            {conferenceTimestamp(item.source.receivedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Conferir manualmente
            </Button>
            <Button type="button" disabled={!review?.length} onClick={onAccept}>
              Aceitar todas ({review?.length ?? 0})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

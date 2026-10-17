import { isExportManifest } from "@/lib/manifest-id";
import { useRef } from "react";
import { Trash2 } from "lucide-react";
import type { Manifest } from "@/lib/conference";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export function ManifestDeleteDialog({
  manifest,
  onCancel,
  onConfirm,
}: {
  manifest: Manifest | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const exported = !!manifest && isExportManifest(manifest.id);
  const documents = manifest?.documents ?? [];
  const volumes = documents.reduce((sum, document) => sum + document.volumes, 0);
  const received = documents.filter((document) => document.received).length;
  return (
    <AlertDialog
      open={!!manifest}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        className="w-[calc(100vw_-_2rem)] max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-lg p-5 sm:p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <div className="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:mx-0">
            <Trash2 size={20} aria-hidden="true" />
          </div>
          <AlertDialogTitle>
            {exported ? "Excluir manifesto?" : "Excluir pré-manifesto?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            O {exported ? "manifesto" : "pré"} e todos os seus CTCs serão removidos de toda a
            equipe, inclusive dos outros logins que os acompanham. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {manifest && (
          <div className="min-w-0 rounded-lg border bg-muted/30 p-4">
            <dl className="grid min-w-0 gap-3 text-sm">
              <div className="grid min-w-0 gap-1">
                <dt className="text-xs text-muted-foreground">
                  {exported ? "Manifesto" : "Pré-manifesto"}
                </dt>
                <dd className="break-all font-mono font-semibold">{manifest.id}</dd>
              </div>
              <div className="grid min-w-0 gap-1">
                <dt className="text-xs text-muted-foreground">Motorista</dt>
                <dd className="break-words font-medium">{manifest.driver}</dd>
              </div>
              <div className="grid min-w-0 gap-1">
                <dt className="text-xs text-muted-foreground">Placa</dt>
                <dd className="break-all font-mono">{manifest.plate}</dd>
              </div>
            </dl>
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
              <div className="min-w-0">
                <dt className="break-words text-xs text-muted-foreground">CTCs</dt>
                <dd className="mt-1 break-all text-lg font-semibold">{documents.length}</dd>
              </div>
              <div className="min-w-0">
                <dt className="break-words text-xs text-muted-foreground">Volumes</dt>
                <dd className="mt-1 break-all text-lg font-semibold">{volumes}</dd>
              </div>
              <div className="min-w-0">
                <dt className="break-words text-xs text-muted-foreground">Conferidos</dt>
                <dd className="mt-1 break-all text-lg font-semibold">{received}</dd>
              </div>
            </dl>
          </div>
        )}
        <AlertDialogFooter className="gap-2 sm:gap-0 [&_button]:h-auto [&_button]:min-h-9 [&_button]:whitespace-normal">
          <AlertDialogCancel ref={cancel} type="button" className="mt-0">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            className={buttonVariants({ variant: "destructive" })}
            onClick={(event) => {
              event.preventDefault();
              if (manifest) onConfirm(manifest.id);
            }}
          >
            {exported ? "Excluir manifesto" : "Excluir pré-manifesto"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

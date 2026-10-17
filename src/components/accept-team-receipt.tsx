import { CheckCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { DocumentItem } from "@/lib/conference";
import { conferenceTimestamp } from "@/lib/conference-display";

export function AcceptTeamReceipt({ doc, onAccept }: { doc: DocumentItem; onAccept: () => void }) {
  if (doc.received || doc.reroutedTo || !doc.peerReceipt) return null;
  const name = doc.peerReceipt.email?.split("@")[0] || "Outro membro da equipe";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="team-receipt-accept ml-1 h-8 w-8 align-middle text-primary/70 hover:text-primary"
          aria-label={`Aceitar conferência da equipe para CTC ${doc.ctc}`}
          title={`Conferido por ${name}. Aceitar na minha conta.`}
          onClick={onAccept}
        >
          <CheckCheck size={16} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {name} já conferiu
        {doc.peerReceipt.receivedAt ? ` em ${conferenceTimestamp(doc.peerReceipt.receivedAt)}` : ""}
        . Aceitar na minha conta.
      </TooltipContent>
    </Tooltip>
  );
}

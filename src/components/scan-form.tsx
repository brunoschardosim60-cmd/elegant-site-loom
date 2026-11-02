import { useState, type RefObject } from "react";
import { ArrowRight, Barcode } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The scanner field keeps what is being typed to itself, so each keystroke
 * re-renders only this form instead of every driver list and table.
 */
export function ScanForm({
  inputRef,
  disabled,
  clearSignal,
  onScan,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  /** Changing this value empties the field (scope change, deleted pre). */
  clearSignal: number;
  /** Returns true when the code was consumed and the field should empty. */
  onScan: (code: string) => boolean;
}) {
  const [code, setCode] = useState("");
  const [clearedAt, setClearedAt] = useState(clearSignal);
  if (clearedAt !== clearSignal) {
    setClearedAt(clearSignal);
    setCode("");
  }
  return (
    <form
      className="scan-form"
      onSubmit={(event) => {
        event.preventDefault();
        const value = code.trim();
        if (value && !disabled && onScan(value)) setCode("");
      }}
    >
      <Barcode />
      <input
        ref={inputRef}
        aria-label="Código do CTC"
        className="scan-input"
        placeholder="Bipe ou digite o código do CTC…"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        disabled={disabled}
      />
      <Button type="submit" size="sm" disabled={!code.trim() || disabled}>
        Conferir <ArrowRight size={13} />
      </Button>
    </form>
  );
}

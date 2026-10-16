import { conferenceTimestamp } from "@/lib/conference-display";

export function ActionActor({
  email,
  at,
  label,
}: {
  email?: string | undefined;
  at?: string | undefined;
  label: string;
}) {
  if (!email) return null;
  const timestamp = conferenceTimestamp(at);
  return (
    <span className="action-actor">
      {label} <strong>{email}</strong>
      {timestamp && (
        <>
          {" "}
          · <time dateTime={at}>{timestamp}</time>
        </>
      )}
    </span>
  );
}

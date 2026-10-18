import { conferenceTimestamp } from "@/lib/conference-display";

export function ActionActor({
  email,
  at,
  label,
  hideAuthor = false,
}: {
  email?: string | undefined;
  at?: string | undefined;
  label: string;
  hideAuthor?: boolean;
}) {
  const timestamp = conferenceTimestamp(at);
  if (hideAuthor)
    return timestamp ? (
      <time className="action-actor" dateTime={at}>
        {timestamp}
      </time>
    ) : null;
  if (!email) return null;
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

import { Children, type ReactNode } from "react";
export { LoadingState, RefusedState } from "./primitives";

// The four UI states, one treatment each, shared by every data page — so
// loading on Search looks like loading on Briefs. Extracted here rather than
// left as per-page inline markup: the pages that adopt the archetypes next
// inherit these instead of each inventing its own error block.
//
// The live-region semantics are part of the treatment, not the page's business:
// role="status" for pending, role="alert" for error, on the element that holds
// the message. A restyle can't silently stop announcing a state change.

export function PendingState({ children }: { children: ReactNode }) {
  return (
    <p className="state-pending" role="status">
      {children}
    </p>
  );
}

// The outcome of a command that has already finished — created, updated,
// deleted. Not PendingState: that one is the Loading treatment and says work is
// still in flight, so wearing it to report a finished action tells the operator
// the opposite of what happened. Same live region, because an outcome that only
// appears visually is one a screen reader never hears; its own treatment,
// because DESIGN.md §8 requires the states to look different from each other.
export function NoticeState({ children }: { children: ReactNode }) {
  return (
    <p className="state-notice" role="status">
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state-empty">{children}</div>;
}

export function ErrorState({ children }: { children: ReactNode }) {
  return (
    <div className="state-error" role="alert">
      {children}
    </div>
  );
}

// The error state every data screen shares: say what failed, and offer the one
// action that can recover it. A refusal (the wrong role's dashboard) is not a
// failure and has nothing to retry, so it uses ErrorState directly.
export function RetryableError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <ErrorState>
      <p>{message}</p>
      <button type="button" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </ErrorState>
  );
}

// The populated state's shared frame: a bordered register of entries, ruled
// between rows. What an entry itself contains is the Index archetype's job
// (#31) — this is only the frame all the lists share.
export function EntryList({ children, total }: { children: ReactNode; total?: number }) {
  const shown = Children.toArray(children).length;
  const whole = total ?? shown;
  return (
    <div className="entry-list-frame">
      <p className="entry-list-summary">Showing {shown} of {whole}</p>
      <ul className="entry-list">{children}</ul>
    </div>
  );
}

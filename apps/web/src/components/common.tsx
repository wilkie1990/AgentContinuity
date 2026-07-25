import type { ReactNode } from "react";
import { formatPercent } from "../format.js";

/** Every mutation from the human interface is attributed to the UI rather than an agent. */
export const UI_ACTOR = "web-ui";

export function ProgressBar({ value }: { value: number | null }) {
  return (
    <div className="row" style={{ gap: 8, flex: 1 }}>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={value === null ? 0 : Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${(value ?? 0) * 100}%` }} />
      </div>
      <span className="small muted">{formatPercent(value)}</span>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="spread">
        <h4>{title}</h4>
        {action}
      </div>
      <div className="rows">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty small">{children}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="error small">{message}</p>;
}

export function Loading() {
  return <p className="muted small">Loading…</p>;
}

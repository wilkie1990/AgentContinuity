/**
 * Shared empty/loading presentation for the drawer and secondary views
 * (activity, decisions, links, context). Deliberately separate from the
 * bare <Empty>/<Loading> in components/common.js, which stay tiny inline
 * notes used by the board and other areas this task doesn't own — these two
 * are the more informative, page-level versions TASK-0007's acceptance
 * criteria call for.
 */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {hint && <p className="small muted" style={{ margin: 0 }}>{hint}</p>}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div className="skeleton-line" key={index} />
      ))}
    </div>
  );
}

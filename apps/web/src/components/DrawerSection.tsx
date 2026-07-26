import type { ReactNode } from "react";

/**
 * Collapsible section for the task drawer. A native <details>/<summary> pair
 * gives keyboard and screen-reader toggling for free, and degrades to a
 * plain expand/collapse control if anything about hydration goes wrong.
 *
 * `defaultOpen` is a one-time initial value, not a controlled prop: React
 * only touches the DOM's `open` attribute when the value passed in actually
 * changes between renders, and it never does for a given section, so a
 * user's manual toggle during a session is never fought. TaskDrawer keys the
 * whole drawer by taskKey so switching tasks remounts every section back to
 * its deliberate default instead of carrying over the previous task's
 * accordion state.
 *
 * Action controls (e.g. a "Save" button) belong in the body, not the
 * summary — nesting an interactive element inside <summary> both fights the
 * browser's own toggle-on-click behaviour and confuses assistive tech.
 */
export function DrawerSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="drawer-section" open={defaultOpen}>
      <summary>
        <h4>{title}</h4>
        {badge}
      </summary>
      <div className="drawer-section-body rows">{children}</div>
    </details>
  );
}

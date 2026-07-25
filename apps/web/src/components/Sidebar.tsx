import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useProjects } from "../api.js";

// Mirrors the desktop breakpoint documented in styles/base.css (1024px).
// Keeping it in one place here means resizing across the breakpoint is
// reflected without a reload, unlike a value read once at mount.
const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

/**
 * The project list. Below 1024px this renders as an off-canvas panel
 * controlled by `open`/`onClose`; at 1024px and above layout.css turns it
 * into a permanent column regardless of `open`, so the open/close state
 * simply stops mattering visually.
 *
 * Presentational and self-contained on purpose: TASK-0005 enriches what
 * it displays without needing to touch the shell mechanics here.
 */
export function Sidebar({
  open,
  onClose,
  onNewProject,
}: {
  open: boolean;
  onClose: () => void;
  onNewProject: () => void;
}) {
  const [search, setSearch] = useState("");
  const isDesktop = useIsDesktop();
  const location = useLocation();
  // The sidebar sits outside the routed area, so the active project comes from the path.
  const activeKey = location.pathname.split("/")[2];
  // Archived projects are hidden by default.
  const { data } = useProjects(["active", "paused", "completed"]);

  const projects = (data?.projects ?? []).filter((project) =>
    `${project.key} ${project.name} ${project.objective ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  // Closing on navigation only matters on mobile/tablet, where the panel is
  // off-canvas; on desktop it is always visible so this is a no-op there.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      {/* A plain div, not a button: it only needs to be clickable, and using
          the button element would pull in the base button styles (hover
          background, padding, min-height) that fight the dimmed overlay
          look. Matches the existing .drawer-backdrop convention. */}
      {open && <div className="sidebar-backdrop" onClick={onClose} role="presentation" />}
      {/* Off-canvas and closed on mobile/tablet: inert removes its contents
          from tab order and the accessibility tree so closing the panel
          also closes it to a keyboard user, not just visually. Desktop
          ignores `open` entirely — the column is always interactive. */}
      <aside
        id="app-sidebar"
        className={`sidebar${open ? " open" : ""}`}
        inert={!isDesktop && !open ? true : undefined}
      >
        <button className="primary" onClick={onNewProject}>
          + New project
        </button>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search projects"
          aria-label="Search projects"
        />
        {/* Closing here (rather than only reacting to pathname changes below)
            also covers re-clicking the already-active project link, which
            does not change the path but is still a dismissal on mobile. */}
        <nav onClick={onClose}>
          {projects.map((project) => (
            <NavLink
              key={project.id}
              to={`/projects/${project.key}`}
              className={project.key === activeKey ? "active" : undefined}
              title={project.objective ?? project.name}
            >
              {project.name}
            </NavLink>
          ))}
          {projects.length === 0 && <p className="empty small">No projects yet.</p>}
        </nav>
      </aside>
    </>
  );
}

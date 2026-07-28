-- Explicit project repository identity and per-execution worktree binding.
-- Paths are caller-supplied local state; no value is derived from a server process cwd.
CREATE TABLE repositories (
  id                      TEXT PRIMARY KEY,
  key                     TEXT NOT NULL UNIQUE,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label                   TEXT NOT NULL,
  canonical_root_path     TEXT NOT NULL,
  canonical_root_path_key TEXT NOT NULL,
  remote_url              TEXT,
  is_primary              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  CHECK(is_primary IN (0, 1)),
  UNIQUE(project_id, canonical_root_path_key)
);
CREATE INDEX repositories_project_id_idx ON repositories(project_id);
CREATE UNIQUE INDEX repositories_project_primary_idx ON repositories(project_id) WHERE is_primary = 1;

CREATE TABLE execution_worktrees (
  id                TEXT PRIMARY KEY,
  execution_id      TEXT NOT NULL UNIQUE REFERENCES task_executions(id) ON DELETE CASCADE,
  repository_id     TEXT NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  worktree_path     TEXT NOT NULL,
  worktree_path_key TEXT NOT NULL,
  branch            TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX execution_worktrees_repository_id_idx ON execution_worktrees(repository_id);
CREATE INDEX execution_worktrees_path_key_idx ON execution_worktrees(worktree_path_key);

INSERT INTO counters(entity_type, current_value) VALUES ('repository', 0);

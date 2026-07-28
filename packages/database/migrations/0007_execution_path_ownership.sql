-- Versioned, agent-declared path ownership for advisory collision analysis.
-- Collision warnings are derived from live claims plus these declarations and Git provenance.
CREATE TABLE execution_path_ownership_revisions (
  id             TEXT PRIMARY KEY,
  execution_id   TEXT NOT NULL REFERENCES task_executions(id) ON DELETE CASCADE,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  worktree_id    TEXT NOT NULL REFERENCES execution_worktrees(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  actor          TEXT NOT NULL,
  session_id     TEXT,
  created_at     TEXT NOT NULL,
  superseded_at  TEXT,
  CHECK(version > 0),
  UNIQUE(execution_id, version)
);
CREATE INDEX execution_path_ownership_revisions_execution_idx
  ON execution_path_ownership_revisions(execution_id, version);
CREATE INDEX execution_path_ownership_revisions_live_idx
  ON execution_path_ownership_revisions(execution_id, superseded_at);
CREATE INDEX execution_path_ownership_revisions_repository_idx
  ON execution_path_ownership_revisions(repository_id);

CREATE TABLE execution_path_ownership_entries (
  id             TEXT PRIMARY KEY,
  revision_id    TEXT NOT NULL REFERENCES execution_path_ownership_revisions(id) ON DELETE CASCADE,
  path           TEXT NOT NULL,
  path_key       TEXT NOT NULL,
  path_kind      TEXT NOT NULL,
  CHECK(path_kind IN ('file', 'directory')),
  UNIQUE(revision_id, path_key)
);
CREATE INDEX execution_path_ownership_entries_revision_idx
  ON execution_path_ownership_entries(revision_id);
CREATE INDEX execution_path_ownership_entries_path_idx
  ON execution_path_ownership_entries(path_key);

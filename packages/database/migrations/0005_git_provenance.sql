-- Structured, derived Git state for an explicitly bound execution worktree.
-- The path key is internal binding identity and is never returned in provenance DTOs.
CREATE TABLE execution_git_baselines (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL UNIQUE REFERENCES task_executions(id) ON DELETE CASCADE,
  worktree_id     TEXT NOT NULL REFERENCES execution_worktrees(id) ON DELETE CASCADE,
  repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  worktree_path_key TEXT NOT NULL,
  source          TEXT NOT NULL,
  status          TEXT NOT NULL,
  branch          TEXT,
  detached        INTEGER NOT NULL DEFAULT 0,
  head_sha        TEXT,
  dirty           INTEGER,
  error_code      TEXT,
  error_message   TEXT,
  captured_at     TEXT NOT NULL,
  CHECK(source = 'local_git'),
  CHECK(status IN ('ok', 'error')),
  CHECK(detached IN (0, 1)),
  CHECK(dirty IS NULL OR dirty IN (0, 1)),
  CHECK(
    (status = 'ok' AND dirty IS NOT NULL AND error_code IS NULL AND error_message IS NULL)
    OR
    (status = 'error' AND branch IS NULL AND detached = 0 AND head_sha IS NULL
      AND dirty IS NULL AND error_code IS NOT NULL AND error_message IS NOT NULL)
  )
);
CREATE INDEX execution_git_baselines_repository_id_idx
  ON execution_git_baselines(repository_id);

CREATE TABLE execution_git_snapshots (
  id              TEXT PRIMARY KEY,
  baseline_id     TEXT NOT NULL REFERENCES execution_git_baselines(id) ON DELETE CASCADE,
  execution_id    TEXT NOT NULL REFERENCES task_executions(id) ON DELETE CASCADE,
  sequence        INTEGER NOT NULL,
  checkpoint_id   TEXT REFERENCES task_checkpoints(id) ON DELETE SET NULL,
  trigger         TEXT NOT NULL,
  source          TEXT NOT NULL,
  status          TEXT NOT NULL,
  branch          TEXT,
  detached        INTEGER NOT NULL DEFAULT 0,
  head_sha        TEXT,
  dirty           INTEGER,
  commit_shas_json TEXT NOT NULL DEFAULT '[]',
  additions       INTEGER NOT NULL DEFAULT 0,
  deletions       INTEGER NOT NULL DEFAULT 0,
  files_changed   INTEGER NOT NULL DEFAULT 0,
  error_code      TEXT,
  error_message   TEXT,
  captured_at     TEXT NOT NULL,
  CHECK(trigger IN ('checkpoint', 'handoff', 'completion', 'manual')),
  CHECK(source = 'local_git'),
  CHECK(status IN ('ok', 'error')),
  CHECK(detached IN (0, 1)),
  CHECK(dirty IS NULL OR dirty IN (0, 1)),
  CHECK(additions >= 0 AND deletions >= 0 AND files_changed >= 0),
  UNIQUE(baseline_id, sequence),
  CHECK(
    (status = 'ok' AND dirty IS NOT NULL AND error_code IS NULL AND error_message IS NULL)
    OR
    (status = 'error' AND branch IS NULL AND detached = 0 AND head_sha IS NULL
      AND dirty IS NULL AND commit_shas_json = '[]' AND additions = 0
      AND deletions = 0 AND files_changed = 0
      AND error_code IS NOT NULL AND error_message IS NOT NULL)
  )
);
CREATE INDEX execution_git_snapshots_execution_id_idx
  ON execution_git_snapshots(execution_id, sequence);
CREATE INDEX execution_git_snapshots_checkpoint_id_idx
  ON execution_git_snapshots(checkpoint_id);

CREATE TABLE execution_git_touched_paths (
  id             TEXT PRIMARY KEY,
  snapshot_id    TEXT NOT NULL REFERENCES execution_git_snapshots(id) ON DELETE CASCADE,
  path           TEXT NOT NULL,
  previous_path  TEXT,
  change_kind    TEXT NOT NULL,
  additions      INTEGER,
  deletions      INTEGER,
  CHECK(change_kind IN ('added', 'modified', 'deleted', 'renamed', 'copied', 'untracked', 'unknown')),
  CHECK(additions IS NULL OR additions >= 0),
  CHECK(deletions IS NULL OR deletions >= 0)
);
CREATE INDEX execution_git_touched_paths_snapshot_id_idx
  ON execution_git_touched_paths(snapshot_id);
CREATE INDEX execution_git_touched_paths_path_idx
  ON execution_git_touched_paths(path);

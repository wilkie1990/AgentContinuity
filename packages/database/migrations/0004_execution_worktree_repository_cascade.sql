-- Correct the repository delete action without changing the already-applied 0003 migration.
-- SQLite cannot alter a foreign key in place, so rebuild the child table and preserve every row.
CREATE TABLE execution_worktrees_0004 (
  id                TEXT PRIMARY KEY,
  execution_id      TEXT NOT NULL UNIQUE REFERENCES task_executions(id) ON DELETE CASCADE,
  repository_id     TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  worktree_path     TEXT NOT NULL,
  worktree_path_key TEXT NOT NULL,
  branch            TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

INSERT INTO execution_worktrees_0004 (
  id,
  execution_id,
  repository_id,
  worktree_path,
  worktree_path_key,
  branch,
  created_at,
  updated_at
)
SELECT
  id,
  execution_id,
  repository_id,
  worktree_path,
  worktree_path_key,
  branch,
  created_at,
  updated_at
FROM execution_worktrees;

DROP TABLE execution_worktrees;
ALTER TABLE execution_worktrees_0004 RENAME TO execution_worktrees;

CREATE INDEX execution_worktrees_repository_id_idx ON execution_worktrees(repository_id);
CREATE INDEX execution_worktrees_path_key_idx ON execution_worktrees(worktree_path_key);

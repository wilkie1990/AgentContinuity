-- Immutable project/task context history with optimistic current-row projections.
-- Existing nullable context columns remain the source used by ordinary reads and search.
ALTER TABLE projects
  ADD COLUMN context_version INTEGER NOT NULL DEFAULT 0 CHECK(context_version >= 0);

ALTER TABLE tasks
  ADD COLUMN context_version INTEGER NOT NULL DEFAULT 0 CHECK(context_version >= 0);

CREATE TABLE context_versions (
  id                      TEXT PRIMARY KEY,
  owner_type              TEXT NOT NULL,
  owner_id                TEXT NOT NULL,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id                 TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  version                 INTEGER NOT NULL,
  content                 TEXT,
  character_count         INTEGER NOT NULL,
  byte_count              INTEGER NOT NULL,
  actor                   TEXT,
  session_id              TEXT,
  reason                  TEXT,
  reverted_from_version   INTEGER,
  created_at              TEXT NOT NULL,
  CHECK(owner_type IN ('project', 'task')),
  CHECK(version > 0),
  CHECK(character_count >= 0),
  CHECK(byte_count >= 0),
  CHECK(reverted_from_version IS NULL OR reverted_from_version > 0),
  CHECK(
    (owner_type = 'project' AND owner_id = project_id AND task_id IS NULL)
    OR
    (owner_type = 'task' AND task_id IS NOT NULL AND owner_id = task_id)
  )
);

CREATE UNIQUE INDEX context_versions_owner_version_idx
  ON context_versions(owner_type, owner_id, version);
CREATE INDEX context_versions_owner_idx
  ON context_versions(owner_type, owner_id, version DESC);
CREATE INDEX context_versions_project_idx
  ON context_versions(project_id);
CREATE INDEX context_versions_task_idx
  ON context_versions(task_id);

-- Backfill the current non-null projections as deterministic version 1 rows.
-- Null means no context has been recorded and deliberately remains at version 0.
INSERT INTO context_versions (
  id, owner_type, owner_id, project_id, task_id, version, content,
  character_count, byte_count, actor, session_id, reason,
  reverted_from_version, created_at
)
SELECT
  'context-project:' || p.id || ':1',
  'project',
  p.id,
  p.id,
  NULL,
  1,
  p.context,
  length(p.context),
  length(CAST(p.context AS BLOB)),
  'migration',
  NULL,
  'Backfilled current context during migration 0008.',
  NULL,
  p.updated_at
FROM projects p
WHERE p.context IS NOT NULL
ORDER BY p.key, p.id;

UPDATE projects
SET context_version = 1
WHERE context IS NOT NULL;

INSERT INTO context_versions (
  id, owner_type, owner_id, project_id, task_id, version, content,
  character_count, byte_count, actor, session_id, reason,
  reverted_from_version, created_at
)
SELECT
  'context-task:' || t.id || ':1',
  'task',
  t.id,
  t.project_id,
  t.id,
  1,
  t.context,
  length(t.context),
  length(CAST(t.context AS BLOB)),
  'migration',
  NULL,
  'Backfilled current context during migration 0008.',
  NULL,
  t.updated_at
FROM tasks t
JOIN projects p ON p.id = t.project_id
WHERE t.context IS NOT NULL
ORDER BY p.key, t.key, t.id;

UPDATE tasks
SET context_version = 1
WHERE context IS NOT NULL;

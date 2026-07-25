-- Agent Workspace v0.1 initial schema.
-- All timestamps are ISO-8601 UTC strings so lexicographic comparison equals chronological order.

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  objective   TEXT,
  description TEXT,
  context     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT,
  CHECK (status IN ('active', 'paused', 'completed', 'archived'))
);

CREATE UNIQUE INDEX projects_key_idx ON projects (key);
CREATE INDEX projects_status_idx ON projects (status);
CREATE INDEX projects_updated_at_idx ON projects (updated_at);

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  key            TEXT NOT NULL UNIQUE,
  project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  context        TEXT,
  status         TEXT NOT NULL DEFAULT 'backlog',
  priority       TEXT NOT NULL DEFAULT 'normal',
  sort_order     REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT,
  CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'review', 'done')),
  CHECK (priority IN ('low', 'normal', 'high', 'critical'))
);

CREATE UNIQUE INDEX tasks_key_idx ON tasks (key);
CREATE INDEX tasks_project_id_idx ON tasks (project_id);
CREATE INDEX tasks_status_idx ON tasks (status);
CREATE INDEX tasks_priority_idx ON tasks (priority);
CREATE INDEX tasks_parent_task_id_idx ON tasks (parent_task_id);
CREATE INDEX tasks_updated_at_idx ON tasks (updated_at);

CREATE TABLE acceptance_criteria (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  is_complete  INTEGER NOT NULL DEFAULT 0,
  sort_order   REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX acceptance_criteria_task_id_idx ON acceptance_criteria (task_id);

CREATE TABLE task_dependencies (
  task_id            TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  created_at         TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX task_dependencies_depends_on_idx ON task_dependencies (depends_on_task_id);

CREATE TABLE task_claims (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor             TEXT NOT NULL,
  session_id        TEXT,
  claimed_at        TEXT NOT NULL,
  last_active_at    TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  released_at       TEXT,
  release_reason    TEXT,
  -- Guarantees task.claim_expired is emitted at most once per claim.
  expiry_recorded_at TEXT
);

CREATE INDEX task_claims_task_id_idx ON task_claims (task_id);
CREATE INDEX task_claims_expires_at_idx ON task_claims (expires_at);
CREATE INDEX task_claims_actor_idx ON task_claims (actor);

CREATE TABLE task_progress (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  actor      TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX task_progress_task_id_idx ON task_progress (task_id);
CREATE INDEX task_progress_created_at_idx ON task_progress (created_at);

CREATE TABLE blockers (
  id              TEXT PRIMARY KEY,
  key             TEXT NOT NULL UNIQUE,
  task_id         TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  required_action TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT,
  resolution      TEXT
);

CREATE UNIQUE INDEX blockers_key_idx ON blockers (key);
CREATE INDEX blockers_task_id_idx ON blockers (task_id);
CREATE INDEX blockers_resolved_at_idx ON blockers (resolved_at);

CREATE TABLE decisions (
  id               TEXT PRIMARY KEY,
  key              TEXT NOT NULL UNIQUE,
  project_id       TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id          TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  decision         TEXT NOT NULL,
  rationale        TEXT,
  created_by       TEXT,
  session_id       TEXT,
  created_at       TEXT NOT NULL,
  superseded_at    TEXT,
  superseded_by_id TEXT REFERENCES decisions (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX decisions_key_idx ON decisions (key);
CREATE INDEX decisions_project_id_idx ON decisions (project_id);
CREATE INDEX decisions_task_id_idx ON decisions (task_id);
CREATE INDEX decisions_created_at_idx ON decisions (created_at);

CREATE TABLE links (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id       TEXT REFERENCES tasks (id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  provider      TEXT,
  reference     TEXT,
  url           TEXT,
  metadata_json TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX links_key_idx ON links (key);
CREATE INDEX links_project_id_idx ON links (project_id);
CREATE INDEX links_task_id_idx ON links (task_id);
CREATE INDEX links_type_idx ON links (type);

-- `seq` is the ordering key. Many events legitimately share a created_at timestamp
-- (a bootstrap writes dozens within the same millisecond), so insertion order is what
-- makes the timeline and its cursor pagination deterministic.
CREATE TABLE activity_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,
  project_id   TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks (id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  actor        TEXT,
  session_id   TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

CREATE INDEX activity_project_id_idx ON activity_events (project_id, seq);
CREATE INDEX activity_task_id_idx ON activity_events (task_id, seq);
CREATE INDEX activity_event_type_idx ON activity_events (event_type);
CREATE INDEX activity_created_at_idx ON activity_events (created_at);

CREATE TABLE counters (
  entity_type   TEXT PRIMARY KEY,
  current_value INTEGER NOT NULL DEFAULT 0
);

INSERT INTO counters (entity_type, current_value) VALUES
  ('project', 0),
  ('task', 0),
  ('decision', 0),
  ('blocker', 0),
  ('link', 0);

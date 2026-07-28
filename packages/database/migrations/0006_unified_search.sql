-- Unified cross-record search. Canonical records remain the source of truth;
-- these rows are a derived, filterable content store backed by external-content FTS5.
CREATE TABLE search_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type  TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  project_key  TEXT NOT NULL,
  task_key     TEXT,
  source_key   TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK(source_type IN (
    'project',
    'project_context',
    'task',
    'task_context',
    'acceptance_criterion',
    'progress',
    'decision',
    'blocker',
    'criterion_evidence',
    'link',
    'activity'
  )),
  UNIQUE(source_type, source_id)
);
CREATE INDEX search_documents_project_idx ON search_documents(project_id);
CREATE INDEX search_documents_task_idx ON search_documents(task_id);
CREATE INDEX search_documents_type_idx ON search_documents(source_type);

CREATE VIRTUAL TABLE search_documents_fts USING fts5(
  source_key,
  title,
  body,
  content='search_documents',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2',
  prefix='2 3 4'
);

CREATE TRIGGER search_documents_ai AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_documents_fts(rowid, source_key, title, body)
  VALUES (new.id, new.source_key, new.title, new.body);
END;

CREATE TRIGGER search_documents_ad AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_documents_fts(search_documents_fts, rowid, source_key, title, body)
  VALUES ('delete', old.id, old.source_key, old.title, old.body);
END;

CREATE TRIGGER search_documents_au AFTER UPDATE ON search_documents BEGIN
  INSERT INTO search_documents_fts(search_documents_fts, rowid, source_key, title, body)
  VALUES ('delete', old.id, old.source_key, old.title, old.body);
  INSERT INTO search_documents_fts(rowid, source_key, title, body)
  VALUES (new.id, new.source_key, new.title, new.body);
END;

-- Project fields and context are separate results so context replacement cannot
-- leave stale terms in the ordinary project document.
INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'project', p.id, p.id, NULL, p.key, NULL,
  p.key, p.key || ' — ' || p.name,
  trim(
    coalesce(p.name, '') || char(10) ||
    coalesce(p.objective, '') || char(10) ||
    coalesce(p.description, '') || char(10) ||
    coalesce(p.status, '')
  ),
  p.created_at, p.updated_at
FROM projects p
ORDER BY p.key, p.id;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'project_context', p.id, p.id, NULL, p.key, NULL,
  p.key || ':context', p.key || ' project context', p.context,
  p.created_at, p.updated_at
FROM projects p
WHERE p.context IS NOT NULL AND trim(p.context) <> ''
ORDER BY p.key, p.id;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'task', t.id, t.project_id, t.id, p.key, t.key,
  t.key, t.key || ' — ' || t.title,
  trim(
    coalesce(t.title, '') || char(10) ||
    coalesce(t.description, '') || char(10) ||
    coalesce(t.status, '') || char(10) ||
    coalesce(t.priority, '')
  ),
  t.created_at, t.updated_at
FROM tasks t
JOIN projects p ON p.id = t.project_id
ORDER BY p.key, t.key, t.id;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'task_context', t.id, t.project_id, t.id, p.key, t.key,
  t.key || ':context', t.key || ' task context', t.context,
  t.created_at, t.updated_at
FROM tasks t
JOIN projects p ON p.id = t.project_id
WHERE t.context IS NOT NULL AND trim(t.context) <> ''
ORDER BY p.key, t.key, t.id;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'acceptance_criterion', c.id, t.project_id, t.id, p.key, t.key,
  t.key || ':criterion:' || substr(c.id, 1, 8),
  t.key || ' acceptance criterion',
  trim(c.description || char(10) || CASE WHEN c.is_complete = 1 THEN 'complete' ELSE 'open' END),
  c.created_at, coalesce(c.completed_at, c.created_at)
FROM acceptance_criteria c
JOIN tasks t ON t.id = c.task_id
JOIN projects p ON p.id = t.project_id
ORDER BY p.key, t.key, c.sort_order, c.id;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'progress', g.id, t.project_id, t.id, p.key, t.key,
  t.key || ':progress:' || substr(g.id, 1, 8),
  t.key || ' progress',
  trim(g.content || char(10) || coalesce(g.actor, '')),
  g.created_at, g.created_at
FROM task_progress g
JOIN tasks t ON t.id = g.task_id
JOIN projects p ON p.id = t.project_id
ORDER BY p.key, t.key, g.created_at, g.id;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'decision', d.id, d.project_id, d.task_id, p.key, t.key,
  d.key, d.key || ' — ' || d.title,
  trim(
    d.decision || char(10) ||
    coalesce(d.rationale, '') || char(10) ||
    CASE WHEN d.superseded_at IS NULL THEN 'current' ELSE 'superseded' END
  ),
  d.created_at, coalesce(d.superseded_at, d.created_at)
FROM decisions d
JOIN projects p ON p.id = d.project_id
LEFT JOIN tasks t ON t.id = d.task_id
ORDER BY p.key, d.created_at, d.key;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'blocker', b.id, t.project_id, t.id, p.key, t.key,
  b.key, b.key || ' on ' || t.key,
  trim(
    b.description || char(10) ||
    coalesce(b.required_action, '') || char(10) ||
    coalesce(b.resolution, '') || char(10) ||
    CASE WHEN b.resolved_at IS NULL THEN 'active' ELSE 'resolved' END
  ),
  b.created_at, coalesce(b.resolved_at, b.created_at)
FROM blockers b
JOIN tasks t ON t.id = b.task_id
JOIN projects p ON p.id = t.project_id
ORDER BY p.key, t.key, b.created_at, b.key;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'criterion_evidence', e.id, t.project_id, t.id, p.key, t.key,
  t.key || ':evidence:' || substr(e.id, 1, 8),
  t.key || ' criterion evidence',
  trim(
    c.description || char(10) ||
    e.type || char(10) ||
    coalesce(e.reference, '') || char(10) ||
    coalesce(e.content, '') || char(10) ||
    coalesce(e.url, '')
  ),
  e.created_at, e.created_at
FROM criterion_evidence e
JOIN acceptance_criteria c ON c.id = e.criterion_id
JOIN tasks t ON t.id = c.task_id
JOIN projects p ON p.id = t.project_id
ORDER BY p.key, t.key, e.created_at, e.id;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'link', l.id, l.project_id, l.task_id, p.key, t.key,
  l.key, l.key || ' — ' || l.type,
  trim(
    l.type || char(10) ||
    coalesce(l.provider, '') || char(10) ||
    coalesce(l.reference, '') || char(10) ||
    coalesce(l.url, '') || char(10) ||
    coalesce(l.metadata_json, '')
  ),
  l.created_at, l.created_at
FROM links l
JOIN projects p ON p.id = l.project_id
LEFT JOIN tasks t ON t.id = l.task_id
ORDER BY p.key, l.created_at, l.key;

INSERT INTO search_documents (
  source_type, source_id, project_id, task_id, project_key, task_key,
  source_key, title, body, created_at, updated_at
)
SELECT
  'activity', a.id, a.project_id, a.task_id, p.key, t.key,
  'activity:' || printf('%010d', a.seq),
  a.event_type || ' on ' || coalesce(t.key, p.key),
  trim(
    a.event_type || char(10) ||
    coalesce(a.actor, '') || char(10) ||
    coalesce(a.session_id, '') || char(10) ||
    coalesce(a.payload_json, '')
  ),
  a.created_at, a.created_at
FROM activity_events a
JOIN projects p ON p.id = a.project_id
LEFT JOIN tasks t ON t.id = a.task_id
ORDER BY p.key, a.seq, a.id;

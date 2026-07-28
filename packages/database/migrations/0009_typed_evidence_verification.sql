-- Append-only typed acceptance evidence and optional per-criterion completion policies.
-- The migration-0002 criterion_evidence table remains intact for legacy compatibility
-- and unified-search projections.
CREATE TABLE criterion_evidence_details (
  evidence_id            TEXT PRIMARY KEY
                         REFERENCES criterion_evidence(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL
                         CHECK(kind IN ('commit', 'test', 'file', 'url', 'result', 'note', 'legacy')),
  legacy_type            TEXT,
  repository_id          TEXT,
  repository_key         TEXT,
  repository_label       TEXT,
  worktree_id            TEXT,
  execution_id           TEXT,
  sha                    TEXT,
  verification_outcome   TEXT
                         CHECK(verification_outcome IS NULL OR verification_outcome IN (
                           'passed', 'failed', 'timed_out', 'signaled', 'spawn_error'
                         )),
  payload_json           TEXT NOT NULL,
  CHECK(
    (kind = 'legacy' AND legacy_type IS NOT NULL)
    OR
    (kind <> 'legacy' AND legacy_type IS NULL)
  ),
  CHECK(
    (repository_id IS NULL AND repository_key IS NULL AND repository_label IS NULL)
    OR
    (repository_id IS NOT NULL AND repository_key IS NOT NULL AND repository_label IS NOT NULL)
  ),
  CHECK(sha IS NULL OR (length(sha) BETWEEN 40 AND 64 AND sha = lower(sha)))
);

CREATE INDEX criterion_evidence_details_kind_idx
  ON criterion_evidence_details(kind);
CREATE INDEX criterion_evidence_details_repository_idx
  ON criterion_evidence_details(repository_id);
CREATE INDEX criterion_evidence_details_verification_outcome_idx
  ON criterion_evidence_details(verification_outcome);

-- Every pre-existing row becomes read-only legacy evidence. The original base columns
-- are deliberately not rewritten, preserving unknown type labels and all values.
INSERT INTO criterion_evidence_details (
  evidence_id, kind, legacy_type, payload_json
)
SELECT id, 'legacy', type, '{}'
FROM criterion_evidence
ORDER BY created_at, id;

CREATE TABLE criterion_evidence_policies (
  criterion_id                  TEXT PRIMARY KEY
                                REFERENCES acceptance_criteria(id) ON DELETE CASCADE,
  minimum_count                 INTEGER NOT NULL CHECK(minimum_count BETWEEN 1 AND 100),
  qualifying_kinds_json         TEXT NOT NULL,
  require_sha                   INTEGER NOT NULL DEFAULT 0 CHECK(require_sha IN (0, 1)),
  require_passing_verification  INTEGER NOT NULL DEFAULT 0
                                CHECK(require_passing_verification IN (0, 1)),
  actor                         TEXT,
  session_id                    TEXT,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);

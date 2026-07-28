-- Bounded replay receipts for deterministic logical workspace imports.
-- These are operational import bookkeeping, deliberately excluded from exports.
CREATE TABLE workspace_transfer_receipts (
  source_digest TEXT PRIMARY KEY,
  format_version INTEGER NOT NULL,
  path_mode TEXT NOT NULL CHECK(path_mode IN ('redacted', 'included')),
  result_digest TEXT NOT NULL,
  transformed_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

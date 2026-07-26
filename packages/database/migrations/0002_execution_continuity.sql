-- Agent Continuity execution continuity foundation. New tables leave existing task and claim semantics intact.
CREATE TABLE task_executions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, claim_id TEXT REFERENCES task_claims(id) ON DELETE SET NULL, actor TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL DEFAULT 'running', current_phase TEXT, started_at TEXT NOT NULL, resumed_at TEXT, last_heartbeat_at TEXT NOT NULL, ended_at TEXT, termination_reason TEXT, CHECK(status IN ('running','ended')));
CREATE INDEX task_executions_task_id_idx ON task_executions(task_id);
CREATE INDEX task_executions_claim_id_idx ON task_executions(claim_id);
CREATE INDEX task_executions_status_idx ON task_executions(status);
CREATE TABLE execution_origins (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES task_executions(id) ON DELETE CASCADE, provider TEXT NOT NULL, reference TEXT NOT NULL, url TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
CREATE INDEX execution_origins_execution_id_idx ON execution_origins(execution_id);
CREATE TABLE task_checkpoints (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, execution_id TEXT REFERENCES task_executions(id) ON DELETE SET NULL, completed TEXT NOT NULL, working_on TEXT NOT NULL, next TEXT NOT NULL, uncertainty TEXT, actor TEXT, session_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX task_checkpoints_task_id_idx ON task_checkpoints(task_id);
CREATE INDEX task_checkpoints_created_at_idx ON task_checkpoints(created_at);
CREATE TABLE task_work_plan_items (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', sort_order REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, CHECK(status IN ('pending','active','completed','skipped')));
CREATE INDEX task_work_plan_items_task_id_idx ON task_work_plan_items(task_id);
CREATE TABLE task_handoffs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, execution_id TEXT REFERENCES task_executions(id) ON DELETE SET NULL, reason TEXT NOT NULL, summary TEXT NOT NULL, next_action TEXT, unresolved_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
CREATE INDEX task_handoffs_task_id_idx ON task_handoffs(task_id);
CREATE TABLE criterion_evidence (id TEXT PRIMARY KEY, criterion_id TEXT NOT NULL REFERENCES acceptance_criteria(id) ON DELETE CASCADE, type TEXT NOT NULL, reference TEXT, content TEXT, url TEXT, actor TEXT, session_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX criterion_evidence_criterion_id_idx ON criterion_evidence(criterion_id);

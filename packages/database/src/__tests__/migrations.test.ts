import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const temporaryDirectories: string[] = [];

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex").slice(0, 16);
}

function numericColumn(row: unknown, column: string): number {
  if (typeof row !== "object" || row === null) {
    throw new Error(`Expected numeric column ${column}.`);
  }
  const value = Reflect.get(row, column);
  if (typeof value !== "number") {
    throw new Error(`Expected numeric column ${column}.`);
  }
  return value;
}

function stringColumn(row: unknown, column: string): string {
  if (typeof row !== "object" || row === null) {
    throw new Error(`Expected string column ${column}.`);
  }
  const value = Reflect.get(row, column);
  if (typeof value !== "string") {
    throw new Error(`Expected string column ${column}.`);
  }
  return value;
}

function applyRecordedMigrations(sqlite: DatabaseSync, names: string[]): void {
  sqlite.exec(`
    CREATE TABLE _migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const record = sqlite.prepare(
    "INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)",
  );
  for (const name of names) {
    const contents = readFileSync(join(migrations, name), "utf8");
    sqlite.exec(contents);
    record.run(name, checksum(contents), "2026-07-27T17:00:00.000Z");
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("applies later migrations to a database that already has the initial schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-continuity-migrations-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "workspace.db");
    const sqlite = new DatabaseSync(databasePath);
    const initial = readFileSync(join(migrations, "0001_initial.sql"), "utf8");

    sqlite.exec(initial);
    sqlite.exec(`
      CREATE TABLE _migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    sqlite
      .prepare("INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)")
      .run("0001_initial.sql", checksum(initial), "2026-01-01T00:00:00.000Z");
    sqlite
      .prepare(
        `INSERT INTO projects
          (id, key, name, objective, description, context, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "project-id",
        "PRJ-0001",
        "Existing workspace",
        "Keep existing data",
        "Created before the driver migration",
        "Persistent context",
        "active",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
    const insertTask = sqlite.prepare(
      `INSERT INTO tasks
        (id, key, project_id, parent_task_id, title, description, context, status, priority, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertTask.run(
      "parent-task-id",
      "TASK-0001",
      "project-id",
      null,
      "Parent task",
      "Existing description",
      "Existing task context",
      "ready",
      "high",
      1000,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    insertTask.run(
      "child-task-id",
      "TASK-0002",
      "project-id",
      "parent-task-id",
      "Child task",
      null,
      null,
      "backlog",
      "normal",
      2000,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    sqlite
      .prepare(
        `INSERT INTO acceptance_criteria
          (id, task_id, description, is_complete, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "criterion-id",
        "parent-task-id",
        "Existing criterion",
        0,
        1000,
        "2026-01-01T00:00:00.000Z",
      );
    sqlite.close();

    const handle = createDatabase({ path: databasePath });
    expect(runMigrations(handle.sqlite, migrations)).toEqual([]);
    expect(
      handle.sqlite
        .prepare("SELECT name FROM _migrations ORDER BY name")
        .all()
        .map((row) => stringColumn(row, "name")),
    ).toEqual([
      "0001_initial.sql",
      "0002_execution_continuity.sql",
      "0003_repository_worktrees.sql",
      "0004_execution_worktree_repository_cascade.sql",
      "0005_git_provenance.sql",
      "0006_unified_search.sql",
      "0007_execution_path_ownership.sql",
      "0008_context_history.sql",
      "0009_typed_evidence_verification.sql",
      "0010_workspace_transfer_receipts.sql",
    ]);
    expect(
      handle.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_executions'")
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_path_ownership_revisions'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_path_ownership_entries'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_documents_fts'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repositories'").get(),
    ).toBeTruthy();
    expect(
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_worktrees'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_git_baselines'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_git_snapshots'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_git_touched_paths'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      handle.sqlite.prepare("SELECT current_value FROM counters WHERE entity_type = ?").get("repository"),
    ).toEqual({ current_value: 0 });
    expect(
      numericColumn(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get(), "count"),
    ).toBe(1);
    expect(
      numericColumn(handle.sqlite.prepare("SELECT COUNT(*) AS count FROM tasks").get(), "count"),
    ).toBe(2);
    expect(
      numericColumn(
        handle.sqlite.prepare("SELECT COUNT(*) AS count FROM acceptance_criteria").get(),
        "count",
      ),
    ).toBe(1);
    expect(
      handle.sqlite.prepare("SELECT parent_task_id FROM tasks WHERE id = ?").get("child-task-id"),
    ).toEqual({ parent_task_id: "parent-task-id" });
    expect(handle.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    handle.close();
  });

  it("upgrades a populated original-0003 database without losing worktree relationships", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyRecordedMigrations(sqlite, [
      "0001_initial.sql",
      "0002_execution_continuity.sql",
      "0003_repository_worktrees.sql",
    ]);

    const now = "2026-07-27T17:00:00.000Z";
    sqlite
      .prepare(
        `INSERT INTO projects
          (id, key, name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("project-id", "PRJ-0001", "Existing repository project", "active", now, now);
    sqlite
      .prepare(
        `INSERT INTO tasks
          (id, key, project_id, title, status, priority, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "task-id",
        "TASK-0001",
        "project-id",
        "Existing execution",
        "in_progress",
        "high",
        1000,
        now,
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO task_executions
          (id, task_id, actor, session_id, status, started_at, last_heartbeat_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("execution-id", "task-id", "codex", "run-1", "running", now, now);
    sqlite
      .prepare(
        `INSERT INTO repositories
          (id, key, project_id, label, canonical_root_path, canonical_root_path_key,
           remote_url, is_primary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "repository-id",
        "REP-0001",
        "project-id",
        "Main",
        "/workspace/main",
        "/workspace/main",
        "https://example.test/main.git",
        1,
        now,
        now,
      );
    sqlite
      .prepare(
        `INSERT INTO execution_worktrees
          (id, execution_id, repository_id, worktree_path, worktree_path_key,
           branch, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "worktree-id",
        "execution-id",
        "repository-id",
        "/workspace/main/feature",
        "/workspace/main/feature",
        "feature/recovery",
        now,
        now,
      );

    const before = sqlite
      .prepare("PRAGMA foreign_key_list(execution_worktrees)")
      .all()
      .find((row) => stringColumn(row, "from") === "repository_id");
    expect(stringColumn(before, "on_delete")).toBe("RESTRICT");

    expect(runMigrations(sqlite, migrations)).toEqual([
      "0004_execution_worktree_repository_cascade.sql",
      "0005_git_provenance.sql",
      "0006_unified_search.sql",
      "0007_execution_path_ownership.sql",
      "0008_context_history.sql",
      "0009_typed_evidence_verification.sql",
      "0010_workspace_transfer_receipts.sql",
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT id, execution_id, repository_id, worktree_path, worktree_path_key,
                  branch, created_at, updated_at
             FROM execution_worktrees`,
        )
        .get(),
    ).toEqual({
      id: "worktree-id",
      execution_id: "execution-id",
      repository_id: "repository-id",
      worktree_path: "/workspace/main/feature",
      worktree_path_key: "/workspace/main/feature",
      branch: "feature/recovery",
      created_at: now,
      updated_at: now,
    });
    expect(
      sqlite.prepare("SELECT id FROM task_executions WHERE id = ?").get("execution-id"),
    ).toEqual({ id: "execution-id" });
    expect(
      sqlite.prepare("SELECT id FROM repositories WHERE id = ?").get("repository-id"),
    ).toEqual({ id: "repository-id" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const after = sqlite
      .prepare("PRAGMA foreign_key_list(execution_worktrees)")
      .all()
      .find((row) => stringColumn(row, "from") === "repository_id");
    expect(stringColumn(after, "on_delete")).toBe("CASCADE");

    sqlite.prepare("DELETE FROM projects WHERE id = ?").run("project-id");
    expect(
      numericColumn(
        sqlite.prepare("SELECT COUNT(*) AS count FROM execution_worktrees").get(),
        "count",
      ),
    ).toBe(0);
    expect(
      numericColumn(sqlite.prepare("SELECT COUNT(*) AS count FROM repositories").get(), "count"),
    ).toBe(0);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("applies all migrations to a fresh database in filename order", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");

    expect(runMigrations(sqlite, migrations)).toEqual([
      "0001_initial.sql",
      "0002_execution_continuity.sql",
      "0003_repository_worktrees.sql",
      "0004_execution_worktree_repository_cascade.sql",
      "0005_git_provenance.sql",
      "0006_unified_search.sql",
      "0007_execution_path_ownership.sql",
      "0008_context_history.sql",
      "0009_typed_evidence_verification.sql",
      "0010_workspace_transfer_receipts.sql",
    ]);
    expect(runMigrations(sqlite, migrations)).toEqual([]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const repositoryForeignKey = sqlite
      .prepare("PRAGMA foreign_key_list(execution_worktrees)")
      .all()
      .find((row) => stringColumn(row, "from") === "repository_id");
    expect(stringColumn(repositoryForeignKey, "on_delete")).toBe("CASCADE");
    sqlite.close();
  });

  it("backfills populated records deterministically into the FTS5 index", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyRecordedMigrations(sqlite, [
      "0001_initial.sql",
      "0002_execution_continuity.sql",
      "0003_repository_worktrees.sql",
      "0004_execution_worktree_repository_cascade.sql",
      "0005_git_provenance.sql",
    ]);
    const now = "2026-07-27T18:00:00.000Z";
    sqlite.exec(`
      INSERT INTO projects
        (id, key, name, objective, description, context, status, created_at, updated_at)
      VALUES
        ('project-id', 'PRJ-0001', 'Projectneedle', 'Objective', 'Description',
         'Projectcontextneedle', 'active', '${now}', '${now}');
      INSERT INTO tasks
        (id, key, project_id, title, description, context, status, priority,
         sort_order, created_at, updated_at)
      VALUES
        ('task-id', 'TASK-0001', 'project-id', 'Taskneedle', 'Task description',
         'Taskcontextneedle', 'ready', 'high', 1000, '${now}', '${now}');
      INSERT INTO acceptance_criteria
        (id, task_id, description, is_complete, sort_order, created_at)
      VALUES
        ('criterion-id', 'task-id', 'Criterionneedle', 0, 1000, '${now}');
      INSERT INTO task_progress (id, task_id, content, actor, created_at)
      VALUES ('progress-id', 'task-id', 'Progressneedle', 'codex', '${now}');
      INSERT INTO decisions
        (id, key, project_id, task_id, title, decision, rationale, created_at)
      VALUES
        ('decision-id', 'DEC-0001', 'project-id', 'task-id', 'Decisionneedle',
         'Choose FTS', 'Local retrieval', '${now}');
      INSERT INTO blockers
        (id, key, task_id, description, required_action, created_at)
      VALUES
        ('blocker-id', 'BLK-0001', 'task-id', 'Blockerneedle', 'Resolve it', '${now}');
      INSERT INTO criterion_evidence
        (id, criterion_id, type, reference, content, created_at)
      VALUES
        ('evidence-id', 'criterion-id', 'test', 'migration.test.ts',
         'Evidenceneedle', '${now}');
      INSERT INTO links
        (id, key, project_id, task_id, type, provider, reference, url, created_at)
      VALUES
        ('link-id', 'LNK-0001', 'project-id', 'task-id', 'document', 'git',
         'Linkneedle', 'https://example.test/search', '${now}');
      INSERT INTO activity_events
        (id, project_id, task_id, event_type, actor, payload_json, created_at)
      VALUES
        ('activity-id', 'project-id', 'task-id', 'task.progress_added', 'codex',
         '{"note":"Activityneedle"}', '${now}');
    `);

    expect(runMigrations(sqlite, migrations)).toEqual([
      "0006_unified_search.sql",
      "0007_execution_path_ownership.sql",
      "0008_context_history.sql",
      "0009_typed_evidence_verification.sql",
      "0010_workspace_transfer_receipts.sql",
    ]);
    expect(
      sqlite
        .prepare("SELECT source_type, source_key FROM search_documents ORDER BY id")
        .all(),
    ).toEqual([
      { source_type: "project", source_key: "PRJ-0001" },
      { source_type: "project_context", source_key: "PRJ-0001:context" },
      { source_type: "task", source_key: "TASK-0001" },
      { source_type: "task_context", source_key: "TASK-0001:context" },
      {
        source_type: "acceptance_criterion",
        source_key: "TASK-0001:criterion:criterio",
      },
      { source_type: "progress", source_key: "TASK-0001:progress:progress" },
      { source_type: "decision", source_key: "DEC-0001" },
      { source_type: "blocker", source_key: "BLK-0001" },
      {
        source_type: "criterion_evidence",
        source_key: "TASK-0001:evidence:evidence",
      },
      { source_type: "link", source_key: "LNK-0001" },
      { source_type: "activity", source_key: "activity:0000000001" },
    ]);

    const findTypes = sqlite.prepare(`
      SELECT d.source_type
      FROM search_documents_fts
      JOIN search_documents d ON d.id = search_documents_fts.rowid
      WHERE search_documents_fts MATCH ?
      ORDER BY d.source_type
    `);
    expect(findTypes.all('"Projectneedle"')).toEqual([{ source_type: "project" }]);
    expect(findTypes.all('"Criterionneedle"')).toEqual([
      { source_type: "acceptance_criterion" },
      { source_type: "criterion_evidence" },
    ]);
    expect(findTypes.all('"Evidenceneedle"')).toEqual([
      { source_type: "criterion_evidence" },
    ]);
    expect(findTypes.all('"Linkneedle"')).toEqual([{ source_type: "link" }]);
    expect(findTypes.all('"Activityneedle"')).toEqual([{ source_type: "activity" }]);

    sqlite.prepare("DELETE FROM projects WHERE id = ?").run("project-id");
    expect(
      numericColumn(
        sqlite.prepare("SELECT COUNT(*) AS count FROM search_documents").get(),
        "count",
      ),
    ).toBe(0);
    expect(findTypes.all('"Projectneedle"')).toEqual([]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("backfills nullable project/task context into immutable version 1 rows", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyRecordedMigrations(sqlite, [
      "0001_initial.sql",
      "0002_execution_continuity.sql",
      "0003_repository_worktrees.sql",
      "0004_execution_worktree_repository_cascade.sql",
      "0005_git_provenance.sql",
      "0006_unified_search.sql",
      "0007_execution_path_ownership.sql",
    ]);
    const created = "2026-07-27T17:00:00.000Z";
    const updated = "2026-07-27T18:00:00.000Z";
    const oversized = "x".repeat(256 * 1024 + 1);
    const insertProject = sqlite.prepare(`
      INSERT INTO projects
        (id, key, name, context, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `);
    insertProject.run("project-cafe", "PRJ-0001", "Café", "café", created, updated);
    insertProject.run("project-empty", "PRJ-0002", "Empty", "", created, updated);
    insertProject.run("project-null", "PRJ-0003", "Null", null, created, updated);
    insertProject.run(
      "project-oversized",
      "PRJ-0004",
      "Oversized",
      oversized,
      created,
      updated,
    );
    const insertTask = sqlite.prepare(`
      INSERT INTO tasks
        (id, key, project_id, title, context, status, priority, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ready', 'normal', ?, ?, ?)
    `);
    insertTask.run(
      "task-text",
      "TASK-0001",
      "project-cafe",
      "Text",
      "task context",
      1000,
      created,
      updated,
    );
    insertTask.run(
      "task-empty",
      "TASK-0002",
      "project-cafe",
      "Empty",
      "",
      2000,
      created,
      updated,
    );
    insertTask.run(
      "task-null",
      "TASK-0003",
      "project-cafe",
      "Null",
      null,
      3000,
      created,
      updated,
    );

    expect(runMigrations(sqlite, migrations)).toEqual([
      "0008_context_history.sql",
      "0009_typed_evidence_verification.sql",
      "0010_workspace_transfer_receipts.sql",
    ]);
    expect(
      sqlite
        .prepare("SELECT key, context_version FROM projects ORDER BY key")
        .all(),
    ).toEqual([
      { key: "PRJ-0001", context_version: 1 },
      { key: "PRJ-0002", context_version: 1 },
      { key: "PRJ-0003", context_version: 0 },
      { key: "PRJ-0004", context_version: 1 },
    ]);
    expect(
      sqlite.prepare("SELECT key, context_version FROM tasks ORDER BY key").all(),
    ).toEqual([
      { key: "TASK-0001", context_version: 1 },
      { key: "TASK-0002", context_version: 1 },
      { key: "TASK-0003", context_version: 0 },
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT id, owner_type, owner_id, version, character_count, byte_count,
                  actor, session_id, reason, created_at
             FROM context_versions
            ORDER BY rowid`,
        )
        .all(),
    ).toEqual([
      {
        id: "context-project:project-cafe:1",
        owner_type: "project",
        owner_id: "project-cafe",
        version: 1,
        character_count: 4,
        byte_count: 5,
        actor: "migration",
        session_id: null,
        reason: "Backfilled current context during migration 0008.",
        created_at: updated,
      },
      {
        id: "context-project:project-empty:1",
        owner_type: "project",
        owner_id: "project-empty",
        version: 1,
        character_count: 0,
        byte_count: 0,
        actor: "migration",
        session_id: null,
        reason: "Backfilled current context during migration 0008.",
        created_at: updated,
      },
      {
        id: "context-project:project-oversized:1",
        owner_type: "project",
        owner_id: "project-oversized",
        version: 1,
        character_count: oversized.length,
        byte_count: oversized.length,
        actor: "migration",
        session_id: null,
        reason: "Backfilled current context during migration 0008.",
        created_at: updated,
      },
      {
        id: "context-task:task-text:1",
        owner_type: "task",
        owner_id: "task-text",
        version: 1,
        character_count: 12,
        byte_count: 12,
        actor: "migration",
        session_id: null,
        reason: "Backfilled current context during migration 0008.",
        created_at: updated,
      },
      {
        id: "context-task:task-empty:1",
        owner_type: "task",
        owner_id: "task-empty",
        version: 1,
        character_count: 0,
        byte_count: 0,
        actor: "migration",
        session_id: null,
        reason: "Backfilled current context during migration 0008.",
        created_at: updated,
      },
    ]);
    expect(
      numericColumn(
        sqlite
          .prepare("SELECT byte_count FROM context_versions WHERE owner_id = ?")
          .get("project-oversized"),
        "byte_count",
      ),
    ).toBe(oversized.length);

    sqlite.prepare("DELETE FROM tasks WHERE id = ?").run("task-text");
    expect(
      numericColumn(
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM context_versions WHERE task_id = ?")
          .get("task-text"),
        "count",
      ),
    ).toBe(0);
    sqlite.prepare("DELETE FROM projects WHERE id = ?").run("project-cafe");
    expect(
      numericColumn(
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM context_versions WHERE project_id = ?")
          .get("project-cafe"),
        "count",
      ),
    ).toBe(0);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("backfills every legacy evidence row without rewriting its free-form values", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyRecordedMigrations(sqlite, [
      "0001_initial.sql",
      "0002_execution_continuity.sql",
      "0003_repository_worktrees.sql",
      "0004_execution_worktree_repository_cascade.sql",
      "0005_git_provenance.sql",
      "0006_unified_search.sql",
      "0007_execution_path_ownership.sql",
      "0008_context_history.sql",
    ]);
    sqlite.exec(`
      INSERT INTO projects (id, key, name, status, created_at, updated_at)
      VALUES ('p', 'PRJ-0001', 'P', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO tasks (
        id, key, project_id, title, status, priority, sort_order, created_at, updated_at
      ) VALUES (
        't', 'TASK-0001', 'p', 'T', 'ready', 'high', 1000,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO acceptance_criteria (
        id, task_id, description, is_complete, sort_order, created_at
      ) VALUES ('c', 't', 'C', 0, 1000, '2026-01-01T00:00:00.000Z');
    `);
    const insert = sqlite.prepare(`
      INSERT INTO criterion_evidence (
        id, criterion_id, type, reference, content, url, actor, session_id, created_at
      ) VALUES (?, 'c', ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "e1",
      "unknown/custom label",
      "ref \u0000 bytes",
      "content 🧪",
      "https://example.test/a?b=%20",
      "legacy-actor",
      "legacy-session",
      "2026-01-01T00:00:00.000Z",
    );
    insert.run(
      "e2",
      "test",
      null,
      "",
      null,
      null,
      null,
      "2026-01-02T00:00:00.000Z",
    );
    const before = sqlite.prepare("SELECT * FROM criterion_evidence ORDER BY id").all();

    expect(runMigrations(sqlite, migrations)).toEqual([
      "0009_typed_evidence_verification.sql",
      "0010_workspace_transfer_receipts.sql",
    ]);
    expect(sqlite.prepare("SELECT * FROM criterion_evidence ORDER BY id").all()).toEqual(before);
    expect(
      sqlite
        .prepare(
          "SELECT evidence_id, kind, legacy_type, payload_json FROM criterion_evidence_details ORDER BY evidence_id",
        )
        .all(),
    ).toEqual([
      {
        evidence_id: "e1",
        kind: "legacy",
        legacy_type: "unknown/custom label",
        payload_json: "{}",
      },
      { evidence_id: "e2", kind: "legacy", legacy_type: "test", payload_json: "{}" },
    ]);
    expect(
      numericColumn(
        sqlite.prepare("SELECT COUNT(*) AS count FROM criterion_evidence").get(),
        "count",
      ),
    ).toBe(
      numericColumn(
        sqlite.prepare("SELECT COUNT(*) AS count FROM criterion_evidence_details").get(),
        "count",
      ),
    );
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("refuses a migration whose applied checksum has changed", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-continuity-checksum-"));
    temporaryDirectories.push(directory);
    const sqlite = new DatabaseSync(":memory:");
    const migrationPath = join(directory, "0001_example.sql");

    writeFileSync(migrationPath, "CREATE TABLE example (id TEXT PRIMARY KEY);\n");
    expect(runMigrations(sqlite, directory)).toEqual(["0001_example.sql"]);

    writeFileSync(
      migrationPath,
      "CREATE TABLE example (id TEXT PRIMARY KEY, changed TEXT);\n",
    );
    expect(() => runMigrations(sqlite, directory)).toThrow(
      /Migration 0001_example\.sql has changed since it was applied/,
    );
    sqlite.close();
  });

  it("rolls back a failed migration without undoing earlier migrations", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-continuity-rollback-"));
    temporaryDirectories.push(directory);
    const sqlite = new DatabaseSync(":memory:");

    writeFileSync(join(directory, "0001_stable.sql"), "CREATE TABLE stable (id TEXT);\n");
    writeFileSync(
      join(directory, "0002_broken.sql"),
      "CREATE TABLE transient (id TEXT);\nINSERT INTO missing_table VALUES ('failure');\n",
    );

    expect(() => runMigrations(sqlite, directory)).toThrow();
    expect(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stable'").get(),
    ).toBeTruthy();
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transient'")
        .get(),
    ).toBeUndefined();
    expect(
      sqlite
        .prepare("SELECT name FROM _migrations ORDER BY name")
        .all()
        .map((row) => stringColumn(row, "name")),
    ).toEqual(["0001_stable.sql"]);
    sqlite.close();
  });
});

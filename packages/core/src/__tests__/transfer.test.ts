import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createWorkspaceTransferService } from "../transfer/service.js";
import { expectErrorCode } from "./helpers.js";
import { createTestWorkspace, seedProject, seedTask } from "./helpers.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

function resign(document: any): void {
  const { canonicalDigest: _digest, ...transfer } = document.transfer;
  document.transfer.canonicalDigest = createHash("sha256").update(JSON.stringify(canonical({ format: document.format, formatVersion: document.formatVersion, transfer, counters: document.counters, data: document.data }))).digest("hex");
}

describe("workspace transfer", () => {
  function seedCompleteFixture(workspace: ReturnType<typeof createTestWorkspace>): void {
    const s = workspace.database.sqlite;
    const now = "2026-07-01T09:00:00.000Z";
    const sha = "a".repeat(40);
    s.exec(`
      INSERT INTO projects VALUES ('p','PRJ-0009','Rich project','objective','description','P','active','${now}','${now}',NULL,1);
      INSERT INTO tasks VALUES ('t1','TASK-0009','p',NULL,'Root','description','T','ready','high',1000,'${now}','${now}',NULL,1);
      INSERT INTO tasks VALUES ('t2','TASK-0010','p','t1','Child',NULL,NULL,'backlog','normal',2000,'${now}','${now}',NULL,0);
      INSERT INTO acceptance_criteria VALUES ('c','t1','criterion',1,1000,'${now}','${now}');
      INSERT INTO task_dependencies VALUES ('t2','t1','${now}');
      INSERT INTO task_claims VALUES ('claim','t1','agent','session','${now}','${now}','${now}','${now}','done',NULL);
      INSERT INTO task_progress VALUES ('progress','t1','progress','agent','session','${now}');
      INSERT INTO blockers VALUES ('blocker','BLK-0009','t1','blocker','act','agent','${now}','${now}','agent','resolved');
      INSERT INTO decisions VALUES ('d1','DEC-0009','p','t1','Old','old',NULL,'agent','session','${now}','${now}',NULL);
      INSERT INTO decisions VALUES ('d2','DEC-0010','p','t1','New','new',NULL,'agent','session','${now}',NULL,NULL);
      UPDATE decisions SET superseded_by_id = 'd2' WHERE id = 'd1';
      INSERT INTO links VALUES ('link','LNK-0009','p','t1','document','local','ref','https://example.test','{"x":1}','agent','${now}');
      INSERT INTO task_executions VALUES ('exec','t1','claim','agent','session','ended','done','${now}',NULL,'${now}','${now}','complete');
      INSERT INTO execution_origins VALUES ('origin','exec','codex','ref','https://example.test','{}','${now}');
      INSERT INTO task_checkpoints VALUES ('checkpoint','t1','exec','done','working','next',NULL,'agent','session','${now}');
      INSERT INTO task_work_plan_items VALUES ('plan','t1','plan','completed',1000,'${now}','${now}','${now}');
      INSERT INTO task_handoffs VALUES ('handoff','t1','exec','reason','summary','next','[]','${now}');
      INSERT INTO criterion_evidence VALUES ('evidence','c','note',NULL,'note',NULL,'agent','session','${now}');
      INSERT INTO criterion_evidence_details VALUES ('evidence','note',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{"content":"note"}');
      INSERT INTO criterion_evidence_policies VALUES ('c',1,'["note"]',0,0,'agent','session','${now}','${now}');
      INSERT INTO context_versions VALUES ('cp','project','p','p',NULL,1,'P',1,1,'agent','session','reason',NULL,'${now}');
      INSERT INTO context_versions VALUES ('ct','task','t1','p','t1',1,'T',1,1,'agent','session','reason',NULL,'${now}');
      INSERT INTO repositories VALUES ('repo','REP-0009','p','repo','/fixture/repo','/fixture/repo','https://example.test/repo',1,'${now}','${now}');
      INSERT INTO execution_worktrees VALUES ('worktree','exec','repo','/fixture/repo','/fixture/repo','main','${now}','${now}');
      INSERT INTO execution_git_baselines VALUES ('baseline','exec','worktree','repo','/fixture/repo','local_git','ok','main',0,'${sha}',0,NULL,NULL,'${now}');
      INSERT INTO execution_git_snapshots VALUES ('snapshot','baseline','exec',1,'checkpoint','manual','local_git','ok','main',0,'${sha}',0,'[]',1,2,1,NULL,NULL,'${now}');
      INSERT INTO execution_git_touched_paths VALUES ('touched','snapshot','src/file.ts',NULL,'modified',1,2);
      INSERT INTO execution_path_ownership_revisions VALUES ('revision','exec','repo','worktree',1,'agent','session','${now}',NULL);
      INSERT INTO execution_path_ownership_entries VALUES ('owned','revision','src/file.ts','src/file.ts','file');
      INSERT INTO activity_events (seq,id,project_id,task_id,event_type,actor,session_id,payload_json,created_at) VALUES (7,'activity','p','t1','task.progress_added','agent','session','{}','${now}');
      UPDATE counters SET current_value = 10 WHERE entity_type IN ('project','task','decision','blocker','link','repository');
    `);
  }

  it("round-trips every canonical relation in included-path mode and rebuilds derived state", () => {
    const source = createTestWorkspace();
    seedCompleteFixture(source);
    const document = source.transfer.exportWorkspace("included");
    expect(Object.values(document.data).every((rows) => rows.length > 0 || rows === document.data.task_claims)).toBe(true);
    const destination = createTestWorkspace();
    expectErrorCode(() => destination.transfer.importWorkspace(document), "WORKSPACE_IMPORT_INVALID");
    expect(destination.transfer.importWorkspace(document, { acceptLocalPaths: true }).status).toBe("imported");
    expect(destination.transfer.exportWorkspace("included")).toEqual(document);
    expect(destination.search.search({ q: "Rich", limit: 20 }).results.length).toBeGreaterThan(0);
    const next = destination.projects.create({ name: "After", actor: "codex" });
    expect(next.key).toBe("PRJ-0011");
    expect(destination.database.sqlite.prepare("SELECT MAX(seq) AS seq FROM activity_events").get()).toEqual({ seq: 8 });
    const portable = source.transfer.exportWorkspace("redacted");
    expect(portable.data.repositories).toEqual([]);
    expect(portable.transfer.redactions?.localBindings.repositories).toBe(1);
    source.close();
    destination.close();
  });

  it("is deterministic, redacts local bindings, and restores an empty workspace", () => {
    const source = createTestWorkspace();
    const project = seedProject(source);
    const task = seedTask(source, project.key, "Transfer fixture", {
      acceptanceCriteria: ["round trip"],
    });
    source.tasks.addProgress(task.key, { content: "preserve me", actor: "codex" });
    const first = source.transfer.exportWorkspace("redacted");
    const second = source.transfer.exportWorkspace("redacted");
    expect(second).toEqual(first);
    expect(first.transfer.pathMode).toBe("redacted");
    expect(first.data.repositories).toEqual([]);

    const destination = createTestWorkspace();
    expect(destination.transfer.importWorkspace(first)).toMatchObject({ status: "imported" });
    expect(destination.projects.get(project.key).name).toBe(project.name);
    expect(destination.tasks.get(task.key).progress.map((entry) => entry.content)).toEqual(["preserve me"]);
    source.close();
    destination.close();
  });

  it("records a receipt so replay after temporal interruption is idempotent", () => {
    const source = createTestWorkspace();
    const project = seedProject(source);
    const task = seedTask(source, project.key);
    source.claims.claim(task.key, { actor: "agent", sessionId: "session" });
    const document = source.transfer.exportWorkspace("redacted");
    const destination = createTestWorkspace();
    const first = destination.transfer.importWorkspace(document);
    expect(first.transformed.claims).toHaveLength(1);
    expect(destination.transfer.importWorkspace(document)).toEqual({
      status: "already_imported",
      sourceDigest: document.transfer.canonicalDigest,
      transformed: first.transformed,
    });
    source.close();
    destination.close();
  });

  it("round-trips decision supersession and rejects a replay after destination mutation", () => {
    const source = createTestWorkspace();
    const project = seedProject(source);
    const original = source.decisions.create(project.key, { title: "Original", decision: "Use A", actor: "codex" });
    source.decisions.create(project.key, { title: "Replacement", decision: "Use B", supersedes: original.key, actor: "codex" });
    const document = source.transfer.exportWorkspace("redacted");
    const destination = createTestWorkspace();
    expect(destination.transfer.importWorkspace(document).status).toBe("imported");
    expect(destination.transfer.exportWorkspace("redacted")).toEqual(document);
    destination.database.sqlite.prepare("DELETE FROM projects").run();
    expectErrorCode(() => destination.transfer.importWorkspace(document), "WORKSPACE_IMPORT_CONFLICT");
    source.close();
    destination.close();
  });

  it("rejects malicious columns, dangling references, and task cycles before any write", () => {
    const source = createTestWorkspace();
    const project = seedProject(source);
    const task = seedTask(source, project.key);
    const base = source.transfer.exportWorkspace("redacted");
    const cases = [
      (document: any) => { document.data.projects[0].injected_column = "no"; },
      (document: any) => { document.unexpected = true; },
      (document: any) => { document.data.tasks[0].project_id = "missing-project"; },
      (document: any) => { document.data.tasks[0].parent_task_id = task.id; },
      (document: any) => { document.data.task_dependencies.push({ task_id: task.id, depends_on_task_id: task.id, created_at: "2026-07-01T09:00:00.000Z" }); },
      (document: any) => { document.data.projects[0].status = "not-a-project-status"; },
      (document: any) => { document.data.projects[0].context_version = "0"; },
      (document: any) => { document.transfer.pathMode = "included"; },
      (document: any) => { document.formatVersion = 999; },
      (document: any) => { document.transfer.sourceMigration = "9999_unknown.sql"; },
    ];
    for (const mutate of cases) {
      const document = structuredClone(base); mutate(document); resign(document);
      const destination = createTestWorkspace();
      expectErrorCode(() => destination.transfer.importWorkspace(document), "WORKSPACE_IMPORT_INVALID");
      expect(destination.projects.list({}).projects).toEqual([]);
      destination.close();
    }
    const digestMismatch = structuredClone(base);
    digestMismatch.transfer.canonicalDigest = "0".repeat(64);
    const digestDestination = createTestWorkspace();
    expectErrorCode(
      () => digestDestination.transfer.importWorkspace(digestMismatch),
      "WORKSPACE_IMPORT_INVALID",
    );
    expect(digestDestination.projects.list({}).projects).toEqual([]);
    digestDestination.close();
    source.close();
  });

  it("rejects non-monotonic activity and rolls back if derived search rebuilding fails", () => {
    const source = createTestWorkspace();
    const project = seedProject(source);
    const task = seedTask(source, project.key);
    source.tasks.addProgress(task.key, { content: "one", actor: "codex" });
    source.tasks.addProgress(task.key, { content: "two", actor: "codex" });
    const document = source.transfer.exportWorkspace("redacted");

    const reordered = structuredClone(document);
    reordered.data.activity_events.reverse();
    resign(reordered);
    const invalidDestination = createTestWorkspace();
    expectErrorCode(
      () => invalidDestination.transfer.importWorkspace(reordered),
      "WORKSPACE_IMPORT_INVALID",
    );
    expect(invalidDestination.projects.list({}).projects).toEqual([]);

    const rollbackDestination = createTestWorkspace();
    const failingTransfer = createWorkspaceTransferService(
      rollbackDestination.runtime,
      {
        refreshScope() {
          throw new Error("injected search rebuild failure");
        },
      } as any,
    );
    expect(() => failingTransfer.importWorkspace(document)).toThrow(
      /injected search rebuild failure/,
    );
    expect(rollbackDestination.projects.list({}).projects).toEqual([]);
    expect(
      rollbackDestination.database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM workspace_transfer_receipts")
        .get(),
    ).toEqual({ count: 0 });

    source.close();
    invalidDestination.close();
    rollbackDestination.close();
  });
});

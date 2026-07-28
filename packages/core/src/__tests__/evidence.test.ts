import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

describe("typed acceptance evidence and completion policies", () => {
  let workspace: TestWorkspace;
  let root: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    root = mkdtempSync(join(tmpdir(), "agent-continuity-evidence-"));
  });

  afterEach(() => {
    workspace.close();
    rmSync(root, { recursive: true, force: true });
  });

  function criterionTask() {
    const project = seedProject(workspace);
    const task = seedTask(workspace, project.key, "Evidence task", {
      status: "ready",
      acceptanceCriteria: ["Proof exists"],
    });
    return {
      project,
      task,
      criterion: workspace.tasks.get(task.key).acceptanceCriteria[0]!,
    };
  }

  function bound() {
    const fixture = criterionTask();
    const repository = workspace.repositories.create(fixture.project.key, {
      label: "Repository",
      rootPath: root,
    });
    workspace.claims.claim(fixture.task.key, {
      actor: "codex",
      sessionId: "session",
    });
    const worktree = workspace.repositories.bindWorktree(fixture.task.key, {
      repository: repository.key,
      worktreePath: root,
      actor: "codex",
      sessionId: "session",
    });
    return { ...fixture, repository, worktree };
  }

  it("round-trips every writable kind and never exposes an absolute local path", () => {
    const { task, criterion, repository, worktree } = bound();
    const sha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    const scope = {
      repository: repository.key,
      executionId: worktree.executionId,
      worktreeId: worktree.id,
      sha,
    };
    workspace.evidence.add(task.key, criterion.id, {
      kind: "commit",
      scope,
      summary: "Commit proof",
    });
    workspace.evidence.add(task.key, criterion.id, {
      kind: "test",
      name: "unit",
      outcome: "passed",
      reference: "pnpm test",
      scope,
    });
    workspace.evidence.add(task.key, criterion.id, {
      kind: "file",
      path: "src/index.ts",
      description: "Implementation",
      scope,
    });
    workspace.evidence.add(task.key, criterion.id, {
      kind: "url",
      url: "https://example.test/report",
      title: "Report",
    });
    workspace.evidence.add(task.key, criterion.id, {
      kind: "result",
      summary: "Reviewed",
      outcome: "informational",
    });
    workspace.evidence.add(task.key, criterion.id, {
      kind: "note",
      content: "Human observation",
    });

    const rows = workspace.evidence.list(task.key, criterion.id);
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "commit",
      "file",
      "note",
      "result",
      "test",
      "url",
    ]);
    expect(rows.find((row) => row.kind === "commit")!.scope?.sha).toBe(sha.toLowerCase());
    expect(JSON.stringify(rows)).not.toContain(root);
    expect(workspace.tasks.get(task.key).acceptanceCriteria[0]!.evidence).toHaveLength(6);
  });

  it("rejects legacy writes, unsafe file paths and repository/binding mismatches", () => {
    const { project, task, criterion, repository, worktree } = bound();
    expectErrorCode(
      () =>
        workspace.evidence.add(task.key, criterion.id, {
          kind: "legacy",
          content: "not writable",
        } as never),
      "VALIDATION_ERROR",
    );
    expectErrorCode(
      () =>
        workspace.evidence.add(task.key, criterion.id, {
          kind: "file",
          path: "../secret",
        } as never),
      "VALIDATION_ERROR",
    );
    const otherRoot = mkdtempSync(join(tmpdir(), "agent-continuity-evidence-other-"));
    try {
      const otherRepository = workspace.repositories.create(project.key, {
        label: "Other",
        rootPath: otherRoot,
      });
      expectErrorCode(
        () =>
          workspace.evidence.add(task.key, criterion.id, {
            kind: "commit",
            scope: {
              repository: otherRepository.key,
              executionId: worktree.executionId,
              worktreeId: worktree.id,
              sha: "a".repeat(40),
            },
          }),
        "GIT_PROVENANCE_MISMATCH",
      );
      expect(repository.key).not.toBe(otherRepository.key);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("preserves default completion behavior and reports precise policy failures", () => {
    const { task, criterion } = criterionTask();
    workspace.tasks.completeAcceptanceCriterion(task.key, criterion.id);
    expect(workspace.tasks.complete(task.key, { force: false }).status).toBe("done");

    workspace.tasks.update(task.key, { status: "in_progress" });
    workspace.evidence.setPolicy(task.key, criterion.id, {
      minimumCount: 2,
      qualifyingKinds: ["test", "commit"],
      requireSha: true,
      requirePassingVerification: true,
    });
    workspace.evidence.add(task.key, criterion.id, {
      kind: "test",
      name: "manual test",
      outcome: "passed",
    });
    const error = expectErrorCode(
      () => workspace.tasks.complete(task.key, { force: false }),
      "TASK_HAS_MISSING_ACCEPTANCE_EVIDENCE",
    );
    expect(error.details.missing).toEqual([
      expect.objectContaining({
        criterionId: criterion.id,
        description: "Proof exists",
        requiredKinds: ["test", "commit"],
        requiredCount: 2,
        actualQualifyingCount: 0,
        failedRequirements: expect.arrayContaining(["sha", "passing_verification", "minimum_count"]),
      }),
    ]);
  });

  it("requires a core force reason and audits overridden missing evidence", () => {
    const { task, criterion } = criterionTask();
    workspace.tasks.completeAcceptanceCriterion(task.key, criterion.id);
    workspace.evidence.setPolicy(task.key, criterion.id, {
      minimumCount: 1,
      qualifyingKinds: ["commit"],
      requireSha: true,
      requirePassingVerification: false,
    });
    expectErrorCode(
      () => workspace.tasks.complete(task.key, { force: true } as never),
      "VALIDATION_ERROR",
    );
    expect(
      workspace.tasks.complete(task.key, {
        force: true,
        reason: "External approval supersedes repository proof",
      }).status,
    ).toBe("done");
    const completed = workspace.activity
      .listForProject(task.projectKey, { limit: 100 })
      .events.find((event) => event.eventType === "task.completed");
    expect(completed?.payload.reason).toBe("External approval supersedes repository proof");
    expect(completed?.payload.missingEvidence).toEqual([
      expect.objectContaining({ criterionId: criterion.id }),
    ]);
  });

  it("qualifies only stable passing local verification with a scoped SHA", () => {
    const { task, criterion, repository, worktree } = bound();
    workspace.tasks.completeAcceptanceCriterion(task.key, criterion.id);
    workspace.evidence.setPolicy(task.key, criterion.id, {
      minimumCount: 1,
      qualifyingKinds: ["test"],
      requireSha: true,
      requirePassingVerification: true,
    });
    const sha = "b".repeat(40);
    const base = {
      source: "local_cli" as const,
      name: "suite",
      command: { executable: "node", args: ["--test"], cwd: null },
      timeoutMs: 60_000,
      outputLimitBytes: 65_536,
      startedAt: "2026-07-27T19:00:00.000Z",
      finishedAt: "2026-07-27T19:00:01.000Z",
      durationMs: 1000,
      exitCode: 0,
      signal: null,
      error: null,
      stdoutTail: "ok",
      stderrTail: "",
      stdoutBytes: 2,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      startSha: sha,
      endSha: sha,
      startDirty: true,
      endDirty: true,
      revisionStable: true,
    };
    workspace.evidence.add(task.key, criterion.id, {
      kind: "test",
      name: "suite",
      outcome: "failed",
      verification: { ...base, outcome: "failed", exitCode: 1 },
      scope: {
        repository: repository.key,
        executionId: worktree.executionId,
        worktreeId: worktree.id,
        sha,
      },
    });
    expectErrorCode(
      () => workspace.tasks.complete(task.key, { force: false }),
      "TASK_HAS_MISSING_ACCEPTANCE_EVIDENCE",
    );
    workspace.evidence.add(task.key, criterion.id, {
      kind: "test",
      name: "suite",
      outcome: "passed",
      verification: { ...base, outcome: "passed" },
      scope: {
        repository: repository.key,
        executionId: worktree.executionId,
        worktreeId: worktree.id,
        sha,
      },
    });
    expect(workspace.tasks.complete(task.key, { force: false }).status).toBe("done");
  });
});

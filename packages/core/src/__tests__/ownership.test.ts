import {
  executionGitBaselines,
  executionGitSnapshots,
  executionGitTouchedPaths,
} from "@agent-continuity/database";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

const temporaryDirectories: string[] = [];

function directory(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `agent-continuity-ownership-${label}-`));
  temporaryDirectories.push(path);
  return path;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    timeout: 10_000,
    windowsHide: true,
  });
}

function initialiseRepository(label: string): string {
  const root = directory(label);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Agent Continuity Test");
  git(root, "config", "user.email", "test@agent-continuity.invalid");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git(root, "add", "--", "seed.txt");
  git(root, "commit", "-m", "initial");
  return root;
}

describe("execution path ownership and collision advisories", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.close();
    for (const path of temporaryDirectories.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function setup(repositoryRoot = directory("repository")) {
    const project = seedProject(workspace);
    const repository = workspace.repositories.create(project.key, {
      label: "Main",
      rootPath: repositoryRoot,
    });
    return { project, repository };
  }

  function boundTask(
    project: ReturnType<typeof seedProject>,
    repositoryKey: string,
    worktreePath: string,
    title: string,
    actor: string,
  ) {
    const task = seedTask(workspace, project.key, title, { status: "ready" });
    workspace.claims.claim(task.key, { actor, sessionId: actor });
    const worktree = workspace.repositories.bindWorktree(task.key, {
      repository: repositoryKey,
      worktreePath,
      actor,
      sessionId: actor,
    });
    const execution = workspace.executions.activeFor(task.id);
    if (!execution) throw new Error("Expected a running execution.");
    return { task, execution, worktree };
  }

  function replace(
    task: { key: string },
    actor: string,
    paths: Array<{ path: string; kind: "file" | "directory" }>,
  ) {
    return workspace.ownership.replace(task.key, {
      paths,
      actor,
      sessionId: actor,
    });
  }

  it("derives exact same-worktree warnings without preventing either claim", () => {
    const root = directory("same-worktree");
    const { project, repository } = setup(root);
    const first = boundTask(project, repository.key, root, "First", "agent-a");
    const second = boundTask(project, repository.key, root, "Second", "agent-b");

    replace(first.task, "agent-a", [{ path: "src/shared.ts", kind: "file" }]);
    const result = replace(second.task, "agent-b", [
      { path: "src/shared.ts", kind: "file" },
    ]);

    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]).toMatchObject({
      worktreeRelation: "same_worktree",
      strength: "high",
      task: { taskKey: second.task.key },
      counterpart: { taskKey: first.task.key },
      overlaps: [
        {
          taskPath: "src/shared.ts",
          taskSource: "declared",
          counterpartPath: "src/shared.ts",
          counterpartSource: "declared",
        },
      ],
    });
    expect(workspace.tasks.get(first.task.key).claim).not.toBeNull();
    expect(workspace.tasks.get(second.task.key).claim).not.toBeNull();
    expect(
      workspace.executions
        .needsAttention(project.key)
        .filter((item) => item.reason === "path_collision"),
    ).toHaveLength(2);
  });

  it("uses slash-boundary directory prefixes and distinguishes separate worktrees", () => {
    const root = directory("prefix-root");
    const worktreeA = directory("prefix-a");
    const worktreeB = directory("prefix-b");
    const { project, repository } = setup(root);
    const first = boundTask(project, repository.key, worktreeA, "Directory", "agent-a");
    const second = boundTask(project, repository.key, worktreeB, "File", "agent-b");

    replace(first.task, "agent-a", [{ path: "src/foo", kind: "directory" }]);
    const overlap = replace(second.task, "agent-b", [
      { path: "src/foo/child.ts", kind: "file" },
    ]);
    expect(overlap.collisions[0]).toMatchObject({
      worktreeRelation: "separate_worktrees",
      strength: "normal",
    });

    const unrelatedPrefix = replace(second.task, "agent-b", [
      { path: "src/foobar.ts", kind: "file" },
    ]);
    expect(unrelatedPrefix.collisions).toEqual([]);
    expect(unrelatedPrefix.ownership.version).toBe(2);
    expect(workspace.ownership.forTask(second.task.key)?.supersededAt).toBeNull();
  });

  it("never compares matching paths from different repository identities", () => {
    const rootA = directory("repo-a");
    const rootB = directory("repo-b");
    const project = seedProject(workspace);
    const repositoryA = workspace.repositories.create(project.key, {
      label: "A",
      rootPath: rootA,
    });
    const repositoryB = workspace.repositories.create(project.key, {
      label: "B",
      rootPath: rootB,
    });
    const first = boundTask(project, repositoryA.key, rootA, "A task", "agent-a");
    const second = boundTask(project, repositoryB.key, rootB, "B task", "agent-b");

    replace(first.task, "agent-a", [{ path: "src/shared.ts", kind: "file" }]);
    expect(
      replace(second.task, "agent-b", [{ path: "src/shared.ts", kind: "file" }]).collisions,
    ).toEqual([]);
  });

  it("removes released and expired executions from warnings while retaining history", () => {
    const root = directory("release");
    const { project, repository } = setup(root);
    const first = boundTask(project, repository.key, root, "First", "agent-a");
    const second = boundTask(project, repository.key, root, "Second", "agent-b");
    replace(first.task, "agent-a", [{ path: "shared.ts", kind: "file" }]);
    replace(second.task, "agent-b", [{ path: "shared.ts", kind: "file" }]);

    workspace.claims.release(second.task.key, {
      actor: "agent-b",
      sessionId: "agent-b",
      reason: "handoff",
    });
    expect(workspace.ownership.collisionsForTask(first.task.key)).toEqual([]);
    expect(workspace.ownership.forTask(second.task.key)).toMatchObject({
      taskKey: second.task.key,
      paths: [expect.objectContaining({ path: "shared.ts" })],
    });

    const third = boundTask(project, repository.key, root, "Third", "agent-c");
    replace(third.task, "agent-c", [{ path: "shared.ts", kind: "file" }]);
    expect(workspace.ownership.collisionsForTask(first.task.key)).toHaveLength(1);
    workspace.advanceMinutes(31);
    expect(workspace.ownership.allWarnings()).toEqual([]);
  });

  it("folds latest successful observed paths into checkpoint advisories", async () => {
    const root = initialiseRepository("observed");
    const { project, repository } = setup(root);
    const observedTask = seedTask(workspace, project.key, "Observed", { status: "ready" });
    const declaredTask = seedTask(workspace, project.key, "Declared", { status: "ready" });
    await workspace.workflows.startWork(observedTask.key, {
      actor: "agent-a",
      sessionId: "agent-a",
      worktree: { repository: repository.key, worktreePath: root },
    });
    await workspace.workflows.startWork(declaredTask.key, {
      actor: "agent-b",
      sessionId: "agent-b",
      worktree: { repository: repository.key, worktreePath: root },
      ownership: [{ path: "src/generated.ts", kind: "file" }],
    });

    writeFileSync(join(root, "src-generated.tmp"), "unrelated\n");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "generated.ts"), "generated\n", { flag: "w" });
    const report = await workspace.workflows.report(observedTask.key, {
      actor: "agent-a",
      sessionId: "agent-a",
      checkpoint: {
        completed: "Generated a file",
        workingOn: "Coordination",
        next: "Resolve the advisory",
      },
    });
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]?.overlaps).toEqual([
      expect.objectContaining({
        taskPath: "src/generated.ts",
        taskSource: "observed",
        counterpartPath: "src/generated.ts",
        counterpartSource: "declared",
      }),
    ]);
  });

  it("rejects absolute, Windows, UNC, traversal, glob and symlink-escape paths", () => {
    const root = directory("safe-root");
    const outside = directory("safe-outside");
    symlinkSync(outside, join(root, "escape"), "dir");
    const { project, repository } = setup(root);
    const bound = boundTask(project, repository.key, root, "Safe paths", "agent-a");
    const invalid = [
      "/absolute/file.ts",
      "C:/outside",
      "C:\\outside",
      "\\\\server\\share",
      "//server/share",
      "../outside",
      "src/*.ts",
    ];
    for (const path of invalid) {
      expectErrorCode(
        () => replace(bound.task, "agent-a", [{ path, kind: "file" }]),
        "VALIDATION_ERROR",
      );
    }
    expectErrorCode(
      () => replace(bound.task, "agent-a", [{ path: "escape/file.ts", kind: "file" }]),
      "REPOSITORY_PATH_INVALID",
    );
  });

  it("keeps large unrelated observed snapshots bounded", () => {
    const root = directory("large");
    const { project, repository } = setup(root);
    const first = boundTask(project, repository.key, root, "Large A", "agent-a");
    const second = boundTask(project, repository.key, root, "Large B", "agent-b");

    workspace.runtime.tx(() => {
      for (const [index, live] of [first, second].entries()) {
        const baselineId = `baseline-${index}`;
        const snapshotId = `snapshot-${index}`;
        workspace.runtime.db.insert(executionGitBaselines).values({
          id: baselineId,
          executionId: live.execution.id,
          worktreeId: live.worktree.id,
          repositoryId: repository.id,
          worktreePathKey: live.worktree.worktreePath,
          source: "local_git",
          status: "ok",
          branch: "main",
          detached: 0,
          headSha: "a".repeat(40),
          dirty: 0,
          capturedAt: workspace.runtime.now(),
        }).run();
        workspace.runtime.db.insert(executionGitSnapshots).values({
          id: snapshotId,
          baselineId,
          executionId: live.execution.id,
          sequence: 1,
          trigger: "manual",
          source: "local_git",
          status: "ok",
          branch: "main",
          detached: 0,
          headSha: "a".repeat(40),
          dirty: 1,
          commitShasJson: "[]",
          additions: 0,
          deletions: 0,
          filesChanged: 5_000,
          capturedAt: workspace.runtime.now(),
        }).run();
        for (let pathIndex = 0; pathIndex < 5_000; pathIndex += 1) {
          workspace.runtime.db.insert(executionGitTouchedPaths).values({
            id: `${snapshotId}-path-${pathIndex}`,
            snapshotId,
            path: `${index === 0 ? "alpha" : "omega"}/path-${pathIndex}.ts`,
            previousPath: null,
            changeKind: "modified",
            additions: null,
            deletions: null,
          }).run();
        }
      }
    });

    const startedAt = performance.now();
    expect(workspace.ownership.allWarnings()).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});

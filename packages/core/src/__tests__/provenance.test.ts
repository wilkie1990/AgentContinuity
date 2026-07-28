import type { GitProvenanceSnapshot } from "@agent-continuity/contracts";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
import { LocalGitInspector } from "../provenance/git.js";

const temporaryDirectories: string[] = [];

function directory(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `agent-continuity-${label}-`));
  temporaryDirectories.push(path);
  return path;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    maxBuffer: 512 * 1024,
    timeout: 10_000,
    windowsHide: true,
  });
}

function initialiseRepository(label = "repository"): string {
  const root = directory(label);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Agent Continuity Test");
  git(root, "config", "user.email", "test@agent-continuity.invalid");
  writeFileSync(join(root, "alpha.txt"), "alpha\n");
  writeFileSync(join(root, "rename-me.txt"), "rename me\n");
  git(root, "add", "--", "alpha.txt", "rename-me.txt");
  git(root, "commit", "-m", "initial");
  return root;
}

function latestSnapshot(workspace: TestWorkspace, taskRef: string): GitProvenanceSnapshot {
  const snapshot = workspace.provenance.forTask(taskRef)?.snapshots.at(-1);
  if (!snapshot) throw new Error("Expected a Git provenance snapshot.");
  return snapshot;
}

describe("Git execution provenance", () => {
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

  it("captures a clean baseline and structured committed, renamed and dirty paths", async () => {
    const root = initialiseRepository("provenance");
    const project = seedProject(workspace);
    const repository = workspace.repositories.create(project.key, {
      label: "Main",
      rootPath: root,
    });
    const task = seedTask(workspace, project.key, "Capture changes", { status: "ready" });
    const statusBefore = git(root, "status", "--porcelain=v1", "-z");

    const started = await workspace.workflows.startWork(task.key, {
      actor: "codex",
      sessionId: "git-run",
      worktree: {
        repository: repository.key,
        worktreePath: root,
        branch: "caller-supplied-branch-is-not-trusted",
      },
    });
    const baseline = started.execution.provenance?.baseline;
    expect(baseline).toMatchObject({
      source: "local_git",
      status: "ok",
      branch: "main",
      detached: false,
      dirty: false,
    });
    expect(baseline?.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(root, "status", "--porcelain=v1", "-z")).toBe(statusBefore);

    writeFileSync(join(root, "alpha.txt"), "alpha changed\n");
    renameSync(join(root, "rename-me.txt"), join(root, "renamed.txt"));
    git(root, "add", "-A");
    git(root, "commit", "-m", "change and rename");
    writeFileSync(join(root, "renamed.txt"), "dirty after commit\n");
    writeFileSync(join(root, "untracked.txt"), "untracked\n");

    const reported = await workspace.workflows.report(task.key, {
      actor: "codex",
      sessionId: "git-run",
      checkpoint: {
        completed: "Changed tracked files",
        workingOn: "Dirty verification",
        next: "Complete",
      },
    });
    const snapshot = reported.provenance;
    expect(snapshot).toMatchObject({
      source: "local_git",
      status: "ok",
      trigger: "checkpoint",
      branch: "main",
      detached: false,
      dirty: true,
    });
    expect(snapshot?.commitShas).toEqual([snapshot?.headSha]);
    expect(snapshot?.filesChanged).toBeGreaterThanOrEqual(3);
    expect(snapshot?.touchedPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "alpha.txt", change: "modified" }),
        expect.objectContaining({
          path: "renamed.txt",
          previousPath: "rename-me.txt",
          change: "renamed",
        }),
        expect.objectContaining({ path: "untracked.txt", change: "untracked" }),
      ]),
    );
    expect(snapshot?.touchedPaths.every((path) => !path.path.startsWith("/"))).toBe(true);

    unlinkSync(join(root, "alpha.txt"));
    const completed = await workspace.workflows.complete(task.key, {
      force: false,
      actor: "codex",
      sessionId: "git-run",
    });
    expect(completed.status).toBe("done");
    const completion = latestSnapshot(workspace, task.key);
    expect(completion.trigger).toBe("completion");
    expect(completion.touchedPaths).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "alpha.txt", change: "deleted" })]),
    );
  });

  it("handles detached HEAD, unborn repositories and linked worktrees", async () => {
    const root = initialiseRepository("states");
    const project = seedProject(workspace);
    const repository = workspace.repositories.create(project.key, {
      label: "States",
      rootPath: root,
    });

    git(root, "checkout", "--detach", "HEAD");
    const detachedTask = seedTask(workspace, project.key, "Detached", { status: "ready" });
    const detached = await workspace.workflows.startWork(detachedTask.key, {
      actor: "codex",
      sessionId: "detached",
      worktree: { repository: repository.key, worktreePath: root },
    });
    expect(detached.execution.provenance?.baseline).toMatchObject({
      status: "ok",
      branch: null,
      detached: true,
    });
    await workspace.workflows.handoff(detachedTask.key, {
      actor: "codex",
      sessionId: "detached",
      checkpoint: {
        completed: "Detached capture",
        workingOn: "Nothing",
        next: "Linked worktree",
      },
    });

    git(root, "switch", "main");
    const linked = directory("linked-worktree");
    rmSync(linked, { recursive: true, force: true });
    git(root, "worktree", "add", "-b", "feature/linked", linked);
    const linkedTask = seedTask(workspace, project.key, "Linked", { status: "ready" });
    const linkedStart = await workspace.workflows.startWork(linkedTask.key, {
      actor: "codex",
      sessionId: "linked",
      worktree: { repository: repository.key, worktreePath: linked },
    });
    expect(linkedStart.execution.provenance?.baseline).toMatchObject({
      status: "ok",
      branch: "feature/linked",
      detached: false,
    });

    const unbornRoot = directory("unborn");
    git(unbornRoot, "init", "-b", "trunk");
    const unbornRepository = workspace.repositories.create(project.key, {
      label: "Unborn",
      rootPath: unbornRoot,
    });
    const unbornTask = seedTask(workspace, project.key, "Unborn", { status: "ready" });
    const unborn = await workspace.workflows.startWork(unbornTask.key, {
      actor: "codex",
      sessionId: "unborn",
      worktree: { repository: unbornRepository.key, worktreePath: unbornRoot },
    });
    expect(unborn.execution.provenance?.baseline).toMatchObject({
      status: "ok",
      branch: "trunk",
      detached: false,
      headSha: null,
      dirty: false,
    });
    writeFileSync(join(unbornRoot, "first.txt"), "first\n");
    const unbornSnapshot = await workspace.git.captureSnapshot(unbornTask.key, {
      trigger: "manual",
    });
    expect(unbornSnapshot).toMatchObject({ status: "ok", headSha: null, dirty: true });
    expect(unbornSnapshot?.touchedPaths).toEqual([
      expect.objectContaining({ path: "first.txt", change: "untracked" }),
    ]);

    git(unbornRoot, "config", "user.name", "Agent Continuity Test");
    git(unbornRoot, "config", "user.email", "test@agent-continuity.invalid");
    git(unbornRoot, "add", "--", "first.txt");
    git(unbornRoot, "commit", "-m", "first commit");
    writeFileSync(join(unbornRoot, "first.txt"), "first\nsecond\n");
    const committedFromUnborn = await workspace.git.captureSnapshot(unbornTask.key, {
      trigger: "manual",
    });
    expect(committedFromUnborn).toMatchObject({
      status: "ok",
      dirty: true,
      commitShas: [committedFromUnborn?.headSha],
      additions: 2,
      deletions: 0,
      filesChanged: 1,
    });
    expect(committedFromUnborn?.touchedPaths).toEqual([
      expect.objectContaining({
        path: "first.txt",
        change: "added",
        additions: 2,
        deletions: 0,
      }),
    ]);
  });

  it("records graceful errors without rolling back task state or inferring process cwd", async () => {
    const notGit = directory("not-git");
    const project = seedProject(workspace);
    const repository = workspace.repositories.create(project.key, {
      label: "Not Git",
      rootPath: notGit,
    });
    const task = seedTask(workspace, project.key, "Graceful capture", { status: "ready" });

    const started = await workspace.workflows.startWork(task.key, {
      actor: "codex",
      sessionId: "not-git",
      worktree: { repository: repository.key, worktreePath: notGit },
    });
    expect(started.task.status).toBe("in_progress");
    expect(started.execution.provenance?.baseline).toMatchObject({
      source: "local_git",
      status: "error",
      error: { code: "not_git_repository" },
    });

    const checkpointed = await workspace.workflows.report(task.key, {
      actor: "codex",
      sessionId: "not-git",
      checkpoint: {
        completed: "Non-Git work",
        workingOn: "Continuity",
        next: "Keep going",
      },
    });
    expect(checkpointed.checkpoint).not.toBeNull();
    expect(checkpointed.provenance).toMatchObject({
      status: "error",
      error: { code: "not_git_repository" },
    });
    expect(workspace.tasks.get(task.key).status).toBe("in_progress");

    const moved = `${notGit}-moved`;
    renameSync(notGit, moved);
    temporaryDirectories.push(moved);
    const unavailable = await workspace.git.captureSnapshot(task.key, { trigger: "manual" });
    expect(unavailable).toMatchObject({
      status: "error",
      error: { code: "worktree_unavailable" },
    });
    expect(workspace.tasks.get(task.key).claim).not.toBeNull();
  });

  it("rejects explicit provenance that does not match the stored binding", () => {
    const firstRoot = initialiseRepository("identity-a");
    const secondRoot = initialiseRepository("identity-b");
    const project = seedProject(workspace);
    const first = workspace.repositories.create(project.key, {
      label: "First",
      rootPath: firstRoot,
    });
    const second = workspace.repositories.create(project.key, {
      label: "Second",
      rootPath: secondRoot,
    });
    const task = seedTask(workspace, project.key, "Identity validation", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "identity" });
    const binding = workspace.repositories.bindWorktree(task.key, {
      repository: first.key,
      worktreePath: firstRoot,
      actor: "codex",
      sessionId: "identity",
    });
    const execution = workspace.executions.activeFor(task.id)!;

    expectErrorCode(
      () =>
        workspace.provenance.recordBaseline(task.key, {
          executionId: execution.id,
          worktreeId: binding.id,
          repositoryId: second.id,
          source: "local_git",
          inspection: {
            status: "ok",
            branch: "main",
            detached: false,
            headSha: "1111111111111111111111111111111111111111",
            dirty: false,
            error: null,
          },
        }),
      "GIT_PROVENANCE_MISMATCH",
    );
    expect(workspace.provenance.forTask(task.key)).toBeNull();

    workspace.provenance.recordBaseline(task.key, {
      executionId: execution.id,
      worktreeId: binding.id,
      repositoryId: first.id,
      source: "local_git",
      inspection: {
        status: "ok",
        branch: "main",
        detached: false,
        headSha: "1111111111111111111111111111111111111111",
        dirty: false,
        error: null,
      },
    });
    expectErrorCode(
      () =>
        workspace.repositories.bindWorktree(task.key, {
          repository: second.key,
          worktreePath: secondRoot,
          actor: "codex",
          sessionId: "identity",
        }),
      "GIT_PROVENANCE_MISMATCH",
    );
    expect(workspace.repositories.worktree(task.key)).toMatchObject({
      repositoryId: first.id,
    });
  });

  it("preserves rename and binary diff facts with bounded structured output", async () => {
    const root = initialiseRepository("binary");
    writeFileSync(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    git(root, "add", "--", "binary.dat");
    git(root, "commit", "-m", "binary baseline");
    const project = seedProject(workspace);
    const repository = workspace.repositories.create(project.key, {
      label: "Binary",
      rootPath: root,
    });
    const task = seedTask(workspace, project.key, "Binary change", { status: "ready" });
    writeFileSync(join(root, "alpha.txt"), "dirty before start\n");
    const started = await workspace.workflows.startWork(task.key, {
      actor: "codex",
      sessionId: "binary",
      worktree: { repository: repository.key, worktreePath: root },
    });
    expect(started.execution.provenance?.baseline).toMatchObject({
      status: "ok",
      dirty: true,
    });

    writeFileSync(join(root, "binary.dat"), Buffer.from([0, 9, 8, 7]));
    const snapshot = await workspace.git.captureSnapshot(task.key, { trigger: "manual" });
    const binary = snapshot?.touchedPaths.find((path) => path.path === "binary.dat");
    expect(binary).toMatchObject({
      change: "modified",
      additions: null,
      deletions: null,
    });
    expect(snapshot?.touchedPaths).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "alpha.txt" })]),
    );
  });

  it("turns bounded-command output overflow into a structured capture error", async () => {
    const root = initialiseRepository("bounded-output");
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(join(root, `long-untracked-file-name-${index}.txt`), `${index}\n`);
    }
    const inspector = new LocalGitInspector({ maxOutputBytes: 96 });
    const result = await inspector.inspectBaseline(root);
    expect(result).toMatchObject({
      status: "error",
      error: { code: "output_limit" },
    });
  });
});

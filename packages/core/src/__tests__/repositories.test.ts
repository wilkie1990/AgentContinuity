import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepositoryPathResolver } from "../repositories/paths.js";
import {
  createTestWorkspace,
  expectErrorCode,
  expectErrorCodeAsync,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

const temporaryDirectories: string[] = [];

function tempDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `agent-continuity-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

describe("repository and execution worktree associations", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("associates canonical roots explicitly and keeps generic repository links", () => {
    const project = seedProject(workspace);
    const root = tempDirectory("repository");

    expect(workspace.repositories.list(project.key)).toEqual([]);
    const repository = workspace.repositories.create(project.key, {
      label: "API",
      rootPath: `${root}/.`,
      remoteUrl: "https://example.test/team/api.git/",
      actor: "codex",
    });
    workspace.links.add(project.key, {
      type: "repository",
      provider: "github",
      url: "https://github.com/example/api",
    });

    expect(repository.key).toBe("REP-0001");
    expect(repository.rootPath).toBe(realpathSync.native(root));
    expect(repository.remoteUrl).toBe("https://example.test/team/api.git");
    expect(repository.primary).toBe(true);
    expect(repository.availability.status).toBe("available");
    expect(workspace.links.list(project.key, {})).toHaveLength(1);

    expectErrorCode(
      () =>
        workspace.repositories.create(project.key, {
          label: "Relative",
          rootPath: "relative/repository",
        }),
      "REPOSITORY_PATH_INVALID",
    );
  });

  it("supports multiple repositories, atomic primary transfer and symlink deduplication", () => {
    const project = seedProject(workspace);
    const firstRoot = tempDirectory("first-repository");
    const secondRoot = tempDirectory("second-repository");
    const symlinkParent = tempDirectory("repository-link");
    const alias = join(symlinkParent, "alias");
    symlinkSync(firstRoot, alias, "dir");

    const first = workspace.repositories.create(project.key, {
      label: "First",
      rootPath: firstRoot,
    });
    const second = workspace.repositories.create(project.key, {
      label: "Second",
      rootPath: secondRoot,
    });
    expect(first.primary).toBe(true);
    expect(second.primary).toBe(false);

    workspace.repositories.update(project.key, second.key, { primary: true, actor: "codex" });
    expect(
      workspace.repositories.list(project.key).map((repository) => [
        repository.key,
        repository.primary,
      ]),
    ).toEqual([
      [first.key, false],
      [second.key, true],
    ]);

    expectErrorCode(
      () =>
        workspace.repositories.create(project.key, {
          label: "Alias",
          rootPath: alias,
        }),
      "REPOSITORY_ALREADY_ASSOCIATED",
    );

    workspace.repositories.remove(project.key, second.key, { force: false });
    expect(workspace.repositories.get(project.key, first.key).primary).toBe(true);
  });

  it("records distinct worktrees and branches without exposing paths on ordinary task reads", () => {
    const project = seedProject(workspace);
    const root = tempDirectory("monorepo");
    const worktreeA = tempDirectory("worktree-a");
    const worktreeB = tempDirectory("worktree-b");
    const repository = workspace.repositories.create(project.key, {
      label: "Monorepo",
      rootPath: root,
    });
    const first = seedTask(workspace, project.key, "First execution", { status: "ready" });
    const second = seedTask(workspace, project.key, "Second execution", { status: "ready" });
    workspace.claims.claim(first.key, { actor: "codex", sessionId: "run-a" });
    workspace.claims.claim(second.key, { actor: "codex", sessionId: "run-b" });

    const firstBinding = workspace.repositories.bindWorktree(first.key, {
      repository: repository.key,
      worktreePath: worktreeA,
      branch: "feature/a",
      actor: "codex",
      sessionId: "run-a",
    });
    const secondBinding = workspace.repositories.bindWorktree(second.key, {
      repository: repository.key,
      worktreePath: worktreeB,
      branch: "feature/b",
      actor: "codex",
      sessionId: "run-b",
    });

    expect(firstBinding.worktreePath).toBe(realpathSync.native(worktreeA));
    expect(firstBinding.relativePath).toBeNull();
    expect(secondBinding.worktreePath).toBe(realpathSync.native(worktreeB));
    expect(workspace.repositories.worktree(first.key).branch).toBe("feature/a");

    const ordinary = workspace.tasks.get(first.key).execution?.worktree;
    expect(ordinary).toMatchObject({
      repositoryKey: repository.key,
      branch: "feature/a",
    });
    expect(ordinary).not.toHaveProperty("worktreePath");
    expect(ordinary).not.toHaveProperty("relativePath");
  });

  it("atomically starts work with a binding and rolls the claim back when the path is absent", async () => {
    const project = seedProject(workspace);
    const root = tempDirectory("start-repository");
    const repository = workspace.repositories.create(project.key, {
      label: "Start",
      rootPath: root,
    });
    const task = seedTask(workspace, project.key, "Atomic start", { status: "ready" });
    const missing = join(root, "missing-worktree");

    await expectErrorCodeAsync(
      async () =>
        workspace.workflows.startWork(task.key, {
          actor: "codex",
          sessionId: "atomic-run",
          worktree: {
            repository: repository.key,
            worktreePath: missing,
            branch: "feature/atomic",
          },
        }),
      "REPOSITORY_PATH_UNAVAILABLE",
    );
    expect(workspace.tasks.get(task.key).status).toBe("ready");
    expect(workspace.tasks.get(task.key).claim).toBeNull();
    expect(workspace.executions.forTask(task.key).execution).toBeNull();

    const worktree = join(root, "worktree");
    mkdirSync(worktree);
    const result = await workspace.workflows.startWork(task.key, {
      actor: "codex",
      sessionId: "atomic-run",
      worktree: {
        repository: repository.key,
        worktreePath: worktree,
        branch: "feature/atomic",
      },
    });
    expect(result.execution.execution?.worktree).toMatchObject({
      repositoryKey: repository.key,
      branch: "feature/atomic",
    });
    expect(workspace.repositories.worktree(task.key).relativePath).toBe("worktree");
  });

  it("reports moved roots and repairs the stored identity without corrupting it", () => {
    const project = seedProject(workspace);
    const root = tempDirectory("moved-repository");
    const replacement = tempDirectory("replacement-repository");
    const repository = workspace.repositories.create(project.key, {
      label: "Moved",
      rootPath: root,
    });
    const storedRoot = repository.rootPath;

    rmSync(root, { recursive: true, force: true });
    expect(workspace.repositories.get(project.key, repository.key).availability).toMatchObject({
      status: "missing",
    });

    expectErrorCode(
      () =>
        workspace.repositories.update(project.key, repository.key, {
          rootPath: join(root, "still-missing"),
        }),
      "REPOSITORY_PATH_UNAVAILABLE",
    );
    expect(workspace.repositories.get(project.key, repository.key).rootPath).toBe(storedRoot);

    const repaired = workspace.repositories.update(project.key, repository.key, {
      rootPath: replacement,
    });
    expect(repaired.rootPath).toBe(realpathSync.native(replacement));
    expect(repaired.availability.status).toBe("available");
  });

  it("rejects lexical and symlink traversal outside a repository root", () => {
    const root = tempDirectory("path-root");
    const nested = join(root, "nested");
    const outside = tempDirectory("path-outside");
    mkdirSync(nested);
    writeFileSync(join(nested, "file.txt"), "proof");
    symlinkSync(outside, join(root, "escape"), "dir");
    const paths = new RepositoryPathResolver({ caseSensitive: true });

    expect(paths.resolveWithin(root, "nested/file.txt").relativePath).toBe("nested/file.txt");
    expectErrorCode(() => paths.resolveWithin(root, "../outside"), "REPOSITORY_PATH_INVALID");
    expectErrorCode(() => paths.resolveWithin(root, "escape"), "REPOSITORY_PATH_INVALID");
  });

  it("preserves execution bindings unless ended history is removed explicitly", () => {
    const project = seedProject(workspace);
    const root = tempDirectory("safe-removal");
    const repository = workspace.repositories.create(project.key, {
      label: "Safe",
      rootPath: root,
    });
    const task = seedTask(workspace, project.key, "Bound execution", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "safe-run" });
    workspace.repositories.bindWorktree(task.key, {
      repository: repository.key,
      worktreePath: root,
      actor: "codex",
      sessionId: "safe-run",
    });

    expectErrorCode(
      () => workspace.repositories.remove(project.key, repository.key, { force: true }),
      "REPOSITORY_IN_USE",
    );
    workspace.claims.release(task.key, {
      actor: "codex",
      sessionId: "safe-run",
      reason: "finished",
    });
    expectErrorCode(
      () => workspace.repositories.remove(project.key, repository.key, { force: false }),
      "REPOSITORY_IN_USE",
    );

    const removed = workspace.repositories.remove(project.key, repository.key, { force: true });
    expect(removed.removedWorktreeBindings).toBe(1);
    expect(workspace.repositories.list(project.key)).toEqual([]);
  });

  it("cascades repository identity when the owning project is explicitly deleted", () => {
    const project = seedProject(workspace);
    const root = tempDirectory("project-removal");
    const repository = workspace.repositories.create(project.key, {
      label: "Project-owned",
      rootPath: root,
    });
    const task = seedTask(workspace, project.key, "Historical binding", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "delete-run" });
    workspace.repositories.bindWorktree(task.key, {
      repository: repository.key,
      worktreePath: root,
      actor: "codex",
      sessionId: "delete-run",
    });
    workspace.claims.release(task.key, {
      actor: "codex",
      sessionId: "delete-run",
      reason: "finished",
    });

    const deleted = workspace.projects.delete(project.key, { force: false, actor: "adam" });
    expect(deleted.removed.repositories).toBe(1);
    expect(deleted.removed.executionWorktrees).toBe(1);
  });
});

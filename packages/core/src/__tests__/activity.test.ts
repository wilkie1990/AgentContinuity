import { ACTIVITY_EVENT_TYPES } from "@agent-continuity/contracts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestWorkspace, seedProject, seedTask, type TestWorkspace } from "./helpers.js";

const temporaryDirectories: string[] = [];

describe("activity", () => {
  let workspace: TestWorkspace;
  let projectKey: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
    projectKey = seedProject(workspace).key;
  });

  afterEach(() => {
    workspace.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns events newest first regardless of shared timestamps", () => {
    const task = seedTask(workspace, projectKey, "Design claim model", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    workspace.tasks.addProgress(task.key, { content: "Initial lease data model designed.", actor: "codex" });
    workspace.decisions.create(projectKey, {
      task: task.key,
      title: "Use lease-based task claims",
      decision: "Tasks use temporary leases.",
      actor: "codex",
    });

    const events = workspace.activity.listForProject(projectKey, { limit: 50 }).events;
    expect(events[0]?.eventType).toBe("decision.recorded");
    expect(events.map((event) => event.eventType)).toEqual([
      "decision.recorded",
      "task.progress_added",
      "execution.started",
      "task.claimed",
      "task.status_changed",
      "task.created",
      "project.created",
    ]);
  });

  it("paginates with a stable cursor", () => {
    const task = seedTask(workspace, projectKey);
    for (let index = 0; index < 8; index += 1) {
      workspace.tasks.addProgress(task.key, { content: `Milestone ${index}`, actor: "codex" });
    }

    const first = workspace.activity.listForProject(projectKey, { limit: 4 });
    expect(first.events).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();

    const second = workspace.activity.listForProject(projectKey, {
      limit: 4,
      cursor: first.nextCursor!,
    });
    expect(second.events).toHaveLength(4);

    const firstIds = new Set(first.events.map((event) => event.id));
    expect(second.events.some((event) => firstIds.has(event.id))).toBe(false);

    const all = workspace.activity.listForProject(projectKey, { limit: 200 });
    expect(all.nextCursor).toBeNull();
    expect(all.events).toHaveLength(10);
  });

  it("filters by task, event type and actor", () => {
    const first = seedTask(workspace, projectKey, "First");
    const second = seedTask(workspace, projectKey, "Second");
    workspace.tasks.addProgress(first.key, { content: "Codex milestone", actor: "codex" });
    workspace.tasks.addProgress(second.key, { content: "Claude milestone", actor: "claude-code" });

    expect(
      workspace.activity.listForProject(projectKey, { limit: 50, task: first.key }).events.every(
        (event) => event.taskKey === first.key,
      ),
    ).toBe(true);

    expect(
      workspace.activity.listForProject(projectKey, {
        limit: 50,
        eventType: ["task.progress_added"],
      }).events,
    ).toHaveLength(2);

    expect(
      workspace.activity.listForProject(projectKey, { limit: 50, actor: "claude-code" }).events,
    ).toHaveLength(1);
  });

  it("attaches project and task keys to every event", () => {
    const task = seedTask(workspace, projectKey);
    const events = workspace.activity.listForProject(projectKey, { limit: 50 }).events;

    expect(events.every((event) => event.projectKey === projectKey)).toBe(true);
    expect(events.find((event) => event.eventType === "task.created")?.taskKey).toBe(task.key);
    expect(events.find((event) => event.eventType === "project.created")?.taskKey).toBeNull();
  });

  it("exercises every declared event type across the domain", () => {
    const project = seedProject(workspace, "Coverage");
    const dependency = seedTask(workspace, project.key, "Dependency", { status: "ready" });
    const task = seedTask(workspace, project.key, "Main", { status: "ready" });

    workspace.tasks.addDependency(task.key, dependency.key, { actor: "codex" });
    workspace.tasks.removeDependency(task.key, dependency.key, { actor: "codex" });

    workspace.projects.updateContext(project.key, {
      context: "Project memory",
      expectedVersion: 0,
      actor: "codex",
    });
    workspace.projects.update(project.key, { objective: "Updated objective", actor: "codex" });
    const repositoryRoot = mkdtempSync(join(tmpdir(), "agent-continuity-activity-repository-"));
    temporaryDirectories.push(repositoryRoot);
    const repository = workspace.repositories.create(project.key, {
      label: "Main",
      rootPath: repositoryRoot,
      actor: "codex",
    });
    workspace.repositories.update(project.key, repository.key, {
      label: "Main repository",
      actor: "codex",
    });

    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    const binding = workspace.repositories.bindWorktree(task.key, {
      repository: repository.key,
      worktreePath: repositoryRoot,
      actor: "codex",
      sessionId: "abc",
    });
    const executionId = workspace.executions.activeFor(task.id)!.id;
    const baseline = workspace.provenance.recordBaseline(task.key, {
      executionId,
      worktreeId: binding.id,
      repositoryId: repository.id,
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
    workspace.provenance.recordSnapshot(task.key, {
      executionId,
      worktreeId: binding.id,
      repositoryId: repository.id,
      baselineId: baseline.id,
      trigger: "manual",
      source: "local_git",
      inspection: {
        status: "ok",
        branch: "main",
        detached: false,
        headSha: "2222222222222222222222222222222222222222",
        dirty: true,
        error: null,
        commitShas: ["2222222222222222222222222222222222222222"],
        additions: 1,
        deletions: 0,
        filesChanged: 1,
        touchedPaths: [
          {
            path: "src/example.ts",
            previousPath: null,
            change: "modified",
            additions: 1,
            deletions: 0,
          },
        ],
      },
    });
    workspace.ownership.replace(task.key, {
      paths: [{ path: "src/example.ts", kind: "file" }],
      actor: "codex",
      sessionId: "abc",
    });
    workspace.repositories.unbindWorktree(task.key, {
      actor: "codex",
      sessionId: "abc",
    });
    workspace.repositories.remove(project.key, repository.key, {
      force: false,
      actor: "codex",
    });
    workspace.claims.renew(task.key, { actor: "codex", sessionId: "abc" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "abc" });
    workspace.claims.heartbeat(task.key, { actor: "codex", sessionId: "abc", phase: "Designing" });
    workspace.executions.checkpoint(task.key, { completed: "Modelled the domain", workingOn: "Service layer", next: "Add routes", actor: "codex", sessionId: "abc" });
    const [plan] = workspace.executions.setWorkPlan(task.key, { items: ["Design", "Implement"], actor: "codex" });
    workspace.executions.updateWorkPlanItem(task.key, plan!.id, { status: "completed", actor: "codex" });
    workspace.tasks.updateContext(task.key, {
      context: "Task memory",
      expectedVersion: 0,
      actor: "codex",
    });
    workspace.tasks.update(task.key, { title: "Main task", actor: "codex" });
    workspace.tasks.addProgress(task.key, { content: "Data model implemented.", actor: "codex" });

    const criteria = workspace.tasks.addAcceptanceCriteria(task.key, ["Outcome is checkable"], {
      actor: "codex",
    });
    workspace.executions.addEvidence(task.key, criteria[0]!.id, { kind: "test", name: "activity suite", outcome: "passed", reference: "activity.test.ts", actor: "codex" });
    workspace.evidence.setPolicy(task.key, criteria[0]!.id, {
      minimumCount: 1,
      qualifyingKinds: ["test"],
      requireSha: false,
      requirePassingVerification: false,
      actor: "codex",
    });
    workspace.evidence.clearPolicy(task.key, criteria[0]!.id, { actor: "codex" });
    workspace.tasks.completeAcceptanceCriterion(task.key, criteria[0]!.id, { actor: "codex" });
    workspace.tasks.reopenAcceptanceCriterion(task.key, criteria[0]!.id, { actor: "codex" });
    const [discardedCriterion] = workspace.tasks.addAcceptanceCriteria(
      task.key,
      ["Discarded outcome"],
      { actor: "codex" },
    );
    workspace.tasks.deleteAcceptanceCriterion(task.key, discardedCriterion!.id, {
      actor: "codex",
    });

    const blocker = workspace.blockers.add(task.key, { description: "Needs input", actor: "codex" });
    workspace.blockers.resolve(blocker.key, { resolution: "Answered", actor: "adam" });

    const superseded = workspace.decisions.create(project.key, {
      title: "First",
      decision: "Initial choice.",
      actor: "codex",
    });
    workspace.decisions.create(project.key, {
      title: "Second",
      decision: "Revised choice.",
      supersedes: superseded.key,
      actor: "codex",
    });

    const [link] = workspace.links.add(project.key, { type: "issue", reference: "AC-42", actor: "codex" });
    workspace.links.remove(link!.key, { actor: "codex" });

    workspace.claims.release(task.key, { actor: "codex", sessionId: "abc", reason: "handover" });
    workspace.claims.claim(task.key, { actor: "claude-code" });
    workspace.advanceMinutes(31);
    workspace.tasks.getSummary(task.key);

    workspace.tasks.completeAcceptanceCriterion(task.key, criteria[0]!.id, { actor: "claude-code" });
    workspace.tasks.complete(task.key, { force: false, actor: "claude-code" });
    workspace.tasks.update(task.key, { status: "review", actor: "adam" });
    const doomed = seedTask(workspace, project.key, "Created in error");
    workspace.tasks.delete(doomed.key, { force: false, actor: "adam" });

    workspace.projects.archive(project.key, { actor: "adam" });

    const seen = new Set(
      workspace.activity.listForProject(project.key, { limit: 200 }).events.map(
        (event) => event.eventType,
      ),
    );

    expect([...ACTIVITY_EVENT_TYPES].filter((type) => !seen.has(type))).toEqual([]);
  });
});

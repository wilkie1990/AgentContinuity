import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestWorkspace,
  expectErrorCode,
  seedProject,
  seedTask,
  type TestWorkspace,
} from "./helpers.js";

function sourceTypes(workspace: TestWorkspace, query: string) {
  return workspace.search.search({ q: query, limit: 100 }).results.map((result) => result.sourceType);
}

describe("unified search", () => {
  let workspace: TestWorkspace;
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("searches every agreed record type with useful stable scope", () => {
    const project = workspace.projects.create({
      name: "Projectneedle Atlas",
      objective: "Cross-record retrieval",
      context: "projectcontextneedle persistent memory",
      actor: "codex",
    });
    const task = workspace.tasks.create(project.key, {
      title: "Taskneedle implementation",
      description: "Search source coverage",
      context: "taskcontextneedle working memory",
      acceptanceCriteria: ["Criterionneedle is independently searchable"],
      actor: "codex",
    });
    const criterion = workspace.tasks.get(task.key).acceptanceCriteria[0]!;
    workspace.tasks.addProgress(task.key, {
      content: "Progressneedle indexing milestone",
      actor: "codex",
    });
    workspace.decisions.create(project.key, {
      task: task.key,
      title: "Decisionneedle architecture",
      decision: "Use local full text search.",
      rationale: "No external service.",
      actor: "codex",
    });
    workspace.blockers.add(task.key, {
      description: "Blockerneedle missing fixture",
      requiredAction: "Create it",
      actor: "codex",
    });
    workspace.executions.addEvidence(task.key, criterion.id, {
      kind: "test",
      name: "Evidenceneedle",
      outcome: "passed",
      summary: "Evidenceneedle passed",
      actor: "codex",
    });
    workspace.links.add(project.key, {
      task: task.key,
      type: "document",
      reference: "Linkneedle specification",
      actor: "codex",
    });

    expect(sourceTypes(workspace, "Projectneedle")).toContain("project");
    expect(sourceTypes(workspace, "projectcontextneedle")).toContain("project_context");
    expect(sourceTypes(workspace, "Taskneedle")).toContain("task");
    expect(sourceTypes(workspace, "taskcontextneedle")).toContain("task_context");
    expect(sourceTypes(workspace, "Criterionneedle")).toContain("acceptance_criterion");
    expect(sourceTypes(workspace, "Progressneedle")).toContain("progress");
    expect(sourceTypes(workspace, "Decisionneedle")).toContain("decision");
    expect(sourceTypes(workspace, "Blockerneedle")).toContain("blocker");
    expect(sourceTypes(workspace, "Evidenceneedle")).toContain("criterion_evidence");
    expect(sourceTypes(workspace, "Linkneedle")).toContain("link");
    expect(
      workspace.search.search({
        q: "criterion evidence added",
        type: ["activity"],
        limit: 20,
      }).results,
    ).toEqual([
      expect.objectContaining({
        sourceType: "activity",
        projectKey: project.key,
        taskKey: task.key,
      }),
    ]);

    const result = workspace.search.search({
      q: "Evidenceneedle",
      task: task.key,
      type: ["criterion_evidence"],
      limit: 20,
    }).results[0];
    expect(result).toMatchObject({
      sourceType: "criterion_evidence",
      projectId: project.id,
      projectKey: project.key,
      taskId: task.id,
      taskKey: task.key,
      title: `${task.key} criterion evidence`,
    });
    expect(result?.sourceId).toBeTruthy();
    expect(result?.sourceKey).toMatch(new RegExp(`^${task.key}:evidence:`));
    expect(result?.snippet).toContain("[Evidenceneedle]");
    expect(result?.score).toBeGreaterThan(0);
  });

  it("ranks title matches first and filters deterministically by project, task and type", () => {
    const firstProject = seedProject(workspace, "First project");
    const titleMatch = seedTask(workspace, firstProject.key, "Rankneedle title");
    const bodyMatch = seedTask(workspace, firstProject.key, "Other title", {
      description: "Rankneedle appears only in the body",
    });
    const secondProject = seedProject(workspace, "Second project");
    seedTask(workspace, secondProject.key, "Rankneedle elsewhere");

    const projectResults = workspace.search.search({
      q: "Rankneedle",
      project: firstProject.key,
      type: ["task"],
      limit: 20,
    }).results;
    expect(projectResults.map((result) => result.taskKey)).toEqual([
      titleMatch.key,
      bodyMatch.key,
    ]);

    expect(
      workspace.search.search({
        q: "Rankneedle",
        task: bodyMatch.key,
        type: ["task"],
        limit: 20,
      }).results.map((result) => result.taskKey),
    ).toEqual([bodyMatch.key]);

    expectErrorCode(
      () =>
        workspace.search.search({
          q: "Rankneedle",
          project: secondProject.key,
          task: titleMatch.key,
          limit: 20,
        }),
      "VALIDATION_ERROR",
    );

    const firstTie = seedTask(workspace, firstProject.key, "Equalprefix ranking");
    const secondTie = seedTask(workspace, firstProject.key, "Equalprefix ranking");
    expect(
      workspace.search.search({
        q: "Equalpref",
        project: firstProject.key,
        type: ["task"],
        limit: 20,
      }).results.map((result) => result.taskKey),
    ).toEqual([firstTie.key, secondTie.key]);
  });

  it("handles Unicode and punctuation without exposing FTS syntax", () => {
    const project = workspace.projects.create({
      name: "Café résumé",
      objective: "Unicode retrieval",
    });
    workspace.tasks.create(project.key, {
      title: "Quoted operators",
      description: "Literal syntax remains safe",
    });

    expect(
      workspace.search.search({
        q: "cafe",
        type: ["project"],
        limit: 20,
      }).results[0],
    ).toMatchObject({ projectKey: project.key, sourceType: "project" });
    expect(() =>
      workspace.search.search({
        q: '"unterminated OR NEAR ( field:value ***',
        limit: 20,
      }),
    ).not.toThrow();
    expect(workspace.search.search({ q: "!!!", limit: 20 }).results).toEqual([]);
  });

  it("does not index explicit repository or worktree absolute paths through activity", () => {
    const root = mkdtempSync(join(tmpdir(), "absoluteprivateuniquetoken-"));
    temporaryDirectories.push(root);
    const pathToken = basename(root).split("-")[0]!;
    const project = seedProject(workspace, "Path redaction");
    const repository = workspace.repositories.create(project.key, {
      label: "Main",
      rootPath: root,
    });
    const task = seedTask(workspace, project.key, "Bound task", { status: "ready" });
    workspace.claims.claim(task.key, { actor: "codex", sessionId: "redaction" });
    workspace.repositories.bindWorktree(task.key, {
      repository: repository.key,
      worktreePath: root,
      actor: "codex",
      sessionId: "redaction",
    });

    expect(
      workspace.search.search({
        q: pathToken,
        type: ["activity"],
        limit: 100,
      }).results,
    ).toEqual([]);
    const activities = workspace.search.search({
      q: "worktree bound",
      type: ["activity"],
      limit: 100,
    }).results;
    expect(activities).toHaveLength(1);
    expect(activities[0]?.snippet).not.toContain(root);
  });

  it("replaces, resolves and deletes indexed records transactionally", () => {
    const project = workspace.projects.create({
      name: "Mutation search",
      context: "oldprojectcontexttoken",
    });
    const task = workspace.tasks.create(project.key, {
      title: "Mutable task",
      description: "olddescriptiontoken",
      context: "oldtaskcontexttoken",
      acceptanceCriteria: ["deletablecriteriontoken"],
    });
    const criterion = workspace.tasks.get(task.key).acceptanceCriteria[0]!;
    workspace.executions.addEvidence(task.key, criterion.id, {
      kind: "test",
      name: "cascadingevidencetoken",
      outcome: "passed",
      summary: "cascadingevidencetoken",
    });
    const blocker = workspace.blockers.add(task.key, {
      description: "resolutionpendingtoken",
    });
    const [link] = workspace.links.add(project.key, {
      task: task.key,
      type: "document",
      reference: "removablelinktoken",
    });

    workspace.projects.updateContext(project.key, {
      context: "newprojectcontexttoken",
      expectedVersion: 1,
    });
    workspace.tasks.update(task.key, { description: "newdescriptiontoken" });
    workspace.tasks.updateContext(task.key, {
      context: "newtaskcontexttoken",
      expectedVersion: 1,
    });
    workspace.blockers.resolve(blocker.key, { resolution: "resolvedblockertoken" });

    for (const oldTerm of [
      "oldprojectcontexttoken",
      "olddescriptiontoken",
      "oldtaskcontexttoken",
    ]) {
      expect(workspace.search.search({ q: oldTerm, limit: 20 }).results).toEqual([]);
    }
    expect(sourceTypes(workspace, "newprojectcontexttoken")).toContain("project_context");
    expect(sourceTypes(workspace, "newdescriptiontoken")).toContain("task");
    expect(sourceTypes(workspace, "newtaskcontexttoken")).toContain("task_context");
    expect(sourceTypes(workspace, "resolvedblockertoken")).toContain("blocker");

    workspace.links.remove(link!.key);
    expect(
      workspace.search.search({
        q: "removablelinktoken",
        type: ["link"],
        limit: 20,
      }).results,
    ).toEqual([]);

    workspace.tasks.deleteAcceptanceCriterion(task.key, criterion.id);
    expect(
      workspace.search.search({
        q: "deletablecriteriontoken",
        type: ["acceptance_criterion", "criterion_evidence"],
        limit: 20,
      }).results,
    ).toEqual([]);
    expect(workspace.search.search({ q: "cascadingevidencetoken", limit: 20 }).results).toEqual([]);
  });

  it("cleans cascades and reindexes decisions detached by task deletion", () => {
    const project = seedProject(workspace, "Deletion scope");
    const task = seedTask(workspace, project.key, "Disposable task");
    workspace.tasks.addProgress(task.key, { content: "taskownedtoken" });
    const decision = workspace.decisions.create(project.key, {
      task: task.key,
      title: "Survivingdecisiontoken",
      decision: "This decision returns to project scope.",
    });

    expect(
      workspace.search.search({
        q: "Survivingdecisiontoken",
        type: ["decision"],
        limit: 20,
      }).results[0],
    ).toMatchObject({ sourceKey: decision.key, taskKey: task.key });

    workspace.tasks.delete(task.key);
    expect(workspace.search.search({ q: "taskownedtoken", limit: 20 }).results).toEqual([]);
    expect(
      workspace.search.search({
        q: "Survivingdecisiontoken",
        type: ["decision"],
        limit: 20,
      }).results[0],
    ).toMatchObject({ sourceKey: decision.key, taskId: null, taskKey: null });

    workspace.projects.delete(project.key);
    expect(
      workspace.search.search({ q: "Survivingdecisiontoken", limit: 20 }).results,
    ).toEqual([]);
  });

  it("rolls search writes back with a failed bootstrap", () => {
    expectErrorCode(
      () =>
        workspace.projects.bootstrap({
          name: "Rollbacksearchtoken",
          tasks: [
            {
              ref: "valid",
              title: "Temporarysearchtoken",
              dependsOn: ["missing"],
            },
          ],
        }),
      "INVALID_BOOTSTRAP_REFERENCE",
    );

    expect(workspace.projects.list({ limit: 50, offset: 0, sort: "name_asc" }).total).toBe(0);
    expect(workspace.search.search({ q: "Rollbacksearchtoken", limit: 20 }).results).toEqual([]);
    expect(
      workspace.database.sqlite
        .prepare("SELECT count(*) AS count FROM search_documents")
        .get(),
    ).toEqual({ count: 0 });
  });
});

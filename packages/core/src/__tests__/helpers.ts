import { AgentContinuityError, type ErrorCode } from "@agent-continuity/contracts";
import { expect } from "vitest";
import { createTestWorkspace, type TestWorkspace } from "../testing.js";

export { createTestWorkspace, type TestWorkspace };

/** Asserts that `fn` throws an AgentContinuityError carrying the given domain code. */
export function expectErrorCode(fn: () => unknown, code: ErrorCode): AgentContinuityError {
  try {
    fn();
  } catch (error) {
    if (!AgentContinuityError.is(error)) throw error;
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error(`Expected an AgentContinuityError with code ${code}, but nothing was thrown.`);
}

export function seedProject(workspace: TestWorkspace, name = "Agent Continuity") {
  return workspace.projects.create({ name, objective: "Prove the workspace model", actor: "codex" });
}

export function seedTask(
  workspace: TestWorkspace,
  projectRef: string,
  title = "Design task claim model",
  overrides: Partial<Parameters<TestWorkspace["tasks"]["create"]>[1]> = {},
) {
  return workspace.tasks.create(projectRef, { title, actor: "codex", ...overrides });
}

export function eventTypes(workspace: TestWorkspace, projectRef: string): string[] {
  return workspace.activity
    .listForProject(projectRef, { limit: 200 })
    .events.map((event) => event.eventType);
}

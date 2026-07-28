import {
  AgentContinuityError,
  criterionEvidencePolicySchema,
  criterionEvidenceSchema,
  localVerificationPayloadSchema,
  type ClearCriterionEvidencePolicyInput,
  type CriterionEvidence,
  type CriterionEvidenceInput,
  type CriterionEvidencePolicy,
  type CriterionEvidencePolicyInput,
  type EvidenceRepositoryScope,
  type EvidenceScopeInput,
  type MissingAcceptanceEvidence,
  type WritableEvidenceKind,
} from "@agent-continuity/contracts";
import {
  acceptanceCriteria,
  criterionEvidence,
  criterionEvidenceDetails,
  criterionEvidencePolicies,
  executionWorktrees,
  taskExecutions,
  type CriterionEvidenceDetailRow,
  type CriterionEvidencePolicyRow,
  type CriterionEvidenceRow,
} from "@agent-continuity/database";
import { and, asc, eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import { requireCriterion, requireRepository, requireTask, requireWritableProject } from "../refs.js";
import type { Runtime } from "../runtime.js";

type EvidenceRows = { base: CriterionEvidenceRow; detail: CriterionEvidenceDetailRow | null };

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function optionalString(payload: Record<string, unknown>, field: string): string | null {
  return typeof payload[field] === "string" ? payload[field] : null;
}

function scope(detail: CriterionEvidenceDetailRow | null): EvidenceRepositoryScope | null {
  if (!detail?.repositoryId || !detail.repositoryKey || !detail.repositoryLabel) return null;
  return {
    repositoryId: detail.repositoryId,
    repositoryKey: detail.repositoryKey,
    repositoryLabel: detail.repositoryLabel,
    executionId: detail.executionId,
    worktreeId: detail.worktreeId,
    sha: detail.sha,
  };
}

function dto({ base, detail }: EvidenceRows): CriterionEvidence {
  const common = {
    id: base.id,
    criterionId: base.criterionId,
    scope: scope(detail),
    actor: base.actor,
    sessionId: base.sessionId,
    createdAt: base.createdAt,
  };
  if (!detail || detail.kind === "legacy") {
    return {
      ...common,
      kind: "legacy",
      legacyType: detail?.legacyType ?? base.type,
      reference: base.reference,
      content: base.content,
      url: base.url,
    };
  }
  const payload = parseObject(detail.payloadJson);
  switch (detail.kind) {
    case "commit":
      return { ...common, kind: "commit", summary: optionalString(payload, "summary") };
    case "test": {
      const verificationResult = localVerificationPayloadSchema.safeParse(payload.verification);
      const rawOutcome = payload.outcome;
      const outcome =
        rawOutcome === "passed" || rawOutcome === "failed" ? rawOutcome : "informational";
      return {
        ...common,
        kind: "test",
        name: optionalString(payload, "name") ?? base.reference ?? "test",
        outcome,
        reference: optionalString(payload, "reference"),
        summary: optionalString(payload, "summary"),
        verification: verificationResult.success ? verificationResult.data : null,
      };
    }
    case "file":
      return {
        ...common,
        kind: "file",
        path: optionalString(payload, "path") ?? base.reference ?? "",
        description: optionalString(payload, "description"),
      };
    case "url":
      return {
        ...common,
        kind: "url",
        url: optionalString(payload, "url") ?? base.url ?? "",
        title: optionalString(payload, "title"),
        summary: optionalString(payload, "summary"),
      };
    case "result": {
      const rawOutcome = payload.outcome;
      const outcome =
        rawOutcome === "passed" || rawOutcome === "failed" ? rawOutcome : "informational";
      return {
        ...common,
        kind: "result",
        summary: optionalString(payload, "summary") ?? base.content ?? "",
        outcome,
      };
    }
    case "note":
      return { ...common, kind: "note", content: optionalString(payload, "content") ?? base.content ?? "" };
    default:
      return {
        ...common,
        kind: "legacy",
        legacyType: base.type,
        reference: base.reference,
        content: base.content,
        url: base.url,
      };
  }
}

function policyDto(row: CriterionEvidencePolicyRow): CriterionEvidencePolicy {
  let kinds: WritableEvidenceKind[] = [];
  try {
    kinds = JSON.parse(row.qualifyingKindsJson) as WritableEvidenceKind[];
  } catch {
    kinds = [];
  }
  return {
    criterionId: row.criterionId,
    minimumCount: row.minimumCount,
    qualifyingKinds: kinds,
    requireSha: Boolean(row.requireSha),
    requirePassingVerification: Boolean(row.requirePassingVerification),
    actor: row.actor,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type EvidenceService = ReturnType<typeof createEvidenceService>;

export function createEvidenceService(
  runtime: Runtime,
  activity: ActivityService,
) {
  function rows(criterionId: string): EvidenceRows[] {
    return runtime.db
      .select({ base: criterionEvidence, detail: criterionEvidenceDetails })
      .from(criterionEvidence)
      .leftJoin(
        criterionEvidenceDetails,
        eq(criterionEvidenceDetails.evidenceId, criterionEvidence.id),
      )
      .where(eq(criterionEvidence.criterionId, criterionId))
      .orderBy(asc(criterionEvidence.createdAt), asc(criterionEvidence.id))
      .all();
  }

  function resolveScope(
    task: ReturnType<typeof requireTask>,
    input: EvidenceScopeInput | undefined,
  ): EvidenceRepositoryScope | null {
    if (!input) return null;
    const repository = requireRepository(runtime, input.repository);
    if (repository.projectId !== task.projectId) {
      throw new AgentContinuityError(
        "REPOSITORY_NOT_FOUND",
        `${input.repository} is not associated with ${task.key}'s project.`,
        { task: task.key, repository: input.repository },
      );
    }

    let executionId: string | null = null;
    let worktreeId: string | null = null;
    if (input.executionId || input.worktreeId) {
      const worktree = input.worktreeId
        ? runtime.db
            .select()
            .from(executionWorktrees)
            .where(eq(executionWorktrees.id, input.worktreeId))
            .get()
        : runtime.db
            .select()
            .from(executionWorktrees)
            .where(eq(executionWorktrees.executionId, input.executionId!))
            .get();
      if (!worktree || worktree.repositoryId !== repository.id) {
        throw new AgentContinuityError(
          "GIT_PROVENANCE_MISMATCH",
          "Evidence does not match the supplied repository/worktree binding.",
          { task: task.key, repository: repository.key },
        );
      }
      const execution = runtime.db
        .select()
        .from(taskExecutions)
        .where(
          and(eq(taskExecutions.id, worktree.executionId), eq(taskExecutions.taskId, task.id)),
        )
        .get();
      if (!execution || (input.executionId && execution.id !== input.executionId)) {
        throw new AgentContinuityError(
          "GIT_PROVENANCE_MISMATCH",
          "Evidence does not match an execution of this task.",
          { task: task.key },
        );
      }
      executionId = execution.id;
      worktreeId = worktree.id;
    }
    return {
      repositoryId: repository.id,
      repositoryKey: repository.key,
      repositoryLabel: repository.label,
      executionId,
      worktreeId,
      sha: input.sha?.toLowerCase() ?? null,
    };
  }

  function projection(input: CriterionEvidenceInput): {
    reference: string | null;
    content: string | null;
    url: string | null;
    payload: Record<string, unknown>;
    verificationOutcome: string | null;
  } {
    switch (input.kind) {
      case "commit":
        return {
          reference: input.scope.sha,
          content: input.summary ?? null,
          url: null,
          payload: { summary: input.summary ?? null },
          verificationOutcome: null,
        };
      case "test":
        return {
          reference: input.reference ?? input.name,
          content: input.summary ?? `${input.outcome}: ${input.name}`,
          url: null,
          payload: {
            name: input.name,
            outcome: input.outcome,
            reference: input.reference ?? null,
            summary: input.summary ?? null,
            verification: input.verification ?? null,
          },
          verificationOutcome: input.verification?.outcome ?? null,
        };
      case "file":
        return {
          reference: input.path,
          content: input.description ?? null,
          url: null,
          payload: { path: input.path, description: input.description ?? null },
          verificationOutcome: null,
        };
      case "url":
        return {
          reference: input.title ?? null,
          content: input.summary ?? null,
          url: input.url,
          payload: { url: input.url, title: input.title ?? null, summary: input.summary ?? null },
          verificationOutcome: null,
        };
      case "result":
        return {
          reference: input.outcome,
          content: input.summary,
          url: null,
          payload: { summary: input.summary, outcome: input.outcome },
          verificationOutcome: null,
        };
      case "note":
        return {
          reference: null,
          content: input.content,
          url: null,
          payload: { content: input.content },
          verificationOutcome: null,
        };
    }
  }

  function add(taskRef: string, criterionRef: string, input: CriterionEvidenceInput): CriterionEvidence {
    const validated = criterionEvidenceSchema.safeParse(input);
    if (!validated.success) {
      throw new AgentContinuityError("VALIDATION_ERROR", "Invalid structured evidence.", {
        issues: validated.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    input = validated.data;
    return runtime.tx(() => {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      const criterion = requireCriterion(runtime, task.id, criterionRef);
      const repositoryScope = resolveScope(task, "scope" in input ? input.scope : undefined);
      if (input.kind === "commit" && !repositoryScope?.sha) {
        throw new AgentContinuityError("VALIDATION_ERROR", "Commit evidence requires a repository SHA.");
      }
      if (input.kind === "test" && input.verification) {
        if (!repositoryScope?.executionId || !repositoryScope.worktreeId) {
          throw new AgentContinuityError(
            "GIT_PROVENANCE_MISMATCH",
            "Local verification evidence requires the stored task execution/worktree identity.",
          );
        }
        const stableSha =
          input.verification.revisionStable &&
          input.verification.startSha &&
          input.verification.startSha === input.verification.endSha
            ? input.verification.startSha
            : null;
        if (stableSha !== repositoryScope.sha) {
          throw new AgentContinuityError(
            "GIT_PROVENANCE_MISMATCH",
            "Verification scope SHA must exactly match the stable before/after Git observation.",
            { observedSha: stableSha, suppliedSha: repositoryScope.sha },
          );
        }
      }
      const projected = projection(input);
      const now = runtime.now();
      const base = runtime.db
        .insert(criterionEvidence)
        .values({
          id: runtime.newId(),
          criterionId: criterion.id,
          type: input.kind,
          reference: projected.reference,
          content: projected.content,
          url: projected.url,
          actor: input.actor ?? null,
          sessionId: input.sessionId ?? null,
          createdAt: now,
        })
        .returning()
        .get();
      const detail = runtime.db
        .insert(criterionEvidenceDetails)
        .values({
          evidenceId: base.id,
          kind: input.kind,
          legacyType: null,
          repositoryId: repositoryScope?.repositoryId ?? null,
          repositoryKey: repositoryScope?.repositoryKey ?? null,
          repositoryLabel: repositoryScope?.repositoryLabel ?? null,
          worktreeId: repositoryScope?.worktreeId ?? null,
          executionId: repositoryScope?.executionId ?? null,
          sha: repositoryScope?.sha ?? null,
          verificationOutcome: projected.verificationOutcome,
          payloadJson: JSON.stringify(projected.payload),
        })
        .returning()
        .get();
      activity.record({
        projectId: task.projectId,
        taskId: task.id,
        eventType: "criterion_evidence.added",
        actor: input.actor,
        sessionId: input.sessionId,
        payload: { criterionId: criterion.id, evidenceId: base.id, kind: input.kind },
      });
      return dto({ base, detail });
    });
  }

  function list(taskRef: string, criterionRef: string): CriterionEvidence[] {
    const task = requireTask(runtime, taskRef);
    const criterion = requireCriterion(runtime, task.id, criterionRef);
    return rows(criterion.id).map(dto);
  }

  function getPolicy(taskRef: string, criterionRef: string): CriterionEvidencePolicy | null {
    const task = requireTask(runtime, taskRef);
    const criterion = requireCriterion(runtime, task.id, criterionRef);
    const row = runtime.db
      .select()
      .from(criterionEvidencePolicies)
      .where(eq(criterionEvidencePolicies.criterionId, criterion.id))
      .get();
    return row ? policyDto(row) : null;
  }

  function setPolicy(
    taskRef: string,
    criterionRef: string,
    input: CriterionEvidencePolicyInput,
  ): CriterionEvidencePolicy {
    const validated = criterionEvidencePolicySchema.safeParse(input);
    if (!validated.success) {
      throw new AgentContinuityError("VALIDATION_ERROR", "Invalid criterion evidence policy.", {
        issues: validated.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    input = validated.data;
    return runtime.tx(() => {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      const criterion = requireCriterion(runtime, task.id, criterionRef);
      if (input.requirePassingVerification && !input.qualifyingKinds.includes("test")) {
        throw new AgentContinuityError(
          "VALIDATION_ERROR",
          "A passing-verification policy must allow test evidence.",
        );
      }
      const now = runtime.now();
      runtime.db
        .insert(criterionEvidencePolicies)
        .values({
          criterionId: criterion.id,
          minimumCount: input.minimumCount,
          qualifyingKindsJson: JSON.stringify([...new Set(input.qualifyingKinds)]),
          requireSha: input.requireSha ? 1 : 0,
          requirePassingVerification: input.requirePassingVerification ? 1 : 0,
          actor: input.actor ?? null,
          sessionId: input.sessionId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: criterionEvidencePolicies.criterionId,
          set: {
            minimumCount: input.minimumCount,
            qualifyingKindsJson: JSON.stringify([...new Set(input.qualifyingKinds)]),
            requireSha: input.requireSha ? 1 : 0,
            requirePassingVerification: input.requirePassingVerification ? 1 : 0,
            actor: input.actor ?? null,
            sessionId: input.sessionId ?? null,
            updatedAt: now,
          },
        })
        .run();
      activity.record({
        projectId: task.projectId,
        taskId: task.id,
        eventType: "criterion_evidence_policy.updated",
        actor: input.actor,
        sessionId: input.sessionId,
        payload: {
          criterionId: criterion.id,
          minimumCount: input.minimumCount,
          qualifyingKinds: input.qualifyingKinds,
          requireSha: input.requireSha,
          requirePassingVerification: input.requirePassingVerification,
        },
      });
      return getPolicy(task.id, criterion.id)!;
    });
  }

  function clearPolicy(
    taskRef: string,
    criterionRef: string,
    input: ClearCriterionEvidencePolicyInput = {},
  ): null {
    return runtime.tx(() => {
      const task = requireTask(runtime, taskRef);
      requireWritableProject(runtime, task.projectId);
      const criterion = requireCriterion(runtime, task.id, criterionRef);
      runtime.db
        .delete(criterionEvidencePolicies)
        .where(eq(criterionEvidencePolicies.criterionId, criterion.id))
        .run();
      activity.record({
        projectId: task.projectId,
        taskId: task.id,
        eventType: "criterion_evidence_policy.cleared",
        actor: input.actor,
        sessionId: input.sessionId,
        payload: { criterionId: criterion.id },
      });
      return null;
    });
  }

  function missingForTask(taskRef: string): MissingAcceptanceEvidence[] {
    const task = requireTask(runtime, taskRef);
    const criteria = runtime.db
      .select()
      .from(acceptanceCriteria)
      .where(eq(acceptanceCriteria.taskId, task.id))
      .all();
    const missing: MissingAcceptanceEvidence[] = [];
    for (const criterion of criteria) {
      const row = runtime.db
        .select()
        .from(criterionEvidencePolicies)
        .where(eq(criterionEvidencePolicies.criterionId, criterion.id))
        .get();
      if (!row) continue;
      const policy = policyDto(row);
      const all = rows(criterion.id).map(dto);
      const kindMatches = all.filter(
        (evidence) =>
          evidence.kind !== "legacy" &&
          policy.qualifyingKinds.includes(evidence.kind as WritableEvidenceKind),
      );
      const shaMatches = kindMatches.filter((evidence) => !policy.requireSha || Boolean(evidence.scope?.sha));
      const qualifying = shaMatches.filter((evidence) => {
        if (!policy.requirePassingVerification) return true;
        return (
          evidence.kind === "test" &&
          evidence.verification?.outcome === "passed" &&
          evidence.verification.revisionStable &&
          Boolean(evidence.scope?.sha)
        );
      });
      if (qualifying.length >= policy.minimumCount) continue;
      const failedRequirements: string[] = [];
      if (kindMatches.length < policy.minimumCount) failedRequirements.push("qualifying_kind");
      if (policy.requireSha && shaMatches.length < policy.minimumCount) failedRequirements.push("sha");
      if (policy.requirePassingVerification && qualifying.length < policy.minimumCount) {
        failedRequirements.push("passing_verification");
      }
      if (qualifying.length < policy.minimumCount) failedRequirements.push("minimum_count");
      missing.push({
        criterionId: criterion.id,
        description: criterion.description,
        requiredKinds: policy.qualifyingKinds,
        requiredCount: policy.minimumCount,
        actualQualifyingCount: qualifying.length,
        failedRequirements,
      });
    }
    return missing;
  }

  return { add, list, getPolicy, setPolicy, clearPolicy, missingForTask };
}

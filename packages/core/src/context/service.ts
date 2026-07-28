import {
  CONTEXT_SOFT_LIMIT_BYTES,
  AgentContinuityError,
  type ContextOwnerType,
  type ContextVersionDetail,
  type ContextVersionPage,
  type ContextVersionSummary,
  type ListContextVersionsQuery,
  type ReplaceContextInput,
  type RevertContextInput,
} from "@agent-continuity/contracts";
import {
  contextVersions,
  projects,
  tasks,
  type ContextVersionRow,
  type ProjectRow,
  type TaskRow,
} from "@agent-continuity/database";
import { and, desc, eq, lt } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import type { ClaimService } from "../claims/service.js";
import { requireProject, requireTask, requireWritableProject } from "../refs.js";
import type { Runtime } from "../runtime.js";
import { assertContextWithinLimit } from "./size.js";

type Owner = {
  type: ContextOwnerType;
  id: string;
  projectId: string;
  taskId: string | null;
  key: string;
  context: string | null;
  contextVersion: number;
};

type VersionMeta = {
  actor?: string | null | undefined;
  sessionId?: string | null | undefined;
  reason?: string | null | undefined;
};

export type ContextService = ReturnType<typeof createContextService>;

function projectOwner(project: ProjectRow): Owner {
  return {
    type: "project",
    id: project.id,
    projectId: project.id,
    taskId: null,
    key: project.key,
    context: project.context,
    contextVersion: project.contextVersion,
  };
}

function taskOwner(task: TaskRow): Owner {
  return {
    type: "task",
    id: task.id,
    projectId: task.projectId,
    taskId: task.id,
    key: task.key,
    context: task.context,
    contextVersion: task.contextVersion,
  };
}

function toSummary(row: ContextVersionRow, currentVersion: number): ContextVersionSummary {
  return {
    id: row.id,
    ownerType: row.ownerType as ContextOwnerType,
    ownerId: row.ownerId,
    projectId: row.projectId,
    taskId: row.taskId,
    version: row.version,
    size: {
      characters: row.characterCount,
      bytes: row.byteCount,
      overSoftLimit: row.byteCount > CONTEXT_SOFT_LIMIT_BYTES,
    },
    actor: row.actor,
    sessionId: row.sessionId,
    reason: row.reason,
    revertedFromVersion: row.revertedFromVersion,
    createdAt: row.createdAt,
    isCurrent: row.version === currentVersion,
  };
}

export function createContextService(
  runtime: Runtime,
  activity: ActivityService,
  claims: ClaimService,
) {
  function insertVersion(
    owner: Owner,
    version: number,
    content: string | null,
    meta: VersionMeta,
    revertedFromVersion: number | null,
  ): void {
    const size = assertContextWithinLimit(content);
    runtime.db
      .insert(contextVersions)
      .values({
        id: runtime.newId(),
        ownerType: owner.type,
        ownerId: owner.id,
        projectId: owner.projectId,
        taskId: owner.taskId,
        version,
        content,
        characterCount: size.characters,
        byteCount: size.bytes,
        actor: meta.actor ?? null,
        sessionId: meta.sessionId ?? null,
        reason: meta.reason ?? null,
        revertedFromVersion,
        createdAt: runtime.now(),
      })
      .run();
  }

  function initialiseProject(project: ProjectRow, meta: VersionMeta): ProjectRow {
    if (project.context === null) return project;
    return runtime.tx(() => {
      assertContextWithinLimit(project.context);
      const updated = runtime.db
        .update(projects)
        .set({ contextVersion: 1 })
        .where(and(eq(projects.id, project.id), eq(projects.contextVersion, 0)))
        .returning()
        .get();
      if (!updated) {
        throw new AgentContinuityError(
          "CONTEXT_VERSION_CONFLICT",
          `${project.key} already has context history.`,
          { ownerType: "project", owner: project.key, expectedVersion: 0 },
        );
      }
      insertVersion(projectOwner(updated), 1, updated.context, meta, null);
      return updated;
    });
  }

  function initialiseTask(task: TaskRow, meta: VersionMeta): TaskRow {
    if (task.context === null) return task;
    return runtime.tx(() => {
      assertContextWithinLimit(task.context);
      const updated = runtime.db
        .update(tasks)
        .set({ contextVersion: 1 })
        .where(and(eq(tasks.id, task.id), eq(tasks.contextVersion, 0)))
        .returning()
        .get();
      if (!updated) {
        throw new AgentContinuityError(
          "CONTEXT_VERSION_CONFLICT",
          `${task.key} already has context history.`,
          { ownerType: "task", owner: task.key, expectedVersion: 0 },
        );
      }
      insertVersion(taskOwner(updated), 1, updated.context, meta, null);
      return updated;
    });
  }

  function conflict(owner: Owner, expectedVersion: number): never {
    const current =
      owner.type === "project"
        ? requireProject(runtime, owner.id).contextVersion
        : requireTask(runtime, owner.id).contextVersion;
    throw new AgentContinuityError(
      "CONTEXT_VERSION_CONFLICT",
      `${owner.key} context changed after version ${expectedVersion}; current version is ${current}.`,
      {
        ownerType: owner.type,
        owner: owner.key,
        expectedVersion,
        currentVersion: current,
      },
    );
  }

  function replaceOwner(
    owner: Owner,
    input: ReplaceContextInput,
    revertedFromVersion: number | null = null,
  ): ProjectRow | TaskRow {
    return runtime.tx(() => {
      const size = assertContextWithinLimit(input.context);
      const nextVersion = input.expectedVersion + 1;
      const now = runtime.now();
      const updated =
        owner.type === "project"
          ? runtime.db
              .update(projects)
              .set({
                context: input.context,
                contextVersion: nextVersion,
                updatedAt: now,
              })
              .where(
                and(
                  eq(projects.id, owner.id),
                  eq(projects.contextVersion, input.expectedVersion),
                ),
              )
              .returning()
              .get()
          : runtime.db
              .update(tasks)
              .set({
                context: input.context,
                contextVersion: nextVersion,
                updatedAt: now,
              })
              .where(
                and(eq(tasks.id, owner.id), eq(tasks.contextVersion, input.expectedVersion)),
              )
              .returning()
              .get();

      if (!updated) conflict(owner, input.expectedVersion);

      const updatedOwner =
        owner.type === "project"
          ? projectOwner(updated as ProjectRow)
          : taskOwner(updated as TaskRow);
      insertVersion(updatedOwner, nextVersion, input.context, input, revertedFromVersion);

      activity.record({
        projectId: owner.projectId,
        taskId: owner.taskId,
        eventType: owner.type === "project" ? "project.context_updated" : "task.context_updated",
        actor: input.actor,
        sessionId: input.sessionId,
        payload: {
          previousVersion: owner.contextVersion,
          newVersion: nextVersion,
          previousLength: [...(owner.context ?? "")].length,
          newLength: size.characters,
          newBytes: size.bytes,
          ...(input.reason ? { reason: input.reason } : {}),
          ...(revertedFromVersion ? { revertedFromVersion } : {}),
        },
      });

      if (owner.type === "task") claims.touch(owner.id, input.actor, input.sessionId);
      return updated;
    });
  }

  function requireVersion(owner: Owner, version: number): ContextVersionRow {
    const row = runtime.db
      .select()
      .from(contextVersions)
      .where(
        and(
          eq(contextVersions.ownerType, owner.type),
          eq(contextVersions.ownerId, owner.id),
          eq(contextVersions.version, version),
        ),
      )
      .get();
    if (!row) {
      throw new AgentContinuityError(
        "CONTEXT_VERSION_NOT_FOUND",
        `Context version ${version} was not found for ${owner.key}.`,
        { ownerType: owner.type, owner: owner.key, version },
      );
    }
    return row;
  }

  function list(owner: Owner, query: ListContextVersionsQuery): ContextVersionPage {
    const conditions = [
      eq(contextVersions.ownerType, owner.type),
      eq(contextVersions.ownerId, owner.id),
    ];
    if (query.beforeVersion !== undefined) {
      conditions.push(lt(contextVersions.version, query.beforeVersion));
    }
    const rows = runtime.db
      .select()
      .from(contextVersions)
      .where(and(...conditions))
      .orderBy(desc(contextVersions.version))
      .limit(query.limit + 1)
      .all();
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      versions: page.map((row) => toSummary(row, owner.contextVersion)),
      nextBeforeVersion: hasMore ? (page.at(-1)?.version ?? null) : null,
    };
  }

  function detail(owner: Owner, version: number): ContextVersionDetail {
    const row = requireVersion(owner, version);
    return { ...toSummary(row, owner.contextVersion), content: row.content };
  }

  function revert(owner: Owner, input: RevertContextInput): ProjectRow | TaskRow {
    return runtime.tx(() => {
      const target = requireVersion(owner, input.targetVersion);
      return replaceOwner(
        owner,
        {
          context: target.content,
          expectedVersion: input.expectedVersion,
          reason: input.reason ?? `Reverted to context version ${input.targetVersion}.`,
          actor: input.actor,
          sessionId: input.sessionId,
        },
        input.targetVersion,
      );
    });
  }

  function readableProject(projectRef: string): Owner {
    return projectOwner(requireProject(runtime, projectRef));
  }

  function writableProject(projectRef: string): Owner {
    return projectOwner(requireWritableProject(runtime, projectRef));
  }

  function readableTask(taskRef: string): Owner {
    return taskOwner(requireTask(runtime, taskRef));
  }

  function writableTask(taskRef: string): Owner {
    const task = requireTask(runtime, taskRef);
    requireWritableProject(runtime, task.projectId);
    return taskOwner(task);
  }

  return {
    initialiseProject,
    initialiseTask,

    replaceProject(projectRef: string, input: ReplaceContextInput): ProjectRow {
      return replaceOwner(writableProject(projectRef), input) as ProjectRow;
    },

    replaceTask(taskRef: string, input: ReplaceContextInput): TaskRow {
      return replaceOwner(writableTask(taskRef), input) as TaskRow;
    },

    replaceTaskRow(task: TaskRow, input: ReplaceContextInput): TaskRow {
      requireWritableProject(runtime, task.projectId);
      return replaceOwner(taskOwner(task), input) as TaskRow;
    },

    listProject(projectRef: string, query: ListContextVersionsQuery): ContextVersionPage {
      return list(readableProject(projectRef), query);
    },

    listTask(taskRef: string, query: ListContextVersionsQuery): ContextVersionPage {
      return list(readableTask(taskRef), query);
    },

    getProject(projectRef: string, version: number): ContextVersionDetail {
      return detail(readableProject(projectRef), version);
    },

    getTask(taskRef: string, version: number): ContextVersionDetail {
      return detail(readableTask(taskRef), version);
    },

    revertProject(projectRef: string, input: RevertContextInput): ProjectRow {
      return revert(writableProject(projectRef), input) as ProjectRow;
    },

    revertTask(taskRef: string, input: RevertContextInput): TaskRow {
      return revert(writableTask(taskRef), input) as TaskRow;
    },
  };
}

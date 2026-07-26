import {
  type CheckpointInput,
  type CriterionEvidence,
  type CriterionEvidenceInput,
  type ExecutionHealth,
  type ExecutionOriginInput,
  type NeedsAttentionItem,
  type TaskCheckpoint,
  type TaskExecution,
  type TaskHandoff,
  type WorkPlanInput,
  type WorkPlanItem,
  type UpdateWorkPlanItemInput,
} from "@agent-continuity/contracts";
import {
  blockers, criterionEvidence, executionOrigins, taskCheckpoints,
  taskExecutions, taskHandoffs, taskWorkPlanItems, taskClaims, tasks, type TaskClaimRow, type TaskExecutionRow,
} from "@agent-continuity/database";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ActivityService } from "../activity/service.js";
import { requireCriterion, requireProject, requireTask, requireWritableProject } from "../refs.js";
import type { Runtime } from "../runtime.js";

const STALE_MINUTES = 5;

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}
function health(runtime: Runtime, row: TaskExecutionRow): ExecutionHealth {
  if (row.status === "ended") return "finished";
  // A run can outlive its lease briefly (for example, a process disappeared before
  // reconciliation). Preserve that distinction instead of reporting it as merely stale.
  if (row.claimId) {
    const claim = runtime.db.select().from(taskClaims).where(eq(taskClaims.id, row.claimId)).get();
    if (!claim || claim.releasedAt || claim.expiresAt <= runtime.now()) return "disconnected";
  }
  const age = Date.parse(runtime.now()) - Date.parse(row.lastHeartbeatAt);
  if (age <= 60_000) return "active";
  if (age <= STALE_MINUTES * 60_000) return "idle";
  return "stale";
}

export type ExecutionService = ReturnType<typeof createExecutionService>;
export function createExecutionService(runtime: Runtime, activity: ActivityService) {
  function origins(executionId: string) {
    return runtime.db.select().from(executionOrigins).where(eq(executionOrigins.executionId, executionId)).all().map((row) => ({
      id: row.id, provider: row.provider, reference: row.reference, url: row.url, metadata: parseJson(row.metadataJson), createdAt: row.createdAt,
    }));
  }
  function dto(row: TaskExecutionRow): TaskExecution {
    return { id: row.id, taskId: row.taskId, actor: row.actor, sessionId: row.sessionId, status: row.status as "running" | "ended", currentPhase: row.currentPhase, startedAt: row.startedAt, resumedAt: row.resumedAt, lastHeartbeatAt: row.lastHeartbeatAt, endedAt: row.endedAt, terminationReason: row.terminationReason, health: health(runtime, row), origins: origins(row.id) };
  }
  function active(taskId: string) { return runtime.db.select().from(taskExecutions).where(and(eq(taskExecutions.taskId, taskId), eq(taskExecutions.status, "running"))).orderBy(desc(taskExecutions.startedAt)).get(); }
  function checkpointRows(taskId: string): TaskCheckpoint[] { return runtime.db.select().from(taskCheckpoints).where(eq(taskCheckpoints.taskId, taskId)).orderBy(desc(taskCheckpoints.createdAt)).all().map(r => ({ id:r.id, taskId:r.taskId, executionId:r.executionId, completed:r.completed, workingOn:r.workingOn, next:r.next, uncertainty:r.uncertainty, actor:r.actor, sessionId:r.sessionId, createdAt:r.createdAt })); }
  function handoff(taskId: string): TaskHandoff | null { const r = runtime.db.select().from(taskHandoffs).where(eq(taskHandoffs.taskId, taskId)).orderBy(desc(taskHandoffs.createdAt)).get(); if (!r) return null; let unresolved: string[] = []; try { unresolved = JSON.parse(r.unresolvedJson) as string[]; } catch {} return { id:r.id,taskId:r.taskId,executionId:r.executionId,reason:r.reason,summary:r.summary,nextAction:r.nextAction,unresolved,createdAt:r.createdAt }; }
  function writeHandoff(taskId: string, execution: TaskExecutionRow | undefined, reason: string): void {
    const cp = checkpointRows(taskId)[0];
    const summary = cp ? `Completed: ${cp.completed}\nWorking on: ${cp.workingOn}` : "No checkpoint was recorded before this execution ended.";
    runtime.db.insert(taskHandoffs).values({ id:runtime.newId(), taskId, executionId:execution?.id ?? null, reason, summary, nextAction:cp?.next ?? null, unresolvedJson:JSON.stringify(cp?.uncertainty ? [cp.uncertainty] : []), createdAt:runtime.now() }).run();
  }
  return {
    forTask(taskRef: string) { const task=requireTask(runtime, taskRef); const row=active(task.id); return { execution: row ? dto(row) : null, checkpoints: checkpointRows(task.id), workPlan: this.workPlan(task.id), handoff: handoff(task.id) }; },
    activeFor(taskId: string): TaskExecution | null { const row=active(taskId); return row ? dto(row) : null; },
    onClaim(taskId: string, claim: TaskClaimRow, resumed: boolean): TaskExecution {
      const existing=active(taskId);
      const now=runtime.now();
      const row = existing
        ? runtime.db.update(taskExecutions).set({ claimId:claim.id, actor:claim.actor, sessionId:claim.sessionId, resumedAt:now, lastHeartbeatAt:now }).where(eq(taskExecutions.id, existing.id)).returning().get()
        : runtime.db.insert(taskExecutions).values({ id:runtime.newId(), taskId, claimId:claim.id, actor:claim.actor, sessionId:claim.sessionId, status:"running", startedAt:now, resumedAt:resumed ? now : null, lastHeartbeatAt:now }).returning().get();
      activity.record({ projectId: requireTask(runtime, taskId).projectId, taskId, eventType: resumed || existing ? "execution.resumed" : "execution.started", actor:claim.actor, sessionId:claim.sessionId, payload:{ executionId:row.id } });
      return dto(row);
    },
    heartbeat(taskRef: string, input: { actor:string; sessionId?:string; phase?:string }) {
      const task=requireTask(runtime, taskRef); const row=active(task.id); if (!row) throw new Error(`No running execution for ${task.key}. Claim the task before heartbeating.`);
      if (row.actor !== input.actor || (row.sessionId && input.sessionId && row.sessionId !== input.sessionId)) throw new Error("Execution is owned by another actor or session.");
      const updated=runtime.db.update(taskExecutions).set({ lastHeartbeatAt:runtime.now(), currentPhase:input.phase ?? row.currentPhase }).where(eq(taskExecutions.id,row.id)).returning().get();
      return dto(updated);
    },
    endForClaim(taskId: string, claimId: string, reason: string) {
      const row=runtime.db.select().from(taskExecutions).where(and(eq(taskExecutions.taskId,taskId),eq(taskExecutions.claimId,claimId),eq(taskExecutions.status,"running"))).get();
      if (!row) return;
      runtime.db.update(taskExecutions).set({status:"ended",endedAt:runtime.now(),terminationReason:reason}).where(eq(taskExecutions.id,row.id)).run();
      writeHandoff(taskId,row,reason);
      const task=requireTask(runtime,taskId); activity.record({projectId:task.projectId,taskId,eventType:"execution.ended",actor:row.actor,sessionId:row.sessionId,payload:{executionId:row.id,reason}});
    },
    checkpoint(taskRef:string, input:CheckpointInput): TaskCheckpoint { const task=requireTask(runtime,taskRef); requireWritableProject(runtime,task.projectId); const execution=active(task.id); const r=runtime.db.insert(taskCheckpoints).values({id:runtime.newId(),taskId:task.id,executionId:execution?.id ?? null,completed:input.completed,workingOn:input.workingOn,next:input.next,uncertainty:input.uncertainty ?? null,actor:input.actor ?? null,sessionId:input.sessionId ?? null,createdAt:runtime.now()}).returning().get(); activity.record({projectId:task.projectId,taskId:task.id,eventType:"task.checkpointed",actor:input.actor,sessionId:input.sessionId,payload:{checkpointId:r.id}}); return {id:r.id,taskId:r.taskId,executionId:r.executionId,completed:r.completed,workingOn:r.workingOn,next:r.next,uncertainty:r.uncertainty,actor:r.actor,sessionId:r.sessionId,createdAt:r.createdAt}; },
    checkpoints(taskRef:string) { return checkpointRows(requireTask(runtime,taskRef).id); },
    setWorkPlan(taskRef:string,input:WorkPlanInput):WorkPlanItem[] { const task=requireTask(runtime,taskRef); requireWritableProject(runtime,task.projectId); const now=runtime.now(); runtime.db.delete(taskWorkPlanItems).where(eq(taskWorkPlanItems.taskId,task.id)).run(); for (const [index,title] of input.items.entries()) runtime.db.insert(taskWorkPlanItems).values({id:runtime.newId(),taskId:task.id,title,status:"pending",sortOrder:(index+1)*1000,createdAt:now,updatedAt:now}).run(); activity.record({projectId:task.projectId,taskId:task.id,eventType:"work_plan.updated",actor:input.actor,sessionId:input.sessionId,payload:{count:input.items.length}}); return this.workPlan(task.id); },
    workPlan(taskRef:string):WorkPlanItem[] { const task=requireTask(runtime,taskRef); return runtime.db.select().from(taskWorkPlanItems).where(eq(taskWorkPlanItems.taskId,task.id)).orderBy(asc(taskWorkPlanItems.sortOrder)).all().map(r=>({id:r.id,taskId:r.taskId,title:r.title,status:r.status as WorkPlanItem["status"],sortOrder:r.sortOrder,createdAt:r.createdAt,updatedAt:r.updatedAt,completedAt:r.completedAt})); },
    updateWorkPlanItem(taskRef:string,itemId:string,input:UpdateWorkPlanItemInput):WorkPlanItem { const task=requireTask(runtime,taskRef); const old=runtime.db.select().from(taskWorkPlanItems).where(and(eq(taskWorkPlanItems.id,itemId),eq(taskWorkPlanItems.taskId,task.id))).get(); if(!old) throw new Error("Work-plan item not found on task."); const now=runtime.now(); const r=runtime.db.update(taskWorkPlanItems).set({status:input.status,updatedAt:now,completedAt: input.status === "completed" || input.status === "skipped" ? now : null}).where(eq(taskWorkPlanItems.id,itemId)).returning().get(); return {id:r.id,taskId:r.taskId,title:r.title,status:r.status as WorkPlanItem["status"],sortOrder:r.sortOrder,createdAt:r.createdAt,updatedAt:r.updatedAt,completedAt:r.completedAt}; },
    addEvidence(taskRef:string, criterionRef:string,input:CriterionEvidenceInput):CriterionEvidence { const task=requireTask(runtime,taskRef); const criterion=requireCriterion(runtime,task.id,criterionRef); const r=runtime.db.insert(criterionEvidence).values({id:runtime.newId(),criterionId:criterion.id,type:input.type,reference:input.reference ?? null,content:input.content ?? null,url:input.url ?? null,actor:input.actor ?? null,sessionId:input.sessionId ?? null,createdAt:runtime.now()}).returning().get(); activity.record({projectId:task.projectId,taskId:task.id,eventType:"criterion_evidence.added",actor:input.actor,sessionId:input.sessionId,payload:{criterionId:criterion.id,evidenceId:r.id,type:r.type}}); return {id:r.id,criterionId:r.criterionId,type:r.type,reference:r.reference,content:r.content,url:r.url,actor:r.actor,sessionId:r.sessionId,createdAt:r.createdAt}; },
    evidence(taskRef:string,criterionRef:string):CriterionEvidence[] { const criterion=requireCriterion(runtime,requireTask(runtime,taskRef).id,criterionRef); return runtime.db.select().from(criterionEvidence).where(eq(criterionEvidence.criterionId,criterion.id)).all().map(r=>({id:r.id,criterionId:r.criterionId,type:r.type,reference:r.reference,content:r.content,url:r.url,actor:r.actor,sessionId:r.sessionId,createdAt:r.createdAt})); },
    addOrigin(taskRef:string,input:ExecutionOriginInput) { const task=requireTask(runtime,taskRef); const execution=active(task.id); if(!execution) throw new Error("Claim the task before attaching an execution origin."); const r=runtime.db.insert(executionOrigins).values({id:runtime.newId(),executionId:execution.id,provider:input.provider,reference:input.reference,url:input.url ?? null,metadataJson:input.metadata ? JSON.stringify(input.metadata) : null,createdAt:runtime.now()}).returning().get(); return {id:r.id,provider:r.provider,reference:r.reference,url:r.url,metadata:parseJson(r.metadataJson),createdAt:r.createdAt}; },
    needsAttention(projectRef?:string):NeedsAttentionItem[] { const projectId=projectRef ? requireProject(runtime,projectRef).id : null; const rows=runtime.db.select().from(tasks).all().filter(t=>t.status !== "done" && (!projectId || t.projectId===projectId)); const result:NeedsAttentionItem[]=[]; for(const task of rows){ const ex=active(task.id); const dtoEx=ex?dto(ex):null; const latestHandoff=handoff(task.id); if(dtoEx && dtoEx.health === "stale") result.push({taskId:task.id,taskKey:task.key,projectId:task.projectId,reason:"stale_execution",requiredAction:"Check the running execution or release/reclaim it.",execution:dtoEx}); else if(dtoEx && dtoEx.health === "disconnected") result.push({taskId:task.id,taskKey:task.key,projectId:task.projectId,reason:"interrupted_execution",requiredAction:"The execution lost its lease; inspect and reclaim the task.",execution:dtoEx}); else if(task.status === "blocked") { const blocker=runtime.db.select().from(blockers).where(eq(blockers.taskId,task.id)).all().find(row=>!row.resolvedAt); result.push({taskId:task.id,taskKey:task.key,projectId:task.projectId,reason:"blocked",requiredAction:blocker?.requiredAction ?? "Resolve the active blocker.",execution:dtoEx}); } else if(task.status === "review") result.push({taskId:task.id,taskKey:task.key,projectId:task.projectId,reason:"review",requiredAction:"Review and either accept or reopen the task.",execution:dtoEx}); else if(latestHandoff && !dtoEx) result.push({taskId:task.id,taskKey:task.key,projectId:task.projectId,reason:latestHandoff.reason === "claim expired" ? "expired_claim" : "handoff",requiredAction:"Read the handoff and reclaim the task when ready.",execution:null}); } return result; },
  };
}

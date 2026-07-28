/**
 * The complete, named MCP surface. Keep this list beside profile policy so a
 * profile cannot accidentally omit a newly registered operation without a
 * failing parity test.
 */
export const MCP_FULL_TOOL_NAMES = [
  "search", "projects_create", "projects_bootstrap", "projects_list", "projects_get", "projects_update",
  "projects_update_context", "projects_context_history", "projects_context_version_get", "projects_context_revert",
  "projects_delete", "repositories_add", "repositories_list", "repositories_get", "repositories_update",
  "repositories_remove", "tasks_create", "tasks_list", "tasks_get", "tasks_update", "tasks_update_context",
  "tasks_context_history", "tasks_context_version_get", "tasks_context_revert", "start_work", "report", "handoff",
  "tasks_claim", "tasks_release_claim", "tasks_heartbeat", "tasks_execution_get", "tasks_worktree_get",
  "tasks_path_ownership_get", "tasks_path_ownership_set", "tasks_worktree_bind", "tasks_worktree_unbind",
  "tasks_checkpoint", "tasks_git_provenance_get", "tasks_git_provenance_capture", "tasks_work_plan",
  "tasks_add_criterion_evidence", "tasks_criterion_evidence", "tasks_criterion_evidence_policy",
  "tasks_add_execution_origin", "attention_list", "tasks_add_progress", "tasks_add_blocker", "tasks_resolve_blocker",
  "tasks_complete", "tasks_delete", "tasks_add_acceptance_criteria", "tasks_update_acceptance_criteria",
  "tasks_add_dependency", "tasks_remove_dependency", "decisions_create", "decisions_list", "links_add", "links_list",
  "links_remove", "activity_list", "profile_info",
] as const;

export type McpToolName = (typeof MCP_FULL_TOOL_NAMES)[number];
export type McpProfile = "full" | "agent";

/**
 * The agent profile supports a complete, non-destructive autonomous workflow.
 * Destructive administration and redundant low-level lifecycle controls remain
 * deliberately named in the full profile; this is profile filtering, never an
 * execute-anything dispatcher.
 */
export const MCP_AGENT_TOOL_NAMES = [
  "profile_info", "search",
  "projects_bootstrap", "projects_list", "projects_get", "projects_update",
  "projects_update_context", "projects_context_history", "projects_context_version_get",
  "projects_context_revert",
  "repositories_add", "repositories_list", "repositories_get",
  "tasks_create", "tasks_list", "tasks_get", "tasks_update", "tasks_update_context",
  "tasks_context_history", "tasks_context_version_get", "tasks_context_revert",
  "start_work", "report", "handoff", "tasks_execution_get", "tasks_worktree_get",
  "tasks_path_ownership_get", "tasks_path_ownership_set", "tasks_git_provenance_get",
  "tasks_work_plan", "tasks_add_criterion_evidence", "tasks_criterion_evidence",
  "tasks_criterion_evidence_policy", "tasks_add_execution_origin", "attention_list",
  "tasks_add_blocker", "tasks_resolve_blocker", "tasks_complete",
  "tasks_add_acceptance_criteria", "tasks_update_acceptance_criteria",
  "tasks_add_dependency", "tasks_remove_dependency",
  "decisions_create", "decisions_list", "links_add", "links_list", "activity_list",
] as const satisfies readonly McpToolName[];

export const MCP_PROFILES = ["full", "agent"] as const satisfies readonly McpProfile[];

export const MCP_TOOL_CATALOG: Record<McpProfile, readonly McpToolName[]> = {
  full: MCP_FULL_TOOL_NAMES,
  agent: MCP_AGENT_TOOL_NAMES,
};

export function parseMcpProfile(value: string | undefined): McpProfile {
  if (value === undefined || value === "") return "full";
  if ((MCP_PROFILES as readonly string[]).includes(value)) return value as McpProfile;
  throw new Error(`Invalid MCP profile \"${value}\". Use one of: ${MCP_PROFILES.join(", ")}.`);
}

export function toolIsInProfile(profile: McpProfile, name: string): boolean {
  return (MCP_TOOL_CATALOG[profile] as readonly string[]).includes(name);
}

export function profileGuidance(profile: McpProfile): string {
  const omitted = MCP_TOOL_CATALOG.full.length - MCP_TOOL_CATALOG[profile].length;
  return profile === "full"
    ? `Active profile: full (${MCP_TOOL_CATALOG.full.length} named typed tools). All supported operations are available.`
    : [
        `Active profile: agent (${MCP_TOOL_CATALOG.agent.length} named typed tools).`,
        `${omitted} destructive, administrative, or redundant low-level lifecycle operations are available only in the full profile.`,
        "The agent profile supports complete non-destructive work, including context, planning, blockers, decisions, evidence, acceptance criteria, collision coordination, and completion.",
        "To use an unavailable operation, restart with --profile full or set AGENT_CONTINUITY_MCP_PROFILE=full.",
        "This server does not provide a generic dispatcher; use the named full-profile operation.",
      ].join("\n");
}

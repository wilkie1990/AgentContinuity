import { z } from "zod";

export const WORKSPACE_TRANSFER_FORMAT = "agent-continuity.workspace" as const;
export const WORKSPACE_TRANSFER_VERSION = 1 as const;

export const workspaceTransferPathModeSchema = z.enum(["redacted", "included"]);
export type WorkspaceTransferPathMode = z.infer<typeof workspaceTransferPathModeSchema>;

/** Raw relational rows are deliberately retained to make snapshots forward auditable. */
export type WorkspaceTransferDocument = {
  format: typeof WORKSPACE_TRANSFER_FORMAT;
  formatVersion: typeof WORKSPACE_TRANSFER_VERSION;
  transfer: {
    pathMode: WorkspaceTransferPathMode;
    sourceMigration: string;
    canonicalDigest: string;
    redactions?: { localBindings: { repositories: number; worktrees: number; git: number; ownership: number } };
  };
  counters: Record<string, number>;
  data: Record<string, Array<Record<string, unknown>>>;
};

export type WorkspaceImportResult = {
  status: "imported" | "already_imported";
  sourceDigest: string;
  transformed: { claims: string[]; executions: string[] };
};

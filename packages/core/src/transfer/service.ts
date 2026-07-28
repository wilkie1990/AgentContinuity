import { createHash } from "node:crypto";
import {
  AgentContinuityError,
  WORKSPACE_TRANSFER_FORMAT,
  WORKSPACE_TRANSFER_VERSION,
  type WorkspaceImportResult,
  type WorkspaceTransferDocument,
  type WorkspaceTransferPathMode,
} from "@agent-continuity/contracts";
import { createDatabase } from "@agent-continuity/database";
import type { SearchService } from "../search/service.js";
import type { Runtime } from "../runtime.js";

const LOCAL_TABLES = [
  "repositories",
  "execution_worktrees",
  "execution_git_baselines",
  "execution_git_snapshots",
  "execution_git_touched_paths",
  "execution_path_ownership_revisions",
  "execution_path_ownership_entries",
] as const;

const TABLES = [
  "projects", "tasks", "acceptance_criteria", "task_dependencies", "task_claims",
  "task_progress", "blockers", "decisions", "links", "task_executions", "execution_origins",
  "task_checkpoints", "task_work_plan_items", "task_handoffs", "criterion_evidence",
  "criterion_evidence_details", "criterion_evidence_policies", "context_versions",
  ...LOCAL_TABLES, "activity_events",
] as const;

type TableName = (typeof TABLES)[number];
type Row = Record<string, unknown>;
type ColumnInfo = { name: string; type: string; notnull: number; pk: number };
type ForeignKeyInfo = { from: string; table: string; to: string };

const ORDER: Record<TableName, string> = {
  projects: "key, id", tasks: "project_id, sort_order, key, id", acceptance_criteria: "task_id, sort_order, id",
  task_dependencies: "task_id, depends_on_task_id", task_claims: "task_id, claimed_at, id",
  task_progress: "task_id, created_at, id", blockers: "key, id", decisions: "key, id", links: "key, id",
  task_executions: "task_id, started_at, id", execution_origins: "execution_id, created_at, id",
  task_checkpoints: "task_id, created_at, id", task_work_plan_items: "task_id, sort_order, id",
  task_handoffs: "task_id, created_at, id", criterion_evidence: "criterion_id, created_at, id",
  criterion_evidence_details: "evidence_id", criterion_evidence_policies: "criterion_id",
  context_versions: "owner_type, owner_id, version, id", repositories: "key, id",
  execution_worktrees: "execution_id, id", execution_git_baselines: "execution_id, id",
  execution_git_snapshots: "baseline_id, sequence, id", execution_git_touched_paths: "snapshot_id, path, id",
  execution_path_ownership_revisions: "execution_id, version, id",
  execution_path_ownership_entries: "revision_id, path_key, id", activity_events: "seq, id",
};

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const MAX_DOCUMENT_ROWS = 100_000;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

function json(value: unknown): string { return JSON.stringify(canonical(value)); }
function digest(value: unknown): string { return createHash("sha256").update(json(value)).digest("hex"); }

function transferPayload(document: Omit<WorkspaceTransferDocument, "transfer"> & { transfer: Omit<WorkspaceTransferDocument["transfer"], "canonicalDigest"> }): unknown {
  return document;
}

function normalizeRow(row: Row): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith("_json") && typeof value === "string") {
      try { result[key] = json(JSON.parse(value)); continue; } catch { /* retain invalid historical text */ }
    }
    result[key] = value;
  }
  return result;
}

function invalid(message: string, details: Row = {}): never {
  throw new AgentContinuityError("WORKSPACE_IMPORT_INVALID", message, details);
}

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function insertRows(sqlite: { prepare(sql: string): { run(...values: any[]): unknown }; exec(sql: string): void }, data: WorkspaceTransferDocument["data"]): void {
  const supersessions = data.decisions.map((row) => [row.id, row.superseded_by_id] as const).filter(([, replacement]) => replacement !== null);
  for (const table of TABLES) {
    const rows = data[table];
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const statement = sqlite.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
    for (const row of rows) {
      const values = columns.map((column) => table === "decisions" && column === "superseded_by_id" ? null : row[column]);
      statement.run(...(values as any[]));
    }
  }
  const update = sqlite.prepare("UPDATE decisions SET superseded_by_id = ? WHERE id = ?");
  for (const [id, replacement] of supersessions) update.run(replacement, id);
}

export type WorkspaceTransferService = ReturnType<typeof createWorkspaceTransferService>;

export function createWorkspaceTransferService(runtime: Runtime, search: SearchService) {
  function isCanonicalStateEmpty(): boolean {
    return TABLES.every((table) => (runtime.handle.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count === 0);
  }

  function replay(document: WorkspaceTransferDocument): WorkspaceImportResult | null {
    const receipt = runtime.handle.sqlite.prepare("SELECT format_version, path_mode, result_digest, transformed_json FROM workspace_transfer_receipts WHERE source_digest = ?").get(document.transfer.canonicalDigest) as { format_version: number; path_mode: WorkspaceTransferPathMode; result_digest: string; transformed_json: string } | undefined;
    if (!receipt) return null;
    if (receipt.format_version !== document.formatVersion || receipt.path_mode !== document.transfer.pathMode || build(document.transfer.pathMode).transfer.canonicalDigest !== receipt.result_digest) {
      throw new AgentContinuityError("WORKSPACE_IMPORT_CONFLICT", "Import receipt does not match the current destination workspace.", { sourceDigest: document.transfer.canonicalDigest });
    }
    return { status: "already_imported", sourceDigest: document.transfer.canonicalDigest, transformed: JSON.parse(receipt.transformed_json) as WorkspaceImportResult["transformed"] };
  }

  function build(pathMode: WorkspaceTransferPathMode): WorkspaceTransferDocument {
    const data = Object.fromEntries(TABLES.map((table) => [table, pathMode === "redacted" && (LOCAL_TABLES as readonly string[]).includes(table) ? [] : runtime.handle.sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER[table]}`).all().map((row) => normalizeRow(row as Row))])) as WorkspaceTransferDocument["data"];
    // A task's parent is a foreign key, so serialise the hierarchy parent-first even
    // when caller-selected sort orders put a child ahead of its parent.
    const tasks = data.tasks;
    const byId = new Map(tasks.map((task) => [String(task.id), task]));
    const ordered: Row[] = [];
    const seen = new Set<string>();
    const visiting = new Set<string>();
    const visit = (task: Row) => {
      const id = String(task.id);
      if (seen.has(id)) return;
      if (visiting.has(id)) invalid("Task hierarchy contains a cycle.", { task: id });
      visiting.add(id);
      if (task.parent_task_id) {
        const parent = byId.get(String(task.parent_task_id));
        if (!parent) invalid("Task parent is missing from export.", { task: id, parent: task.parent_task_id });
        visit(parent);
      }
      visiting.delete(id); seen.add(id); ordered.push(task);
    };
    for (const task of tasks) visit(task);
    data.tasks = ordered;
    const counters = Object.fromEntries((runtime.handle.sqlite.prepare("SELECT entity_type, current_value FROM counters ORDER BY entity_type").all() as Array<{ entity_type: string; current_value: number }>).map((row) => [row.entity_type, row.current_value]));
    const redactions = pathMode === "redacted" ? {
      localBindings: {
        repositories: (runtime.handle.sqlite.prepare("SELECT COUNT(*) AS count FROM repositories").get() as { count: number }).count,
        worktrees: (runtime.handle.sqlite.prepare("SELECT COUNT(*) AS count FROM execution_worktrees").get() as { count: number }).count,
        git: ["execution_git_baselines", "execution_git_snapshots", "execution_git_touched_paths"].reduce((sum, table) => sum + (runtime.handle.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count, 0),
        ownership: ["execution_path_ownership_revisions", "execution_path_ownership_entries"].reduce((sum, table) => sum + (runtime.handle.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count, 0),
      },
    } : undefined;
    const sourceMigration = (runtime.handle.sqlite.prepare("SELECT name FROM _migrations ORDER BY name DESC LIMIT 1").get() as { name?: string } | undefined)?.name ?? "none";
    const basis = { format: WORKSPACE_TRANSFER_FORMAT, formatVersion: WORKSPACE_TRANSFER_VERSION, transfer: { pathMode, sourceMigration, ...(redactions ? { redactions } : {}) }, counters, data };
    return { ...basis, transfer: { ...basis.transfer, canonicalDigest: digest(transferPayload(basis)) } };
  }

  function assertDocument(value: unknown): WorkspaceTransferDocument {
    if (!value || typeof value !== "object") invalid("Workspace import must be a JSON object.");
    const doc = value as Partial<WorkspaceTransferDocument>;
    if (!sameKeys(Object.keys(doc).sort(), ["counters", "data", "format", "formatVersion", "transfer"])) invalid("Workspace import has unknown or missing top-level fields.");
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) invalid("Workspace import exceeds the 64 MiB core safety limit.");
    if (doc.format !== WORKSPACE_TRANSFER_FORMAT || doc.formatVersion !== WORKSPACE_TRANSFER_VERSION) invalid("Unsupported workspace transfer format/version.", { format: doc.format, formatVersion: doc.formatVersion });
    if (!doc.transfer) invalid("Invalid transfer metadata.");
    const transferKeys = ["canonicalDigest", "pathMode", "sourceMigration", ...("redactions" in doc.transfer ? ["redactions"] : [])].sort();
    if (!sameKeys(Object.keys(doc.transfer).sort(), transferKeys) || (doc.transfer.pathMode !== "redacted" && doc.transfer.pathMode !== "included") || typeof doc.transfer.canonicalDigest !== "string" || typeof doc.transfer.sourceMigration !== "string") invalid("Invalid transfer metadata.");
    if (doc.transfer.redactions !== undefined) {
      const redactions = doc.transfer.redactions as unknown as Row;
      const local = redactions?.localBindings as Row | undefined;
      if (!local || !sameKeys(Object.keys(redactions).sort(), ["localBindings"]) || !sameKeys(Object.keys(local).sort(), ["git", "ownership", "repositories", "worktrees"]) || Object.values(local).some((count) => !Number.isInteger(count) || Number(count) < 0)) invalid("Invalid local-binding redaction manifest.");
    }
    if (!doc.data || !doc.counters || typeof doc.data !== "object" || typeof doc.counters !== "object") invalid("Transfer data and counters are required.");
    const transferData = doc.data;
    if (!sameKeys(Object.keys(doc.data).sort(), [...TABLES].sort())) invalid("Transfer contains unknown or missing data tables.");
    const counterEntities = ["project", "task", "decision", "blocker", "link", "repository"];
    if (!sameKeys(Object.keys(doc.counters).sort(), counterEntities.sort()) || Object.values(doc.counters).some((count) => !Number.isInteger(count) || Number(count) < 0)) invalid("Counters must be complete non-negative integers.");
    for (const table of TABLES) if (!Array.isArray(doc.data[table])) invalid(`Missing array for ${table}.`, { table });
    if (Object.values(doc.data).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0) > MAX_DOCUMENT_ROWS) invalid("Workspace import exceeds the 100,000-row core safety limit.");
    const applied = new Set((runtime.handle.sqlite.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>).map((row) => row.name));
    if (doc.transfer.sourceMigration !== "none" && !applied.has(doc.transfer.sourceMigration)) invalid("Workspace snapshot requires an unknown database migration.", { sourceMigration: doc.transfer.sourceMigration });
    if ((doc.transfer.pathMode === "redacted" && ((LOCAL_TABLES as readonly string[]).some((table) => transferData[table].length !== 0) || doc.transfer.redactions === undefined)) || (doc.transfer.pathMode === "included" && doc.transfer.redactions !== undefined)) invalid("Path mode and redaction manifest are inconsistent.");
    const basis = { format: doc.format, formatVersion: doc.formatVersion, transfer: Object.fromEntries(Object.entries(doc.transfer).filter(([key]) => key !== "canonicalDigest")), counters: doc.counters, data: doc.data };
    if (digest(basis) !== doc.transfer.canonicalDigest) invalid("Workspace transfer digest does not match document contents.");
    const columnInfo = new Map<TableName, ColumnInfo[]>();
    for (const table of TABLES) {
      const columns = runtime.handle.sqlite.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
      columnInfo.set(table, columns);
      const identities = new Set<string>();
      const expected = columns.map((column) => column.name).sort();
      for (const [index, row] of doc.data[table].entries()) {
        if (!row || typeof row !== "object" || Array.isArray(row)) invalid("Transfer rows must be objects.", { table, index });
        if (!sameKeys(Object.keys(row as Row).sort(), expected)) invalid("Transfer row has unknown or missing fields.", { table, index });
        for (const column of columns) {
          const field = (row as Row)[column.name];
          if (field === null) { if (column.notnull || column.pk) invalid("NULL supplied for a required transfer column.", { table, index, column: column.name }); continue; }
          if (column.type === "TEXT" && typeof field !== "string") invalid("Transfer column has the wrong primitive type.", { table, index, column: column.name, expected: "string" });
          if (column.type === "INTEGER" && (!Number.isSafeInteger(field) || typeof field !== "number")) invalid("Transfer column has the wrong primitive type.", { table, index, column: column.name, expected: "integer" });
          if (column.type === "REAL" && (typeof field !== "number" || !Number.isFinite(field))) invalid("Transfer column has the wrong primitive type.", { table, index, column: column.name, expected: "number" });
        }
        const primary = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
        if (primary.length) {
          const key = primary.map((column) => JSON.stringify((row as Row)[column.name])).join("\0");
          if (identities.has(key)) invalid("Duplicate transfer row identity.", { table, index });
          identities.add(key);
        }
      }
    }
    // Validate every declared FK against the document before opening the write transaction.
    const valuesByTable = new Map<string, Map<string, Set<string>>>();
    for (const table of TABLES) {
      const columns = columnInfo.get(table)!;
      const values = new Map<string, Set<string>>();
      for (const column of columns) values.set(column.name, new Set(doc.data[table].map((row) => JSON.stringify(row[column.name]))));
      valuesByTable.set(table, values);
    }
    for (const table of TABLES) {
      const foreignKeys = runtime.handle.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyInfo[];
      for (const foreignKey of foreignKeys) {
        const target = valuesByTable.get(foreignKey.table)?.get(foreignKey.to);
        if (!target) invalid("Transfer references an unsupported foreign-key target.", { table, target: foreignKey.table });
        for (const [index, row] of doc.data[table].entries()) {
          const referenced = row[foreignKey.from];
          if (referenced !== null && referenced !== undefined && !target.has(JSON.stringify(referenced))) invalid("Dangling foreign-key reference in transfer.", { table, index, field: foreignKey.from, target: foreignKey.table, value: referenced });
        }
      }
    }
    let previousActivitySequence = 0;
    for (const [index, event] of doc.data.activity_events.entries()) {
      const sequence = Number(event.seq);
      if (sequence <= previousActivitySequence) {
        invalid("Activity events must be ordered by a strictly increasing sequence.", {
          table: "activity_events",
          index,
          sequence,
          previousSequence: previousActivitySequence,
        });
      }
      previousActivitySequence = sequence;
    }
    const projectIds = new Set(doc.data.projects.map((row) => String(row.id)));
    const tasks = new Map(doc.data.tasks.map((row) => [String(row.id), row]));
    for (const task of tasks.values()) {
      if (!projectIds.has(String(task.project_id))) invalid("Task references a missing project.", { task: task.id, project: task.project_id });
      if (task.parent_task_id) {
        const parent = tasks.get(String(task.parent_task_id));
        if (!parent || parent.project_id !== task.project_id) invalid("Task parent is missing or cross-project.", { task: task.id, parent: task.parent_task_id });
      }
    }
    const walking = new Set<string>(); const walked = new Set<string>();
    const walk = (id: string) => { if (walked.has(id)) return; if (walking.has(id)) invalid("Task hierarchy contains a cycle.", { task: id }); walking.add(id); const parent = tasks.get(id)?.parent_task_id; if (parent) walk(String(parent)); walking.delete(id); walked.add(id); };
    for (const id of tasks.keys()) walk(id);
    const dependencies = new Map<string, string[]>();
    for (const dependency of doc.data.task_dependencies) dependencies.set(String(dependency.task_id), [...(dependencies.get(String(dependency.task_id)) ?? []), String(dependency.depends_on_task_id)]);
    const dependencyWalking = new Set<string>(); const dependencyWalked = new Set<string>();
    const walkDependencies = (id: string) => { if (dependencyWalked.has(id)) return; if (dependencyWalking.has(id)) invalid("Task dependency graph contains a cycle.", { task: id }); dependencyWalking.add(id); for (const next of dependencies.get(id) ?? []) walkDependencies(next); dependencyWalking.delete(id); dependencyWalked.add(id); };
    for (const id of tasks.keys()) walkDependencies(id);
    const contextKeys = new Set<string>();
    for (const version of doc.data.context_versions) {
      const key = `${version.owner_type}\0${version.owner_id}\0${version.version}`;
      if (contextKeys.has(key)) invalid("Duplicate context owner version.", { owner: version.owner_id, version: version.version });
      contextKeys.add(key);
      const owner = version.owner_type === "project" ? doc.data.projects.find((row) => row.id === version.owner_id) : version.owner_type === "task" ? doc.data.tasks.find((row) => row.id === version.owner_id) : undefined;
      if (!owner || (version.owner_type === "project" && (version.project_id !== version.owner_id || version.task_id !== null)) || (version.owner_type === "task" && (version.task_id !== version.owner_id || version.project_id !== owner.project_id))) invalid("Invalid context owner projection.", { ownerType: version.owner_type, ownerId: version.owner_id });
    }
    for (const owner of [...doc.data.projects, ...doc.data.tasks]) {
      const ownerType = "project_id" in owner ? "task" : "project";
      const history = doc.data.context_versions.filter((version) => version.owner_type === ownerType && version.owner_id === owner.id).sort((a, b) => Number(a.version) - Number(b.version));
      const currentVersion = Number(owner.context_version);
      if ((history.at(-1)?.version ?? 0) !== currentVersion || (history.length && history.at(-1)?.content !== owner.context) || history.some((entry, index) => Number(entry.version) !== index + 1 || Number(entry.character_count) !== Array.from(String(entry.content ?? "")).length || Number(entry.byte_count) !== Buffer.byteLength(String(entry.content ?? ""), "utf8"))) invalid("Current context projection does not match immutable history.", { owner: owner.id });
    }
    const decisions = new Map(doc.data.decisions.map((row) => [String(row.id), row]));
    for (const decision of decisions.values()) if (decision.superseded_by_id) { const replacement = decisions.get(String(decision.superseded_by_id)); if (!replacement || replacement.project_id !== decision.project_id || decision.superseded_at === null) invalid("Invalid decision supersession projection.", { decision: decision.id }); }
    const executions = new Map(doc.data.task_executions.map((row) => [String(row.id), row]));
    const worktrees = new Map(doc.data.execution_worktrees.map((row) => [String(row.id), row]));
    const baselines = new Map(doc.data.execution_git_baselines.map((row) => [String(row.id), row]));
    for (const baseline of baselines.values()) { const worktree = worktrees.get(String(baseline.worktree_id)); if (!worktree || worktree.execution_id !== baseline.execution_id || worktree.repository_id !== baseline.repository_id) invalid("Git baseline does not match its execution worktree/repository.", { baseline: baseline.id }); }
    for (const snapshot of doc.data.execution_git_snapshots) { const baseline = baselines.get(String(snapshot.baseline_id)); if (!baseline || baseline.execution_id !== snapshot.execution_id) invalid("Git snapshot does not match its baseline execution.", { snapshot: snapshot.id }); }
    for (const revision of doc.data.execution_path_ownership_revisions) { const worktree = worktrees.get(String(revision.worktree_id)); if (!executions.has(String(revision.execution_id)) || !worktree || worktree.execution_id !== revision.execution_id || worktree.repository_id !== revision.repository_id) invalid("Ownership revision does not match its execution worktree/repository.", { revision: revision.id }); }
    const prefixes: Record<string, string> = { project: "PRJ-", task: "TASK-", decision: "DEC-", blocker: "BLK-", link: "LNK-", repository: "REP-" };
    const counterTables: Record<string, TableName> = { project: "projects", task: "tasks", decision: "decisions", blocker: "blockers", link: "links", repository: "repositories" };
    for (const [entity, prefix] of Object.entries(prefixes)) {
      const table = counterTables[entity];
      const max = Math.max(0, ...doc.data[table].map((row) => Number(String(row.key).slice(prefix.length))).filter(Number.isInteger));
      if (Number(doc.counters[entity]) < max) invalid("Counter is below an imported key suffix.", { entity, counter: doc.counters[entity], max });
    }
    // Run the database's NOT NULL, type/CHECK, UNIQUE and composite-key rules in a
    // disposable migrated schema before touching the live workspace.
    const scratch = createDatabase({ path: ":memory:" });
    try { insertRows(scratch.sqlite, doc.data as WorkspaceTransferDocument["data"]); }
    catch (error) { invalid("Workspace rows violate database constraints.", { cause: error instanceof Error ? error.message : String(error) }); }
    finally { scratch.close(); }
    return doc as WorkspaceTransferDocument;
  }

  function importWorkspace(value: unknown, options: { acceptLocalPaths?: boolean } = {}): WorkspaceImportResult {
    const document = assertDocument(value);
    if (document.transfer.pathMode === "included" && !options.acceptLocalPaths) invalid("Included local paths require explicit acceptance.");
    const priorReplay = replay(document);
    if (priorReplay) return priorReplay;
    if (!isCanonicalStateEmpty() || (runtime.handle.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_transfer_receipts").get() as { count: number }).count !== 0) {
      throw new AgentContinuityError("WORKSPACE_IMPORT_CONFLICT", "Workspace is not empty and has no matching import receipt.", { sourceDigest: document.transfer.canonicalDigest });
    }
    const transformed = { claims: [] as string[], executions: [] as string[] };
    const data = structuredClone(document.data);
    const now = runtime.now();
    for (const claim of data.task_claims) if (claim.released_at === null) { claim.released_at = now; claim.release_reason = "workspace_import_interrupted"; claim.expiry_recorded_at = now; transformed.claims.push(String(claim.id)); }
    for (const execution of data.task_executions) if (execution.status === "running") { execution.status = "ended"; execution.ended_at = now; execution.termination_reason = "workspace_import_interrupted"; transformed.executions.push(String(execution.id)); }
    return runtime.tx(() => {
      const inTransactionReplay = replay(document);
      if (inTransactionReplay) return inTransactionReplay;
      if (!isCanonicalStateEmpty() || (runtime.handle.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_transfer_receipts").get() as { count: number }).count !== 0) throw new AgentContinuityError("WORKSPACE_IMPORT_CONFLICT", "Workspace changed during import preflight.", { sourceDigest: document.transfer.canonicalDigest });
      // SQLite foreign keys provide the final relational preflight; the surrounding transaction makes failure invisible.
      insertRows(runtime.handle.sqlite, data);
      for (const [entity, value] of Object.entries(document.counters)) {
        if (!Number.isInteger(value) || value < 0) invalid("Invalid counter value.", { entity, value });
        runtime.handle.sqlite.prepare("INSERT INTO counters(entity_type, current_value) VALUES (?, ?) ON CONFLICT(entity_type) DO UPDATE SET current_value = MAX(current_value, excluded.current_value)").run(entity, value);
      }
      runtime.handle.sqlite.exec("DELETE FROM search_documents");
      for (const project of data.projects) search.refreshScope(String(project.id));
      const resultDigest = build(document.transfer.pathMode).transfer.canonicalDigest;
      runtime.handle.sqlite.prepare("INSERT INTO workspace_transfer_receipts(source_digest, format_version, path_mode, result_digest, transformed_json, imported_at) VALUES (?, ?, ?, ?, ?, ?)").run(document.transfer.canonicalDigest, document.formatVersion, document.transfer.pathMode, resultDigest, json(transformed), now);
      runtime.handle.sqlite.exec("DELETE FROM workspace_transfer_receipts WHERE source_digest NOT IN (SELECT source_digest FROM workspace_transfer_receipts ORDER BY imported_at DESC, source_digest DESC LIMIT 100)");
      return { status: "imported" as const, sourceDigest: document.transfer.canonicalDigest, transformed };
    });
  }

  return { exportWorkspace: build, importWorkspace };
}

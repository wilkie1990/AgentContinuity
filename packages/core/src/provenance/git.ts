import type {
  GitBaselineInspection,
  GitCaptureError,
  GitPathChangeKind,
  GitSnapshotInspection,
  GitTouchedPathInput,
} from "@agent-continuity/contracts";
import { execFile, type ExecFileException } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_TOUCHED_PATHS = 5_000;

type CommandResult = { stdout: string; stderr: string };

class GitInspectionFailure extends Error {
  constructor(
    readonly code: GitCaptureError["code"],
    message: string,
  ) {
    super(message);
    this.name = "GitInspectionFailure";
  }
}

export type GitInspectorOptions = {
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export interface GitInspector {
  inspectBaseline(worktreePath: string): Promise<GitBaselineInspection>;
  inspectSnapshot(
    worktreePath: string,
    baselineHeadSha: string | null,
  ): Promise<GitSnapshotInspection>;
}

type MutableTouchedPath = GitTouchedPathInput;

function captureError(error: unknown): GitCaptureError {
  if (error instanceof GitInspectionFailure) {
    return { code: error.code, message: error.message.slice(0, 2_000) };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "git_failed",
    message: `Git inspection failed: ${message}`.slice(0, 2_000),
  };
}

function failedBaseline(error: unknown): GitBaselineInspection {
  return {
    status: "error",
    branch: null,
    detached: false,
    headSha: null,
    dirty: null,
    error: captureError(error),
  };
}

function failedSnapshot(error: unknown): GitSnapshotInspection {
  return {
    ...failedBaseline(error),
    commitShas: [],
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    touchedPaths: [],
  };
}

function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0")
  ) {
    throw new GitInspectionFailure(
      "invalid_output",
      "Git returned a path outside the explicitly associated worktree.",
    );
  }
  return normalized;
}

function kindForStatus(status: string): GitPathChangeKind {
  switch (status[0]) {
    case "A":
      return "added";
    case "M":
    case "T":
    case "U":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "?":
      return "untracked";
    default:
      return "unknown";
  }
}

function pathKey(path: string, previousPath: string | null | undefined): string {
  return `${path}\0${previousPath ?? ""}`;
}

function addTouched(
  paths: Map<string, MutableTouchedPath>,
  entry: MutableTouchedPath,
): void {
  const normalized: MutableTouchedPath = {
    ...entry,
    path: normalizeRelativePath(entry.path),
    previousPath: entry.previousPath
      ? normalizeRelativePath(entry.previousPath)
      : null,
  };
  const key = pathKey(normalized.path, normalized.previousPath);
  const existing = paths.get(key);
  paths.set(key, {
    ...normalized,
    additions: normalized.additions ?? existing?.additions ?? null,
    deletions: normalized.deletions ?? existing?.deletions ?? null,
  });
  if (paths.size > MAX_TOUCHED_PATHS) {
    throw new GitInspectionFailure(
      "output_limit",
      `Git reported more than ${MAX_TOUCHED_PATHS} touched paths.`,
    );
  }
}

function splitNul(output: string): string[] {
  return output.split("\0").filter((token) => token !== "");
}

function parseNameStatus(
  output: string,
  paths: Map<string, MutableTouchedPath>,
): void {
  const tokens = splitNul(output);
  for (let index = 0; index < tokens.length; ) {
    let status = tokens[index++]!.replace(/^\s+/, "");
    let firstPath: string | undefined;
    const tab = status.indexOf("\t");
    if (tab >= 0) {
      firstPath = status.slice(tab + 1);
      status = status.slice(0, tab);
    } else {
      firstPath = tokens[index++];
    }
    if (!firstPath) {
      throw new GitInspectionFailure("invalid_output", "Git returned an incomplete name-status record.");
    }

    const change = kindForStatus(status);
    if (change === "renamed" || change === "copied") {
      const destination = tokens[index++];
      if (!destination) {
        throw new GitInspectionFailure(
          "invalid_output",
          "Git returned an incomplete rename or copy record.",
        );
      }
      addTouched(paths, {
        path: destination,
        previousPath: firstPath,
        change,
        additions: null,
        deletions: null,
      });
    } else {
      addTouched(paths, {
        path: firstPath,
        previousPath: null,
        change,
        additions: null,
        deletions: null,
      });
    }
  }
}

function numericStat(value: string): number | null {
  if (value === "-") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new GitInspectionFailure("invalid_output", "Git returned an invalid numeric diff stat.");
  }
  return parsed;
}

function parseNumstat(
  output: string,
  paths: Map<string, MutableTouchedPath>,
): { additions: number; deletions: number } {
  const tokens = output.split("\0");
  let additions = 0;
  let deletions = 0;

  for (let index = 0; index < tokens.length; ) {
    const record = tokens[index++]!;
    if (!record) continue;
    const fields = record.replace(/^\s+/, "").split("\t");
    if (fields.length < 3) {
      throw new GitInspectionFailure("invalid_output", "Git returned an invalid numstat record.");
    }
    const added = numericStat(fields[0]!);
    const deleted = numericStat(fields[1]!);
    const inlinePath = fields.slice(2).join("\t");
    let path = inlinePath;
    let previousPath: string | null = null;
    if (!inlinePath) {
      previousPath = tokens[index++] || null;
      path = tokens[index++] || "";
    }
    if (!path) {
      throw new GitInspectionFailure("invalid_output", "Git returned an incomplete numstat path.");
    }
    additions += added ?? 0;
    deletions += deleted ?? 0;

    const normalizedPath = normalizeRelativePath(path);
    const normalizedPrevious = previousPath ? normalizeRelativePath(previousPath) : null;
    const direct =
      paths.get(pathKey(normalizedPath, normalizedPrevious)) ??
      [...paths.values()].find((entry) => entry.path === normalizedPath);
    addTouched(paths, {
      path: normalizedPath,
      previousPath: normalizedPrevious ?? direct?.previousPath ?? null,
      change: direct?.change ?? (normalizedPrevious ? "renamed" : "modified"),
      additions: added,
      deletions: deleted,
    });
  }
  return { additions, deletions };
}

function sortedTouchedPaths(paths: Map<string, MutableTouchedPath>): GitTouchedPathInput[] {
  return [...paths.values()].sort((left, right) =>
    left.path === right.path
      ? (left.previousPath ?? "").localeCompare(right.previousPath ?? "")
      : left.path.localeCompare(right.path),
  );
}

export class LocalGitInspector implements GitInspector {
  readonly executable: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;

  constructor(options: GitInspectorOptions = {}) {
    this.executable = options.executable ?? "git";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  private command(
    args: string[],
    cwd: string,
    allowedExitCodes: number[] = [],
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        args,
        {
          cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: "0",
            GIT_TERMINAL_PROMPT: "0",
            LC_ALL: "C",
          },
          maxBuffer: this.maxOutputBytes,
          timeout: this.timeoutMs,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ stdout, stderr });
            return;
          }
          const exitCode = typeof error.code === "number" ? error.code : null;
          if (exitCode !== null && allowedExitCodes.includes(exitCode)) {
            resolve({ stdout, stderr });
            return;
          }
          reject(this.commandFailure(error, stderr));
        },
      );
    });
  }

  private commandFailure(error: ExecFileException, stderr: string): GitInspectionFailure {
    if (
      error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
      error.message.toLowerCase().includes("maxbuffer")
    ) {
      return new GitInspectionFailure(
        "output_limit",
        `Git output exceeded the ${this.maxOutputBytes}-byte capture limit.`,
      );
    }
    if (error.killed || error.code === "ETIMEDOUT") {
      return new GitInspectionFailure(
        "timed_out",
        `Git inspection exceeded the ${this.timeoutMs} ms timeout.`,
      );
    }
    const detail = stderr.trim() || error.message;
    return new GitInspectionFailure("git_failed", `Git command failed: ${detail}`.slice(0, 2_000));
  }

  private async validateWorktree(worktreePath: string): Promise<string> {
    if (!isAbsolute(worktreePath)) {
      throw new GitInspectionFailure(
        "worktree_unavailable",
        "The stored execution worktree path is not absolute.",
      );
    }
    let canonical: string;
    try {
      const details = await stat(worktreePath);
      if (!details.isDirectory()) throw new Error("not a directory");
      canonical = await realpath(worktreePath);
    } catch {
      throw new GitInspectionFailure(
        "worktree_unavailable",
        "The explicitly associated execution worktree is missing or inaccessible.",
      );
    }

    const inside = await this.command(
      ["rev-parse", "--is-inside-work-tree"],
      canonical,
      [128],
    );
    if (inside.stdout.trim() !== "true") {
      throw new GitInspectionFailure(
        "not_git_repository",
        "The explicitly associated execution worktree is not a Git worktree.",
      );
    }

    const topLevelOutput = await this.command(["rev-parse", "--show-toplevel"], canonical);
    let topLevel: string;
    try {
      topLevel = await realpath(topLevelOutput.stdout.trim());
    } catch {
      throw new GitInspectionFailure(
        "invalid_output",
        "Git returned an unavailable worktree root.",
      );
    }
    const outside = relative(canonical, topLevel);
    if (outside !== "") {
      throw new GitInspectionFailure(
        "invalid_output",
        "The stored execution worktree must identify the Git worktree root.",
      );
    }
    return canonical;
  }

  private async state(cwd: string): Promise<{
    branch: string | null;
    detached: boolean;
    headSha: string | null;
    dirty: boolean;
  }> {
    const [branchResult, headResult, statusResult] = await Promise.all([
      this.command(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd, [1]),
      this.command(["rev-parse", "--verify", "--quiet", "HEAD"], cwd, [1]),
      this.command(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd),
    ]);
    const branch = branchResult.stdout.trim() || null;
    const headSha = headResult.stdout.trim().toLowerCase() || null;
    if (headSha && !/^[0-9a-f]{40,64}$/.test(headSha)) {
      throw new GitInspectionFailure("invalid_output", "Git returned an invalid HEAD object id.");
    }
    return {
      branch,
      detached: branch === null && headSha !== null,
      headSha,
      dirty: statusResult.stdout.length > 0,
    };
  }

  async inspectBaseline(worktreePath: string): Promise<GitBaselineInspection> {
    try {
      const cwd = await this.validateWorktree(worktreePath);
      return { status: "ok", ...(await this.state(cwd)), error: null };
    } catch (error) {
      if (
        error instanceof GitInspectionFailure &&
        error.code === "git_failed" &&
        error.message.includes("not a git repository")
      ) {
        return failedBaseline(
          new GitInspectionFailure(
            "not_git_repository",
            "The explicitly associated execution worktree is not a Git worktree.",
          ),
        );
      }
      return failedBaseline(error);
    }
  }

  async inspectSnapshot(
    worktreePath: string,
    baselineHeadSha: string | null,
  ): Promise<GitSnapshotInspection> {
    try {
      const cwd = await this.validateWorktree(worktreePath);
      const current = await this.state(cwd);
      const touched = new Map<string, MutableTouchedPath>();

      const range =
        baselineHeadSha && current.headSha
          ? `${baselineHeadSha}..${current.headSha}`
          : current.headSha;
      const commitShas = range
        ? splitNul(
            (
              await this.command(
                ["rev-list", "--reverse", "--max-count=100", "-z", range],
                cwd,
              )
            ).stdout,
          ).map((sha) => sha.trim()).filter(Boolean)
        : [];

      let finalNameStatus = "";
      let finalNumstat = "";
      const comparisonHead =
        baselineHeadSha ??
        (current.headSha
          ? current.headSha.length === 64
            ? "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321"
            : "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
          : null);
      if (comparisonHead) {
        [finalNameStatus, finalNumstat] = await Promise.all([
          this.command(
            [
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--find-renames",
              "--name-status",
              "-z",
              comparisonHead,
              "--",
            ],
            cwd,
          ).then((result) => result.stdout),
          this.command(
            [
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--find-renames",
              "--numstat",
              "-z",
              comparisonHead,
              "--",
            ],
            cwd,
          ).then((result) => result.stdout),
        ]);
      } else {
        const [cachedStatus, cachedNumstat, unstagedStatus, unstagedNumstat] =
          await Promise.all([
            this.command(
              ["diff", "--cached", "--no-ext-diff", "--find-renames", "--name-status", "-z", "--"],
              cwd,
            ),
            this.command(
              ["diff", "--cached", "--no-ext-diff", "--find-renames", "--numstat", "-z", "--"],
              cwd,
            ),
            this.command(
              ["diff", "--no-ext-diff", "--find-renames", "--name-status", "-z", "--"],
              cwd,
            ),
            this.command(
              ["diff", "--no-ext-diff", "--find-renames", "--numstat", "-z", "--"],
              cwd,
            ),
          ]);
        finalNameStatus = cachedStatus.stdout + unstagedStatus.stdout;
        finalNumstat = cachedNumstat.stdout + unstagedNumstat.stdout;
      }

      if (range) {
        const history = await this.command(
          [
            "log",
            "--format=tformat:",
            "--name-status",
            "-z",
            "--find-renames",
            range,
            "--",
          ],
          cwd,
        );
        parseNameStatus(history.stdout, touched);
      }

      // Apply the final baseline-to-worktree state after commit history so the latest
      // observed status wins when a path changed more than once during the execution.
      parseNameStatus(finalNameStatus, touched);
      const totals = parseNumstat(finalNumstat, touched);

      const untracked = await this.command(
        ["ls-files", "--others", "--exclude-standard", "-z"],
        cwd,
      );
      for (const path of splitNul(untracked.stdout)) {
        addTouched(touched, {
          path,
          previousPath: null,
          change: "untracked",
          additions: null,
          deletions: null,
        });
      }

      const touchedPaths = sortedTouchedPaths(touched);
      return {
        status: "ok",
        ...current,
        error: null,
        commitShas,
        additions: totals.additions,
        deletions: totals.deletions,
        filesChanged: touchedPaths.length,
        touchedPaths,
      };
    } catch (error) {
      if (
        error instanceof GitInspectionFailure &&
        error.code === "git_failed" &&
        error.message.includes("not a git repository")
      ) {
        return failedSnapshot(
          new GitInspectionFailure(
            "not_git_repository",
            "The explicitly associated execution worktree is not a Git worktree.",
          ),
        );
      }
      return failedSnapshot(error);
    }
  }
}

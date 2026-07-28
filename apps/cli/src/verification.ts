import type { LocalVerificationPayload, VerificationOutcome } from "@agent-continuity/contracts";
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const DEFAULT_VERIFICATION_TIMEOUT_MS = 60_000;
export const MAX_VERIFICATION_TIMEOUT_MS = 15 * 60_000;
export const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;
export const MAX_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 1_000;

type Tail = {
  append(chunk: Buffer): void;
  readonly bytes: number;
  readonly truncated: boolean;
  text(): string;
};

function boundedTail(limit: number): Tail {
  let chunks: Buffer[] = [];
  let kept = 0;
  let bytes = 0;
  return {
    append(chunk) {
      bytes += chunk.length;
      chunks.push(chunk);
      kept += chunk.length;
      while (kept > limit && chunks.length > 0) {
        const overflow = kept - limit;
        const first = chunks[0]!;
        if (overflow >= first.length) {
          kept -= first.length;
          chunks.shift();
        } else {
          chunks[0] = first.subarray(overflow);
          kept -= overflow;
        }
      }
    },
    get bytes() {
      return bytes;
    },
    get truncated() {
      return bytes > limit;
    },
    text() {
      let value = Buffer.concat(chunks, kept);
      // A byte-tail can begin in the middle of a UTF-8 sequence. Drop only leading
      // continuation bytes so persisted text remains valid while the byte count remains exact.
      let offset = 0;
      while (offset < value.length && (value[offset]! & 0xc0) === 0x80) offset += 1;
      value = value.subarray(offset);
      return value.toString("utf8");
    },
  };
}

function assertBounds(executable: string, args: string[], timeoutMs: number, outputLimitBytes: number) {
  if (!executable || executable.length > 1000 || executable.includes("\0")) {
    throw new Error("Executable must contain 1-1000 characters and no NUL byte.");
  }
  if (args.length > 256 || args.some((arg) => arg.length > 16_000 || arg.includes("\0"))) {
    throw new Error("Verification supports at most 256 arguments of at most 16000 characters.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_VERIFICATION_TIMEOUT_MS) {
    throw new Error("Timeout must be between 1000 and 900000 milliseconds.");
  }
  if (
    !Number.isInteger(outputLimitBytes) ||
    outputLimitBytes < 1 ||
    outputLimitBytes > MAX_OUTPUT_LIMIT_BYTES
  ) {
    throw new Error("Output limit must be between 1 and 1048576 bytes per stream.");
  }
}

export async function resolveVerificationCwd(
  worktreePath: string,
  requested?: string,
): Promise<{ absolute: string; relative: string | null }> {
  const root = await realpath(worktreePath);
  if (requested === undefined) return { absolute: root, relative: null };
  if (
    requested.trim() !== requested ||
    requested === "" ||
    requested === "." ||
    requested === ".." ||
    requested.includes("\\") ||
    isAbsolute(requested) ||
    /^[A-Za-z]:/.test(requested) ||
    requested.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Verification cwd must be a normalized repository-relative directory.");
  }
  const candidate = resolve(root, requested);
  const lexical = relative(root, candidate);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw new Error("Verification cwd escapes the stored execution worktree.");
  }
  const details = await stat(candidate);
  if (!details.isDirectory()) throw new Error("Verification cwd is not a directory.");
  const canonical = await realpath(candidate);
  const resolvedRelative = relative(root, canonical);
  if (
    resolvedRelative === ".." ||
    resolvedRelative.startsWith(`..${sep}`) ||
    isAbsolute(resolvedRelative)
  ) {
    throw new Error("Verification cwd resolves through a symlink outside the stored worktree.");
  }
  return { absolute: canonical, relative: requested };
}

async function gitObservation(
  cwd: string,
): Promise<{ sha: string | null; dirty: boolean | null }> {
  async function capture(args: string[]): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolveCapture) => {
      const child = spawn("git", args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const output = boundedTail(64 * 1024);
      let settled = false;
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.stdout.on("data", (chunk: Buffer) => output.append(chunk));
      child.on("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolveCapture({ code: null, stdout: "" });
        }
      });
      child.on("close", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolveCapture({ code, stdout: output.text() });
        }
      });
    });
  }
  const [head, status] = await Promise.all([
    capture(["rev-parse", "--verify", "HEAD"]),
    capture(["status", "--porcelain", "--untracked-files=normal"]),
  ]);
  const sha = head.code === 0 && /^[0-9a-fA-F]{40,64}$/.test(head.stdout.trim())
    ? head.stdout.trim().toLowerCase()
    : null;
  return { sha, dirty: status.code === 0 ? status.stdout.length > 0 : null };
}

function terminateTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch {
    // The process may have exited between the timeout and the signal.
  }
}

export type VerificationRunInput = {
  worktreePath: string;
  cwd?: string;
  executable: string;
  args: string[];
  name: string;
  timeoutMs?: number;
  outputLimitBytes?: number;
};

export async function runLocalVerification(input: VerificationRunInput): Promise<LocalVerificationPayload> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  const outputLimitBytes = input.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  assertBounds(input.executable, input.args, timeoutMs, outputLimitBytes);
  const cwd = await resolveVerificationCwd(input.worktreePath, input.cwd);
  const before = await gitObservation(input.worktreePath);
  const started = new Date();
  const stdout = boundedTail(outputLimitBytes);
  const stderr = boundedTail(outputLimitBytes);

  const processResult = await new Promise<{
    outcome: VerificationOutcome;
    exitCode: number | null;
    signal: string | null;
    error: string | null;
  }>((resolveRun) => {
    let timedOut = false;
    let spawnError: string | null = null;
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const child = spawn(input.executable, input.args, {
      cwd: cwd.absolute,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.on("error", (error) => {
      spawnError = error.message.slice(0, 4000);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateTree(child.pid, "SIGTERM");
      forceTimer = setTimeout(() => terminateTree(child.pid, "SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      const outcome: VerificationOutcome = spawnError
        ? "spawn_error"
        : timedOut
          ? "timed_out"
          : signal
            ? "signaled"
            : code === 0
              ? "passed"
              : "failed";
      resolveRun({
        outcome,
        exitCode: code,
        signal,
        error: spawnError,
      });
    });
  });

  const finished = new Date();
  const after = await gitObservation(input.worktreePath);
  const revisionStable = before.sha !== null && before.sha === after.sha;
  return {
    source: "local_cli",
    name: input.name,
    command: {
      executable: input.executable,
      args: input.args,
      cwd: cwd.relative,
    },
    timeoutMs,
    outputLimitBytes,
    outcome: processResult.outcome,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    error: processResult.error,
    stdoutTail: stdout.text(),
    stderrTail: stderr.text(),
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    startSha: before.sha,
    endSha: after.sha,
    startDirty: before.dirty,
    endDirty: after.dirty,
    revisionStable,
  };
}

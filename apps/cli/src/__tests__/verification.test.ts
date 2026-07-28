import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVerificationCwd, runLocalVerification } from "../verification.js";

const directories: string[] = [];

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-continuity-verification-"));
  directories.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "verification@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Verification"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "initial\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });
  return root;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI-only local verification runner", () => {
  it("captures passing and nonzero results with Git facts", async () => {
    const root = repository();
    const passed = await runLocalVerification({
      worktreePath: root,
      executable: process.execPath,
      args: ["-e", "process.stdout.write('ok'); process.stderr.write('warn')"],
      name: "pass",
    });
    expect(passed).toMatchObject({
      outcome: "passed",
      exitCode: 0,
      stdoutTail: "ok",
      stderrTail: "warn",
      stdoutBytes: 2,
      stderrBytes: 4,
      revisionStable: true,
      startDirty: false,
      endDirty: false,
    });
    expect(passed.startSha).toMatch(/^[0-9a-f]{40}$/);
    expect(passed.endSha).toBe(passed.startSha);

    const failed = await runLocalVerification({
      worktreePath: root,
      executable: process.execPath,
      args: ["-e", "process.stderr.write('bad'); process.exit(7)"],
      name: "fail",
    });
    expect(failed).toMatchObject({
      outcome: "failed",
      exitCode: 7,
      stderrTail: "bad",
    });
  });

  it("times out, terminates the process group and prevents worker descendants surviving", async () => {
    const root = repository();
    const marker = join(root, "worker-survived.txt");
    const script = [
      "const {spawn}=require('node:child_process');",
      `spawn(process.execPath,['-e',${JSON.stringify(
        `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad'),1800)`,
      )}],{stdio:'ignore'});`,
      "setInterval(()=>{},1000);",
    ].join("");
    const result = await runLocalVerification({
      worktreePath: root,
      executable: process.execPath,
      args: ["-e", script],
      name: "timeout",
      timeoutMs: 1000,
    });
    expect(result.outcome).toBe("timed_out");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(existsSync(marker)).toBe(false);
  });

  it("records spawn errors and signals distinctly", async () => {
    const root = repository();
    const missing = await runLocalVerification({
      worktreePath: root,
      executable: join(root, "does-not-exist"),
      args: [],
      name: "missing",
    });
    expect(missing.outcome).toBe("spawn_error");
    expect(missing.error).toMatch(/ENOENT/);

    const signaled = await runLocalVerification({
      worktreePath: root,
      executable: process.execPath,
      args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
      name: "signaled",
    });
    expect(signaled.outcome).toBe("signaled");
    expect(signaled.signal).toBe("SIGTERM");
  });

  it("keeps fixed-memory UTF-8 tails and exact byte/truncation counters per stream", async () => {
    const root = repository();
    const result = await runLocalVerification({
      worktreePath: root,
      executable: process.execPath,
      args: [
        "-e",
        "for(let i=0;i<200;i++){process.stdout.write('🧪');process.stderr.write('é')}",
      ],
      name: "large",
      outputLimitBytes: 127,
    });
    expect(result.outcome).toBe("passed");
    expect(result.stdoutBytes).toBe(800);
    expect(result.stderrBytes).toBe(400);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdoutTail)).toBeLessThanOrEqual(127);
    expect(Buffer.byteLength(result.stderrTail)).toBeLessThanOrEqual(127);
    expect(result.stdoutTail).not.toContain("\uFFFD");
    expect(result.stderrTail).not.toContain("\uFFFD");
  });

  it("validates cwd lexical and realpath containment", async () => {
    const root = repository();
    mkdirSync(join(root, "packages"));
    mkdirSync(join(root, "..cache"));
    const outside = mkdtempSync(join(tmpdir(), "agent-continuity-verification-outside-"));
    directories.push(outside);
    symlinkSync(outside, join(root, "escape"), "dir");

    await expect(resolveVerificationCwd(root, "packages")).resolves.toEqual({
      absolute: realpathSync(join(root, "packages")),
      relative: "packages",
    });
    await expect(resolveVerificationCwd(root, "..cache")).resolves.toMatchObject({
      relative: "..cache",
    });
    for (const invalid of ["", ".", "..", "../outside", "/tmp", "a\\b", "a//b"]) {
      await expect(resolveVerificationCwd(root, invalid)).rejects.toThrow();
    }
    await expect(resolveVerificationCwd(root, "missing")).rejects.toThrow();
    await expect(resolveVerificationCwd(root, "escape")).rejects.toThrow(/symlink outside/);
  });

  it("records before/after SHA drift and refuses to claim a stable revision", async () => {
    const root = repository();
    const script = [
      "const fs=require('node:fs');const cp=require('node:child_process');",
      "fs.writeFileSync('second.txt','second\\n');",
      "cp.execFileSync('git',['add','second.txt']);",
      "cp.execFileSync('git',['commit','-qm','second']);",
    ].join("");
    const result = await runLocalVerification({
      worktreePath: root,
      executable: process.execPath,
      args: ["-e", script],
      name: "revision drift",
    });
    expect(result.outcome).toBe("passed");
    expect(result.startSha).not.toBe(result.endSha);
    expect(result.revisionStable).toBe(false);
  });
});

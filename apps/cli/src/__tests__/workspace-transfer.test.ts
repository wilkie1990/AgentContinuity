import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram, readBoundedWorkspaceImport, writeWorkspaceExportFile } from "../program.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function directory(): string { const value = mkdtempSync(join(tmpdir(), "ac-transfer-cli-")); directories.push(value); return value; }

describe("workspace transfer CLI file safety", () => {
  it("requires import confirmation and exposes explicit local-path acknowledgement", () => {
    const workspace = buildProgram().commands.find((command) => command.name() === "workspace");
    const importing = workspace?.commands.find((command) => command.name() === "import");
    expect((importing?.options.find((option) => option.long === "--confirm") as any)?.mandatory).toBe(true);
    expect(importing?.options.some((option) => option.long === "--accept-local-paths")).toBe(true);
  });

  it("writes private deterministic content, refuses overwrite, and permits explicit force", () => {
    const file = join(directory(), "backup.json");
    writeWorkspaceExportFile(file, "{\"ok\":true}\n");
    expect(readFileSync(file, "utf8")).toBe("{\"ok\":true}\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() => writeWorkspaceExportFile(file, "changed")).toThrow(/Refusing to overwrite/);
    expect(readFileSync(file, "utf8")).toBe("{\"ok\":true}\n");
    writeWorkspaceExportFile(file, "changed", true);
    expect(readFileSync(file, "utf8")).toBe("changed");
  });

  it("reads normal files in bounded chunks and rejects oversized files before loading", async () => {
    const folder = directory();
    const normal = join(folder, "normal.json");
    writeFileSync(normal, "{}", "utf8");
    await expect(readBoundedWorkspaceImport(normal)).resolves.toBe("{}");
    const oversized = join(folder, "oversized.json");
    writeFileSync(oversized, "", "utf8");
    truncateSync(oversized, 64 * 1024 * 1024 + 1);
    await expect(readBoundedWorkspaceImport(oversized)).rejects.toThrow(/64 MiB/);
  });

  it("refuses interactive stdin rather than waiting for an accidental import", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    try {
      await expect(readBoundedWorkspaceImport("-")).rejects.toThrow(/interactive terminal/);
    } finally {
      if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });
});

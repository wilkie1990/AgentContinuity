import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../client.js";
import { projects } from "../schema.js";

const temporaryDirectories: string[] = [];

function pragmaValue(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
  name: string,
  column = name,
): unknown {
  const row = sqlite.prepare(`PRAGMA ${name}`).get();
  if (typeof row !== "object" || row === null) {
    throw new Error(`PRAGMA ${name} did not return a row.`);
  }
  return Reflect.get(row, column);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("node:sqlite database client", () => {
  it("configures foreign keys and busy timeout for in-memory workspaces", () => {
    const handle = createDatabase({ path: ":memory:" });

    expect(pragmaValue(handle.sqlite, "foreign_keys")).toBe(1);
    expect(pragmaValue(handle.sqlite, "busy_timeout", "timeout")).toBe(5_000);
    expect(pragmaValue(handle.sqlite, "journal_mode")).toBe("memory");

    handle.close();
    expect(handle.sqlite.isOpen).toBe(false);
  });

  it("uses WAL and preserves data when a filesystem workspace is reopened", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-continuity-client-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "workspace.db");
    const first = createDatabase({ path: databasePath });

    expect(pragmaValue(first.sqlite, "journal_mode")).toBe("wal");
    first.sqlite.exec("CREATE TABLE reopen_check (value TEXT NOT NULL)");
    first.sqlite.prepare("INSERT INTO reopen_check (value) VALUES (?)").run("preserved");
    first.close();

    const reopened = createDatabase({ path: databasePath });
    expect(reopened.sqlite.prepare("SELECT value FROM reopen_check").get()).toEqual({
      value: "preserved",
    });
    expect(pragmaValue(reopened.sqlite, "journal_mode")).toBe("wal");
    reopened.close();

    const readonly = createDatabase({ path: databasePath, readonly: true });
    expect(readonly.sqlite.prepare("SELECT value FROM reopen_check").get()).toEqual({
      value: "preserved",
    });
    expect(() =>
      readonly.sqlite.prepare("INSERT INTO reopen_check (value) VALUES (?)").run("rejected"),
    ).toThrow(/readonly/);
    readonly.close();
  });

  it("rolls back failed Drizzle transactions and composes nested runtime-style work", () => {
    const handle = createDatabase({ path: ":memory:" });
    const project = {
      id: "project-id",
      key: "PRJ-0001",
      name: "Rolled back",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(() =>
      handle.db.transaction((tx) => {
        tx.insert(projects).values(project).run();
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(handle.db.select().from(projects).all()).toEqual([]);

    handle.db.transaction((tx) => {
      tx.insert(projects).values({ ...project, name: "Committed" }).run();
      handle.db
        .update(projects)
        .set({ objective: "Same synchronous connection" })
        .run();
    });
    expect(handle.db.select().from(projects).get()).toMatchObject({
      name: "Committed",
      objective: "Same synchronous connection",
    });
    handle.close();
  });
});

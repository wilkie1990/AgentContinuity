import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrate.js";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const temporaryDirectories: string[] = [];

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex").slice(0, 16);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("applies later migrations to a database that already has the initial schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-continuity-migrations-"));
    temporaryDirectories.push(directory);
    const sqlite = new Database(join(directory, "workspace.db"));
    const initial = readFileSync(join(migrations, "0001_initial.sql"), "utf8");

    sqlite.exec(initial);
    sqlite.exec(`
      CREATE TABLE _migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    sqlite
      .prepare("INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)")
      .run("0001_initial.sql", checksum(initial), "2026-01-01T00:00:00.000Z");

    expect(runMigrations(sqlite, migrations)).toEqual(["0002_execution_continuity.sql"]);
    expect(
      sqlite
        .prepare("SELECT name FROM _migrations ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual(["0001_initial.sql", "0002_execution_continuity.sql"]);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_executions'")
        .get(),
    ).toBeTruthy();

    sqlite.close();
  });
});

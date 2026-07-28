import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Works from both `src/` (tests, tsx) and `dist/` (built output). */
export function migrationsDir(): string {
  return join(here, "..", "migrations");
}

export type AppliedMigration = { name: string; checksum: string; appliedAt: string };

type AppliedMigrationRow = Pick<AppliedMigration, "name" | "checksum">;

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex").slice(0, 16);
}

function isAppliedMigrationRow(row: unknown): row is AppliedMigrationRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "name" in row &&
    typeof row.name === "string" &&
    "checksum" in row &&
    typeof row.checksum === "string"
  );
}

/**
 * Applies every not-yet-applied `.sql` file in `migrations/`, in filename order,
 * inside a single transaction per migration.
 */
export function runMigrations(sqlite: DatabaseSync, directory = migrationsDir()): string[] {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Map(
    sqlite
      .prepare("SELECT name, checksum FROM _migrations")
      .all()
      .map((row) => {
        if (!isAppliedMigrationRow(row)) {
          throw new Error("Invalid row found in _migrations.");
        }
        return [row.name, row.checksum] as const;
      }),
  );

  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const executed: string[] = [];
  const insert = sqlite.prepare(
    "INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)",
  );

  for (const file of files) {
    const contents = readFileSync(join(directory, file), "utf8");
    const hash = checksum(contents);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== hash) {
        throw new Error(
          `Migration ${file} has changed since it was applied (expected checksum ${previous}, found ${hash}).`,
        );
      }
      continue;
    }

    sqlite.exec("BEGIN");
    try {
      sqlite.exec(contents);
      insert.run(file, hash, new Date().toISOString());
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
    executed.push(file);
  }

  return executed;
}

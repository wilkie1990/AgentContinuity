import { drizzle } from "drizzle-orm/node-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrate.js";

export type WorkspaceDatabase = ReturnType<typeof drizzle>;

export type DatabaseHandle = {
  db: WorkspaceDatabase;
  sqlite: DatabaseSync;
  path: string;
  close(): void;
};

export type CreateDatabaseOptions = {
  /** Absolute file path, or ":memory:" for an ephemeral database (used by tests). */
  path: string;
  migrate?: boolean;
  readonly?: boolean;
};

export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const { path, migrate = true, readonly = false } = options;

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new DatabaseSync(path, {
    readOnly: readonly,
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });

  // WAL is persistent for file databases. In-memory databases report `memory`.
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  if (migrate && !readonly) {
    runMigrations(sqlite);
  }

  const db = drizzle({ client: sqlite });

  return {
    db,
    sqlite,
    path,
    close() {
      sqlite.close();
    },
  };
}

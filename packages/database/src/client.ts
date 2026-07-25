import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrate.js";
import * as schema from "./schema.js";

export type WorkspaceDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseHandle = {
  db: WorkspaceDatabase;
  sqlite: Database.Database;
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

  const sqlite = new Database(path, { readonly });

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Wait rather than fail immediately when the CLI, server and MCP server contend.
  sqlite.pragma("busy_timeout = 5000");

  if (migrate && !readonly) {
    runMigrations(sqlite);
  }

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    path,
    close() {
      sqlite.close();
    },
  };
}

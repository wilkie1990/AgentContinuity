import type { DatabaseHandle, WorkspaceDatabase } from "@agent-continuity/database";
import { randomUUID } from "node:crypto";

export type Clock = () => Date;

export type RuntimeOptions = {
  claimTtlMinutes: number;
  clock?: Clock;
  idFactory?: () => string;
};

/**
 * Shared execution context for the core services.
 *
 * better-sqlite3 is synchronous, so a single mutable "current connection" is enough to
 * make any service call participate in an outer transaction without threading a `tx`
 * argument through every signature. Nested `tx()` calls join the enclosing transaction.
 */
export class Runtime {
  readonly handle: DatabaseHandle;
  readonly claimTtlMinutes: number;

  #base: WorkspaceDatabase;
  #current: WorkspaceDatabase | null = null;
  #clock: Clock;
  #idFactory: () => string;

  constructor(handle: DatabaseHandle, options: RuntimeOptions) {
    this.handle = handle;
    this.#base = handle.db;
    this.claimTtlMinutes = options.claimTtlMinutes;
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  /** The connection every repository must use: the active transaction when one is open. */
  get db(): WorkspaceDatabase {
    return this.#current ?? this.#base;
  }

  get inTransaction(): boolean {
    return this.#current !== null;
  }

  tx<T>(fn: () => T): T {
    if (this.#current) return fn();
    return this.#base.transaction((tx) => {
      this.#current = tx as unknown as WorkspaceDatabase;
      try {
        return fn();
      } finally {
        this.#current = null;
      }
    });
  }

  now(): string {
    return this.#clock().toISOString();
  }

  nowDate(): Date {
    return this.#clock();
  }

  newId(): string {
    return this.#idFactory();
  }

  /** ISO timestamp `minutes` in the future, used for claim leases. */
  future(minutes: number): string {
    return new Date(this.#clock().getTime() + minutes * 60_000).toISOString();
  }
}

export function minutesBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
}

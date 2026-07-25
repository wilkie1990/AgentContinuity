import { formatKey, type KeyEntity } from "@agent-workspace/contracts";
import { counters } from "@agent-workspace/database";
import { eq, sql } from "drizzle-orm";
import type { Runtime } from "./runtime.js";

/**
 * Allocates the next human-readable key for an entity type.
 *
 * The read-modify-write happens in a single atomic UPDATE ... RETURNING, and callers
 * always run inside a transaction so a rolled back operation never burns a key.
 */
export function nextKey(runtime: Runtime, entity: KeyEntity): string {
  const updated = runtime.db
    .update(counters)
    .set({ currentValue: sql`${counters.currentValue} + 1` })
    .where(eq(counters.entityType, entity))
    .returning({ value: counters.currentValue })
    .get();

  if (updated) return formatKey(entity, updated.value);

  // Counter row missing (a database created before the entity existed): seed it at 1.
  const inserted = runtime.db
    .insert(counters)
    .values({ entityType: entity, currentValue: 1 })
    .onConflictDoUpdate({
      target: counters.entityType,
      set: { currentValue: sql`${counters.currentValue} + 1` },
    })
    .returning({ value: counters.currentValue })
    .get();

  return formatKey(entity, inserted.value);
}

/** Human readable identifier prefixes. Internally every row also carries a UUID primary key. */
export const KEY_PREFIXES = {
  project: "PRJ",
  task: "TASK",
  decision: "DEC",
  blocker: "BLK",
  link: "LNK",
  repository: "REP",
} as const;

export type KeyEntity = keyof typeof KEY_PREFIXES;

const KEY_PATTERN = /^(PRJ|TASK|DEC|BLK|LNK|REP)-(\d{1,10})$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatKey(entity: KeyEntity, value: number): string {
  return `${KEY_PREFIXES[entity]}-${String(value).padStart(4, "0")}`;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/**
 * Normalises a user-supplied key so `task-42`, `TASK-0042` and `TASK-42` all resolve
 * to the canonical `TASK-0042`. Returns null when the value is not a key at all.
 */
export function normaliseKey(value: string): string | null {
  const match = KEY_PATTERN.exec(value.trim());
  if (!match) return null;
  const prefix = match[1].toUpperCase();
  const digits = String(Number.parseInt(match[2], 10)).padStart(4, "0");
  return `${prefix}-${digits}`;
}

export function keyEntityOf(value: string): KeyEntity | null {
  const normalised = normaliseKey(value);
  if (!normalised) return null;
  const prefix = normalised.split("-")[0];
  const entry = Object.entries(KEY_PREFIXES).find(([, candidate]) => candidate === prefix);
  return entry ? (entry[0] as KeyEntity) : null;
}

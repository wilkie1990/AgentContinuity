import { useEffect, useRef, useState } from "react";

/**
 * Local draft text seeded from a server value, kept in sync with background
 * refetches (polling, window refocus) without clobbering an in-progress edit.
 *
 * The draft only re-adopts the server value when the field is not "dirty" —
 * i.e. it still matches the last value we synced from the server. Once the
 * user types something different, background refetches are ignored until
 * either the identity changes (switching to a different task/project, which
 * always resets and discards the draft) or the server catches up to what was
 * saved, at which point the comparison naturally stops flagging it as dirty.
 *
 * Usage mirrors useState so it drops in where a plain useState + sync-effect
 * pair was used before:
 *
 *   const [description, setDescription] = useSyncedDraft(task?.description, task?.id);
 */
export function useSyncedDraft(
  serverValue: string | null | undefined,
  identity: unknown,
): [string, (next: string) => void] {
  const [value, setValue] = useState(serverValue ?? "");
  const identityRef = useRef(identity);
  const lastSyncedRef = useRef(serverValue ?? "");

  useEffect(() => {
    const changedIdentity = identityRef.current !== identity;
    identityRef.current = identity;

    setValue((current) => {
      const dirty = !changedIdentity && current !== lastSyncedRef.current;
      lastSyncedRef.current = serverValue ?? "";
      return changedIdentity || !dirty ? (serverValue ?? "") : current;
    });
  }, [identity, serverValue]);

  return [value, setValue];
}

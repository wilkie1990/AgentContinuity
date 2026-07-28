import { useEffect, useRef, useState, type MutableRefObject } from "react";

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

/**
 * Context drafts additionally pin the server version they were based on. A background
 * refetch may update the displayed server record, but it cannot advance this token
 * while the local text is dirty, so save remains a real optimistic compare-and-swap.
 */
export function useVersionedSyncedDraft(
  serverValue: string | null | undefined,
  serverVersion: number | undefined,
  identity: unknown,
): [string, (next: string) => void, MutableRefObject<number>] {
  const [value, setValue] = useState(serverValue ?? "");
  const identityRef = useRef(identity);
  const lastSyncedRef = useRef(serverValue ?? "");
  const expectedVersionRef = useRef(serverVersion ?? 0);

  useEffect(() => {
    const changedIdentity = identityRef.current !== identity;
    identityRef.current = identity;

    setValue((current) => {
      const nextServerValue = serverValue ?? "";
      const dirty = !changedIdentity && current !== lastSyncedRef.current;
      const serverCaughtUp = current === nextServerValue;
      const adopt = changedIdentity || !dirty || serverCaughtUp;
      lastSyncedRef.current = nextServerValue;
      if (adopt) expectedVersionRef.current = serverVersion ?? 0;
      return adopt ? nextServerValue : current;
    });
  }, [identity, serverValue, serverVersion]);

  return [value, setValue, expectedVersionRef];
}

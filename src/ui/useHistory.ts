import { useCallback, useRef, useState } from "react";

export interface History<T> {
  state: T;
  /** Latest value, even between renders. Use this inside event handlers. */
  getState: () => T;
  commit: (next: T, mergeKey?: string) => void;
  /** Replace without creating an undo entry (initial load, external sync). */
  replace: (next: T) => void;
  /** Replace and discard undo/redo history (open/new document). */
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  /** Stop merging subsequent commits into the current undo entry. */
  endMerge: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface Store<T> {
  past: T[];
  present: T;
  future: T[];
  merge: string | null;
}

interface View<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 100;

/**
 * Snapshot undo/redo for immutable state.
 *
 * The mutable store is the source of truth (so event handlers always see the
 * latest value); a shallow view is mirrored into React state for rendering.
 *
 * Consecutive commits with the same `mergeKey` collapse into one undo entry,
 * which is what a drag or a slider needs: one undo step for the whole gesture.
 * Call `endMerge()` on pointer-up so the next gesture starts a new entry.
 */
export function useHistory<T>(initial: T): History<T> {
  const store = useRef<Store<T>>({
    past: [],
    present: initial,
    future: [],
    merge: null,
  });
  const [view, setView] = useState<View<T>>({
    past: [],
    present: initial,
    future: [],
  });

  const sync = useCallback(() => {
    const current = store.current;
    setView({
      past: [...current.past],
      present: current.present,
      future: [...current.future],
    });
  }, []);

  const getState = useCallback(() => store.current.present, []);

  const commit = useCallback(
    (next: T, mergeKey?: string) => {
      const current = store.current;
      if (Object.is(next, current.present)) return;

      if (!mergeKey || current.merge !== mergeKey) {
        current.past.push(current.present);
        if (current.past.length > LIMIT) current.past.shift();
      }
      current.present = next;
      current.future.length = 0;
      current.merge = mergeKey ?? null;
      sync();
    },
    [sync],
  );

  const replace = useCallback(
    (next: T) => {
      store.current.present = next;
      store.current.merge = null;
      sync();
    },
    [sync],
  );

  const reset = useCallback(
    (next: T) => {
      const current = store.current;
      current.past.length = 0;
      current.future.length = 0;
      current.present = next;
      current.merge = null;
      sync();
    },
    [sync],
  );

  const undo = useCallback(() => {
    const current = store.current;
    const previous = current.past.pop();
    if (previous === undefined) return;
    current.future.push(current.present);
    current.present = previous;
    current.merge = null;
    sync();
  }, [sync]);

  const redo = useCallback(() => {
    const current = store.current;
    const next = current.future.pop();
    if (next === undefined) return;
    current.past.push(current.present);
    current.present = next;
    current.merge = null;
    sync();
  }, [sync]);

  const endMerge = useCallback(() => {
    store.current.merge = null;
  }, []);

  return {
    state: view.present,
    getState,
    commit,
    replace,
    reset,
    undo,
    redo,
    endMerge,
    canUndo: view.past.length > 0,
    canRedo: view.future.length > 0,
  };
}

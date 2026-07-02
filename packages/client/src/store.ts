/**
 * Framework-neutral external-store contract. React consumes it with
 * useSyncExternalStore (all three members); Vue/Svelte bindings wrap
 * subscribe + getSnapshot (see the design spec's binding recipes).
 * getServerSnapshot returns the constant initial snapshot so SSR renders
 * deterministically and hydration matches a fresh client store.
 */
export type ExternalStore<S> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => S;
  getServerSnapshot: () => S;
};

export const createStore = <S,>(initial: S): ExternalStore<S> & { set: (next: S) => void } => {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    // Identical references coalesce: producers reuse the current snapshot to
    // signal "no change" (e.g. a duplicate progress percent) without waking
    // subscribers.
    set: (next) => {
      if (Object.is(next, snapshot)) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
};

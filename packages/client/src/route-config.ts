import type { AnyRouteConfig } from "@upload-stuff/core";

import { type ExternalStore, createStore } from "./store";

export type RouteConfigSnapshot<TConfig = AnyRouteConfig> = {
  data?: TConfig;
  error?: Error;
  isLoading: boolean;
};

export type RouteConfigHandle<TConfig = AnyRouteConfig> = {
  /**
   * Promise face — the single config data path, and the forced-refresh
   * mechanism. Without `force`: starts the fetch when nothing is cached or
   * in flight (retrying after an error), shares the in-flight promise,
   * resolves from cache afterwards. With `{ force: true }`: joins an
   * existing in-flight fetch instead of duplicating it; otherwise starts a
   * fresh fetch while the store keeps serving the cached snapshot (no
   * `isLoading` flip, no reference change) until it settles — a silent
   * background refresh. A successful forced fetch swaps in the fresh data.
   * A failed forced fetch leaves the snapshot completely untouched when
   * cached data existed (stale beats broken), though the returned promise
   * still rejects so imperative callers can react; the in-flight slot
   * clears either way so a later attempt can retry.
   */
  load: (options?: { force?: boolean }) => Promise<TConfig>;
  /**
   * Reactive face over the same entry. Born `{ isLoading: true }` so a
   * render that happens before `subscribe` (React calls getSnapshot first)
   * is already truthful; the first subscribe triggers `load()`.
   */
  store: ExternalStore<RouteConfigSnapshot<TConfig>>;
};

export const createRouteConfigCache = (
  fetcher: (endpoint: string) => Promise<AnyRouteConfig>,
): ((endpoint: string) => RouteConfigHandle) => {
  const handles = new Map<string, RouteConfigHandle>();

  const createHandle = (endpoint: string): RouteConfigHandle => {
    const store = createStore<RouteConfigSnapshot>({ isLoading: true });
    let inFlight: Promise<AnyRouteConfig> | undefined;

    const load = (options?: { force?: boolean }): Promise<AnyRouteConfig> => {
      const { data } = store.getSnapshot();
      const force = options?.force ?? false;

      if (!force && data !== undefined) return Promise.resolve(data);
      // A forced call joins an in-flight fetch (own or subscribe-triggered)
      // rather than duplicating the request.
      if (inFlight) return inFlight;

      // A forced refresh with cached data is a silent background refresh:
      // leave the snapshot (and its reference) exactly as-is while it runs.
      const hadCachedData = data !== undefined;
      if (!hadCachedData) store.set({ isLoading: true });

      inFlight = fetcher(endpoint).then(
        (config) => {
          inFlight = undefined;
          store.set({ data: config, isLoading: false });
          return config;
        },
        (e) => {
          // Clear so the next subscribe/load retries; config errors are
          // transient (network, cold server), not permanent.
          inFlight = undefined;
          const error = e instanceof Error ? e : new Error(String(e));
          // Stale config beats an error for UI purposes — only surface the
          // failure in the snapshot when there was nothing cached to fall
          // back on. Either way the promise below still rejects.
          if (!hadCachedData) store.set({ error, isLoading: false });
          throw error;
        },
      );
      return inFlight;
    };

    return {
      load,
      store: {
        ...store,
        subscribe: (listener) => {
          // Subscriber path never surfaces the rejection — the snapshot
          // carries the error state.
          const { data } = store.getSnapshot();
          if (data === undefined && !inFlight) {
            load().catch(() => {});
          }
          return store.subscribe(listener);
        },
      },
    };
  };

  return (endpoint) => {
    let handle = handles.get(endpoint);
    if (!handle) {
      handle = createHandle(endpoint);
      handles.set(endpoint, handle);
    }
    return handle;
  };
};

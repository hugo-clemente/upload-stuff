import type { AnyRouteConfig } from "@upload-stuff/core";

import { type ExternalStore, createStore } from "./store";

export type RouteConfigSnapshot<TConfig = AnyRouteConfig> = {
  data?: TConfig;
  error?: Error;
  isLoading: boolean;
};

export type RouteConfigHandle<TConfig = AnyRouteConfig> = {
  /**
   * Promise face — the single config data path. Starts the fetch when
   * nothing is cached or in flight (retrying after an error), shares the
   * in-flight promise, resolves from cache afterwards.
   */
  load: () => Promise<TConfig>;
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

    const load = (): Promise<AnyRouteConfig> => {
      const { data } = store.getSnapshot();
      if (data !== undefined) return Promise.resolve(data);
      if (inFlight) return inFlight;

      store.set({ isLoading: true });
      inFlight = fetcher(endpoint).then(
        (config) => {
          store.set({ data: config, isLoading: false });
          return config;
        },
        (e) => {
          // Clear so the next subscribe/load retries; config errors are
          // transient (network, cold server), not permanent.
          inFlight = undefined;
          const error = e instanceof Error ? e : new Error(String(e));
          store.set({ error, isLoading: false });
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

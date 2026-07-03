/* oxlint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type {
  AnyFileRoute,
  CompleteUploadResult,
  EndpointArg,
  ExternalStore,
  RouteConfig,
  UploadCallbacks,
  UploadController,
  UploadStuffClient,
  UploadStuffRouter,
  inferRouteInput,
  inferRouteServerData,
} from "@upload-stuff/client";
import { getAcceptFromType, mergeHeaders, resolveEndpoint } from "@upload-stuff/client";

export type UseUploadStuffOptions<TRoute extends AnyFileRoute> = UploadCallbacks<TRoute> & {
  /**
   * Sent on init and complete requests. Merged under per-call
   * `startUpload(..., { headers })` — the per-call value wins.
   */
  headers?: HeadersInit;
};

export type StartUploadFnOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type StartUploadFn<TRoute extends AnyFileRoute> =
  // Tuple-wrapped to opt out of TS's "conditional type over a bare `any`
  // check type resolves to the union of both branches" behavior. Without
  // it, `StartUploadFn<any>` (what `createUploadStuffReactHelpers<any>`
  // produces in tests) becomes a union of the two function signatures,
  // and calling it with just `files` fails to type-check because the
  // union's stricter (input-required) branch demands a second argument.
  [inferRouteInput<TRoute>] extends [undefined]
    ? (
        files: File[],
        input?: undefined,
        options?: StartUploadFnOptions,
      ) => Promise<CompleteUploadResult<inferRouteServerData<TRoute>>>
    : (
        files: File[],
        input: inferRouteInput<TRoute>,
        options?: StartUploadFnOptions,
      ) => Promise<CompleteUploadResult<inferRouteServerData<TRoute>>>;

export type UseUploadStuffReturn<TRoute extends AnyFileRoute> = {
  startUpload: StartUploadFn<TRoute>;
  /**
   * Is the hook ready to be used?
   */
  isLoading: boolean;
  /**
   * Are files currently being uploaded?
   */
  isUploading: boolean;
  /**
   * Whole-run progress percent (0–100), throttled by
   * `uploadProgressGranularity`.
   */
  progress: number;
  /**
   * Abort the in-flight upload. No-op when idle.
   */
  abort: () => void;
  routeConfig?: RouteConfig<TRoute["$types"]["fileUsageContext"]>;
  accept?: string;
};

const useStore = <S,>(store: ExternalStore<S>): S =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

export const createUploadStuffReactHelpers = <TFileRouter extends UploadStuffRouter>(
  client: UploadStuffClient<TFileRouter>,
) => {
  const useRouteConfig = <TEndpoint extends keyof TFileRouter>(endpoint: TEndpoint) => {
    // Handles are memoized per resolved endpoint in the engine — stable
    // identity across renders without useMemo.
    const handle = client.routeConfig(endpoint);
    const snapshot = useStore(handle.store);
    // Forced, fire-and-forget: failures surface via the snapshot only when
    // there was nothing cached yet (first load); a forced refresh that
    // fails keeps serving the stale snapshot by design, so there is
    // nothing further for this callback to do with the rejection.
    const refetch = useCallback(() => {
      void handle.load({ force: true }).catch(() => {});
    }, [handle]);
    return { data: snapshot.data, error: snapshot.error, isLoading: snapshot.isLoading, refetch };
  };

  const useUploadStuff = <
    TEndpoint extends keyof TFileRouter,
    TRoute extends TFileRouter[TEndpoint],
  >(
    endpoint: EndpointArg<TFileRouter, TEndpoint>,
    opts?: UseUploadStuffOptions<TRoute>,
  ): UseUploadStuffReturn<TRoute> => {
    const resolvedEndpoint = useMemo(
      () => resolveEndpoint<TFileRouter, TEndpoint>(endpoint),
      [endpoint],
    );

    // Controller identity must survive re-renders for the whole upload run,
    // so it lives in state (useMemo may legally discard its cache). Keyed on
    // the resolved endpoint: changing endpoints rebinds to a fresh idle
    // controller and detaches the old run (its callbacks still fire).
    const [box, setBox] = useState(() => ({
      endpoint: resolvedEndpoint,
      controller: client.createUpload<TEndpoint>(resolvedEndpoint),
    }));
    if (box.endpoint !== resolvedEndpoint) {
      setBox({
        endpoint: resolvedEndpoint,
        controller: client.createUpload<TEndpoint>(resolvedEndpoint),
      });
    }
    // `unknown` intermediary: `UploadController<T>` mixes T co- and
    // contravariantly (start()'s params vs getSnapshot()'s return), so a
    // direct `as UploadController<TRoute>` doesn't type-check even though
    // TRoute is constrained to TFileRouter[TEndpoint] — the actual shape
    // returned by client.createUpload above.
    const controller = box.controller as unknown as UploadController<TRoute>;

    const uploadSnapshot = useStore(controller);
    const { data: routeConfig, isLoading } = useRouteConfig(resolvedEndpoint);

    const accept = useMemo(
      () => (routeConfig ? getAcceptFromType(routeConfig.type) : undefined),
      [routeConfig],
    );

    const startUpload = useCallback(
      (async (files: File[], input: any, runOpts?: StartUploadFnOptions) =>
        controller.start(files, {
          ...opts,
          input,
          signal: runOpts?.signal,
          headers: mergeHeaders(opts?.headers, runOpts?.headers),
        } as any)) as StartUploadFn<TRoute>,
      [opts, controller],
    );

    return {
      startUpload,
      isUploading: uploadSnapshot.status === "uploading",
      progress: uploadSnapshot.progressPercent,
      abort: controller.abort,
      routeConfig,
      accept,
      isLoading,
    };
  };

  return {
    useRouteConfig,
    useUploadStuff,
  };
};

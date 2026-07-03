/* oxlint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AnyFileRoute,
  CompleteUploadResult,
  EndpointArg,
  RouteConfig,
  UploadCallbacks,
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

export const createUploadStuffReactHelpers = <TFileRouter extends UploadStuffRouter>(
  client: UploadStuffClient<TFileRouter>,
) => {
  const useRouteConfig = <TEndpoint extends keyof TFileRouter>(endpoint: TEndpoint) => {
    type State = {
      endpoint: TEndpoint;
      data?: TFileRouter[TEndpoint]["routeConfig"];
      error?: Error;
      isLoading: boolean;
    };
    const [state, setState] = useState<State>(() => ({ endpoint, isLoading: true }));
    // Adjust-state-during-render: an endpoint switch must never render the
    // previous endpoint's config. The same key guards every setState below
    // against a stale load settling after a switch.
    if (state.endpoint !== endpoint) setState({ endpoint, isLoading: true });

    const load = useCallback(
      (force: boolean) => {
        client.getRouteConfig(endpoint, { force }).then(
          (data) =>
            setState((prev) =>
              prev.endpoint === endpoint ? { endpoint, data, isLoading: false } : prev,
            ),
          (e: unknown) =>
            setState((prev) => {
              // Stale beats broken: a failed refresh keeps serving the
              // config we already have; only a first load surfaces the error.
              if (prev.endpoint !== endpoint || prev.data !== undefined) return prev;
              return {
                endpoint,
                error: e instanceof Error ? e : new Error(String(e)),
                isLoading: false,
              };
            }),
        );
      },
      [endpoint],
    );

    useEffect(() => {
      load(false);
    }, [load]);

    /**
     * Force a fresh config fetch, e.g. after the route's config changed
     * server-side. Fire-and-forget — failures keep the current data.
     */
    const refetch = useCallback(() => load(true), [load]);

    return { data: state.data, error: state.error, isLoading: state.isLoading, refetch };
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

    // Upload state keyed on the resolved endpoint: switching endpoints
    // presents a fresh idle hook and detaches the old run — its callbacks
    // still fire, but the endpoint key below keeps it off this state.
    const [run, setRun] = useState({ endpoint: resolvedEndpoint, isUploading: false, progress: 0 });
    if (run.endpoint !== resolvedEndpoint) {
      setRun({ endpoint: resolvedEndpoint, isUploading: false, progress: 0 });
    }

    // The active run's AbortController doubles as its identity token: only
    // the active run may settle state or answer abort(). Terminal callbacks
    // may synchronously start the next run while the old frame is still
    // unwinding — the token comparison keeps the old run's finally off the
    // new run's state.
    const activeRef = useRef<{ endpoint: TEndpoint; controller: AbortController } | undefined>(
      undefined,
    );

    const startUpload = useCallback(
      (async (files: File[], input: any, runOpts?: StartUploadFnOptions) => {
        if (activeRef.current?.endpoint === resolvedEndpoint) {
          // Async function → rejected promise, no sync throw.
          throw new Error("An upload is already in progress");
        }
        const token = { endpoint: resolvedEndpoint, controller: new AbortController() };
        activeRef.current = token;

        const callerSignal = runOpts?.signal;
        const onCallerAbort = () => token.controller.abort();
        if (callerSignal?.aborted) token.controller.abort();
        else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

        const update = (partial: Partial<{ isUploading: boolean; progress: number }>) =>
          setRun((prev) => (prev.endpoint === token.endpoint ? { ...prev, ...partial } : prev));
        // Settling BEFORE the user's terminal callback lets that callback
        // synchronously start the next run against an idle hook.
        const settle = () => {
          if (activeRef.current !== token) return;
          activeRef.current = undefined;
          update({ isUploading: false });
        };

        update({ isUploading: true, progress: 0 });
        try {
          return await client.uploadFiles(resolvedEndpoint, files, {
            ...opts,
            input,
            signal: token.controller.signal,
            headers: mergeHeaders(opts?.headers, runOpts?.headers),
            onUploadProgress: (percent: number) => {
              if (activeRef.current === token) update({ progress: percent });
              opts?.onUploadProgress?.(percent);
            },
            onClientUploadComplete: (result: any) => {
              settle();
              opts?.onClientUploadComplete?.(result);
            },
            onUploadError: (error: Error) => {
              settle();
              opts?.onUploadError?.(error);
            },
            onUploadAborted: () => {
              settle();
              opts?.onUploadAborted?.();
            },
          } as any);
        } finally {
          // Rejections that bypass the callbacks (e.g. empty files) still
          // settle; after a callback already settled this is a no-op.
          settle();
          callerSignal?.removeEventListener("abort", onCallerAbort);
        }
      }) as StartUploadFn<TRoute>,
      [opts, resolvedEndpoint],
    );

    const abort = useCallback(() => {
      // Only aborts a run bound to the current endpoint — a run detached by
      // an endpoint switch keeps running.
      if (activeRef.current?.endpoint === resolvedEndpoint) activeRef.current.controller.abort();
    }, [resolvedEndpoint]);

    const { data: routeConfig, isLoading } = useRouteConfig(resolvedEndpoint);

    const accept = useMemo(
      () => (routeConfig ? getAcceptFromType(routeConfig.type) : undefined),
      [routeConfig],
    );

    return {
      startUpload,
      isUploading: run.isUploading,
      progress: run.progress,
      abort,
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
